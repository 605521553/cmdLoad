# 数据库设计（阶段三、外观自定义、AI 注释与提示词库 v0.2.0）

> 状态：SQLite `user_version = 5` 已实现；命令、分类、标签、标签关联、本地剪贴板历史、命令/分类外观、独立 AI 注释以及独立的提示词库（提示词、提示词目录、提示词标签关联、FTS5）均通过 Repository/Service、导入导出、备份恢复和实际桌面验收。AI API Key 不进入数据库，只保存在 Windows Credential Manager。

## 1. 范围与原则

- 命令、分类、标签、标签关联、使用统计、本地剪贴板历史、AI 注释和提示词库存入 SQLite。
- 命令与提示词是独立实体：命令使用 `commands` / `categories` / `command_tags`，提示词使用 `prompts` / `prompt_categories` / `prompt_tags`；`tags` 词表共用。不给 `commands` 增加 `type=prompt`。
- 窗口、主题、快捷键、自启动、剪贴板偏好、个人颜色色板和 AI 非敏感配置保存在 JSON `settings.json`，其 schema 当前为 5；API Key 在 Windows Credential Manager。
- 命令 ID、分类 ID、标签 ID、提示词 ID、提示词目录 ID 使用 UUID 字符串；导出、导入和数据库恢复保持稳定身份。
- 所有结构变化走 `PRAGMA user_version` 版本化迁移；迁移在事务中执行。
- 外键约束开启；写操作使用事务；WAL 模式；`busy_timeout = 5000`。
- 删除命令和提示词均为软删除（`deleted_at`），普通查询使用 `deleted_at IS NULL`。
- 数据库和备份只读写本机；只有用户配置并触发的 AI 注释生成会通过 Rust 访问外部 API；提示词不会自动调用 AI；没有云同步。

## 2. 文件与连接配置

```text
%APPDATA%\com.pata.commands\commands.db
%APPDATA%\com.pata.commands\backups\
%APPDATA%\com.pata.commands\settings.json
```

启动连接配置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 5000;
```

Rust 使用 `rusqlite`（bundled SQLite，含 FTS5），通过 `parking_lot::Mutex<Connection>` 串行化访问。剪贴板监听线程、Tauri command 和导入导出都走同一个连接锁。

## 3. 迁移、损坏与恢复

- 当前数据库 `user_version = 5`，迁移 SQL 位于 `src-tauri/src/services/database/migrations.rs`。
- **v1**：命令、分类、标签、`command_tags`、FTS5 和触发器。
- **v2**：
  - `commands.source_type`，默认 `manual`；
  - `commands.content_hash`；
  - `commands.ai_annotation_status`，默认 `none`；
  - 新建 `clipboard_entries`；
  - 相关索引；
  - Rust 在迁移完成后为已有命令回填 FNV-1a `content_hash`。
- **v3**：
  - `commands.background_color`（可空）；
  - `commands.use_category_color`，默认 0，`CHECK IN (0, 1)`；
  - `categories.color`（可空）；
  - `categories.icon_name`（可空）；
  - 全部为增量可空/默认字段，不重建表、不覆盖原有命令和分类。
- **v4**：
  - 新建 `ai_annotations`，通过 `command_id` 与 `commands` 一对一关联；
  - 保存短/详细说明、参数/前提/风险 JSON、建议 Shell、风险等级、provider/model、命令哈希、prompt 版本和时间戳；
  - `commands.ai_annotation_status` 正式启用为 `none/pending/ready/failed`；
  - 不修改命令原文、title/description 或已有命令数据。
- **v5**：
  - 新建 `prompt_categories`、`prompts`、`prompt_tags` 和 `prompts_fts`；
  - 提示词目录独立于命令分类，支持图标、颜色、多级、排序和拖拽；
  - 提示词 `title` 可空，`content` 必填且保留原始换行/空格/Markdown；
  - `background_color`、收藏、排序、使用次数、最近使用和软删除与命令结构保持一致；
  - 不修改任何已有 `commands`、`categories`、`clipboard_entries` 或 `ai_annotations` 数据。
- 非空旧库升级前使用 `VACUUM INTO` 创建 `commands.db.pre-migration-v<old>-<timestamp>.bak`。
- 每个迁移版本使用独立事务；失败回滚，`user_version` 不变，原库保留。
- 未来版本（`user_version > 5`）拒绝写入并显示原生错误，不静默降级。
- 启动执行 `PRAGMA quick_check`；损坏时：
  1. 将数据库及 `-wal`/`-shm` 移为 `.corrupt-<timestamp>` 保留；
  2. 创建空数据库并迁移；
  3. 在应用快照中返回数据库恢复警告。
- 迁移失败或无法恢复时不会自动删除/覆盖旧库，也不会覆盖设置文件。

## 4. Schema v5（命令与提示词）

### categories

```sql
CREATE TABLE categories (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  color       TEXT,              -- v3，规范 #RRGGBB
  icon_name   TEXT,              -- v3，Lucide 允许集合
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_categories_parent
  ON categories(parent_id, sort_order, name COLLATE NOCASE);
CREATE UNIQUE INDEX idx_categories_unique_name
  ON categories(ifnull(parent_id, ''), name COLLATE NOCASE);
```

- `color` 只表示分类图标颜色，不填充整行背景；命令若选择“使用所在分类颜色”，渲染时再读取该值。
- `icon_name` 必须是 `src-tauri/src/models/appearance.rs` 与前端 `categoryIcons.ts` 共用的允许集合；未知值写入被拒绝，导入时回退为 `NULL`（中性文件夹）。
- 每级分类独立保存颜色和图标，不自动继承父分类。
- 重命名、移动父级不会修改 `color`/`icon_name`。

数据库仍使用硬删除和 `ON DELETE CASCADE`；服务层不再允许无选项删除非空分类。`delete_category_with_options` 必须在同一事务中明确命令去向（父分类/未分类）和子分类处理（提升/删除子树），先移动命令再删除分类。永久命令不会因分类级联删除而丢失。同名同级分类返回冲突。

### commands

```sql
CREATE TABLE commands (
  id            TEXT PRIMARY KEY NOT NULL,
  title         TEXT NOT NULL,
  command       TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  shell         TEXT NOT NULL DEFAULT 'powershell',
  category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  is_favorite   INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  use_count     INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  source_type   TEXT NOT NULL DEFAULT 'manual',
  content_hash  TEXT,
  ai_annotation_status TEXT NOT NULL DEFAULT 'none',
  background_color TEXT,                                  -- v3，可空
  use_category_color INTEGER NOT NULL DEFAULT 0           -- v3
    CHECK (use_category_color IN (0, 1)),
  CHECK (length(trim(title)) BETWEEN 1 AND 200),
  CHECK (length(trim(command)) > 0)
);
CREATE INDEX idx_commands_active_sort
  ON commands(deleted_at, category_id, sort_order, updated_at DESC);
CREATE INDEX idx_commands_last_used
  ON commands(deleted_at, last_used_at DESC);
CREATE INDEX idx_commands_favorite
  ON commands(deleted_at, is_favorite, updated_at DESC);
CREATE INDEX idx_commands_content_hash_active
  ON commands(deleted_at, content_hash);
```

时间字段为 Unix 毫秒。`title` 在服务层允许用户留空，但写库前自动生成，因此数据库仍保留非空约束。

Shell 服务层支持：`powershell`、`cmd`、`bash`、`sh`、`zsh`、`other`、`unknown`。快速收藏不能确定时写 `unknown`。

命令来源：

| source_type | 含义 |
| --- | --- |
| `manual` | 手动添加/编辑 |
| `clipboard_current` | 从当前剪贴板保存 |
| `clipboard_history` | 从系统历史或本地监听历史保存 |
| `import` | 外部 JSON 导入；schema 1 缺失字段也回退为此值 |

`ai_annotation_status` 是命令上的轻量状态：`none`（未生成）、`pending`（自动任务进行中）、`ready`（有对应 AI 注释）、`failed`（上次生成失败，可重试）。AI 注释正文在独立表，避免覆盖手写 `title`/`description`。

### AI 注释表

```sql
CREATE TABLE ai_annotations (
    id                     TEXT PRIMARY KEY NOT NULL,
    command_id             TEXT NOT NULL UNIQUE REFERENCES commands(id) ON DELETE CASCADE,
    short_description      TEXT NOT NULL,
    detailed_description   TEXT NOT NULL DEFAULT '',
    parameters_json        TEXT NOT NULL DEFAULT '[]',
    requirements_json      TEXT NOT NULL DEFAULT '[]',
    warnings_json          TEXT NOT NULL DEFAULT '[]',
    suggested_shell        TEXT NOT NULL DEFAULT 'unknown',
    risk_level             TEXT NOT NULL DEFAULT 'unknown',
    provider               TEXT NOT NULL,
    model                  TEXT NOT NULL,
    command_content_hash   TEXT NOT NULL,
    prompt_version         TEXT NOT NULL,
    generated_at           INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL,
    CHECK (length(trim(short_description)) > 0),
    CHECK (suggested_shell IN ('powershell','cmd','bash','sh','zsh','other','unknown')),
    CHECK (risk_level IN ('low','medium','high','unknown'))
);
CREATE INDEX idx_ai_annotations_command ON ai_annotations(command_id);
```

- `command_content_hash` 是生成时命令原文的 FNV-1a 指纹；读取时与 `commands.content_hash` 比较，不一致则 `isStale = true`，不自动删除旧注释。
- `parameters_json` / `requirements_json` / `warnings_json` 保存结构化数组；解析失败时回退为空数组，单条坏数据不阻断命令列表。
- 保存注释时在事务内复核命令存在、内容哈希和手写字段，再 upsert 并更新状态为 `ready`；命令原文 `command` 永不被修改。
- 软删除命令保留其 AI 注释；数据库备份/恢复会携带此表。
- API Key 不在本表，也不在其他 SQLite 表。

### 提示词库（v5）

提示词库与命令库完全独立。提示词分类使用 `prompt_categories`，不复用 `categories`；提示词正文不进入 `commands`。

```sql
CREATE TABLE prompt_categories (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES prompt_categories(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  color       TEXT,
  icon_name   TEXT,
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX idx_prompt_categories_unique_name
  ON prompt_categories(ifnull(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE prompts (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  content           TEXT NOT NULL,
  category_id       TEXT REFERENCES prompt_categories(id) ON DELETE SET NULL,
  background_color  TEXT,
  is_favorite       INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  use_count         INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  CHECK (length(trim(content)) > 0),
  CHECK (length(title) <= 200)
);
CREATE INDEX idx_prompts_active_sort
  ON prompts(deleted_at, category_id, sort_order, updated_at DESC);
CREATE INDEX idx_prompts_last_used ON prompts(deleted_at, last_used_at DESC);
CREATE INDEX idx_prompts_favorite ON prompts(deleted_at, is_favorite, updated_at DESC);

CREATE TABLE prompt_tags (
  prompt_id   TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);
CREATE INDEX idx_prompt_tags_tag ON prompt_tags(tag_id, prompt_id);
```

- `content` 是唯一必填字段，服务层上限 200,000 字符；保存、更新、复制和导出都不裁剪首尾空白，保留 CRLF/LF、缩进、Markdown 代码块和特殊字符。
- `title` 可为空字符串；剪贴板快速保存时取首个有意义行作为显示标题。标题不参与正文，也不会触发 AI。
- 分类为空表示系统“默认”目录；提示词目录的图标/颜色与命令目录使用同一套校验和渲染组件，但数据完全隔离。
- `background_color` 只有在用户明确设置时才显示马卡龙背景；默认为中性表面。没有“跟随目录颜色”模式。
- 提示词收藏、排序、最近使用、使用次数和软删除与命令语义一致；命令与提示词各自维护统计。
- `tags` 表共用，`command_tags` 与 `prompt_tags` 分离；删除一个提示词只级联删除其 `prompt_tags`。
- 提示词不存储 Shell、执行风险、终端环境、AI 注释或来源类型。

### 命令与分类外观

- `background_color` 是命令自己的背景色，保存规范 `#RRGGBB`；`NULL` 表示跟随主题默认背景。
- `use_category_color = 1` 是独立的实时模式，不复制分类颜色值：
  - 渲染时为该命令读取所属分类的 `color`；
  - 分类颜色修改后，所有开启该模式的命令自动更新；
  - 关闭该模式后恢复命令自己的 `background_color`（该值在开启期间保留）；
  - 应用新的自定义/预设颜色或恢复默认时，同时把 `use_category_color` 置 0。
- 命令颜色与分类颜色分别存储，不存在默认同步；同分类命令可以各自使用不同颜色。
- 所有颜色写入前统一规范化为 `#RRGGBB`；非法颜色被拒绝。分类图标必须在允许集合内。
- 外观更新不修改命令 `updated_at`、内容、分类、排序、收藏或使用次数；数据库写入失败整体回滚。
- 批量设置颜色/跟随模式使用单事务，先校验 ID 完整且无重复，再一次性更新。

### UI 展示映射（本轮无 schema 变更）

- `commands.title` 仍保存原值；UI 将其展示为“简短注释”。与命令首行相同/仅因自动截断产生的 title 不直接展示，避免重复。
- `commands.description` 仍保存原值；UI 将其展示为“详细说明”。
- 不执行把旧 title 批量迁移到 description 或其他字段的操作；JSON 字段名保持 `title` / `description`。
- 用户可见的“分类”模块统一显示为“目录结构”，“未分类”显示为“默认”；数据库表名、字段名和 JSON 键不变。
- 系统默认目录仍是 `category_id = NULL`（筛选时使用前端稳定的 `__unclassified__` 标识）；不按显示名称判断，用户自建同名“默认”目录不会与系统默认目录混用。
- 管理器/快捷面板剪贴板一键保存继续写入 `category_id = NULL`（显示为默认目录），并自动生成 `title`；Saved 与 Favorite 字段保持不变。
- `commands.shell` 原值不变；UI 只在 `powershell/cmd/bash/sh/zsh/other` 时显示 Shell 徽标，`unknown`、空值或未知值不显示，不执行数据清洗。
- 命令编辑器选择 `unknown` 时保存的仍是原有合法值，只是选项文案改为“不显示”。

### 排序与分类移动事务

- 查询排序使用稳定次级条件：
  - 自定义：`sort_order ASC, updated_at DESC, title, id`；
  - 最近：`last_used_at` 空值/倒序、`updated_at DESC, id`；
  - 名称：`title, sort_order, id`；
  - 避免相同 `sort_order` 在不同查询/刷新间随机变化。
- `reorder_commands(ids)`：
  - 只接受非空、无重复且均存在的活跃命令 ID；
  - 把这些 ID 放入它们原本占用的全局槽位，保持其他命令相对顺序；
  - 将全部活跃命令的 `sort_order` 归一化为 10/20/30…；
  - 只更新 `sort_order`，不修改 `updated_at`、内容、收藏、标签或 AI 字段。
- `move_commands_to_category(ids, category_id)`：
  - 校验目标分类存在；
  - 捕获每条命令的原 `category_id` 和 `sort_order`；
  - 批量追加到目标分类末尾，跳过已经位于目标分类的命令；
  - 单事务更新 `category_id`、`sort_order`、`updated_at`；
  - 返回 `previous` 供 `restore_command_placements` 撤销；旧分类不存在时撤销回退到未分类。
- `reorder_categories(parent_id, ids)`：对同级分类做槽位替换并归一化 `sort_order`，不影响命令。
- `delete_category_with_options(id, options)`：
  - 命令目标为父分类或未分类；
  - `promote`：直接子分类提升到父级，同名冲突则回滚；
  - `deleteSubtree`：收集整棵子树，先把其中所有命令移到目标，再删除分类；
  - 事务失败不留下部分移动或半删除分类。

### 去重与原始文本

- 保存前查询 `deleted_at IS NULL AND command = ?`；严格原始文本相同才视为重复。
- 不做大小写、空白、换行或引号归一化；`docker ps` 与 `docker ps ` 是不同命令。
- 重复时返回已有命令 ID，不新增，不修改来源。
- `content_hash` 使用 FNV-1a 64 位稳定指纹（十六进制），仅用于索引/未来扩展；去重比较仍使用原文。
- 保存和复制都使用原始 `command` 字段；预览折叠和标题截断不会改变原文。

### tags / command_tags

```sql
CREATE TABLE tags (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color       TEXT,
  created_at  INTEGER NOT NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 40)
);

CREATE TABLE command_tags (
  command_id  TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (command_id, tag_id)
);
CREATE INDEX idx_command_tags_tag ON command_tags(tag_id, command_id);
```

标签在命令保存时按名称查找/自动创建，大小写不敏感去重；单命令最多 24 个。当前没有独立标签重命名/合并 UI。

### clipboard_entries（本地临时历史）

```sql
CREATE TABLE clipboard_entries (
  id                TEXT PRIMARY KEY NOT NULL,
  content           TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'local_monitor',
  content_type      TEXT NOT NULL DEFAULT 'text',
  copied_at         INTEGER NOT NULL,
  is_sensitive      INTEGER NOT NULL DEFAULT 0 CHECK (is_sensitive IN (0, 1)),
  linked_command_id TEXT REFERENCES commands(id) ON DELETE SET NULL,
  CHECK (length(content) > 0),
  CHECK (source IN ('current', 'system_history', 'local_monitor'))
);
CREATE UNIQUE INDEX idx_clipboard_entries_hash
  ON clipboard_entries(content_hash);
CREATE INDEX idx_clipboard_entries_copied
  ON clipboard_entries(copied_at DESC);
```

当前实现只把本地监听文本写入该表，来源为 `local_monitor`。当前剪贴板和 Windows 系统历史是实时读取，不写入该表；表结构保留 `current`/`system_history` 枚举以后扩展。

- 同一内容按 `content_hash` upsert，只更新 `copied_at`（和关联/原文），不重复插入。
- 敏感文本在监听层直接过滤，不进入本表。
- 写入成功后按「最多 N 条、保留 D 天」清理；默认 100 条、7 天。设置页可修改，启动和读取时也会触发清理。
- 清空本地历史只删除本表，不删除 `commands`，也不修改 Windows 系统历史。
- `linked_command_id` 是可选关联，已保存状态不依赖它；UI 始终通过 Command Service 查询原文计算，软删除后自然显示为未保存。

## 5. FTS5 与搜索

```sql
CREATE VIRTUAL TABLE commands_fts USING fts5(
  command_id UNINDEXED,
  title,
  command_text,
  description,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

三个触发器同步 INSERT、标题/原文/说明 UPDATE 和 DELETE。软删除不会立即删除 FTS 行，但查询始终附加 `deleted_at IS NULL`。

提示词使用独立 FTS 表：

```sql
CREATE VIRTUAL TABLE prompts_fts USING fts5(
  prompt_id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

- 三个触发器同步提示词 INSERT、标题/正文 UPDATE 和 DELETE。
- 提示词搜索同时使用 FTS `MATCH` 与转义 `LIKE`（标题、正文、标签名），保证中文子串和特殊字符可用。
- 列表限制最多返回 500 条；正文较长时 LIKE 回退只在当前库规模内执行，后续可按实际数据量再加分页/索引优化。

Repository 搜索策略：

1. 将查询转义并拆分后构造 FTS5 `MATCH`；
2. 同时用转义后的 `LIKE` 搜索标题、原文、说明和标签名；
3. 两种条件 OR，覆盖中文/短子串；
4. 特殊字符（引号、`%`、`_`、反斜杠、`*` 等）不会导致 SQL 错误。

快捷面板的剪贴板视图是前端对原文做大小写不敏感子串过滤；命令库/收藏视图使用 Command Service 搜索。

## 6. 复制与使用统计

- 复制命令由 Rust `LibraryService` 读取原文，再调用 Win32 Unicode 剪贴板写入。
- 提示词由独立 `PromptService` 复制：单条写入完整原文；多选按空行连接；成功后更新提示词自己的 `use_count`、`last_used_at`、`updated_at`。
- 只有系统剪贴板写入返回成功后才更新使用统计；命令与提示词统计互不影响。
- 批量复制命令把原文按换行拼接，批量提示词按空行拼接；都会对每个选中项各记录一次。
- 复制剪贴板历史原文不增加任何命令或提示词使用次数。
- 应用自身写剪贴板前设置 1.5 秒监听抑制窗，避免自身复制进入本地临时历史。

## 7. 设置文件（与数据库分离）

`settings.json` 当前 schema 5：

```json
{
  "schemaVersion": 5,
  "shortcut": "Ctrl+Shift+V",
  "launchAtStartup": false,
  "autoHideQuickPanel": true,
  "theme": "system",
  "lastMode": "quick",
  "sidebarWidth": 172,
  "clipboardMonitoringEnabled": true,
  "clipboardHistoryLimit": 100,
  "clipboardHistoryRetentionDays": 7,
  "hideQuickPanelAfterCopy": false,
  "customColors": ["#EDF3FC", "#FCEEF0"],
  "aiProvider": "deepseek",
  "aiBaseUrl": "https://api.deepseek.com/v1",
  "aiModel": "deepseek-chat",
  "aiTimeoutSeconds": 30,
  "aiTemperature": null,
  "aiAutoAnnotation": false,
  "windowLayouts": { "quick": null, "manager": null }
}
```

- schema 1 → 2 重置旧版窗口几何；schema 2 → 3 保留布局，只增加剪贴板字段；schema 3 → 4 保留全部偏好，增加个人颜色色板；schema 4 → 5 只增加 AI 非敏感配置。
- `customColors` 为规范 `#RRGGBB` 数组，去重、最多 24 个；删除某个个人颜色不会修改已使用该颜色的命令或分类。
- 个人色板由命令颜色面板和分类外观面板共享；保存/删除/重排都通过设置事务写入。
- 设置不包含命令、剪贴板内容、API Key 或数据库内容；API Key 在 Windows Credential Manager 的 `PataCommands/AI/OpenAICompatible`。
- 设置文件损坏时保留原文件，使用默认设置并在下次保存前备份。

## 8. JSON 导入导出（当前 schema 4）

导出结构（省略部分数组项）：

```json
{
  "schemaVersion": 4,
  "exportedAt": 1795403000000,
  "application": { "name": "Pata Commands", "version": "0.2.0" },
  "categories": [
    {
      "id": "uuid",
      "name": "运维",
      "parentId": null,
      "sortOrder": 10,
      "createdAt": 0,
      "updatedAt": 0,
      "color": "#EDF3FC",
      "iconName": "server"
    }
  ],
  "tags": [
    { "id": "uuid", "name": "docker", "color": null, "createdAt": 0 }
  ],
  "commands": [
    {
      "id": "uuid",
      "title": "查看容器",
      "command": "docker ps",
      "description": "",
      "shell": "unknown",
      "categoryId": null,
      "tags": ["docker"],
      "sourceType": "clipboard_history",
      "aiAnnotationStatus": "none",
      "isFavorite": false,
      "sortOrder": 10,
      "useCount": 4,
      "lastUsedAt": 1793084150292,
      "createdAt": 0,
      "updatedAt": 0,
      "backgroundColor": "#FCEEF0",
      "useCategoryColor": false
    }
  ],
  "promptCategories": [
    {
      "id": "uuid",
      "name": "代码审查",
      "parentId": null,
      "sortOrder": 10,
      "createdAt": 0,
      "updatedAt": 0,
      "color": "#F4EFFB",
      "iconName": "book-open"
    }
  ],
  "prompts": [
    {
      "id": "uuid",
      "title": "代码审查提示词",
      "content": "请你作为资深工程师检查以下代码：\\n\\n```ts\\nconst x = 1;\\n```",
      "categoryId": "uuid",
      "tags": ["审查"],
      "isFavorite": true,
      "backgroundColor": null,
      "sortOrder": 10,
      "useCount": 2,
      "lastUsedAt": 1795403100000,
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

导入规则：

- 接受 schema 1、2、3 和 4；超过 100 MB、超过 10,000 条命令或 10,000 条提示词拒绝。
- schema 1 缺失 `sourceType` / `aiAnnotationStatus` 时分别回退为 `import` / `none`。
- schema 1/2 缺失 `backgroundColor` / `useCategoryColor` / 分类 `color` / `iconName` 时回退为 `null` / `false` / `null` / `null`。
- schema 1–3 不包含 `promptCategories` / `prompts`；导入时字段为 `None`，**完整恢复只替换命令库，保留现有提示词库**。schema 4 显式包含提示词数组时才替换提示词库。
- `aiAnnotationStatus` 在导入时统一重置为 `none`，因为 JSON schema 4 不携带 `ai_annotations` 数据。
- 校验 UUID、标题/正文长度、Shell、分类引用、提示词目录循环、重复 ID、标签长度和使用次数。
- 提示词正文不裁剪，导入/导出保持原始文本。
- 合并导入按命令 ID、提示词 ID 跳过已有项；提示词还会跳过严格相同正文；分类/标签按名称映射或新增。已存在分类不覆盖其外观。
- 完整恢复在单事务内写入；失败回滚，导入前自动创建 `pre-import` 数据库备份。
- 软删除命令/提示词不进入 JSON 导出；数据库备份保留它们。
- 个人色板属于设置偏好，不写入 JSON；数据库备份也不包含 `settings.json`。
- API Key、AI 注释正文和模型元数据不进入 JSON 导出；数据库备份包含 AI 注释。

## 9. 数据库备份与恢复

- 备份目录：`%APPDATA%\com.pata.commands\backups\`。
- `VACUUM INTO` 生成一致性快照，不复用 WAL 中间状态。
- 列表按修改时间倒序，记录文件名、路径、大小和时间；UI 只提供创建和恢复，不提供删除。
- 恢复前创建 `pre-restore-<timestamp>.db`。
- 备份校验：`quick_check`、`user_version = 5`、核心表（含 `clipboard_entries`、`prompts`、`prompt_categories`、`prompt_tags`；v4 备份含 `ai_annotations`）。
- 恢复使用 `ATTACH DATABASE` + 延迟外键 + 单事务替换当前表；包含命令、分类、标签、命令标签关联、提示词、提示词目录、提示词标签关联、本地剪贴板历史、命令/分类外观字段和 AI 注释；失败回滚并保留当前数据。
- 对没有 `ai_annotations` 的旧备份，恢复后将无注释的命令状态归一化为 `none`，不会保留虚假 `ready`。
- 备份文件名校验阻止目录穿越；当前只接受 `user_version = 5` 的数据库备份。JSON schema 1–4 可直接导入。

## 10. 实际验收重点

- 从真实 UI 把当前剪贴板和系统历史内容保存到 SQLite；重启后命令仍在。
- 多行文本（包含前后空格、CRLF、缩进、引号和中文）保存后原文完全一致，标题只取首行，Shell 为 `unknown`。
- `password=hunter2` 未进入本地历史；取消敏感确认时没有命令写入；确认后才写入。
- 清空本地历史后 `clipboard_entries = 0`，命令数量不变。
- 删除永久命令后系统历史仍包含该文本；其保存状态变为未保存。
- 数据库从 v1 迁移到 v2 后旧命令保留，`source_type` 回填为 `manual`，`content_hash` 非空。
- 数据库从 v2 迁移到 v3 后命令/分类数据保留，外观字段为 `NULL`/0；实际旧库中的 4 条命令迁移后仍存在。
- 数据库 v3 → v4 后原有命令保留，`ai_annotations` 新建；实际旧库的 2 条有效命令在 AI 测试前后均保留。
- 设置从 schema 2 迁移到 3 后快捷键/主题/窗口布局保留，新增剪贴板字段使用默认值；schema 3 → 4 保留全部偏好并增加个人色板；schema 4 → 5 只增加 AI 配置。
- AI 注释保存后命令原文和手写 title/description 按用户选择保持不变；命令内容改变后 `isStale = true`。
- 数据库备份/恢复实际保留 AI 注释；API Key 扫描 settings、SQLite 全表和 JSON 导出均无命中。
- 实际应用设置命令颜色、跟随分类颜色、分类颜色/图标、批量颜色和个人色板保存/删除后，重启仍保持。
- JSON schema 3 导出/导入实际保留外观；旧 schema 2 导入回退默认外观，未知图标不阻塞导入。
- 管理器剪贴板一键保存实际新增命令：`category_id` 为 `NULL`、来源正确、多行原文完整；不产生 schema 变更。
- 重命名展示为“目录结构/默认”后，原分类 ID、父子关系、筛选和命令归属不变。
- 将 Shell 设为 unknown/powershell/bash 后，UI 分别隐藏、显示 PowerShell、显示 Bash；数据库 shell 列值未变。
- 数据库 v4 → v5 后原有 7 条命令保留，`prompts`、`prompt_categories`、`prompt_tags`、`prompts_fts` 新建；迁移前自动生成 v4 备份。
- 从快捷面板剪贴板“保存为提示词”实际写入 `prompts`，标题取首行，正文与剪贴板原文一致，默认目录为 `NULL`；命令数量不变。
- 创建多行中文/Markdown 提示词后保存、重启、查看、复制，原文逐字符一致；快速复制只增加该提示词的使用次数。
- 提示词库目录新建、重命名、图标/颜色、拖拽排序和删除选项只影响 `prompt_categories`，命令分类树不受影响。
- JSON schema 4 导出包含提示词目录、提示词正文、收藏、标签和颜色；完整恢复回到原状；schema 3 旧文件完整恢复后提示词库仍在。
- 数据库备份/恢复实际保留提示词、提示词目录、标签和使用记录。
