# Feishu Diary for Obsidian

[中文说明](#中文说明)

Talk to a Feishu bot, and it lands in your Obsidian vault as a diary. No server required — everything goes through Feishu's official open platform APIs (WebSocket long connection).

Also available as a **standalone CLI** — `npx feishu-diary` writes the same diary into any local directory, no Obsidian needed (see [CLI usage](#cli-usage)).

## Features

- **Scan to set up**: create your Feishu app by scanning a QR code in the plugin settings — permissions and event subscriptions are pre-configured automatically
- **Per-machine enable switch**: the bot service is off by default and toggled per machine (stored in local storage, not synced with your vault) — safe to run the same vault on multiple machines, only one of them listens
- **Send anything, it's a diary entry**: each message becomes an entry in `FeishuDiary/YYYY/YYYY-MM-DD.md`, with messages in the same minute sharing one timestamp heading
- **Two-state reaction receipts**: ⏳ received → ✅ done, no chat noise; only commands and errors produce text replies
- **Attachments**: images/videos embedded, files linked, voice notes stored as-is (Ogg/Opus, playable inside Obsidian)
- **Natural language commands**: 撤回 (undo last) / 结束 / 晚安 (seal the day) / 在吗 (ping) / 记：xxx (force note) / 帮助 (help) / 叫我XX (set nickname)
- **Daily reminder**: reminds you only if you haven't written today (default 21:30), goes silent after 3 unanswered days, catches up on launch
- **Logical day boundary**: messages before 4 AM count as the previous day, while the timestamp heading keeps the real time
- **Data contract**: append-only, atomic writes, frontmatter written once at creation, attachments never deleted (see `docs/DECISIONS.md`)

## Network usage

This plugin connects to the following endpoints on your machine:

- `open.feishu.cn` — Feishu Open Platform: send/receive messages, download message resources, manage the app you own
- `accounts.feishu.cn` — scan-to-create-app device authorization (only when you use the QR setup)
- `msg-frontier.feishu.cn` — WebSocket long connection for receiving messages

Your App Secret is stored in Obsidian's SecretStorage, never in plugin data files. The bot only recognizes the first user who messages it (or the user who scanned the QR code) — no contact permissions are requested.

## Setup

1. Install the plugin and open its settings
2. Click "扫码创建" (Scan to create) and confirm on your phone — this creates a Feishu custom app with the required permissions (the "Enable on this machine" switch turns on automatically)
3. Publish the app version in the Feishu developer console (the QR flow pre-fills everything; publishing takes two clicks)
4. Find the bot in Feishu and start talking

The bot service is **off by default** and toggled per machine via "在本机启用" (Enable on this machine) — the switch is stored locally and never synced with your vault, so multi-machine vaults only listen on the machines you choose.

## CLI usage

The same pipeline ships as an npm package (`feishu-diary`) for headless environments — a home server, a NAS, a Raspberry Pi, or simply anywhere without Obsidian:

```sh
npx feishu-diary init    # scan a QR code to create the Feishu app, then publish it
                         # (link provided) — writes ~/.feishu-diary.json (mode 600)
npx feishu-diary         # runs with zero arguments, reading that config file
```

Prefer explicit credentials? Everything is overridable (`args > env > config file > defaults`):

```sh
npx feishu-diary --app-id cli_xxx --app-secret yyy --dir ~/diary
# or via environment variables (a .env file works too, see --env-file)
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy npx feishu-diary --dir ~/diary
```

Run `npx feishu-diary --help` for the full option list; the config file fields and URL hooks are documented in [docs/config.md](docs/config.md). Notes:

- Files land in `<dir>/YYYY/YYYY-MM-DD.md` with the same data contract as the plugin (append-only, atomic writes, attachments under `<dir>/attachments/`)
- Runtime state (owner binding, nickname, reminder state) lives in `<dir>/.feishu-diary-state.json` — back up the directory and you've backed up everything
- Recalled entries move to `<dir>/.trash/` (recoverable) instead of the system trash
- **URL hooks** (CLI only): either inline in the config file (`"hooks": {...}`) or as a `hooks.json` next to your diary — matching links get routed to your own commands, the original message still lands in the diary, each matched URL runs your command (URL appended as the last argument, no shell), and the command's stdout is appended to the day's file. Podcast downloads, doc archiving, whatever you script. See `--help` for the format
- Auto-start on macOS: see [docs/autostart-macos.md](docs/autostart-macos.md) (launchd plist template)
- ⚠️ One app, one client: if the Obsidian plugin and the CLI connect with the same app credentials at the same time, Feishu delivers each event to a random one of them. Don't run both against the same app.

Requires Node.js ≥ 18.

## Development

```sh
pnpm install
pnpm run lint && pnpm run fmt:check
pnpm test
pnpm run build   # produces main.js (plugin) + dist/cli.cjs (npm CLI)
pnpm run release # bump version (package/manifest/versions) + commit + tag, all in one
```

Channel verification and onboarding scripts live in [scripts/p0/README.md](scripts/p0/README.md); design decisions in [docs/DECISIONS.md](docs/DECISIONS.md).

## 中文说明

对着飞书机器人说话，内容落进本地 Obsidian 库——不依赖服务器，全部走飞书官方开放 API（WebSocket 长连接）。也提供**独立 CLI 版**（`npx feishu-diary`），无需 Obsidian，可跑在任意有 Node 的机器上，写入任意本地目录。

- **扫码即用**：设置页扫码一键创建飞书自建应用（自动配好权限与事件订阅），无需进开发者后台
- **本机启用开关**：服务默认关闭，按机器开关（只存本机，不随 vault 同步）——多机共用同一 vault 也不怕抢消息，只在指定机器上监听
- **发什么记什么**：一次发送 = 一条日记，同分钟消息共享时间戳段头
- **表情两态回执**：⏳ 收到 → ✅ 完成，不打扰；命令与异常才发文字
- **附件入库**：图片/视频嵌入、文件链接、语音 🎤 原声直存（Obsidian 可直接播）
- **自然语言命令**：撤回 / 结束 / 晚安 / 在吗 / 记：xxx / 帮助 / 叫我XX
- **每日提醒**：当天没记才提醒（默认 21:30），连 3 天没记自动沉默，错过到点开机补发
- **数据契约**：只追加、原子写、frontmatter 仅创建时写、附件永不删

### CLI 用法

```sh
npx feishu-diary init    # 扫码创建飞书应用（确认页也可复用已有应用），按提示发布后
                         # 生成 ~/.feishu-diary.json（含凭据与主人 open_id，权限 600）
npx feishu-diary         # 零参数启动，自动读该配置文件
```

也支持显式传参/环境变量（优先级 参数 > 环境变量 > 配置文件 > 默认，`--env-file` 可加载 .env）：

```sh
npx feishu-diary --app-id cli_xxx --app-secret yyy --dir ~/diary
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy npx feishu-diary --dir ~/diary
```

- 数据契约与插件完全一致；运行状态（认主/称呼/提醒）存 `<dir>/.feishu-diary-state.json`
- 撤回的条目移入 `<dir>/.trash/`（可恢复），不走系统废纸篓
- **URL hooks（仅 CLI）**：写在配置文件 `"hooks"` 字段或日记目录的 `hooks.json`——命中规则的链接自动交给自定义命令处理，原文照常记日记，命令 stdout 追加进当天日记（URL 作为命令最后一个参数，不经 shell）；配置格式见 `npx feishu-diary --help`
- macOS 开机自启：[docs/autostart-macos.md](docs/autostart-macos.md)（launchd 配置模板）
- ⚠️ 同一应用凭据勿与 Obsidian 插件同时在线（飞书会把事件随机推给其中一个客户端）
- 配置文件与 URL hooks 完整用法：[docs/config.md](docs/config.md)
- 要求 Node.js ≥ 18，完整参数见 `npx feishu-diary --help`

## License

MIT
