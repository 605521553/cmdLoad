# 架构设计（阶段三及 AI v0.2.0）

> 状态：阶段一桌面基础、紧凑 UI 改版、阶段二 SQLite 命令库、阶段三剪贴板快速收藏、阶段三后续增量、UI/UX 整体改版、命令/分类外观自定义、UI 一致性修复，以及 v0.2.0 AI 智能注释（安全配置、单条预览、自动注释、无注释批量生成）均已实现并通过实际 Windows 桌面和真实 DeepSeek API 验收。工作流仍属于后续阶段。

## 1. 设计目标

- 本地优先：命令、分类、标签与临时剪贴板历史均只保存在本机。
- 快速收藏优先：日常保存路径是「复制 → `Ctrl+Shift+V` → 一次保存」，手动表单只作为辅助入口。
- 原始内容不可变：剪贴板原文按原样进入 SQLite 和系统剪贴板；预览截断、标题生成、Shell 猜测都不修改原文。
- 明确区分三层状态：临时剪贴板历史、永久命令库、永久命令的收藏标记（Favorite）。
- 复用现有 Tauri、React、Rust 结构；不重建工程，不修改已经稳定的托盘、窗口和快捷键逻辑。

## 2. 运行架构

```text
Windows 应用（Terminal / PowerShell / CMD / SSH / VS Code）
        │ 复制文本
        ▼
Windows Clipboard
        ├── 当前 CF_UNICODETEXT 读取（Win32）
        ├── Windows 系统历史（官方 WinRT Clipboard.GetHistoryItemsAsync）
        └── AddClipboardFormatListener / WM_CLIPBOARDUPDATE
                 │
                 ▼
Tauri 2 单进程
  ├── 单 WebView（React 19）
  │     ├── 完整管理：命令库 / 分类 / 剪贴板概览 / 概览 / 设置
  │     └── 快捷面板：剪贴板 / 命令库 / 收藏
  └── Rust
        ├── commands/*：Tauri command 边界
        ├── services/library：Command Repository + Service
        ├── services/clipboard：当前读取、WinRT 历史、监听、历史 Repository
        ├── services/ai：OpenAI 兼容请求、prompt、凭据管理器、注释持久化
        ├── services/database：SQLite 连接、迁移、损坏处理
        └── services/window / hotkey / tray / settings
                 │
                 ▼
        %APPDATA%\com.pata.commands\commands.db
          ├── commands / categories / tags / command_tags
          ├── clipboard_entries（仅本地临时历史）
          └── ai_annotations（与 commands 一对一，独立于手写 title/description）
```

API Key 不在上面的数据流中：只保存在 Windows Credential Manager 的目标 `PataCommands/AI/OpenAICompatible`，由 Rust 在请求前读取。

单个 WebView 通过 `set_ui_mode` 在管理界面和快捷面板之间切换；两套界面共享同一个 Rust 数据服务和同一个 SQLite 连接。

## 3. 模块职责

### React 前端

- `app/`：模式切换、启动快照、全局事件桥接。
- `features/command-manager/`：命令库 CRUD、列表/树状视图、分类树与分类排序、命令编辑器、详情预览、概览、剪贴板本地历史页。
- `features/prompts/`：独立提示词库页面、文本卡片列表、完整原文预览、纯文本编辑器、提示词右键菜单/颜色 Popover、共享 prompt actions。
- `features/updater/`：启动静默检查、设置页检查、更新弹窗、下载进度、安装/重启状态。
- `features/ai/`：AI 生成入口、敏感确认、可编辑预览、批量生成对话框、候选过滤、快捷面板/管理器共享的一键生成 hook 与确认弹窗。
- `features/command-actions/`：管理器和快捷面板共享的命令右键菜单、复制/收藏/移动/删除 mutation hook；菜单支持可选 AI 一键生成项。
- `features/appearance/`：马卡龙设计 token、颜色/图标解析、共享 `CategoryIcon`、命令颜色 Popover、分类外观 Popover、个人色板 hook。
- `features/quick-panel/`：剪贴板/命令库/提示词库两级导航、保存/复制、提示词展开预览、命令与提示词右键菜单、已保存状态、键盘操作。
- `features/settings/`：窗口、快捷键、AI 配置、剪贴板监听配置、数据工具、退出。
- `services/appApi.ts`：唯一 Tauri invoke 入口；React 不包含 SQL 或数据库逻辑，也不直接发 AI 网络请求。
- `stores/appStore.ts`：模式、管理器路由、命令/提示词/剪贴板 revision、命令与提示词详情跳转请求、拖动状态。

### Rust command 边界

- `commands/app.rs`：启动快照、退出。
- `commands/window.rs`：窗口模式、拖动、隐藏。
- `commands/settings.rs`：设置事务性更新、快捷键/自启动应用与回滚。
- `commands/library.rs`：命令/分类/标签、复制、排序、导入导出、备份恢复。
- `commands/prompts.rs`：提示词/提示词目录/标签、复制、排序、颜色、剪贴板保存为提示词；独立 `data://prompts-changed` 事件。
- `commands/updater.rs`：暴露构建时更新源/公钥是否已配置；实际检查与安装由 Tauri Updater 插件完成，私钥不进入应用。
- `commands/clipboard.rs`：当前剪贴板状态、系统历史、保存、复制、清空本地历史、状态；保存成功后只异步触发自动注释。
- `commands/ai.rs`：Key 保存/清除、测试连接、敏感预检、生成/取消、保存注释和自动任务；生成路径使用单命令 in-flight 锁。
- command 层只做 DTO 转换、事件广播和调用服务；不直接写 SQL。

### Rust 服务

- `services/database`：`parking_lot::Mutex<Connection>` 串行化访问；WAL、外键、`quick_check`、版本化迁移、损坏隔离与恢复。
- `services/library/repository.rs`：所有命令/分类/标签 SQL。
- `services/library/mod.rs`：校验、UUID、规范化、精确去重、原始文本保存、使用次数和剪贴板顺序。
- `services/library/portability.rs`：JSON schema 4 导入导出（含提示词）、备份、`VACUUM INTO`、事务恢复。
- `services/prompts/repository.rs`：提示词、提示词目录、提示词标签的全部 SQL；独立 FTS + LIKE 搜索。
- `services/prompts/mod.rs`：提示词校验、原文保留、严格去重、复制/使用统计、剪贴板保存；不调用 AI。
- `services/ai/client.rs`：OpenAI 兼容 Chat Completions 请求、URL 校验、超时、错误映射和 JSON 提取；`reqwest` 仅在后端使用。
- `services/ai/credentials.rs`：Windows Credential Manager 读写删；Key 不进入配置文件/数据库。
- `services/ai/prompt.rs`：中文解释 prompt；命令作为不可信数据。
- `services/ai/repository.rs`：AI 注释保存、状态、哈希过期和中断恢复。
- `services/ai/mod.rs`：配置装配、输出归一化、自动注释条件、按 request id 的取消注册表，以及按 command id 的生成互斥锁。
- `services/clipboard/text.rs`：稳定内容指纹、标题/Shell 猜测、敏感内容启发式。
- `services/clipboard/history.rs`：`clipboard_entries` 独立 Repository/Service、合并/清理限制。
- `services/clipboard/system_history.rs`：WinRT 只读历史读取与状态映射。
- `services/clipboard/monitor.rs`：消息窗口、`AddClipboardFormatListener`、`WM_CLIPBOARDUPDATE` 工作线程。
- `services/clipboard/mod.rs`：Win32 当前文本读取和 Unicode 写入。
- `state.rs`：设置、模式、命令/提示词/剪贴板 revision、监听警告和自我复制抑制时间窗。

## 4. 关键决策

### 4.1 单窗口双模式

继续使用一个 WebView，而不是两个常驻窗口：

- 快捷面板关闭/隐藏不会销毁命令库状态。
- 背面只有一个 Tauri 窗口，系统托盘、全局快捷键、拖动、位置记忆保持原有实现。
- 剪贴板监听在 Rust 后台线程中运行，不依赖快捷面板是否可见。

### 4.2 设置与业务数据继续分离

- `settings.json` 保存窗口、主题、快捷键、自启动、剪贴板偏好、个人颜色色板和 AI 非敏感配置。
- 设置 schema 当前为 **5**：schema 4 → 5 只增加 `aiProvider`、`aiBaseUrl`、`aiModel`、`aiTimeoutSeconds`、`aiTemperature`、`aiAutoAnnotation`，保留全部既有偏好；API Key 不在此文件中。
- 新字段：`clipboardMonitoringEnabled`、`clipboardHistoryLimit`（默认 100，范围 10–500）、`clipboardHistoryRetentionDays`（默认 7，范围 1–365）、`hideQuickPanelAfterCopy`、`customColors`（规范 HEX，去重，最多 24 个）、AI 配置字段。
- SQLite 保存用户内容；数据库 schema 当前为 **5**，AI 注释和提示词库均为独立表。
- 提示词使用 `prompts` / `prompt_categories` / `prompt_tags`，与命令表完全分离；`tags` 词表共用。

### 4.3 临时剪贴板历史不等于命令库

- 当前剪贴板：每次读取 Win32 `CF_UNICODETEXT`，不持久化到 `clipboard_entries`。
- Windows 系统历史：通过官方 WinRT 实时读取，映射为内存中的只读列表，不写入 SQLite。
- 本地监听历史：写入独立表 `clipboard_entries`，来源 `local_monitor`。
- 用户点击「保存」才创建 `commands` 行；保存当前/历史内容不会自动清空或删除任何临时历史。
- 清空本地历史只执行 `DELETE FROM clipboard_entries`；不会删除 `commands`，也不会调用 Windows 历史删除 API。

### 4.4 WinRT 系统历史的验证与实现

已实际验证官方 API 在当前 Tauri 2 + Rust 桌面环境可用：

- `Clipboard.IsHistoryEnabled()` 返回 true/false。
- `Clipboard.GetHistoryItemsAsync()` 返回 `ClipboardHistoryItemsResult`（状态、条目、时间）。
- `DataPackageView.GetTextAsync()` 提取可读文本；图片/无文本格式返回错误时逐条跳过，不影响其他条目。
- Rust 在独立 blocking task 中执行 `CoInitializeEx(COINIT_APARTMENTTHREADED)`，用 Tauri runtime 驱动 WinRT async operation；读取完成后平衡 `CoUninitialize`。
- 结果在真实应用中返回了 16 条可读历史，状态为 `available`；关闭 Windows 剪贴板历史后，状态返回 `disabled`，当前剪贴板和本地历史仍可保存。
- 未使用模拟 `Win+V`、截图识别或读取未公开数据库；没有删除 Windows 历史。

`Clipboard.HistoryChanged` 尚未订阅。面板打开、本地剪贴板更新、保存/清空以及命令数据变更都会触发重新读取；不在面板打开时无意义地高频订阅系统事件。

### 4.5 本地监听与自身复制抑制

- 启动时在专用线程创建 message-only 窗口并调用 `AddClipboardFormatListener`。
- `WM_CLIPBOARDUPDATE` 只向工作线程发送信号；工作线程合并 120 ms 内的连续更新，再读取当前文本。
- 相同文本用 FNV-1a 内容指纹匹配，更新 `copied_at` 而不是重复插入。
- 应用自身写剪贴板前设置 1.5 秒抑制窗；监听线程在该窗口内不写本地历史，从而避免自身复制造成回环。
- 敏感文本不进入本地历史；仍可在当前剪贴板查看，保存时必须二次确认。
- 非文本、空文本和超过 100,000 字符的文本不写入本地历史；失败不会清空已有历史。

### 4.6 一键保存、标题、Shell 与来源

- 快捷面板保存只构造 Command Service 输入，不打开编辑表单。
- 原始命令字符串原样保存，**不使用 `trim()` 作为入库内容**；空白、CRLF、缩进和引号均保留。
- 标题：首个有意义的非注释行，去掉常见 Shell 提示符，最多 80 字符；手动编辑可为空，服务自动生成。
- Shell：明确的 PowerShell / CMD / Bash 特征才猜测；`docker ps`、`git status` 等跨平台命令为 `unknown`。
- 分类为空（未分类）、标签为空、说明为空。
- `source_type`：`manual` / `clipboard_current` / `clipboard_history` / `import`。
- 精确原文去重：查询未软删除命令的 `command = ?`；存在时返回已有 ID，不新增。
- `content_hash` 使用稳定 FNV-1a 64 位指纹，仅用于索引和未来扩展，不替代原文比较。

### 4.7 敏感内容

- 本地启发式覆盖私钥头、`password=`、Token/API key 常见前缀、AWS/Bearer、带凭据连接串等。
- 系统历史条目标记为「敏感」；保存前弹出确认，确认后才调用 `allowSensitive`。
- 本地监听历史不缓存敏感项。
- 手动编辑器中的保存是显式用户操作，没有额外二次弹窗。
- AI 自动/批量路径对疑似敏感命令直接跳过，不发送。
- AI 手动生成疑似敏感命令时会先由 Rust 返回 `AI_SENSITIVE_BLOCKED`，前端展示包含服务商、模型和“完整原文将发送、无法撤回”的确认；用户确认后才带 `allowSensitive=true` 重试。
- API Key 只由 Rust 从 Windows Credential Manager 读取；请求错误、设置快照、日志和导出均不包含 Key。

### 4.8 快捷面板与键盘

- 默认标签为「剪贴板」；三个视图：剪贴板 / 命令库 / 收藏。
- 当前剪贴板置顶，系统历史保持 WinRT 返回顺序，本地历史按 `copied_at` 倒序；跨来源按原文去重。
- 卡片展示预览（三行折叠、可展开）、来源、相对时间、敏感标记、保存状态。
- `↑/↓` 改变选中项，`Enter` 复制，`Ctrl+S` 保存，`Esc` 隐藏；保存不关闭面板。
- 命令库/收藏卡片支持右键和 `Menu`/`Shift+F10` 打开共享上下文菜单；`context="quick"` 保留“在完整管理界面中查看”，不显示上移/下移。
- 命令卡片右侧显示直接分类名；分类树用于计算完整路径作为悬停提示，未分类不渲染标签。
- 已保存按钮跳转管理界面的命令编辑器；删除命令后保存状态由 Command Service 查询结果重新计算。
- 复制后是否隐藏由设置 `hideQuickPanelAfterCopy` 控制；保存永远不触发隐藏。

### 4.9 Favorite 与 Saved 分离

- `saved` 由命令是否存在决定，`favorite` 是 `commands.is_favorite`。
- 从剪贴板保存不会自动设置 Favorite。
- 已保存卡片的跳转入口打开命令详情，用户可手动切换 Favorite。
- 快速收藏、手动添加、导入使用同一 Command Service 和同一去重逻辑。

### 4.10 数据事件与刷新

- 命令写操作：`data://commands-changed`，携带递增 revision。
- 剪贴板写/监听/清空：`clipboard://changed`，携带递增 revision。
- 前端 `useAppEvents` 更新 store；快捷面板和命令库在 revision 变化后重新读取权威数据。
- 当前单 WebView，管理界面和快捷面板互斥；事件已验证会触发刷新，但没有两个物理 WebView 同时显示的测试。

### 4.11 搜索

- 命令：FTS5 `MATCH` + LIKE 回退，覆盖中文、子串、标题/原文/说明/标签。
- 剪贴板：前端对合并后的原文进行大小写不敏感子串过滤；预览不改变保存内容。
- 快捷面板命令库/收藏视图使用同一 Command Service 的搜索和筛选。

### 4.12 导入导出、备份与恢复

- JSON 当前 schema **3**：在 schema 2 的 `sourceType`、`aiAnnotationStatus` 之上增加命令 `backgroundColor` / `useCategoryColor` 和分类 `color` / `iconName`；旧 schema 1/2 仍可导入，缺失外观字段默认 `null` / `false`，未知图标回退为默认文件夹。
- 合并导入按命令 ID 跳过已有项；完整恢复单事务清空并导入，失败回滚；导入前自动备份。
- 数据库备份使用 `VACUUM INTO`，包含命令、分类、标签、`clipboard_entries` 和 `ai_annotations`。
- 恢复校验 `quick_check`、数据库 schema 5 和核心表；恢复前创建 `pre-restore` 备份；通过 `ATTACH` + 延迟外键 + 单事务复制，包含外观字段、AI 注释和提示词库；旧备份没有 `ai_annotations` 时回退为无注释。
- 旧 schema 1/2 数据库备份当前会被拒绝，需先由旧版本打开完成迁移；JSON schema 1/2 可以直接导入。
- JSON 导出为 schema 4，包含命令、提示词、目录、标签和外观，当前不包含 AI 注释，但绝不包含 API Key；数据库备份恢复包含 AI 注释与提示词。

### 4.13 命令排序、分类移动与树状视图

- 命令排序只有“自定义排序”允许拖动；最近使用、名称排序由后端查询决定。
- `reorder_commands` 不整体重写表，而是把请求 ID 放入它们原本占用的槽位，再把全部活跃命令的 `sort_order` 归一化为 10/20/30…；因此分类筛选下的局部排序不会改变其他分类的相对顺序。
- 前端先乐观更新当前列表；Rust 事务失败时恢复原数组并提示。成功只通过 `data://commands-changed` 刷新权威数据。
- 多选复制按选择顺序传给 `copy_commands`；按列表/树顺序复制则按当前展示顺序重排 ID。
- `move_commands_to_category` 捕获原分类和 `sort_order`，批量追加到目标分类；返回的 `previous` 供 `restore_command_placements` 撤销。
- 右键、多选对话框、拖到侧栏分类、拖到树分类都调用同一 Service；分类选择器只负责 UI 展示和筛选。
- 分类删除由 `delete_category_with_options` 显式接收“命令去向”和“子分类处理”：
  - `moveToParent` / `unclassified`；
  - `promote` / `deleteSubtree`；
  - 全部在单事务中完成，永久命令只改分类，不做级联删除。
- 分类独立排序由 `reorder_categories` 处理同级槽位；当前 UI 使用右键上移/下移，不实现分类节点拖动。

### 4.14 菜单上下文、上移/下移与分类就地创建

- `CommandContextMenu` 接收窗口上下文：
  - quick：复制、编辑、收藏、移动分类、在管理界面查看、删除；
  - manager：复制、编辑、收藏、上移、下移、移动分类、删除。
- 管理器的上移/下移只在自定义排序下启用；边界项禁用，最近/名称/搜索/收藏/标签等场景显示提示。树状视图按同分类范围交换相邻命令。
- 上移/下移与拖拽都先乐观更新，再调用 `reorder_commands`；失败恢复原数组。SQLite 查询使用稳定次级排序（标题/时间/id）。
- Windows 窗口配置 `dragDropEnabled: false`：Tauri 默认会替换 WebView2 的拖放处理器，导致前端 HTML5 拖拽出现红色禁止光标；关闭后由 WebView2 原生处理 HTML5 DnD。应用没有依赖 Tauri 文件 drop。
- 原生 HTML5 拖拽在分类节点、未分类入口、列表命令行和树命令行同时处理 `dragenter` 与 `dragover`，避免“进入目标后停住则无法 drop”的问题。
- 拖动时源行半透明；原生 drag image 使用独立 `CommandDragPreview` 构造标题、单行预览和多选数量；命令行间显示插入线；分类目标高亮并切换文件夹图标。
- Esc 触发 `dragSession` 取消标记并结束拖拽状态；后续 drop 被忽略。关闭 Tauri 拖放 handler 后，OS 级 Esc 也可取消 WebView2 原生拖拽，已用真实 Win32 键鼠输入验证。
- 移动到分类面板底部固定“新建一级分类”，分类行提供“新建子分类”；就地输入后“创建并移动”先调用 `create_category`，再调用 `move_commands_to_category`。分类名称校验由 Rust Repository 统一完成，菜单保留失败项以便重试。
- 树状视图按分类分组命令，展开状态持久化；搜索/筛选时自动展开匹配路径，分类计数按当前匹配命令计算。

### 4.15 AI 智能注释

- 请求只在 Rust 发送：`POST {base_url}/chat/completions`，Bearer Key 来自 Credential Manager；Timeout 默认 30 秒。
- 配置只保存 provider/base URL/model/timeout/temperature/auto 开关；Key 不进入 settings。
- Prompt 固定版本 `annotation-v1`，要求严格 JSON、中文、15–40 字简短说明、参数/前提/风险、受限 Shell 与风险枚举；命令作为不可信数据。
- 输出在 Rust 校验并归一化；首次请求 `response_format: json_object`，模型明确不支持时回退一次。
- 单条生成只返回 `GeneratedAiAnnotation`，不写库；用户确认后 `save_ai_annotation` 在事务内复核命令存在、内容哈希和当前手写注释，再写独立表。
- 手写注释选择：`keep` 默认不改 title/description；`append` 在用户确认后追加；`replace` 替换用户可见注释。任何模式都不修改 `command` 原文。
- AI 注释状态：`none/pending/ready/failed`；自动任务 pending，成功 ready，失败 failed；启动时 pending 恢复为 failed。
- 自动触发位于 `save_clipboard_text` 成功之后，只处理 `created=true`，先做本地条件检查再异步 spawn。
- 批量由管理器前端逐条调用同一生成/保存接口，先过滤手写/AI/ready/pending，再顺序执行；敏感命令由后端拦截并计入跳过。
- 数据事件在 pending 和最终状态时触发 `data://commands-changed`；命令列表通过 `isStale` 比较 AI 哈希与当前 `content_hash`。
- 取消按 request id 使用 oneshot 与 `futures_util::select` 实现；不会取消其他请求。
- 快捷面板和完整管理器复用 `CommandContextMenu` 的可选 AI 项；点击后先调用只读 `check_ai_command_sensitivity`，敏感或已有注释时用一个确认弹窗合并风险，确认后直接生成并按模式保存。
- 快捷一键生成始终只处理当前命令；管理器多选时隐藏该项，继续使用批量入口。前端按 command id 同步抑制重复点击，Rust 的 `AiCommandLocks` 再覆盖模式切换、批量/自动任务并发。
- 已有手写注释并确认覆盖时使用 `replace`，把旧手写内容追加到新详细说明的“原手写注释（已保留）”段；若 title/description 只是上次 replace 的 AI 镜像，则识别为 AI 文本并再次替换，避免误保留或重复显示。

## 5. 安全与隐私边界

- AI 请求只发送当前命令原文、Shell 和生成要求到用户配置的 OpenAI 兼容服务；没有云同步或内置中转服务。
- API Key 只保存在 Windows Credential Manager，不写入 settings/JSON 导出/SQLite/日志，也不返回前端。
- 自动/批量不会发送疑似敏感命令；手动发送和右键一键生成在敏感或已有注释时需确认。
- 右键一键生成只会覆盖 AI 注释或经确认的 replace；手写内容会保留在新详细说明中，原始 `command` 始终不变。
- 命令内容不会记录进应用日志；HTTP 错误只返回状态和通用提示，不包含命令正文或 Key。
- 本地剪贴板历史以明文保存在 `commands.db` 的 `clipboard_entries`；用户可以关闭监听、修改上限/保留期或一键清空。
- 系统历史通过官方 API 只读访问，本应用没有删除/修改入口。
- 敏感过滤是启发式，不可能覆盖所有密钥格式；保存敏感内容仍需要用户确认。
- 自身复制抑制是 1.5 秒时间窗，极端情况下外部程序在该窗口写入相同文本可能不被本地历史捕获。
- 备份、JSON 导出和数据库都是本机文件，没有加密；恢复/导入/清空均有确认或自动备份保护。
- 外观只保存颜色值与图标名，不包含用户上传的图片或 HTML/SVG；自定义色和图标不能注入样式或脚本。
- AI 输出以纯文本 React 节点展示，不使用 `dangerouslySetInnerHTML`，不作为程序指令执行，也不会直接修改原始命令。

## 6. 已知限制与后续

- 单 WebView，无两个物理 WebView 同时打开。
- 系统历史 API 依赖 Windows 10 1809+、系统版本支持且用户开启剪贴板历史；当前只在 Windows 11 实测。
- `Clipboard.HistoryChanged` 未订阅；通过面板打开和剪贴板更新事件刷新。
- 分类节点拖动排序、跨分类精确插入位置、独立标签管理 UI、回收站、列表分页、原生「另存为」尚未实现。
- Tauri 原生文件拖放已关闭以启用 HTML5 拖放；文件导入仍使用文件选择器。
- 工作流仍是后续阶段；AI 注释的 JSON 导出、后端批量队列、自动请求取消和独立 AI 编辑留待后续增量。
- 安装包未签名；多显示器/非 100% DPI 只有算法单测。

### 4.16 UI/UX 设计系统与布局

- `styles.css` 定义颜色、圆角、阴影和字体 token；`ui-panel`、`ui-inset`、`ui-eyebrow`、`ui-hairline`、`ui-selected` 提供共享视觉原语。浅色/深色使用同一语义变量。
- 快捷面板继续 460×480：拖动条、搜索、分段标签、结果区和键盘 footer；只保留快速检索/复制/保存/收藏，不承载完整管理界面功能。
- 管理界面在命令库页使用三栏：
  - `Sidebar`：导航与分类树，保留独立宽度和拖放；
  - `LibraryPage` 左列：搜索/筛选/排序/列表或树；
  - `CommandDetailPanel` 右列：代码详情、分类路径、元数据与操作。
- 详情宽度使用 `pata-commands.library-detail-width` 本地存储，范围 248–400px、默认 300px；分隔条支持指针拖动和双击复位。
- 视口小于 860px 时详情和分隔条使用响应式 CSS 收起，列表仍保留完整管理功能。
- 详情中的复制、编辑、收藏、删除复用 `useCommandActions`/现有编辑器/删除确认，不建立第二套业务逻辑。
- 布局改版不触碰 Rust Repository、SQLite schema、剪贴板监听、托盘、快捷键和窗口模式实现。

### 4.17 命令与分类外观

- 设计 token 集中在 `features/appearance/palette.ts`：8 个马卡龙预设各带浅色命令背景、深色命令背景、浅色图标、深色图标四个值；自定义颜色通过同一套 HSL/亮度算法派生可读背景和图标色，组件不自行写颜色逻辑。
- `resolveCommandSurface` 产出 `--command-tint-light` / `--command-tint-dark`，`styles.css` 只按 `data-theme` 切换背景；命令行、树命令行和快捷面板卡片共享同一个 resolver，因此同一命令颜色一致。
- **自己的颜色与跟随分类颜色分离**：
  - `commands.background_color` 保存自己的颜色；
  - `commands.use_category_color` 是一个实时模式；开启时渲染读取 `category_color`，分类修改后通过 `data://commands-changed` 刷新；
  - 关闭该模式恢复自己的颜色；应用新颜色/恢复默认会关闭该模式；
  - 分类颜色不会默认同步给命令。
- 命令列表 DTO 同时返回 `categoryColor` / `categoryIconName`，避免每个列表行额外查询；分类树、移动分类、分类管理器、命令详情和快捷面板都通过同一个 `CategoryIcon` 渲染图标和颜色。
- 图标名由前端 Lucide registry 与 Rust 允许集合共同约束；数据库只保存名称，导入未知名称回退 `NULL`。
- 个人色板属于设置偏好（`settings.json` 的 `customColors`），命令和分类外观面板共享；删除色板项不影响已写入的命令/分类颜色。
- 颜色/图标 Popover 使用 Portal + 视口约束 + `ResizeObserver`；展开自定义颜色时重新计算位置，避免超出快捷面板窗口。
- 批量命令颜色/跟随模式为单事务；外观更新不修改 `updated_at`、内容、分类、排序或使用统计。写失败时前端不留下乐观修改，Popover 显示错误。
- 数据访问仍通过 `appApi` 和 Rust `LibraryService`；前端不直接访问 SQLite。

### 4.18 UI 一致性与命令优先展示

- 共享 `SearchInput` 统一隐藏 WebView 原生搜索清空按钮；有值且提供 `onClear` 时只渲染一个自定义清空控件，清空后聚焦输入框。
- 快捷面板 `Esc` 的顺序为：弹层（颜色/外观 Popover、菜单、敏感确认）→ 清空搜索 → 隐藏面板。搜索框右侧不再重复放 Esc 提示，统一放到 footer。
- 管理器剪贴板复用 `save_clipboard_text` / `copy_clipboard_text` 与共享 `ClipboardItemActions`、`SensitiveClipboardDialog`；保存仍自动标题、默认目录、原文去重，不打开编辑表单。
- 命令优先展示集中在 `features/command-display/CommandPrimary.tsx` 与 `commandDisplay.ts`：
  - 第一行命令原文（等宽、可截断 1–3 行）；
  - 第二行简短注释（由旧 `title` UI 映射；与命令首行重复的自动标题不显示）；
  - 右侧辅助 Shell/目录/收藏标识。
- 快捷面板、管理器列表、树状视图、概览最近命令和拖拽预览使用同一组件；`description` 只作为详情中的“详细说明”。
- 详情面板顺序固定为命令 → 复制/编辑 → 简短注释 → 详细说明 → 目录/标签 → 元数据；代码区为单一详情滚动容器，不设置内部二次纵向滚动。
- 快捷面板删除内部品牌/QUICK 头，只保留 32px 拖动条与必要工具按钮；管理器删除侧栏品牌区和多级面包屑，页面标题只保留一处。
- 用户可见“分类”改为“目录结构”、“未分类”改为“默认”；内部仍使用 `CategoryNode`、UUID 和 `category_id = NULL`，没有 schema 或 JSON 字段变化。
- 深色自定义命令背景始终与深色基底至少混合 75%，避免低亮度但高饱和的蓝色等颜色形成刺眼色块；预设颜色继续使用固定浅/深 token。
- Shell 展示由 `features/command-display/shellDisplay.ts` 和 `ShellBadge.tsx` 统一：
  - 仅 `powershell/cmd/bash/sh/zsh/other` 映射为用户文案；
  - `unknown`、null、空/空白和未识别值返回 `null`，组件及调用方不渲染空徽标或 trailing 容器；
  - 管理器列表、树、快捷面板和详情共用同一判断，详情在未知时整行省略 `Shell` 元数据。
- 这些改动只触及 React 展示层和既有 Tauri Service 调用，不修改托盘、快捷键、窗口模式、剪贴板监听或数据库迁移。

阶段四及以后继续沿用现有 Repository/Service/Tauri command 分层，不直接在前端访问数据库。
