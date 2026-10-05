import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import AgentPresets from '@deepseek-ai/dsh-agent-presets';
const plugin = await import(process.env.DSH_THREAD_PLUGIN ? pathToFileURL(process.env.DSH_THREAD_PLUGIN) : new URL('./index.mjs', import.meta.url));

const workdir = fileURLToPath(new URL('.', import.meta.url));
const testRoot = join(workdir, '.test-data');

class MockModel extends LlmAdapter {
  requests = [];
  async *stream(options) {
    this.requests.push(options);
    const task = options.messages.filter(message => message.source?.kind === 'coordinator' || message.source?.kind === 'user').at(-1)?.content.find(block => block.type === 'text')?.text ?? '';
    if (task === 'dispatch') {
      const results = options.messages.filter(message => message.source?.kind === 'tool');
      if (results.length < 2) {
        const name = results.length === 0 ? 'create_thread' : 'wait_threads';
        const args = results.length === 0 ? { prompt: 'slow native child', title: 'native child' }
          : { thread_ids: [JSON.parse(results[0].content[0].content[0].text).thread_id], timeout_ms: 1000 };
        const block = { type: 'tool-call', id: `dispatch-${results.length}`, name, arguments: JSON.stringify(args) };
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'block-end', index: 0, block };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
    }
    if (task.startsWith('slow')) await delay(120, undefined, { signal: options.signal });
    if (task === 'fail') throw new Error('simulated model failure');
    const text = `done:${task}`;
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function harness(root) {
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(join(workdir, 'index.mjs')).href;
  new Loader(ctx);
  new SessionStore(ctx);
  new AgentRegistry(ctx);
  new LlmRuntime(ctx);
  new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 10 });
  new SessionTitle(ctx, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 });
  new Persistence(ctx, { root, compression: 'none', packChunks: false, writeBatchMaxDelayMs: 1 });
  new AgentLoop(ctx, { agents: [], maxParallelToolCalls: 10 });
  const presetRoot = join(root, 'presets');
  await mkdir(join(presetRoot, 'test'), { recursive: true });
  await writeFile(join(presetRoot, 'test', 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n  config:\n    text: "local test preset"\n');
  new AgentPresets(ctx, { default: 'test', roots: [{ path: presetRoot, trust: 'user' }], includeUserRoot: false });
  const model = new MockModel();
  ctx.llm.registerAdapter(['mock'], model);
  await ctx.plugin(plugin);
  const owner = await ctx.agents.create({ sessionId: 'test-caller', meta: { cwd: workdir, agentPreset: 'test' }, agentOptions: { provider: 'mock', model: 'local-test' }, setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'test').then(() => {}) });
  const invoke = (name, args, signal = new AbortController().signal) => ctx.tools.get(name).execute(args, { agent: owner.agent, signal });
  return { ctx, owner, invoke, model, dispose: () => ctx.fiber.dispose() };
}

async function newRoot() {
  await mkdir(testRoot, { recursive: true });
  return mkdtemp(join(testRoot, 'sessions-'));
}

test('real DSH core: independent parallel tasks, queued follow-up, completed-turn fork', async () => {
  const h = await harness(await newRoot());
  try {
    assert.equal(['create_thread', 'fork_thread', 'send_message_to_thread', 'read_thread', 'list_threads', 'wait_threads'].filter(name => h.ctx.tools.get(name)).length, 6);
    const slow = await h.invoke('create_thread', { prompt: 'slow A', title: 'task A' });
    const fast = await h.invoke('create_thread', { prompt: 'B', title: 'task B' });
    assert.notEqual(slow.thread_id, fast.thread_id);
    assert.equal(h.ctx.agents.roots().length, 3);
    assert.equal(h.ctx.agents.get(slow.thread_id).session.events.some(event => event.type === 'assistant/message'), false);
    const first = await h.invoke('wait_threads', { thread_ids: [slow.thread_id, fast.thread_id], timeout_ms: 1000 });
    assert.equal(first.threads.find(thread => thread.thread_id === fast.thread_id).output, 'done:B', JSON.stringify(first));
    assert.equal(first.threads.find(thread => thread.thread_id === slow.thread_id).status, 'running');
    await h.invoke('send_message_to_thread', { thread_id: slow.thread_id, prompt: 'A follow-up' });
    await h.invoke('wait_threads', { thread_ids: [slow.thread_id], timeout_ms: 1000 });
    const result = await h.invoke('read_thread', { thread_id: slow.thread_id });
    assert.equal(result.output, 'done:A follow-up');
    assert.equal(result.last_turn.kind, 'completed');
    assert.equal(result.messages.filter(message => message.role === 'user').length, 2);
    assert.ok(h.model.requests.every(request => request.tools.some(tool => tool.name === 'create_thread')));
    assert.ok(h.model.requests.every(request => request.system.includes('local test preset')));

    await h.invoke('send_message_to_thread', { thread_id: slow.thread_id, prompt: 'slow in-flight' });
    await delay(15);
    const fork = await h.invoke('fork_thread', { thread_id: slow.thread_id, prompt: 'fork work', title: 'fork A' });
    await h.invoke('wait_threads', { thread_ids: [fork.thread_id], timeout_ms: 1000 });
    const forked = await h.invoke('read_thread', { thread_id: fork.thread_id, turn_limit: 20 });
    assert.ok(forked.messages.some(message => message.text === 'A follow-up'));
    assert.ok(!forked.messages.some(message => message.text === 'slow in-flight'));
    assert.equal(forked.output, 'done:fork work');
    assert.equal(h.ctx.agents.get(fork.thread_id).session.header.parentSession, slow.thread_id);
    assert.equal(fork.provider, 'mock');
    assert.equal(fork.model, 'local-test');
    const list = await h.invoke('list_threads', {});
    assert.ok(list.threads.some(thread => thread.thread_id === fork.thread_id));
    await h.ctx.agents.get(slow.thread_id).whenIdle();
    h.owner.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'dispatch' }], source: { kind: 'user' } }));
    await h.owner.agent.whenIdle();
    const native = await h.invoke('read_thread', { thread_id: h.owner.agent.id });
    assert.equal(native.output, 'done:dispatch');
    assert.equal(h.owner.agent.session.events.filter(event => event.type === 'tool/call').length, 2);
    assert.ok(h.owner.agent.session.events.filter(event => event.type === 'tool/result').every(event => !event.data.message.content[0].isError));
  } finally {
    await h.dispose();
  }
});

test('real JSONL persistence: cold read/resume, wait timeout/cancellation and failed outcome', async () => {
  const root = await newRoot();
  let h = await harness(root);
  const created = await h.invoke('create_thread', { prompt: 'persisted', title: 'persistent task' });
  await h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 1000 });
  await h.dispose();
  h = await harness(root);
  try {
    const cold = await h.invoke('read_thread', { thread_id: created.thread_id });
    assert.equal(cold.live, false);
    assert.equal(cold.title, 'persistent task');
    assert.equal(cold.output, 'done:persisted');
    const fork = await h.invoke('fork_thread', { thread_id: created.thread_id, prompt: 'cold fork' });
    await h.invoke('wait_threads', { thread_ids: [fork.thread_id], timeout_ms: 1000 });
    assert.equal((await h.invoke('read_thread', { thread_id: fork.thread_id })).output, 'done:cold fork');
    await h.invoke('send_message_to_thread', { thread_id: created.thread_id, prompt: 'slow resumed' });
    const instant = await h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 0 });
    assert.equal(instant.threads[0].status, 'running');
    const timed = await h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 5 });
    assert.equal(timed.threads[0].status, 'running');
    const cancellation = new AbortController();
    const pending = h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 1000 }, cancellation.signal);
    cancellation.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 1000 });
    assert.equal((await h.invoke('read_thread', { thread_id: created.thread_id })).output, 'done:slow resumed');
    const failed = await h.invoke('create_thread', { prompt: 'fail' });
    await h.invoke('wait_threads', { thread_ids: [failed.thread_id], timeout_ms: 1000 });
    const failure = await h.invoke('read_thread', { thread_id: failed.thread_id });
    assert.equal(failure.last_turn.kind, 'error');
    await assert.rejects(h.invoke('wait_threads', { thread_ids: [h.owner.agent.id] }), /itself/);
  } finally {
    await h.dispose();
  }
});
