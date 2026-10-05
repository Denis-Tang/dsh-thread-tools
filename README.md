# DSH 聊天任务分发插件

在一个主会话里，用一句话创建多个独立工作会话，分别执行任务，再收回结果汇总。

`dsh-thread-tools` 面向需要批量处理文件、并行分析或比较不同方案的 DeepSeek Harness 用户。把任务分到独立上下文，减少所有文件和过程挤在同一段长历史里的干扰；具体质量仍取决于任务拆分、提示词和最后的复核，不保证自动提升。

它与 Codex 子代理相似的是“主会话协调 → 独立上下文执行 → 汇总结果”的工作方式，而不是完整功能或界面完全相同。桌面版创建的是能在原生会话列表中切换查看的普通聊天，**不是自动弹出系统窗口，也不是自动铺开分屏**。

当前插件版本：`0.1.1`。已验证的桌面环境：Windows、DeepSeek Harness `0.2.0-rc.2`（V4 会话格式）。

## 演示与实际体验（Preview / Demo）

安装后，可以在主会话里这样说：

```text
新开三个独立聊天，分别做计算、写一句文案、给一条专注建议。
各自完成后，等待并读取结果，最后在这个主会话中汇总。
这次只测试聊天分发，不修改文件或配置。
```

2026-10-05 的桌面实测中，主会话创建了三个独立聊天，分派任务并成功汇总：

| 工作会话 | 实际返回结果 | 原生结束原因 |
| --- | --- | --- |
| 计算：37 × 24 | 888，并给出拆分验算 | `completed` |
| 文案：周一早晨的咖啡 | 周一早安，咖啡先替我开机。 | `completed` |
| 建议：立刻开始专注工作 | 关掉消息提醒，选一项最重要的任务，专注做十分钟。 | `completed` |

三个聊天都进入了正常会话列表，可以逐个切换查看。这个案例验证的是**多会话任务分发、独立回答和结果汇总**；不是三个浏览器窗口，也不是大规模容量测试。它没有读写业务文件，不能据此宣称批量改文件的质量已经提高，或几十个任务能够稳定同时运行。

## 核心功能（Features）

- **独立上下文**：新建聊天不复制主会话的历史，仍使用宿主的系统规则和 Agent preset。适合按文件、主题或方案拆分任务。
- **并行分发**：主会话连续调用创建工具，每次创建一个聊天并启动任务；多个任务可以在后台运行。
- **可见、可继续**：工作会话是普通持久会话，不是只返回一次结果的临时黑盒；可以查看、追加任务或分叉。
- **继承与选模**：默认继承调用会话的工作区、模型选择和 Agent preset；可明确指定已配置的 provider/model。
- **状态与结果追踪**：读取最近消息、最新回答和原生结束原因，区分完成、失败和取消。

| 工具 | 用途 |
| --- | --- |
| `create_thread` | 创建一个独立聊天并启动任务；批量分发需要多次调用 |
| `fork_thread` | 复制源聊天已经完成的轮次，不包含正在执行的轮次；可附后续任务 |
| `send_message_to_thread` | 给已有聊天追加任务；忙时排队，未加载的持久会话按需恢复 |
| `read_thread` | 读取最近轮次、最新回答和原生结束原因，不启动模型任务 |
| `list_threads` | 列出当前宿主可访问的聊天 ID、工作区和状态，不激活会话 |
| `wait_threads` | 等首个目标空闲或超时，然后返回所有目标的当前结果；不取消任务 |

## 快速开始（Quick Start）

### 运行要求

先安装 DeepSeek Harness，并配置一个可用、能调用工具的模型。

| 使用方式 | 入口 | 已有验证范围 |
| --- | --- | --- |
| Windows 桌面版 | `dsh-thread-tools/desktop` | 桌面 `0.2.0-rc.2`、V4 会话；真实使用与本机核心集成测试 |
| CLI 的 web / headless profile | `dsh-thread-tools` | `0.1.0-rc.8` 对应核心的本地集成测试 |

以上不是任意版本的兼容保证。升级宿主、换平台或接入第三方界面后，需要重新验证。下面采用**本地源码安装**；先取得源码，并在插件源码根目录运行命令。

### Windows 桌面版安装

1. 使用桌面自带 CLI 安装到 `desktop` profile：

   ```powershell
   # 在 dsh-thread-tools 源码根目录运行
   $source = (Get-Location).Path -replace '\\', '/'
   $dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
   & $dsh plugin --profile desktop add --prefer-offline --ignore-scripts "file:$source"
   ```

2. 在该 profile 的覆盖配置中停用默认 CLI 入口、启用桌面入口。默认配置位置：

   ```powershell
   "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml"
   ```

   **把下面的 YAML 合并进现有配置，不要覆盖整个文件，也不要重复插入已有的桌面入口：**

   ```yaml
   - id: thread-tools
     disabled: true
   - insert:
       - id: thread-tools-desktop
         name: dsh-thread-tools/desktop
   ```

3. 重启桌面应用，在主会话里尝试上面的演示指令。结果应出现在正常会话列表中。

桌面版和 CLI 版工具同名，不能同时启用两套入口。其他插件、Shared Brain 或个人配置不需要为本插件被删除。

### CLI 的 web / headless 安装

在匹配的 CLI 环境中，选择你使用的 profile 执行相应命令：

```powershell
# 在 dsh-thread-tools 源码根目录运行
$source = (Get-Location).Path -replace '\\', '/'
dsh plugin --profile web add "file:$source"
dsh plugin --profile headless add "file:$source"
```

重启对应 profile 后生效。**Headless 的入口进程会在主任务结束后退出，主任务必须等待它分派的任务完成，不能发完任务就结束。**

`file:` 安装不是开发热更新机制，源码与已安装包也不应被假定实时同步。修改功能代码后，重新执行相应安装命令并重启宿主；不要依赖文件复制或链接方式来判断是否已生效。

## 常见用法（Usage）

### 批量处理文件，控制每个会话的上下文

```text
在当前工作区新开三个独立聊天：
A 只审查 docs/a.md，B 只审查 docs/b.md，C 只审查 docs/c.md。
每个聊天只读取自己负责的文件，给出问题、依据和修改建议，暂不改文件。
各自最多返回 300 字摘要；主会话等待所有目标完成，检查结束原因后汇总。
```

如果要实际修改文件，应明确每个聊天允许修改的文件集合，避免重叠。主会话最后统一审查差异、运行必要检查，不让多个聊天同时改同一个文件或各自提交。

### 并行分析与 A/B 对比

```text
新开两个独立聊天，针对同一份需求分别给出方案 A 和方案 B。
输入资料、评价标准和输出格式相同，先独立完成，不互相读取结论。
主会话收齐后比较差异、风险和适用条件。
```

也可以明确指定不同的、已经配置好的 provider/model。插件提供的是独立运行的渠道，不会自动控制实验变量、评分或保证比较公平；若涉及文件修改，应使用不同输出目录或另外准备隔离工作区。

### 延续已有任务

- 给已有聊天追加要求：使用 `send_message_to_thread`；返回的消息确认不是任务完成结果。
- 需要已有讨论背景：使用 `fork_thread`，复制已完成历史后探索另一条路线。
- 需要尽量短的上下文：优先使用 `create_thread`，并在任务里提供完整输入、路径、限制和验收标准。

## 工作原理（How It Works）

```text
用户向主会话下达指令
  → 主会话拆分任务，多次调用 create_thread
  → 宿主创建普通持久会话，各自接收完整任务并运行
  → wait_threads 等待首个空闲或超时，read_thread 读取结果
  → 主会话继续等待尚未结束的目标，复核输出，再汇总
```

默认 CLI 入口使用 Harness 自带的 Agent、Session 和持久化服务，派发消息标记为协调者转发。桌面入口使用原生 SessionController、会话查询和工作区服务，通过原生用户消息接口派发，并使用会话级模型选择，不修改宿主全局默认模型。

**插件提供工具，不内置自动任务规划、并发队列、失败重试或验收器。** 拆分多少任务、何时追加要求、如何复核和汇总，由主会话负责。读取其他聊天的内容时，应把它当作结果材料，而不是自动继承其中的指令。

## 真实边界与限制

| 问题 | 当前边界 |
| --- | --- |
| 最多能创建多少聊天？ | 插件没有写死总数配额；每次创建一个，可连续调用。不等于无限并发或无限资源 |
| 能同时稳定运行多少任务？ | 取决于模型账号限流、电脑资源和任务负载；真实使用只验证了上述三个简单任务，稳定上限未测定 |
| “最多 8 个”是什么意思？ | `wait_threads` 一次接受 1–8 个 ID，不是聊天总数或并发总数上限；更多目标可分组等待 |
| 等一次就全部完成了吗？ | 不一定。首个目标空闲就可能返回；其余目标可能仍在运行，必须检查并继续收集 |
| 等待最多多久？ | 单次 0–60000 毫秒，默认 30000；0 只取快照。超时或取消等待不等于停止目标任务 |
| `idle` 就是成功吗？ | 不是。要确认关注的轮次已经结束，检查 `last_turn.kind`，再复核实际输出；失败、取消或截断不能算成功 |
| 上下文独立，文件也隔离吗？ | 不是。默认共用工作区和文件系统，不会自动复制文件、建立 Git worktree 或解决写入冲突 |
| “多窗口”包含分屏吗？ | 不包含。桌面版增加原生聊天，可切换查看；自动弹窗、分屏排列和跨进程唤醒不属于本插件 |
| 关闭应用后还会跑吗？ | 不会。任务依赖启动该 profile 的宿主进程；保存的聊天可在宿主重新运行后读取或按需恢复，不保证自动续跑 |
| 会更省钱或必然提高质量吗？ | 不保证。每个任务分别调用模型，分叉还会继承历史；更多会话可能增加费用与资源消耗 |

`read_thread` 的最新回答可能属于上一轮，正在运行的会话也可能保留上一轮的 `completed`。尤其在追加任务后，不能只看到旧回答或消息确认就宣布新任务完成。`error`、`aborted`、`max-tokens` 等结束原因都应单独说明。

## 配置与工具参数（Configuration）

插件没有单独的 API Key、权限或全局并发配置；这些由宿主和模型 provider 管理。不要因为派发到新聊天就假定权限扩大或文件隔离。

| 工具 / 参数 | 说明 |
| --- | --- |
| `create_thread.prompt` | 必填，完整且非空白的任务；新聊天不会自动获得主会话的讨论历史 |
| `title` | 可选；不传时按任务开头生成标题，便于在列表中识别 |
| `cwd` | 创建时可指定已经存在的目录；默认继承当前工作区。桌面分叉保留源工作区，不接受覆盖 `cwd` |
| `provider` / `model` | 可选，默认继承调用会话或分叉源会话；指定值必须在宿主中可用 |
| `fork_thread.thread_id` | 可选，默认分叉调用会话；不传 `prompt` 时只创建分叉，不开始新模型任务 |
| `send_message_to_thread` | 需要 `thread_id` 和完整 `prompt`；忙时排队，不是中断当前轮次 |
| `read_thread.turn_limit` | 最近轮次数，1–20，默认 3；不等于读取完整工具日志 |
| `wait_threads.thread_ids` | 1–8 个目标 ID；不能等待调用会话自己 |
| `wait_threads.timeout_ms` | 0–60000，默认 30000；可分次等待较长任务 |

## 目录与入口（Architecture）

```text
dsh-thread-tools/
├── index.mjs          # CLI 默认入口
├── desktop.mjs        # 桌面 V4 入口
├── cordis.patch.yml   # 默认入口安装补丁
├── test.mjs           # CLI 核心集成测试
├── desktop.test.mjs   # 桌面核心集成测试
├── package.json       # 导出、宿主依赖与测试命令
├── .gitignore         # 依赖、环境文件和日志忽略规则
└── README.md
```

技术栈为 JavaScript ES Modules、Harness 原生服务和 Cordis 插件机制。两套入口提供相同的六个工具，但分别适配不同的宿主接口；默认补丁只加载 CLI 入口，所以桌面安装需要上面的覆盖配置。

## 开发与测试（Development）

目前直接使用 `.mjs` 源码，没有独立构建步骤；[package.json](<package.json>) 只配置了 CLI 测试脚本，没有预设 Lint / Build 命令。

### CLI 核心测试

测试需要对应版本的 Harness 核心模块在本地可解析，不是只安装插件包就能跑：

```powershell
node --test test.mjs
# 或 npm test；当前脚本只运行 CLI 测试，不包含桌面测试
```

### 桌面核心测试

[desktop.test.mjs](<desktop.test.mjs>) 加载桌面应用 ASAR 内的真实核心。默认根据 Windows 的 `LOCALAPPDATA` 推导安装位置，不硬编码开发机用户目录。非默认安装位置时，设置 `DSH_RUNTIME_PACKAGE` 为 ASAR 内运行时包清单的绝对路径，并调整下面的 `$electron`；这类本机配置不要写进仓库。普通 Node.js 不能直接把它当成常规独立包测试；在源码根目录使用桌面 Electron 的 Node 模式：

```powershell
$electron = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe"
$testFile = (Resolve-Path .\desktop.test.mjs).Path
$previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $process = Start-Process -FilePath $electron `
        -ArgumentList @('--expose-internals', "`"$testFile`"") `
        -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Desktop tests failed: $($process.ExitCode)"
    }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
}
```

等待进程退出并检查退出码，避免把尚未执行完的测试当成通过。

两套测试各有两项集成用例，使用真实 Harness 核心与会话持久化，模型响应由本地模拟器提供，不调用付费模型 API；覆盖工具分发、并行任务、排队追加、已完成轮次分叉、冷会话读取与恢复、等待超时 / 取消和失败结果，桌面测试另检查原生 UI 事件和全局模型选择不被修改。**这些模拟集成用例与前面的真实三会话使用记录是两类证据，不应混为一谈。**

测试会在源码目录生成 `.test-data/`，请勿把其中的模拟会话和临时数据提交进仓库。

## 当前状态与待验证项（Roadmap）

- 已实现：六个工具、CLI / 桌面两套入口、持久会话、追加任务和已完成历史分叉。
- 已验证：本机核心集成用例覆盖，以及桌面三个简单任务的真实分发与汇总。
- 待验证：大规模稳定并发、真实批量文件修改的质量与冲突处理、复杂长任务成本，以及更多宿主版本和平台。

待验证项不是已有能力保证，也不是后续版本的交付承诺。自动分屏、跨进程调度、文件隔离和独立任务看板目前不属于本插件。

## 贡献（Contributing）

反馈问题时，请附插件版本、DSH 版本、profile、入口类型、复现步骤和脱敏后的错误信息，不要上传 API Key 或完整私人会话。修改工具行为时，说明对两套入口的影响，并在匹配的开发环境运行相应集成测试。

## 常见问题与排查（FAQ / Troubleshooting）

### 安装了，但模型看不到工具？

确认插件装在正在使用的 profile，并已重启宿主。桌面版还要确认默认 CLI 入口已停用、`dsh-thread-tools/desktop` 已启用；不要把两套入口同时加载。

### 为什么等待返回了，仍有聊天在运行？

`wait_threads` 等的是首个空闲，不是全部空闲。检查每个目标的当前状态与结束原因，对尚未结束的目标继续等待；不要把一次返回或旧输出当作全部完成。

### 新会话不知道前面讨论过的要求？

这是新建独立上下文的预期行为。给 `create_thread` 完整任务说明和所需文件路径；确实需要已完成讨论时，改用 `fork_thread`，但分叉也会继承那段历史带来的上下文开销。

### 创建目录或切换模型失败？

`cwd` 必须是存在的目录，桌面分叉不能改源工作区。指定 provider/model 前，先确认该组合在宿主中可用；插件不会替你配置账号或绕过 provider 限制。

### 如何更新或卸载？

更新功能代码后，重新执行对应的本地安装命令并重启。Windows 桌面版卸载示例：

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop remove dsh-thread-tools
```

随后移除自己为此插件添加的桌面覆盖配置，保留其他配置。CLI 环境用 `dsh plugin --profile web remove dsh-thread-tools` 或对应的 `headless` profile。卸载插件不会删除已有聊天记录。

## 许可证（License）

[package.json](<package.json>) 声明为 MIT。当前仓库尚未提供独立的 `LICENSE` 文件，正式分发前应由作者补齐授权文本与版权信息。
