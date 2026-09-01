# Feishu Diary for Obsidian

[中文说明](#中文说明)

Talk to a Feishu bot, and it lands in your Obsidian vault as a diary. No server required — everything goes through Feishu's official open platform APIs (WebSocket long connection).

## Features

- **Scan to set up**: create your Feishu app by scanning a QR code in the plugin settings — permissions and event subscriptions are pre-configured automatically
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
2. Click "扫码创建" (Scan to create) and confirm on your phone — this creates a Feishu custom app with the required permissions
3. Publish the app version in the Feishu developer console (the QR flow pre-fills everything; publishing takes two clicks)
4. Find the bot in Feishu and start talking

## Development

```sh
pnpm install
pnpm run lint && pnpm run fmt:check
pnpm test
pnpm run build   # produces main.js
pnpm run release # bump version (package/manifest/versions) + commit + tag, all in one
```

Channel verification and onboarding scripts live in [scripts/p0/README.md](scripts/p0/README.md); design decisions in [docs/DECISIONS.md](docs/DECISIONS.md).

## 中文说明

对着飞书机器人说话，内容落进本地 Obsidian 库——不依赖服务器，全部走飞书官方开放 API（WebSocket 长连接）。

- **扫码即用**：设置页扫码一键创建飞书自建应用（自动配好权限与事件订阅），无需进开发者后台
- **发什么记什么**：一次发送 = 一条日记，同分钟消息共享时间戳段头
- **表情两态回执**：⏳ 收到 → ✅ 完成，不打扰；命令与异常才发文字
- **附件入库**：图片/视频嵌入、文件链接、语音 🎤 原声直存（Obsidian 可直接播）
- **自然语言命令**：撤回 / 结束 / 晚安 / 在吗 / 记：xxx / 帮助 / 叫我XX
- **每日提醒**：当天没记才提醒（默认 21:30），连 3 天没记自动沉默，错过到点开机补发
- **数据契约**：只追加、原子写、frontmatter 仅创建时写、附件永不删

## License

MIT
