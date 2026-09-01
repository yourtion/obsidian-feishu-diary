# Feishu Diary for Obsidian

对着飞书机器人说话，内容落进本地 Obsidian 库——不依赖服务器，全部走飞书官方开放 API（WebSocket 长连接）。

## 特性

- **扫码即用**：设置页扫码一键创建飞书自建应用（自动配好权限与事件订阅），无需进开发者后台
- **发什么记什么**：一次发送 = 一条日记，`FeishuDiary/YYYY/YYYY-MM-DD.md` 按契约落库，同分钟消息共享时间戳段头
- **表情两态回执**：⏳ 收到 → ✅ 完成，不打扰；命令与异常才发文字
- **附件入库**：图片/视频嵌入、文件链接、语音 🎤 原声直存（Ogg/Opus，Obsidian 可直接播）
- **自然语言命令**：撤回 / 结束 / 晚安 / 在吗 / 记：xxx / 帮助 / 叫我XX
- **每日提醒**：当天没记才提醒（默认 21:30），连 3 天没记自动沉默，错过到点开机补发
- **跨逻辑日**：凌晨 4 点前算前一天，段头时间戳仍写真实时间
- **数据契约**：只追加、原子写、frontmatter 仅创建时写、附件永不删（见 `docs/DECISIONS.md`）

## 开发

```sh
npm install
npm run lint && npm run fmt:check
npm test
npm run build   # 产出 main.js
```

接入与通道验证见 [scripts/p0/README.md](scripts/p0/README.md)，设计决策见 [docs/DECISIONS.md](docs/DECISIONS.md)。

## License

MIT
