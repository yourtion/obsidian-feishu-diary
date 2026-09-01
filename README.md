# Feishu Diary for Obsidian

对着飞书机器人说话，内容落进本地 Obsidian 库——不依赖服务器，全部走飞书官方开放 API（WebSocket 长连接）。

## 特性（规划中，MVP 开发中）

- 发什么记什么：一次发送 = 一条日记，`FeishuDiary/YYYY/YYYY-MM-DD.md` 按契约落库
- 表情两态回执：⏳ 收到 → ✅ 完成，不打扰
- 附件入库：图片/文件/视频存 `attachments/YYYY/`，笔记内插 wikilink
- 语音原声：Ogg/Opus 直存，Obsidian 可直接播放
- 自然语言命令：撤回 / 结束 / 晚安 / 在吗 / 帮助 …
- 每日提醒（当天没记才提醒）

## 开发

```sh
npm install
npm run lint && npm run fmt:check
npm test
npm run build   # 产出 main.js
```

## License

MIT
