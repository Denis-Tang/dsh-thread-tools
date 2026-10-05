import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const runtimePackage = process.env.DSH_RUNTIME_PACKAGE?.trim()
  || (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar', 'dsh', 'package.json')
    : undefined);
if (!runtimePackage || !isAbsolute(runtimePackage)) {
  throw new Error('Set DSH_RUNTIME_PACKAGE to the absolute path of the installed DSH runtime package.json.');
}
const runtime = createRequire(runtimePackage);
const native = name => import(pathToFileURL(runtime.resolve(`@deepseek-ai/${name}`)));
const { Context } = await native('cordis');
const { LlmAdapter } = await native('dsh-llm');
const modules = new Map(await Promise.all([
  'cordis-plugin-loader', 'dsh-session', 'dsh-session-projection', 'dsh-agent', 'dsh-llm',
  'dsh-system-prompt', 'dsh-tools', 'dsh-session-title', 'dsh-session-persistence-jsonl',
  'dsh-session-query', 'dsh-agent-loop', 'dsh-typert-registry', 'dsh-agent-default-model',
  'dsh-fs', 'dsh-attachment-local', 'dsh-storage', 'dsh-storage-json', 'dsh-storage-domain',
  'dsh-workspace', 'dsh-agent-preset-registry', 'dsh-api-session-controller', 'dsh-persona',
].map(async name => [name, await native(name)])));
const plugin = await import(process.env.DSH_THREAD_PLUGIN ? pathToFileURL(process.env.DSH_THREAD_PLUGIN) : new URL('./desktop.mjs', import.meta.url));
const workdir = fileURLToPath(new URL('.', import.meta.url));

class MockModel extends LlmAdapter {
  requests = [];
  async *stream(options) {
    this.requests.push(options);
    const task = options.messages.filter(message => message.source?.kind === 'user').at(-1)?.content.find(block => block.type === 'text')?.text ?? '';
    if (task === 'dispatch') {
      const results = options.messages.filter(message => message.source?.kind === 'tool');
      if (results.length < 2) {
        const name = results.length === 0 ? 'create_thread' : 'wait_threads';
        const args = results.length === 0 ? { prompt: 'slow native child', title: 'native child' }
          : { thread_ids: [JSON.parse(results[0].content[0].text).thread_id], timeout_ms: 1000 };
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
  ctx.baseUrl = pathToFileURL(runtime.resolve('@deepseek-ai/dsh-api-session-controller')).href;
  const mount = async (name, config = {}) => {
    const module = modules.get(name).default;
    await ctx.plugin(module, config);
  };
  await mount('cordis-plugin-loader');
  await mount('dsh-session');
  await mount('dsh-session-projection');
  await mount('dsh-agent');
  await mount('dsh-llm');
  await mount('dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false });
  await mount('dsh-tools');
  await mount('dsh-session-title', { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 });
  await mount('dsh-session-persistence-jsonl', { root: join(root, 'sessions'), compression: 'none' });
  await mount('dsh-session-query');
  await mount('dsh-agent-loop');
  await mount('dsh-typert-registry');
  await mount('dsh-agent-default-model', { provider: 'mock', model: 'global-default' });
  await mount('dsh-fs');
  await mount('dsh-attachment-local', { dshHome: root });
  await mount('dsh-storage');
  await ctx.plugin(modules.get('dsh-storage-json'), { root: join(root, 'storage') });
  await ctx.plugin(modules.get('dsh-storage-domain'), { backend: 'json' });
  await mount('dsh-workspace');
  // Text-only test: no browser uploads or external file IO are performed.
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => {},
    bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }),
  });
  await mount('dsh-agent-preset-registry', { default: 'test' });
  await ctx.agentPresets.register({ id: 'test', plugins: [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'local desktop preset' } }] });
  await mount('dsh-api-session-controller', { nativeOpen: false });
  const model = new MockModel();
  ctx.llm.registerAdapter(['mock'], model);
  await ctx.plugin(plugin);
  const workspace = await ctx.workspaceRegistry.create(workdir, 'test workspace');
  const { sessionId } = await ctx.sessionController.create({ workspaceId: workspace.id });
  const owner = ctx.agents.get(sessionId);
  ctx.sessionController.agents.selectForNextRequest(owner, { provider: 'mock', model: 'caller-model' });
  const invoke = (name, args, signal = new AbortController().signal) => ctx.tools.get(name).execute(args, { agent: owner, signal });
  return { ctx, owner, invoke, model, workspace, dispose: () => ctx.fiber.dispose() };
}
async function newRoot() {
  const root = join(workdir, '.test-data');
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'desktop-'));
}

test('desktop V4 core: native UI events, parallel dispatch, queued follow-up and completed-turn fork', async () => {
  const h = await harness(await newRoot());
  try {
    const added = [], statuses = [];
    h.ctx.on('api-session/added', item => added.push(item));
    h.ctx.on('api-session/status', (id, running) => statuses.push({ id, running }));
    assert.equal(['create_thread', 'fork_thread', 'send_message_to_thread', 'read_thread', 'list_threads', 'wait_threads'].filter(name => h.ctx.tools.get(name)).length, 6);
    const slow = await h.invoke('create_thread', { prompt: 'slow A', title: 'desktop A' });
    const fast = await h.invoke('create_thread', { prompt: 'B', title: 'desktop B' });
    const first = await h.invoke('wait_threads', { thread_ids: [slow.thread_id, fast.thread_id], timeout_ms: 1000 });
    assert.equal(first.threads.find(thread => thread.thread_id === fast.thread_id).output, 'done:B');
    assert.equal(first.threads.find(thread => thread.thread_id === slow.thread_id).status, 'running');
    await h.invoke('send_message_to_thread', { thread_id: slow.thread_id, prompt: 'follow-up A' });
    await h.invoke('wait_threads', { thread_ids: [slow.thread_id], timeout_ms: 1000 });
    assert.equal((await h.invoke('read_thread', { thread_id: slow.thread_id })).output, 'done:follow-up A');
    await h.invoke('send_message_to_thread', { thread_id: slow.thread_id, prompt: 'slow in-flight' });
    await delay(15);
    const fork = await h.invoke('fork_thread', { thread_id: slow.thread_id, prompt: 'fork work' });
    await h.invoke('wait_threads', { thread_ids: [fork.thread_id], timeout_ms: 1000 });
    const forked = await h.invoke('read_thread', { thread_id: fork.thread_id, turn_limit: 20 });
    assert.ok(forked.messages.some(message => message.text === 'follow-up A'));
    assert.ok(!forked.messages.some(message => message.text === 'slow in-flight'));
    assert.equal(forked.output, 'done:fork work');
    assert.equal(h.ctx.agents.get(fork.thread_id).session.header.parentSession, slow.thread_id);
    assert.ok(h.workspace.sessionIds.includes(fork.thread_id));
    assert.ok(added.some(item => item.sessionId === slow.thread_id && item.agentAvailable));
    assert.ok(statuses.some(item => item.id === fast.thread_id && !item.running));
    assert.ok((await h.invoke('list_threads', {})).threads.some(thread => thread.thread_id === fork.thread_id));
    assert.ok(h.model.requests.every(request => request.model === 'caller-model'));
    assert.ok(h.model.requests.every(request => JSON.stringify(request.messages).includes('local desktop preset')));
    assert.equal(h.ctx.agentDefaultModel.currentSelection().model, 'global-default');
    await h.ctx.agents.get(slow.thread_id).whenIdle();
    await h.ctx.sessionController.prompt({ sessionId: h.owner.id, requestId: 'dispatch', content: [{ type: 'text', text: 'dispatch' }] }, new AbortController().signal);
    await h.owner.whenIdle();
    const nativeResult = await h.invoke('read_thread', { thread_id: h.owner.id });
    assert.equal(nativeResult.output, 'done:dispatch', JSON.stringify(nativeResult));
    const log = await h.ctx.sessionQuery.readSession(h.owner.id);
    assert.equal(log.events.filter(event => event.type === 'tool/call').length, 2);
    assert.ok(log.events.filter(event => event.type === 'tool/result').every(event => !event.data.message.content[0].isError));
  } finally { await h.dispose(); }
});

test('desktop V4 persistence: cold read/resume/fork, timeout, cancellation and failed turn', async () => {
  const root = await newRoot();
  let h = await harness(root);
  const created = await h.invoke('create_thread', { prompt: 'persisted', title: 'persistent desktop' });
  await h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 1000 });
  await h.dispose();
  h = await harness(root);
  try {
    const cold = await h.invoke('read_thread', { thread_id: created.thread_id });
    assert.equal(cold.live, false);
    assert.equal(cold.title, 'persistent desktop');
    assert.equal(cold.output, 'done:persisted');
    const fork = await h.invoke('fork_thread', { thread_id: created.thread_id, prompt: 'cold fork' });
    await h.invoke('wait_threads', { thread_ids: [fork.thread_id], timeout_ms: 1000 });
    assert.equal((await h.invoke('read_thread', { thread_id: fork.thread_id })).output, 'done:cold fork');
    await h.invoke('send_message_to_thread', { thread_id: created.thread_id, prompt: 'slow resumed' });
    assert.equal((await h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 5 })).threads[0].status, 'running');
    const cancellation = new AbortController();
    const waiting = h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 1000 }, cancellation.signal);
    cancellation.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    await h.invoke('wait_threads', { thread_ids: [created.thread_id], timeout_ms: 1000 });
    assert.equal((await h.invoke('read_thread', { thread_id: created.thread_id })).output, 'done:slow resumed');
    const failed = await h.invoke('create_thread', { prompt: 'fail' });
    await h.invoke('wait_threads', { thread_ids: [failed.thread_id], timeout_ms: 1000 });
    assert.equal((await h.invoke('read_thread', { thread_id: failed.thread_id })).last_turn.kind, 'error');
    assert.equal(h.ctx.agentDefaultModel.currentSelection().model, 'global-default');
  } finally { await h.dispose(); }
});
