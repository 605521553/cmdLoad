# 测试记录

最后更新：2026-11-23（提示词库：数据库 v5、独立目录、管理器/快捷面板、剪贴板保存为提示词、JSON schema 4、备份恢复）

## 1. 环境

| 项 | 值 |
| --- | --- |
| Windows | Windows 11 64 位 |
| 显示 / DPI | 单显示器，100% |
| Node.js | 24.21.0 |
| npm | 11.19.0 |
| Rust | 1.99.1，MSVC toolchain |
| Tauri | 2.12.5 |
| WebView2 | 当前系统运行时 |
| 测试方式 | 自动化单测 + 实际运行桌面应用 + CDP 检查 WebView + Win32/WinRT 实测 |

## 2. 自动化结果

| 项目 | 结果 |
| --- | --- |
| TypeScript strict | ✅ `npm run typecheck` |
| ESLint | ✅ `npm run lint`（0 warning） |
| Vitest | ✅ 28 个文件 / 154 个测试 |
| 生产 Vite 构建 | ✅ |
| rustfmt | ✅ `cargo fmt -- --check` |
| Clippy | ✅ `cargo clippy --all-targets -- -D warnings` |
| Rust 测试 | ✅ 116 个测试 |

前端测试覆盖：启动/空状态、快捷面板三视图、当前剪贴板保存、Ctrl+S/Enter、敏感确认、命令库搜索、已保存状态、设置快捷键组件、错误显示；排序请求、多选序号、树状视图、快捷面板右键菜单/键盘入口、管理器窗口菜单上下文、上移/下移、拖拽预览、分类路径和就地创建/创建并移动。外观轮新增：设计 token 归一化、自定义色对比度/深色适配、个人色板去重与排序、`CategoryIcon` 回退、颜色/图标 Popover 交互、命令颜色与跟随分类菜单、快捷面板 tint、管理器批量颜色与跟随分类。本轮新增：SearchInput 单清空/聚焦、Esc 先清空后隐藏、CommandPrimary 命令优先与重复标题抑制、管理器剪贴板保存/多行原文/搜索/复制/敏感确认、编辑器命令优先字段、深色高饱和自定义色抑制。Shell 轮新增：ShellBadge 的 unknown/null/空值/未知值隐藏、明确 Shell 的标题大小写显示、快捷卡片与详情行同步。右键一键轮新增：菜单 AI 项显示/忙态、快捷面板未配置引导、手写保留与 AI 镜像识别、敏感/覆盖合并确认文案、重复点击抑制、管理器多选隐藏、详情重复文本抑制。提示词轮新增：多行正文原样保存、标题可选、Ctrl+S、空正文拒绝、未保存确认、管理器列表/详情/搜索/双击复制/收藏/软删除、快捷面板提示词标签页、5 行预览展开/收起/Esc、剪贴板保存下拉菜单保存为提示词、提示词右键收藏。

Rust 测试覆盖：数据库 WAL/外键/FTS、迁移/失败回滚/损坏恢复、设置 schema 5、命令 CRUD/搜索/软删除/收藏/使用次数、分类、严格原文去重、多行原文保留、标题/Shell 猜测、敏感检测、本地历史去重/清理/期限、清空历史不影响命令、JSON schema 1/2/3 兼容、备份恢复；排序/分类移动撤销/分类排序/分类提升删除/子树删除保留命令。外观轮新增：v2→v3 外观迁移、单条/批量颜色事务、跟随分类实时模式、嵌套分类独立外观、颜色/图标校验、JSON 外观往返、未知图标回退、备份恢复外观字段。AI 轮新增：URL 校验、JSON 提取、输出归一化、空响应、手写注释检测、自动跳过条件、取消注册、Credential Manager 临时目标 CRUD、v3→v4 迁移、v4→v5 设置迁移、AI 注释保存/保留/追加/替换、命令原文不变、哈希过期拒绝、pending 恢复、备份恢复 AI 注释，以及 camelCase/snake_case 两种结构化字段名兼容。右键一键轮新增：单命令 in-flight 锁、重复请求拒绝、自动注释与手动生成互斥检查。提示词轮新增：v4→v5 迁移保留命令、提示词/目录/标签 CRUD、中文与标签搜索、FTS 特殊字符、收藏/最近/软删除、多行原文精确往返、复制成功/失败与使用次数、严格去重与敏感确认、目录独立、删除选项/移动撤销/排序、颜色与目录外观、JSON schema 4 往返、旧 schema 3 不删除提示词、备份恢复提示词。

## 3. WinRT 系统剪贴板历史验证

### 3.1 PowerShell 探针

使用 Windows PowerShell 5.1 STA 读取官方 WinRT API：

```text
HistoryEnabled=True
Items=25（系统返回集合）
可读文本：当前剪贴板、ssh 命令、docker ps、中文文本、路径等
不可读格式：GetTextAsync 返回 DataPackage 不包含指定格式，逐条跳过
```

没有读取 Windows 私有数据库，没有模拟 Win+V，没有截图识别。

### 3.2 Rust 示例探针

运行 `cargo run --example winrt_clipboard_probe`：

```text
CoInitializeEx=HRESULT(0x00000000)
IsHistoryEnabled=Ok(true)
Status=Ok(ClipboardHistoryItemsResultStatus(0))
Items=25
多个条目返回文本；非文本条目 TEXT_ERROR 被跳过
```

### 3.3 完整 Tauri 应用

开发版通过 `get_clipboard_status` / `get_system_clipboard_history` 实际调用：

```json
{
  "status": "available",
  "enabled": true,
  "count": 16
}
```

临时把 `HKCU\Software\Microsoft\Clipboard\EnableClipboardHistory` 设为 0 后：

```json
{
  "systemHistoryEnabled": false,
  "systemHistoryStatus": "disabled",
  "message": "Windows 剪贴板历史未启用……"
}
```

此时仍成功从当前剪贴板保存命令；随后恢复原值 1，状态恢复 `available`。

## 4. 必须通过的 15 项验收

| # | 要求 | 实际结果 |
| --- | --- | --- |
| 1 | 复制一条命令，唤出面板，点击一次即可保存 | ✅ 外部复制 `docker ps -a`；单击保存成功，source=`clipboard_current` |
| 2 | 不输入标题/说明/Shell/分类/标签也能保存 | ✅ 快捷面板保存无表单；自动标题 `docker ps -a`，Shell=`unknown`，分类/标签为空 |
| 3 | 多行命令保存后与原文完全一致 | ✅ 77 字符、前后空格、CRLF、缩进、引号、中文；DB 原文逐字符一致 |
| 4 | 系统历史中不同命令可逐条收藏 | ✅ 从系统历史保存 `~/embodiedgen-work/input`、`docker ps`；source=`clipboard_history` |
| 5 | 保存过的内容正确显示“已保存” | ✅ 当前项和系统历史重复项均显示“已保存”；点击打开命令详情 |
| 6 | 重复收藏不无限创建相同命令 | ✅ 重复调用返回已有 ID，`created=false`，命令数不增加 |
| 7 | 收藏成功后命令库立即可见 | ✅ 快捷面板保存后管理命令库立即出现；`data://commands-changed` 广播 |
| 8 | 删除永久命令不错误清理系统历史 | ✅ 删除后系统历史仍有原文；保存状态变为未保存 |
| 9 | 清理临时历史不删除永久命令 | ✅ `clipboard_entries=0`，命令数保持 8 |
| 10 | 重启后永久命令仍存在 | ✅ 7 条命令、来源和本地历史在重启后保留 |
| 11 | 本地监听不影响其他应用正常复制粘贴 | ✅ 外部 Set-Clipboard / Get-Clipboard 正常；监听线程不阻止其他进程 |
| 12 | 快捷面板不会因剪贴板更新意外关闭 | ✅ 外部复制时面板保持打开并刷新当前内容/系统历史 |
| 13 | AI API 未配置时保存正常 | ✅ 本阶段 AI 未接入；v0.2.0 再次确认无 Key/关闭自动注释时保存不调用网络 |
| 14 | 明显敏感信息不会未经确认持久化/发送 | ✅ 本地历史未新增；取消确认无命令；确认后才写入；没有 AI 发送 |
| 15 | 系统历史关闭时当前剪贴板保存正常 | ✅ `disabled` 状态下成功保存 `echo system-history-disabled` |

## 5. 额外实际验收

| 项 | 操作 | 结果 |
| --- | --- | --- |
| 本地监听后台运行 | 管理模式下外部复制 | ✅ 本地记录数增加，无需打开快捷面板 |
| 监听开关 | 设置关闭后外部复制；再开启 | ✅ 关闭时数量不变；开启后恢复 |
| 自身复制抑制 | 应用内 `copy_clipboard_text` 后等待 | ✅ 本地记录数不变；外部再次复制才增加 |
| 当前内容为空 | 清空剪贴板文本 | ✅ 当前内容为空，本地历史保留 |
| 非文本剪贴板 | 设置 10×10 图片到剪贴板 | ✅ 当前文本为空，不崩溃，不清空历史 |
| 监听历史清理 | 设置页清空并确认 | ✅ 本地 7→0，永久命令不变 |
| 敏感过滤 | 外部复制 `password=hunter2` | ✅ 本地历史不新增；显示敏感徽标 |
| 敏感确认取消 | 点击保存后取消 | ✅ 命令未写入 |
| 敏感确认保存 | 再次确认 | ✅ 命令写入，source=`clipboard_current` |
| 手动添加 | 只填 `Get-Date`，标题留空 | ✅ 标题自动生成，Shell=`unknown`，source=`manual` |
| 命令库/收藏视图 | 快捷面板切换、收藏命令 | ✅ 收藏过滤为 1 条；命令库搜索 docker 为 2 条 |
| 已保存跳转 | 点击快捷面板“已保存” | ✅ 打开管理命令编辑器，标题正确 |
| 搜索剪贴板 | 搜索 docker | ✅ 仅显示匹配条目 |
| 复制后隐藏 | 设置开启后复制 | ✅ Win32 枚举窗口显示快捷面板 `visible=False`；随后关闭设置 |
| 数据库迁移 | v1 数据库启动 | ✅ `user_version=2`；旧命令保留，source=manual，content_hash 回填 |
| 设置迁移 | schema 2 设置启动 | ✅ 文件写为 schema 3；快捷键/主题/布局保留 |
| JSON 来源往返 | schema 2 导出/导入；schema 1 缺失字段 | ✅ 来源保留；旧字段回退 import/none |
| 删除后系统历史 | 删除 `echo system-history-disabled` | ✅ 系统历史仍存在，saved 为 null |

### 5.1 阶段三后续增量验收

| 项 | 操作 | 结果 |
| --- | --- | --- |
| 列表拖拽排序 | 将第一条拖到第二条下方 | ✅ 界面立即换序；数据库 `sort_order` 为 10/20/30 |
| 排序重启持久化 | 重启应用后查看顺序 | ✅ 仍为拖拽后的顺序 |
| 非自定义排序 | 名称排序下拖动列表命令 | ✅ 自定义顺序不变；界面保持名称排序 |
| 树内排序 | Docker 分类内拖“查看容器”到“启动 API”之后 | ✅ 顺序变为“启动 API、查看容器、临时命令”，持久化 |
| 多选序号 | Ctrl 选两条，再 Shift 选范围；取消其中一条 | ✅ 序号 1–4；取消后自动重排 1–3 |
| 选择顺序复制 | 点击“按选择顺序复制” | ✅ 剪贴板多行顺序与点击顺序一致 |
| 列表顺序复制 | 点击“按列表顺序复制” | ✅ 剪贴板顺序为当前列表顺序 |
| 多选移动 | 两条命令移动到 Git | ✅ 数据库分类变为 Git；通知出现“撤销” |
| 移动撤销 | 点击“撤销” | ✅ 两条命令恢复 Docker 分类 |
| 拖到侧栏 + 自动展开 | 拖“临时命令”到 Linux，停留约 600 ms 再拖到 Docker | ✅ Linux 自动展开；最终分类 Docker；出现撤销 |
| 快捷面板右键 | 右键命令卡片 | ✅ 显示完整菜单，没有 AI 项；未触发复制 |
| 快捷面板键盘菜单 | `Shift+F10` | ✅ 菜单聚焦首项；在 460×480 右缘自动左移不溢出 |
| 右键收藏 | 点击“收藏命令” | ✅ 数据库收藏为真，菜单关闭，面板保持快捷模式 |
| 右键编辑 | 点击“编辑命令” | ✅ 切换到管理器并打开编辑器，命令字段已载入 |
| 分类右键菜单 | 右键树中 Git | ✅ 新建子分类/重命名/上移/下移/删除分类 |
| 新建子分类 | 从 Git 新建“测试子类” | ✅ 出现在 Git 下，数据库 parent 正确 |
| 分类独立排序 | 将“删除子类”上移 | ✅ 排到 Git 前，`sort_order` 持久化 |
| 删除分类提升 | 删除“删除测试”，命令去未分类、子分类提升 | ✅ 父分类消失、子分类成为根、父命令未分类、子命令保留 |
| 未分类筛选 | 点击侧栏“未分类” | ✅ 仅显示未分类命令，筛选 chip 正常 |
| 树展开持久化 | 展开 Linux/Docker 后刷新 | ✅ 展开状态从本地存储恢复 |

### 5.2 增量二实际验收

| 项 | 操作 | 结果 |
| --- | --- | --- |
| 管理菜单上下文 | 右键管理器命令 | ✅ 无“在完整管理界面中查看”；有上移/下移 |
| 快捷菜单上下文 | 右键/`Shift+F10` 快捷卡片 | ✅ 有“在完整管理界面中查看”；无上移/下移 |
| 管理上移 | 最后一条右键上移 | ✅ 下移禁用；顺序和 SQLite 同步改变，Toast 成功 |
| 上移/下移边界 | 第一条上移、最后一条下移 | ✅ 分别禁用 |
| 非自定义排序 | 名称排序下右键 | ✅ 上移/下移禁用并显示“仅自定义排序”提示 |
| 红色禁止光标根因 | 检查 Tauri/WebView2 配置 | ✅ 默认 `dragDropEnabled: true` 替换 WebView2 拖放处理器；设置 `false` 后真实拖拽可用 |
| 原生 OS 鼠标拖拽 | Win32 `SetCursorPos` + `mouse_event` 从手柄拖到目标行 | ✅ UI 和数据库均换序；不再出现禁止光标；重启后保持 |
| 插入线 | 拖拽悬停目标行 | ✅ 目标行出现上下插入线 |
| 拖拽预览 | 拦截 `DataTransfer.setDragImage` 读取元素文本 | ✅ 单选含标题和命令预览；多选含“共 2 条命令” |
| 原生拖到分类 | Win32 OS 鼠标从左栏手柄拖到 Linux | ✅ 目标高亮、文件夹图标变化、drop 成功、出现撤销 |
| 拖到未分类 | 原生拖到未分类入口 | ✅ 分类变为未分类 |
| 自动展开 | 悬停折叠 TestRoot 约 600 ms，再拖到 Child | ✅ TestRoot 展开，最终落入 Child |
| 多选拖动 | 选中两条，拖动其中一条到 Git | ✅ 两条均移动，批量 Service 调用 |
| OS Esc 取消 | Win32 真实拖拽中发送 Escape，再释放鼠标 | ✅ 拖拽取消，命令分类保持不变 |
| 快捷分类标签 | 命令库/收藏卡片右侧 | ✅ 显示 Git、Docker 等直接分类；未分类无标签 |
| 完整路径提示 | 悬停/读取标签 title | ✅ `Linux / Docker`、`TestRoot / Child` |
| 分类移动即时刷新 | 新建或移动分类后观察快捷面板 | ✅ 标签即时更新 |
| 新建一级分类 | 菜单底部“新建一级分类”输入并创建 | ✅ 固定按钮可见；创建后直接移动并关闭 |
| 新建子分类 | 分类行悬停加号创建 Child | ✅ 支持嵌套；创建并移动 |
| 重名校验 | 新建根分类 Git | ✅ 菜单保持、内联错误与 Toast；未创建 |
| 重启一致性 | 重启应用读取顺序/分类/快捷标签 | ✅ 顺序、分类计数和标签保持 |

### 5.3 UI/UX 整体改版实际验收

| 项 | 操作/尺寸 | 结果 |
| --- | --- | --- |
| 快捷面板尺寸 | 真实 WebView2 截图 | ✅ 460×480；搜索、标签、结果区和 footer 均无横向溢出 |
| 快捷面板浅色/深色 | 切换主题并截图 | ✅ 分段标签、选中边框/强调线、分类标签和操作按钮对比度正常 |
| 快捷命令行 | 命令库标签 | ✅ 标题、Shell、右侧直接分类、单行预览；选中项边框和左侧强调线 |
| 剪贴板卡片 | 当前剪贴板/Windows 历史/已保存 | ✅ 保存、已保存、复制；两行预览和展开全文保留 |
| 管理三栏（900） | 干净安装版启动并切到命令库 | ✅ 分类树 172px、命令列表、详情 300px 三栏，无横向溢出 |
| 管理三栏（950） | Release 实际数据 | ✅ 列表与详情联动，标题栏“分类 / 命令列表 / 详情” |
| 详情悬停联动 | 鼠标悬停“Get-Date”“查看容器” | ✅ 详情标题、代码、分类路径和元数据即时切换 |
| 详情复制 | 详情“复制命令原文” | ✅ 剪贴板为当前命令原文 |
| 详情编辑 | 详情“编辑” | ✅ 打开现有命令编辑器，关闭后列表保持 |
| 详情收藏 | 详情星标 | ✅ SQLite `is_favorite=true`，列表星标同步 |
| 详情宽度拖动 | 从分隔条向左拖 50px | ✅ 详情 248→298px，列表 441→391px；localStorage 写入 298 |
| 详情宽度重启 | 关闭并重启 release | ✅ 详情恢复为 298px，localStorage 仍为 298 |
| 详情宽度复位 | 双击分隔条 | ✅ 恢复 300px 默认值 |
| 3 栏原生拖拽 | 950 宽下 Win32 鼠标把“查看容器”从列表拖到 Linux | ✅ `drop` 命中 Linux，分类 Docker→Linux，无禁止光标 |
| 分类树/右键/排序 | 三栏布局下打开分类与命令菜单 | ✅ 菜单定位、上移/下移、树展开和拖放目标保持 |
| 全局快捷键 | Win32 `Ctrl+Shift+V` 从管理器唤出 | ✅ 切换到快捷面板，内层 460×480 |
| 快捷键隐藏 | 快捷面板按 Win32 Esc | ✅ 窗口不可见，后台进程保持 |
| 安装版 UI | 静默安装后干净启动 | ✅ 命令 0、管理三栏 900×650、详情空态、快捷面板 460×480、无设置警告 |
| 安装/卸载 | 安装 exit 0，卸载 exit 0 | ✅ 安装目录和 appdata 最终清理，剪贴板恢复 `Get-Date` |

## 6. 测试限制与未自动化项

- **系统历史 access denied**：实测了系统历史 `disabled`，没有强制制造权限拒绝；`access_denied/error` 分支通过代码审查，未声称实机验证。
- **`Clipboard.HistoryChanged`**：未订阅；通过面板打开、`WM_CLIPBOARDUPDATE`、保存/清空事件刷新。没有测试系统历史 UI 中“恢复/删除某项”后的即时刷新。
- **真实读写锁冲突**：没有用另一个进程长期占用剪贴板来强制 `OpenClipboard` 失败；读取代码有重试和错误分支。
- **两个物理 WebView**：单 WebView 架构；数据事件已验证，未同时打开两个窗口。
- **原生文件选择器**：沿用阶段二方式，通过 CDP `DOM.setFileInputFiles` 给真实 `<input type=file>` 设置文件，没有自动点击 Windows 原生对话框。
- **多显示器 / 高 DPI**：只有算法单元测试，单屏 100% 实测。
- **安装包系统历史**：最终 UI 安装版完成干净启动与尺寸检查；WinRT 系统历史继续沿用已实测的同一 Service 代码，本轮未重复逐项截图。
- **长时间复制压力**：做了连续外部复制和监听开关测试，没有做数万次压力测试。
- **分类节点拖动排序**：当前用右键上移/下移，没有实现分类行本身拖动；命令行拖拽已实测。
- **跨分类精确插入**：可拖到另一分类，但不能指定跨分类后的精确位置。
- **拖拽自动化**：排序、跨分类、OS Esc 使用 Win32 真实鼠标/键盘事件；自动展开和多选移动在开发版完成，`setDragImage` 内容通过拦截验证，未做桌面截图中拖拽缩略图的像素级截图。
- **拖拽缩略图截图**：原生 drag image 属于 OS 拖放层，WebView2 `Page.captureScreenshot` 无法包含，只验证了传入的标题/预览/数量文本。
- **创建和移动原子性**：分类创建与命令移动是两个 Service 调用；创建成功、移动失败时分类保留，需后续补偿或合并事务。
- **详情窄窗收起**：`<860px` 详情与分隔条通过响应式 CSS 收起，已检查样式和构建，未用 OS 窗口缩放逐像素验收。
- **详情宽度存储**：使用 localStorage 而非 settings JSON，不参与设置导入/导出。
- **详情操作覆盖**：鼠标悬停联动已实测；键盘焦点移动只更新命令 activeIndex，不会主动滚动详情。
- **语法高亮**：详情代码区提供等宽字体、行号、选择、复制和整行注释弱化；没有引入 shell/PowerShell 完整语法高亮库，未做逐 token 着色验证。
- **管理器系统历史**：管理器剪贴板页展示当前剪贴板和本地历史；Windows 系统历史仍只在快捷面板中只读展示，本轮没有新增第二套系统历史读取 UI。
- **系统默认重名**：系统默认目录与用户自建“默认”目录显示名相同，内部用 `NULL` 区分；没有增加“系统”徽标或强制禁止同名目录。
- **编辑器外观颜色**：颜色仍从命令右键“设置颜色”进入；编辑器没有新增第二套颜色控件。
- **高 DPI**：验证了 CSS 像素、浏览器缩放和可读字号，没有在真实 125%/150% DPI 多显示器做逐像素截图矩阵。

## 7. 视觉验收

实际 WebView2 截图（`docs/images/`）：

- `ui-quick-light.png` / `ui-quick-dark.png`：Raycast 方向快捷面板，剪贴板优先。
- `ui-quick-commands-light.png`：快捷面板命令库标签、直接分类和单行预览。
- `ui-command-three-column-light.png`：完整管理界面三栏，详情与代码块。
- `ui-command-three-column-dark.png`：深色三栏。
- `ui-command-three-column-resized.png`：详情宽度拖动后的布局。
- `ui-command-list-light.png`：旧版命令列表（保留作历史）。
- `ui-command-multiselect-light.png`：多选序号与选择顺序/列表顺序操作栏。
- `ui-command-tree-light.png`：旧版分类树/树状视图（布局行为仍保留）。
- `ui-quick-command-context-light.png`：快捷面板命令右键菜单（含“在完整管理界面中查看”）。
- `ui-quick-category-light.png`：快捷面板直接分类标签与完整路径 tooltip。
- `ui-command-context-manager-light.png`：管理器右键菜单（无管理界面查看，含上移/下移）。
- `ui-category-create-light.png`：移动到分类面板的固定“新建一级分类”。
- `ui-library-light.png` / `ui-library-dark.png`：更早期命令库截图（保留作历史）。
- `ui-clipboard-manager-light.png`：管理器剪贴板摘要。
- `ui-settings-light.png` / `ui-settings-dark.png`：设置与剪贴板配置。
- `ui-data-tools-light.png`：JSON/备份工具。
- `ui-overview-light.png`：真实概览。
- `ui-category-manager-light.png`：分类树。
- `appearance-*.png`：本轮命令/分类外观截图，详见第 9.7 节。

检查项：快捷 460×480 无横向溢出；三栏 900/950 宽列表和详情均不溢出；选中行/详情强调线；深色对比度；详情代码块换行和长分类路径省略；保存/已保存状态；footer 快捷键；设置长路径换行；外观颜色在深色下不刺眼、分类图标可辨。

## 8. 构建与打包

执行：

```powershell
npm run tauri build
```

| 产物 | 结果 |
| --- | --- |
| Release 可执行文件 | ✅ `src-tauri/target/release/pata-commands.exe`，7,098,368 bytes；SHA-256 `8ECD2C6254DC417FD071E8E014146EFA0586D2C37C7D01078E72AA167C7A095C` |
| NSIS 安装包 | ✅ `src-tauri/target/release/bundle/nsis/Pata Commands_0.2.0_x64-setup.exe`，2,899,290 bytes；SHA-256 `B1FC3337EC380E7930844F15DC98F7CD5AFC89B6A53E7BFC8907ABB2B15802F6`；另有 `.exe.sig` |
| 前端生产资源 | ✅ JS 594.87 kB（gzip 178.24 kB）、CSS 51.64 kB（gzip 9.70 kB） |
| 安装路径 | `%LOCALAPPDATA%\Pata Commands` |
| 静默安装 | 上一轮 0.2.0 基线已验证 installer exit 0；本轮重新构建安装包但未重复安装 |
| 安装版运行 | 上一轮基线已验证启动和用户命令保留；本轮 Release 直接启动完成 v4→v5 迁移和提示词交互 |
| 静默卸载 | 上一轮基线已验证 exit 0；本轮未重复卸载 |
| 最终清理 | 本轮运行进程已停止；`%APPDATA%\com.pata.commands` 用户数据保留 |
| 干净首次启动 | ✅ 本轮验证的是真实旧库升级：数据库 v4→v5，用户 7 条有效命令保留，提示词表新建 |

安装包未配置代码签名证书，Windows SmartScreen 可能提示“未知发布者”。

## 9. 命令与分类外观实际验收

### 9.1 迁移

- 使用上一轮真实 `commands.db`（`user_version=2`、4 条命令、无分类）启动新 release：
  - `PRAGMA user_version` 变为 3；
  - 4 条命令保留；
  - `background_color` 全为 `NULL`，`use_category_color` 全为 0；
  - `categories` 新增 `color`、`icon_name` 且现有行为空。
- 同一启动把 `settings.json` 从 schema 3 迁移为 4，窗口/主题/快捷键/剪贴板字段保留，`customColors` 初始化为空数组（AI 轮后当前 schema 为 5）。
- 旧数据库迁移前仍生成 `pre-migration-v2-*` 备份；迁移后未重建数据库。

### 9.2 命令颜色与跟随分类模式

- 真实 UI 右键“查看容器”→“设置颜色”→薄荷绿：SQLite `background_color='#EDF8F2'`，列表行 `--command-tint-light` 同步；快捷面板命令卡显示同一颜色。
- 右键“清理容器”→“使用所在分类颜色”：`use_category_color=1`，行背景读取 Docker 分类颜色。
- 在侧栏右键 Docker→“自定义外观”：图标改 `boxes`，颜色从薄荷绿改淡紫/冰青：
  - “启动 API 服务”“清理容器”两条跟随命令背景同步变化；
  - “查看容器”自己的奶油粉背景保持不变；
  - 侧栏、树状视图、移动分类选择器、命令详情、快捷面板分类图标/颜色一致。
- 分类颜色变化后无需重新打开应用；`data://commands-changed` 刷新列表与快捷面板。
- 命令自己的颜色和分类颜色分别存库，验证没有默增强制同步。

### 9.3 自定义调色盘与个人色板

- 第一轮在分类外观面板展开“自定义颜色”，输入 `#EBF8F8`（与预设冰青同值，用于验证预设/自定义互通）：
  - 实时预览为浅青色；
  - 保存到“我的颜色”后 `settings.json` 出现 `"customColors": ["#EBF8F8"]`；
  - 重新打开命令颜色面板和分类外观面板均能看到该颜色。
- 点击个人色板删除按钮后：
  - `customColors` 清空；
  - Docker 分类颜色仍为 `#EBF8F8`；
  - 两条跟随命令背景仍为冰青；
  - 证明删除色板项不会改变已设置外观。
- 最终构建在快捷面板命令颜色面板输入 `#E8F0FF`（非预设颜色）并保存：
  - `settings.json` 为 `["#E8F0FF"]`；
  - 快捷面板“我的颜色”出现该色；
  - 展开自定义区域后 Popover 重新定位，个人色/预览/应用按钮均在 451×572 窗口内可见。
- 前端测试覆盖非法 HEX、重复颜色、色板满 24、Alt+左右键重排、删除、默认重置。

### 9.4 分类图标与一致性

- 分类外观 Popover 展示当前图标预览、搜索框、26 个 Lucide 图标网格、默认图标、颜色预设/个人色/自定义色、恢复默认外观。
- 搜索“sql”只显示数据库图标；搜索中文“容器”可找到容器图标；未知/空搜索显示全部。
- 图标点击立即写入 `categories.icon_name`；颜色点击立即写入 `categories.color`。
- 同一分类在以下位置使用同一 `CategoryIcon`：
  - 左侧分类树；
  - 命令库树状视图；
  - 右键“移动到分类”；
  - 分类管理器列表；
  - 命令详情分类 chip/元数据；
  - 快捷面板命令卡分类标签。
- 嵌套分类独立验证：父分类设为蓝色 server，子分类保持无颜色/默认 folder；修改父分类不影响子分类。

### 9.5 批量、深色与重启

- 管理器勾选“连接服务器”“重启 Nginx”，底部操作栏“设置颜色”→淡紫：
  - 两条命令均更新；
  - 选择序号 1/2 保留；
  - 两条命令调用一次批量事务；SQLite 同时更新。
- 深色主题下 7 条命令背景分别为低亮度粉、青、黄、紫、蓝、暖灰；标题、命令原文、Shell 标签保持可读；分类图标在深色背景可见。
- 快捷面板实际窗口 451×572（用户此前缩放尺寸）中打开颜色 Popover：
  - 顶部/底部均在窗口内；
  - 展开自定义颜色时 `ResizeObserver` 重新定位；
  - 预设/个人色/默认/跟随开关均可用。
- 关闭并重启 release 后：
  - 主题仍为深色；
  - 命令颜色、跟随分类模式、分类颜色/图标、个人色板均保持；
  - 当时 `user_version` 为 3、设置为 schema 4；v0.2.0 AI 验收后分别为 4 和 5。

### 9.6 JSON 与备份

- 实际调用 `export_library_json`：`schemaVersion=3`，7 条命令、5 个分类，包含 `backgroundColor`、`useCategoryColor`、`color`、`iconName`。
- 实际调用 `import_library_json`（replace）：7 条命令、5 个分类恢复，命令颜色/跟随模式与分类外观完整保留。
- 自动化测试验证：
  - 旧 schema 2 文件缺少外观字段时回退 `null`/`false`；
  - 未知 `iconName` 导入后为 `NULL`，颜色仍保留；
  - 非法颜色不写入；
  - 数据库备份恢复包含 `background_color`、`use_category_color`、`color`、`icon_name`。
- 个人色板在 `settings.json`，不进入命令 JSON 或数据库备份；文档已明确。

### 9.7 视觉截图

- `docs/images/appearance-manager-light.png`：浅色管理器命令 tint、分类图标、右键外观入口。
- `docs/images/appearance-manager-dark.png`：深色管理器低亮度 tint；重启后仍保持。
- `docs/images/appearance-quick-light.png` / `appearance-quick-dark.png`：快捷面板命令颜色与分类标签。
- `docs/images/appearance-color-popover.png`：命令颜色面板、预设/个人色/自定义。
- `docs/images/appearance-quick-color-popover.png`：快捷面板内实际颜色面板，展开自定义后仍在窗口内。
- `docs/images/appearance-category-popover.png`：分类图标网格与颜色面板，展开自定义后重新定位。
- `docs/images/appearance-follow-sync.png`：修改 Docker 分类颜色后跟随命令同步、自己的颜色不变。
- `docs/images/appearance-move-picker.png`：移动到分类选择器中的分类图标。
- `docs/images/appearance-batch.png`：多选批量设置颜色与选择序号。

### 9.8 外观验收限制

- 分类颜色/图标通过右键打开；未在分类管理器弹窗中内嵌独立外观编辑器。
- 个人色板重排使用拖动和 Alt+左右键；未做触摸手势验证。
- Popover 使用 `ResizeObserver`，极矮窗口下内部滚动，不做逐像素截图断言。
- 颜色对比度由前端算法单测验证（背景/图标 ≥ 3:1），未接入第三方无障碍扫描器。

## 10. UI 一致性与命令层级实际验收

### 10.1 搜索清空与 Esc

- 快捷面板搜索输入 `docker`：DOM 中 `[aria-label="清空搜索"]` 数量为 1，输入框仍为 `type="search"`，原生 cancel 按钮通过 `::-webkit-search-cancel-button` 隐藏；截图中右侧只有一个 X。
- 按 `Esc`：搜索值清空、面板不隐藏；搜索为空后再次 `Esc` 才隐藏。footer 从“Esc 隐藏”变为“Esc 清空”。
- 管理器命令库、管理器剪贴板搜索均复用 `SearchInput`，同样只有一个清空按钮；清空后输入框重新聚焦。
- 弹出颜色/外观面板、命令菜单或敏感确认时，`Esc` 优先关闭弹层。

### 10.2 管理器剪贴板保存

- 真实管理器剪贴板页点击“当前剪贴板”保存：
  - `save_clipboard_text` 成功，命令数 3→4；
  - 数据库命令 `category_id = NULL`、`source_type = clipboard_current`；
  - 页面按钮变为“已保存”，快捷面板同步；
  - 提示“已保存到命令库的‘默认’目录”。
- 历史列表多行文本保存调用同一服务，原文完整保留；重复保存返回已有命令而不是新增。
- 历史搜索 `docker`：22 条过滤为 2 条，搜索清除恢复。
- 复制按钮调用 `copy_clipboard_text`，复制完整原文；敏感内容保存时显示共享确认对话框。
- Saved 状态使用绿色“已保存”，不是收藏星标。

### 10.3 标题、品牌与布局

- 快捷面板内部不再出现 Logo/`Pata Commands`/`QUICK`；顶部只有 32px 拖动条和两个图标按钮，搜索紧贴顶部。Windows 原生标题栏仍在。
- 管理器侧栏顶部不再有品牌区，导航从顶部开始；顶部只显示当前页面名称，无“分类 / 命令列表 / 详情”面包屑。
- 剪贴板页不再渲染可见重复 `h1`，且移除页面内重复的“打开快捷面板”按钮。
- 概览快捷操作移除重复快捷面板按钮；Overview/Settings 不再重复内部应用品牌。
- 真实 1012×650 管理器和 451×572 快捷面板截图确认无重复品牌和横向溢出。

### 10.4 目录命名

- 侧栏模块标题显示“目录结构”，系统默认行和树视图显示“默认”。
- 命令右键菜单显示“移动到目录”；移动面板标题“移动 N 条命令到目录”，默认选项“默认”。
- 命令详情/编辑器/筛选 chip/快捷面板分类标签/数据工具均显示目录相关文案；全项目非测试 UI 源码无“分类/未分类”字符串。
- 用户已有分类 ID、父子关系、颜色图标、命令归属和筛选结果未变化；内部仍使用 `NULL` 默认分类。
- 快捷面板中默认目录命令继续不显示目录标签。

### 10.5 命令优先层级

- 快捷面板命令卡：命令原文 14px 等宽、最多两行；简短注释在下；右侧 Shell/目录/收藏；无注释时没有占位行。
- 管理器列表：命令原文 13.5px 第一行，简短注释第二行，Shell/目录在右；详细说明不再占列表空间。
- 树状视图：命令原文第一行、注释第二行；目录节点仍是图标+名称+数量。
- 详情：命令原文代码块 → 复制/编辑 → 简短注释 → 详细说明 → 目录/标签 → 元数据；无顶部大标题。
- 编辑器：命令原文默认焦点 → 简短注释 → 详细说明 → Shell → 目录 → 标签。
- 自动标题等于命令首行的命令不显示重复注释；编辑器“简短注释”为空；手写简短注释正常显示。

### 10.6 字体、长命令与深色

- 详情长命令 74 行 / 2522 字符完整显示，代码字号 14px、行高 22.4px（1.6）；详情内部只有一个滚动容器，无代码区第二纵向滚动条。
- 快捷命令 14px，管理器 13.5px，树 13px，目录名 13px；长命令两行截断，详情提供完整阅读。
- 真实深色下，自定义高饱和目录色 `#2844CC` 的命令背景实际像素为 `#1E2547`（修复前为 `#263EB1`），不再出现刺眼蓝色块；白色文字保持可读。
- 深色预设马卡龙 tint、目录图标、选中边框、Shell/目录标签均保持可辨。

### 10.7 回归

- CDP 真实鼠标拖拽命令排序：数据库与 UI 首三条 ID 顺序一致，拖拽后无残留缩略图。
- 既有多选序号、批量颜色、右键菜单、目录树、复制/收藏/删除和快捷键单测继续通过。
- 管理器/快捷面板的真实切换、搜索、保存、复制、Esc 和滚动均正常；没有出现新增空白按钮或占位控件。

### 10.8 视觉截图

- `docs/images/ui-quick-light.png`：新快捷面板剪贴板视图（无内部品牌、单一搜索清除）。
- `docs/images/ui-quick-commands-light.png` / `ui-quick-dark.png`：命令优先快捷卡片。
- `docs/images/ui-command-three-column-light.png` / `ui-command-three-column-dark.png`：新管理器列表与详情。
- `docs/images/ui-manager-clipboard-light.png`：管理器剪贴板保存/搜索。
- `docs/images/ui-command-editor-light.png`：命令优先编辑器。
- `docs/images/ui-command-detail-light.png`：命令详情层级。

## 11. Shell 标签显示实际验收

### 11.1 显示矩阵

| 原始值 | 列表/树/快捷 | 详情 |
| --- | --- | --- |
| `unknown` | 不显示、无占位 | 整行 `Shell` 不显示 |
| `null` / `undefined` / `""` / 空白 | 不显示、无占位 | 整行 `Shell` 不显示 |
| 未识别的字符串 | 不显示、无占位 | 整行 `Shell` 不显示 |
| `powershell` | `PowerShell` | `Shell` + `PowerShell` |
| `cmd` | `CMD` | `Shell` + `CMD` |
| `bash` | `Bash` | `Shell` + `Bash` |
| `zsh` | `Zsh` | `Shell` + `Zsh` |
| `sh` | `Shell` | `Shell` + `Shell` |
| `other` | `Other` | `Shell` + `Other` |

- 显示文本保持标题大小写，不再使用 CSS `uppercase`。
- `ShellBadge` 返回 `null` 时不会生成空 span；列表/树/快捷面板的 trailing 容器由调用方按“有 Shell 或目录”决定，因此没有空列或额外留白。

### 11.2 真实桌面

- 将测试数据分别设为 `unknown`、`powershell`、`bash` 后启动真实 release：
  - 管理器列表显示 PowerShell、Bash；unknown 行没有 Shell 标签。
  - 树状视图显示 PowerShell、Bash；unknown 命令占满可用宽度。
  - 快捷面板显示 PowerShell、Bash；unknown 命令没有 Shell 徽标。
  - 详情 unknown 时 `dt` 中没有 Shell；PowerShell 时显示 `Shell` 和徽标。
- 通过编辑器把 unknown 命令改为 `zsh` 并保存，列表行与详情立即出现 `Zsh`，无重启。
- 单元测试覆盖：null/undefined/空串/空白/unknown/未知值全部隐藏；六种有效值大小写与标签；快捷面板隐藏/显示；详情 Shell 行隐藏/显示。
- 自动化：25 个 Vitest 文件 / 132 个测试；Rust 100 个测试；TypeScript、ESLint、rustfmt、Clippy、生产构建通过。

## 12. AI 注释实际验收（v0.2.0）

### 12.1 配置与凭据

- 真实 DeepSeek 配置：`https://api.deepseek.com/v1` / `deepseek-chat` / timeout 30。
- 未保存 Key 时点击“测试连接”，返回 `连接成功 · 924 ms · deepseek-flash`。
- 保存配置后：
  - `settings.json` 为 schema 5，存在 AI 非敏感字段；
  - 文件全文不含 API Key、`apiKey` 或 `api_key` 字段；
  - API Key 输入框清空，状态为“密钥已配置”；
  - `cmdkey /list` 显示 `PataCommands/AI/OpenAICompatible` / `pata-commands`；
  - SQLite 全部表列扫描无 API Key；JSON 导出也无命中。
- 重启后密钥状态、Base URL、Model 和自动开关保持；测试结束后自动开关恢复默认关闭。

### 12.2 单条生成

- 对 `docker ps -a` 点击生成，DeepSeek 返回：
  - 简短说明；
  - 详细说明；
  - 参数 `-a` 和说明；
  - 执行前提；
  - 建议 Shell `unknown`、风险 `low`。
- 点击“重新生成”后内容更新，预览保持打开且未写库。
- 编辑简短说明并点击“应用并保存”，SQLite `ai_annotations` 写入，`ai_annotation_status=ready`。
- 快捷面板命令库第二行显示“查看全部 Docker 容器及运行状态”，完整管理器列表同步显示。
- 对已有手写注释 `123123`（title=`31`）生成：
  - 预览显示保留/追加/替换；
  - 默认保留；
  - 应用后 title 仍为 `31`、description 为空；
  - AI 注释独立存在。
- 修改命令原文后，`isStale=true`，详情出现“AI 注释可能过期”警告。
- 命令原文在以上全流程中保持完全一致。

### 12.3 自动注释

- 开启自动注释后，从 Windows 系统剪贴板历史保存 `git push -u origin main`（真实 Win32 剪贴板被其他程序持续占用）：
  - 保存立即返回，命令创建；
  - 0.00 s 状态为 `pending`；
  - 约 1.65 s 后状态为 `ready`，AI 注释写入；
  - 快捷面板显示“将本地 main 分支推送到远程并建立跟踪关系”。
- 再次保存相同内容：
  - `created=false`，返回相同命令 ID；
  - 状态仍为 `ready`；
  - AI 注释 `updated_at` 不变，未重复请求。
- 保存测试敏感内容 `api_key=...`（显式允许保存）后，命令存在、状态 `none`、无 AI 注释。
- 临时把模型改为不存在的名称，自动任务失败后命令保留、状态 `failed`、无注释；恢复模型后不自动重试。
- 测试结束后恢复配置、关闭自动开关并清理测试命令。

### 12.4 取消、敏感与批量

- 发起生成后 40 ms 取消，返回 `AI_CANCELLED`，状态保持 `none`，没有预览或注释。
- 对 `password=hunter2` 点击生成：
  - Rust 返回 `AI_SENSITIVE_BLOCKED`；
  - 弹出包含服务商/模型/外发风险的确认；
  - 取消后无请求、无注释、状态仍为 `none`。
- 勾选 3 条无注释命令开始批量：
  - 顺序执行 3 次；
  - 进度 3/3，成功 3、失败 0、敏感跳过 0；
  - 3 条命令均变为 `ready` 并显示简短注释。
- 勾选 3 条无注释 + 2 条已有注释：
  - 按钮显示“批量 AI 注释 (3)”；
  - 对话框统计 3 可生成 / 2 已有注释 / 0 生成中；
  - 不启动，不产生请求。
- 实际修复：批量进行中概览统计改为冻结启动时快照，避免每完成一条后“已有注释”计数跳动。

### 12.5 重启与安装包

- 关闭/重启后 AI 注释仍在，数据库 `user_version=4`、设置 schema 5，原有有效命令 2 条保留。
- 安装包静默安装、安装版启动显示 v0.2.0、静默卸载均通过；卸载不删除用户数据。
- 测试命令和 AI 注释已清理；API Key 保留在 Credential Manager，自动注释恢复为关闭。

### 12.6 本轮限制

- 当前系统剪贴板被其他程序持续占用，`Set-Clipboard` / 应用当前剪贴板读取失败；自动流程使用 Windows 系统历史保存入口完成真实链路验证。
- 批量由前端顺序驱动，退出应用会中止；自动请求没有取消按钮。
- JSON 导出不包含 AI 注释；数据库备份包含。

### 12.7 2026-10-29 复核

在同一台 Windows 11 机器、同一用户数据目录上重新运行 Release 与真实 DeepSeek API：

| 场景 | 结果 |
| --- | --- |
| 测试连接 | ✅ `deepseek-flash`，约 881 ms |
| 单条生成并保存 | ✅ `docker ps -a --format "table {{.Names}}\t{{.Status}}"` 返回中文简短/详细说明、参数、前提、风险；约 1.38 s；保存后 `ready` |
| 命令原文保护 | ✅ 生成、保存、重载后命令逐字一致，`contentHash` 一致 |
| 快捷面板 | ✅ 第二行显示 AI 简短注释；无注释命令不显示占位 |
| 自动注释 | ✅ `kubectl get pods -A --no-headers \| wc -l` 写入后异步 `ready`，重复保存不重复请求 |
| 批量仅无注释 | ✅ 5 选 2 可生成 / 3 已有注释；2/2 成功，已有注释未被改写 |
| 重启持久化 | ✅ 重启后快捷面板 AI 注释仍存在，数据库 v4、设置 schema 5 |
| 凭据隔离 | ✅ Key 仅在 Windows Credential Manager；设置、SQLite、日志、源码无明文 |
| 清理 | ✅ 本轮临时命令和 AI 注释已删除，保留 2 条用户有效命令；自动开关关闭 |
| 自动化复跑 | ✅ 25 个 Vitest 文件 / 132 个测试；100 个 Rust 测试；TypeScript、ESLint、rustfmt、Clippy、生产构建通过 |

结构化解析新增兼容测试：同一份 AI 注释分别用 camelCase 和任务文档示例的 snake_case 字段名反序列化，结果一致。这样即使兼容服务没有严格遵循 prompt 的字段命名，也不会因字段大小写/下划线差异直接失败。

### 12.8 右键一键 AI 注释（2026-10-29）

| 场景 | 结果 |
| --- | --- |
| 快捷面板右键 | ✅ 菜单含“AI 生成注释”；已有 AI 时变为“重新生成 AI 注释” |
| 无注释一键生成 | ✅ `docker compose version --short` 直接生成并保存，状态 `ready`，命令原文不变 |
| 手写注释确认 | ✅ 弹窗说明覆盖并保留；确认后 title 变为 AI 简短说明 |
| 手写内容保留 | ✅ description 含“原手写注释（已保留）”、原 title 和原 description，且 AI 行与命令字段一致 |
| 敏感命令确认 | ✅ `password=hunter2` 弹出外发风险；取消后状态 `none`、无 AI 注释 |
| 已有 AI 确认 | ✅ 弹窗“已有 AI 注释，会覆盖”；取消后 `updated_at` 不变 |
| 管理器右键 | ✅ 同一菜单组件显示 AI 项 |
| 多选隐藏 | ✅ 选择 2 条后右键，AI 项消失；“批量 AI 注释”按钮保留 |
| 前端重复点击 | ✅ hook busy 集合抑制快速重复请求，单元测试通过 |
| Rust 并发锁 | ✅ 同时发起两次生成：一次成功，一次 `AI_BUSY` |
| 详情去重 | ✅ replace 后，与 AI 文本相同的简短/详细块不重复渲染 |
| 安装版 | ✅ 静默安装后快捷面板右键显示 AI 菜单；卸载 exit 0，AppData 保留 |
| 清理 | ✅ 本轮测试命令已删除；保留用户原有 2 条命令及其已有 AI 注释；自动开关关闭 |

测试结束后保留用户数据，未清除用户命令或既有 AI 注释。最终数据库 `user_version=4`、设置 schema 5、`aiAutoAnnotation=false`。


### 11.3 视觉截图

- `docs/images/ui-command-three-column-light.png`：管理器列表同时出现 PowerShell/Bash 与未知 Shell 无徽标。
- `docs/images/ui-quick-commands-light.png`：快捷面板 PowerShell/Bash 与无 Shell 命令。
- `docs/images/ui-command-detail-light.png`：详情 `Shell` + PowerShell 徽标。
- `docs/images/ui-shell-hidden-light.png`：全部为 unknown 时列表/详情无任何 Shell 占位。
- `docs/images/ui-command-editor-light.png`：编辑器 `unknown` 选项显示为“不显示”。

### 11.4 边界

- 数据库原始 `shell` 字段没有批量清洗；隐藏只是前端展示。
- 编辑器仍可选 `unknown`，选项显示为“不显示”，不是列表占位标签。
- 未来新增 Shell 类型需要同时加入 `shellDisplay.ts` 的映射，否则按未指定隐藏。

## 12. 当前边界

- 其余产品边界见 [docs/development-progress.md](development-progress.md) 和 [docs/architecture.md](architecture.md)。
- 工作流、分类节点拖动排序、跨分类精确插入、标签管理、回收站、分页、原生另存为、云同步、自动更新和代码签名未实现。
- 提示词目录节点拖动排序未实现（沿用上移/下移）；提示词 Markdown 导出未实现。

## 13. 提示词库实际验收（2026-11-23）

| 场景 | 结果 |
| --- | --- |
| 真实旧库迁移 | ✅ `user_version` 4 → 5；7 条命令保留；`prompts` / `prompt_categories` / `prompt_tags` / `prompts_fts` 创建 |
| 迁移备份 | ✅ 生成 `commands.db.pre-migration-v4-*.bak` |
| 工具恢复 | ✅ 旧程序停止后直接启动新 Release，未重建数据库 |
| 快捷面板导航 | ✅ 第一层「剪贴板 / 命令库 / 提示词库」，第二层「全部 / 最近使用 / 收藏」；460px 级别宽度保持 |
| 剪贴板保存为命令 | ✅ 主按钮仍一键保存；原命令数量和流程不变 |
| 剪贴板保存为提示词 | ✅ 下拉菜单“保存为提示词”写入 `prompts`；提示“已保存到提示词库的‘默认’目录” |
| 提示词原文 | ✅ 标题取 URL 首行，正文完整；`prompts = 1`；命令数仍为 7 |
| 提示词快捷卡片 | ✅ 标题、约 5 行正文、默认目录、收藏星标；单击复制、展开/收起可用 |
| 提示词管理器 | ✅ 侧栏「提示词库」、目录树（默认）、列表、右侧完整原文、复制/编辑/收藏/删除按钮可见 |
| 提示词编辑器 | ✅ 从详情打开“编辑”，标题和正文回填；大文本区、Ctrl+S/Esc 提示、取消/保存按钮可见 |
| 数据隔离 | ✅ 提示词页面不显示 Shell、执行风险、终端环境、AI 注释或行号 |
| 提示词目录 | ✅ 切换命令库/提示词库时目录区只显示当前库；默认目录可拖入 |
| 自动化复跑 | ✅ 28 个 Vitest 文件 / 154 个测试；116 个 Rust 测试；TypeScript、ESLint、rustfmt、Clippy、生产构建通过 |
| Release 构建 | ✅ `npm run release` 成功；exe 7,098,368 bytes，NSIS 2,899,290 bytes，另生成 `.exe.sig` 和 `latest.json` |

本轮实际测试产生的提示词仅用于验收，测试结束后已删除，`prompts` 和 `prompts_fts` 均为 0；用户原有 7 条命令保留。测试结束后已停止新 Release 进程并恢复 `autoHideQuickPanel=true`。

## 14. 在线更新验收（2026-11-23）

| 场景 | 结果 |
| --- | --- |
| 签名密钥 | ✅ 生成 `src-tauri/updater-keys/` 私钥/公钥/密码；公钥写入 `tauri.conf.json`，目录已 gitignore |
| Tauri 插件 | ✅ `tauri-plugin-updater`、`tauri-plugin-process`；capabilities 含 `updater:default`、`process:default` |
| Rust 编译 | ✅ `cargo check`、Clippy `-D warnings`、116 个 Rust 测试通过 |
| 前端单测 | ✅ 7 个更新状态测试：可用/无更新/手动提示/静默失败/下载进度/占位端点/网络错误/稍后提醒 |
| 签名构建 | ✅ `npm run release` 生成 `Pata Commands_0.2.0_x64-setup.exe`、`.exe.sig` 和 `artifacts/updater/latest.json` |
| 清单格式 | ✅ UTF-8 无 BOM；`windows-x86_64.signature` 来自 `.exe.sig`，`url` 指向签名 setup.exe |
| 配置检测 | ✅ endpoint 已指向实际仓库；未配置时 `configured=false`，设置页「检查更新」禁用，不会误报“已是最新版本” |
| 启动检查 | ✅ 代码路径为启动 4 秒后静默检查一次；有新版本才弹窗，失败不打断 |
| 更新 UI | ✅ 设置页显示当前版本/更新源/状态；更新弹窗含版本、日期、更新说明、进度和稍后 |
| 实际服务器下载 | ⏳ 未执行：需要先把 endpoint 改成真实 HTTPS 地址并上传 latest.json + setup.exe + sig |
| 安装重启 | ⏳ 未执行：需真实服务器和 0.2.0→0.2.1 两个签名版本联调 |

> 在线更新没有做真实 Release 下载/安装验收，因为尚未上传 0.2.1 更新包。签名构建、清单生成、配置检测和前端状态已通过自动化验证；发布前按 [在线更新](updater.md#6-本地联调不发布) 做一次两版本联调。
