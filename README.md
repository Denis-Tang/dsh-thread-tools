# DSH 聊天任务分发插件

把新建聊天、分叉、追加任务和结果追踪提供为 DeepSeek Harness 的模型工具。使用 Harness 自带 Agent、Session 和持久化服务；任务成为普通聊天，Web 界面可直接打开。

| 工具 | 用途 |
| --- | --- |
| `create_thread` | 创建独立聊天并立即执行任务，可连续创建多个 |
| `fork_thread` | 复制指定聊天已经完成的轮次，可附新任务 |
| `send_message_to_thread` | 给已有聊天追加任务，忙时排队，冷会话恢复 |
| `read_thread` | 读取最近轮次、最终回答和原生结束原因 |
| `list_threads` | 列出已有聊天 ID 与工作区 |
| `wait_threads` | 等待首个目标空闲，最长 60 秒；不取消后台任务 |

例如：“新开三个聊天，分别研究 A、B、C，等它们结束后汇总。”新聊天继承当前模型、工作区和 Agent preset；可明确指定其他 provider/model。独立聊天从空历史开始，分叉只继承已经完成的轮次。CLI 消息标记为协调者转发，桌面版通过原生用户消息接口派发。

## 本地安装

需要已安装的 DeepSeek Harness 0.1.0-rc.8。

```powershell
# 在插件源码根目录运行
$source = (Get-Location).Path -replace '\\', '/'
dsh plugin --profile web add "file:$source"
dsh plugin --profile headless add "file:$source"
```

安装后重新启动对应 profile。`file:` 安装复制代码，源码修改后需要重新安装。卸载用 `dsh plugin --profile web remove dsh-thread-tools`，headless 同理；会话日志保留。

任务在启动该 profile 的进程里运行。关闭该进程会停止执行，已经保存的聊天仍可恢复；插件不会创建独立操作系统窗口，也不会唤醒其他 DSH 进程。Headless 的入口进程在主任务结束后退出，因此主任务必须等待它派发的任务完成。结束原因 `error`、`aborted` 或 `max-tokens` 不能当作任务成功。

验证使用本机真实 Harness 核心与本地模拟模型，不调用付费模型。运行 `node --test test.mjs`。

## DeepSeek Harness 桌面版

适配已验证的桌面版 0.2.0-rc.2（会话格式 V4）。同一安装包的 `dsh-thread-tools/desktop` 入口使用桌面原生 SessionController，创建的聊天进入正常会话列表；分叉继承源工作区。桌面核心尚未提供不改全局默认的选模入口，因此通过其会话选择控制器继承模型，仅修改新聊天的选择。

使用桌面自带 CLI 安装：

```powershell
# 在插件源码根目录运行
$source = (Get-Location).Path -replace '\\', '/'
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add --prefer-offline --ignore-scripts "file:$source"
```

在桌面 profile 的覆盖配置中停用默认 CLI 入口并插入桌面入口（从 `$env:USERPROFILE` 下的 `.dsh/profiles/desktop` 定位）：

```yaml
- id: thread-tools
  disabled: true
- insert:
    - id: thread-tools-desktop
      name: dsh-thread-tools/desktop
```

重新启动桌面应用后生效。源码更新需重新执行安装命令。卸载用上述桌面 CLI 的 `plugin --profile desktop remove dsh-thread-tools`，并删除这一覆盖；已有聊天保留。

桌面测试文件 `desktop.test.mjs` 使用应用 ASAR 中的真实 AgentLoop、会话控制器、投影、Agent preset、工作区和 JSONL 持久化，仅模型与空文件上传接口模拟。用 Electron 的 Node 模式运行，Windows 下需等待进程退出才能可靠收集结果：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$testFile = (Resolve-Path .\desktop.test.mjs).Path
Start-Process "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe" -ArgumentList @('--expose-internals', "`"$testFile`"") -WindowStyle Hidden -Wait
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

每套两项集成测试覆盖实际模型工具调用、并行任务、排队追加、完成轮次分叉、原生 UI 事件、冷会话恢复、等待取消及失败结果。未运行真实付费模型，也未自动打开独立操作系统窗口。
