# 在线更新（Tauri Updater）

> 当前代码已经接入 Tauri v2 Updater：设置页有「软件更新」，应用启动 4 秒后静默检查一次；发现新版本会弹出更新对话框，下载并安装后自动重启。更新包使用 minisign 公钥校验签名。
>
> 当前仓库已配置为 `https://github.com/605521553/cmdLoad/releases/latest/download/latest.json`，`get_update_configuration` 会返回 `configured: true`。如果以后更换仓库或使用自建 HTTPS 服务器，只需修改 `src-tauri/tauri.conf.json` 的 `plugins.updater.endpoints` 并重新构建。

## 1. 整体流程

```text
你发布新版本
  ├─ 版本号 0.2.0 → 0.2.1
  ├─ npm run release
  │    ├─ 使用私钥签名 NSIS 更新包
  │    ├─ 生成 setup.exe / setup.exe.sig
  │    └─ 生成 artifacts/updater/latest.json
  ├─ 上传 latest.json + zip + sig 到 GitHub Releases / 你的 HTTPS 服务器
  └─ 用户启动应用
       ├─ 4 秒后静默请求 latest.json
       ├─ 版本更高 → 弹出更新说明
       ├─ 点击「下载并安装」
       ├─ 校验签名 → 运行 NSIS 更新 → 自动重启
       └─ 命令、提示词、设置和备份保持不变
```

## 2. 已实现的部分

| 层 | 位置 | 作用 |
| --- | --- | --- |
| Tauri 插件 | `src-tauri/src/lib.rs` | `tauri-plugin-updater` + `tauri-plugin-process` |
| 配置 | `src-tauri/tauri.conf.json` | `plugins.updater`（公钥/endpoint）、`createUpdaterArtifacts: true` |
| 权限 | `src-tauri/capabilities/default.json` | `updater:default`、`process:default` |
| 后端配置查询 | `src-tauri/src/commands/updater.rs` | 返回当前版本、endpoint、是否已配置 |
| 前端状态 | `src/features/updater/updateStore.ts` | 检查、下载进度、安装、错误、稍后提醒 |
| 更新弹窗 | `src/features/updater/UpdateDialog.tsx` | 版本、更新说明、进度、安装按钮 |
| 设置页 | `src/features/settings/components/UpdateSettings.tsx` | 当前版本、检查按钮、状态和更新源 |
| 启动检查 | `src/app/App.tsx` | 启动 4 秒后静默检查一次 |
| 签名构建 | `scripts/build-release.ps1` | 读取签名私钥、构建、生成 `latest.json` |

## 3. 一次性配置

### 3.1 生成签名密钥

当前项目已生成一套本地开发密钥：

```text
src-tauri/updater-keys/pata-commands.key       # 私钥，绝不能提交或发给用户
src-tauri/updater-keys/pata-commands.key.pub   # 公钥
src-tauri/updater-keys/password.txt            # 私钥密码，仅本机保留
```

`.gitignore` 已排除 `src-tauri/updater-keys/`。请立即备份整个目录；**私钥或密码丢失后，已安装的客户端将无法验证后续更新**，只能让用户手动安装新版本。

重新生成（会替换现有密钥，旧客户端将无法自动更新）：

```powershell
npx tauri signer generate -w src-tauri/updater-keys/pata-commands.key
```

把新公钥文件内容填入 `tauri.conf.json` 的 `plugins.updater.pubkey`。

### 3.2 配置更新源

修改 `src-tauri/tauri.conf.json`：

```json
"plugins": {
  "updater": {
    "pubkey": "你的公钥 Base64",
    "endpoints": [
      "https://github.com/你的组织/你的仓库/releases/latest/download/latest.json"
    ],
    "windows": {
      "installMode": "passive"
    }
  }
}
```

支持任意 HTTPS 静态地址，例如：

```text
https://updates.example.com/pata-commands/latest.json
```

不要求 CORS；Tauri 在 Rust 侧请求，不受 WebView CSP 限制。GitHub Releases 的 `releases/latest/download/latest.json` 可以直接使用。

### 3.3 版本号

每次发布前同时修改：

- `package.json` 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`
- `src-tauri/Cargo.toml` 的 `version`

`latest.json` 中的版本必须**严格大于**客户端当前版本，更新器才会提示。不要重复发布同一个版本号。

## 4. 发布新版本

```powershell
# 可选：自定义下载 URL 前缀；不填则从 tauri.conf.json 的 endpoint 推导
$env:PATA_UPDATE_BASE_URL = "https://github.com/你的组织/你的仓库/releases/latest/download"

npm run release
```

`npm run release` 会：

1. 从 `src-tauri/updater-keys/` 读取私钥和密码（也可用 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量覆盖）；
2. 执行 `npm run tauri build`；
3. 生成 `src-tauri/target/release/bundle/nsis/*-setup.exe` 和 `.exe.sig`；
4. 生成 `artifacts/updater/latest.json`；
5. 把 zip、sig、latest.json 复制到 `artifacts/updater/`，便于上传。

生成示例：

```json
{
  "version": "0.2.1",
  "notes": "Pata Commands v0.2.1\n\n- 修复……",
  "pub_date": "2026-11-23T04:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "……minisign 签名……",
      "url": "https://github.com/你的组织/你的仓库/releases/latest/download/Pata%20Commands_0.2.1_x64-setup.exe"
    }
  }
}
```

把以下三个文件上传到同一个 Release（或同一静态目录）：

- `latest.json`
- `Pata Commands_<version>_x64-setup.exe`
- `Pata Commands_<version>_x64-setup.exe.sig`

> Tauri v2 + NSIS 的更新包就是签名的 `setup.exe`，配套 `.exe.sig`；`latest.json` 的 `url` 必须指向这个 exe，`signature` 必须来自同名 `.sig`。
>
> `notes` 可以写纯文本或 Markdown 文本，更新弹窗按纯文本显示并保留换行。可以传入发布说明文件：
>
> ```powershell
> npm run release -- -NotesPath docs/release-notes.md
> ```

## 5. 客户端行为

- 启动 4 秒后静默检查一次；失败不弹窗，只记录在设置页。
- 有更新时弹出「发现新版本」，显示版本、日期、更新说明和下载大小。
- 「稍后」只关闭当前会话，下次启动仍会提示。
- 「下载并安装」显示下载进度；完成后调用 NSIS 安装并自动重启。
- 设置 → 软件更新可以手动检查、查看当前版本、更新源和错误。
- 更新不会删除 `%APPDATA%\com.pata.commands` 下的数据库、设置、备份或凭据。
- 安装包仍受 Windows SmartScreen 影响；代码签名与更新签名是两件事。

## 6. 本地联调（不发布）

准备两个版本，例如当前 0.2.0，准备 0.2.1：

1. 临时把 `plugins.updater.endpoints` 改成 `http://127.0.0.1:8787/latest.json`，并在同一个 `plugins.updater` 中加 `"dangerousInsecureTransportProtocol": true`（仅本地联调；正式发布必须删除）。
2. `npm run release` 生成 0.2.1 的 zip/sig/latest.json。
3. 在 `artifacts/updater` 启动静态服务器：

```powershell
python -m http.server 8787
```

4. 先安装/运行 0.2.0 的 updater-enabled 版本；启动后应提示 0.2.1。
5. 点击下载安装，确认应用重启且 `commands.db` 命令/提示词仍在。
6. 测试完毕把 endpoint 改回正式地址并重新构建。

> 首次安装的 0.2.0 **必须已经包含 updater 插件**。更早的 0.1.x / 未接入 updater 的构建无法自动升级，只能手动安装一次。

## 7. GitHub Actions 示例

仓库 Secrets 配置：

- `TAURI_SIGNING_PRIVATE_KEY`：私钥文件内容
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码

工作流在 tag 推送时构建并创建 Release，上传签名后的 `setup.exe`、`setup.exe.sig` 和 `latest.json`。注意 `latest.json` 中 `version` 要与 tag/应用版本一致，`url` 指向本次 Release 的 setup.exe。

## 8. 安全与限制

- **私钥只在构建机**：不要写入前端、SQLite、settings、安装包或 GitHub 明文变量。私钥泄露后可被伪造更新。
- 更新器会校验 `latest.json` 平台签名；签名不匹配会拒绝安装。
- 更新源必须使用 HTTPS；开发联调可用 HTTP，但不要用于正式发布。
- Windows 使用 NSIS `passive` 安装模式；安装过程中会出现系统安装进度，应用会退出并由安装器重启。
- 自动更新不会自动回滚。若新版本有问题，发布一个更高版本修复；不要让用户降级。
- 当前 endpoint 指向 `605521553/cmdLoad` 的 GitHub Releases；尚未上传第一个 `latest.json` 时，启动检查会静默失败，设置页会显示错误。发布 0.2.1 Release 后即可生效。
- SmartScreen 代码签名证书与 updater 签名是独立的两件事；正式分发建议两者都配置。

## 9. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 检查更新按钮灰色 | `plugins.updater.endpoints` 未配置或公钥为空；改地址并重新构建 |
| 404 / 无法连接 | latest.json 未上传、路径不对、Release 未发布或仓库为私有 |
| 提示签名无效 | 私钥与 `pubkey` 不匹配；或 latest.json 的签名不是本次 setup.exe 的 `.sig` |
| 不提示新版本 | `version` 未严格大于客户端版本；检查版本号三处是否一致 |
| 下载后安装失败 | 下载地址不是签名的 `setup.exe`，或 exe/sig 不匹配 |
| 更新后数据丢失 | 正常更新不会；检查是否误用了全新安装/清理脚本，数据在 `%APPDATA%\com.pata.commands` |
