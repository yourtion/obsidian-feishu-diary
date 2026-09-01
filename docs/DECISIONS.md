# 决策记录

> 2026-09-01 开发前经逐项评审拍板。改动任何一条前先读它背后的理由。

## D1 · License：完全独立实现 + MIT

只参考原项目（obsidian-wechat-diary）公开文档中的设计思想（数据契约、意图规则思路），代码与文案全部独立重写。不复制其 main.js、意图词表原文、回执文案。换来许可自由，规避 AGPL 传染。

## D2 · 数据契约：完全独立目录，内部沿用原布局

- 根目录 `FeishuDiary/`（可配置），与微信版完全隔离、不共目录接力
- 内部：`FeishuDiary/YYYY/YYYY-MM-DD.md` + `FeishuDiary/attachments/YYYY/`
- frontmatter `source: feishu-diary`；时间戳段头、同分钟合并、封存注脚照原契约语义

## D3 · MVP 只做 p2p 单聊

事件层直接丢弃 `chat_type=group`，不留群聊分支。私聊是日记场景的自然形态；后续支持时再加。

## D4 · 命名（一次定死）

仓库 `obsidian-feishu-diary` / 插件 id `feishu-diary` / 显示名 `Feishu Diary`。

## D5 · 时区：硬编码 Asia/Shanghai

不做时区配置。作者自用场景，实现从简；`util/time.ts` 是唯一时间入口，若未来上架社区市场再改为可配置。

## D6 · 语音：默认存原声，转写做成开关

Ogg/Opus 直存（Obsidian 可直接播）；飞书官方 ASR 是设置开关而非主路径（免费版可用性待 P0 实测，未验证前不放主路径）；后期可选自配 OpenAI 兼容接口。

## D7 · 回执：表情两态，不发文字

普通消息回执用表情回复表达：`OnIt`（收到/执行中）→ 完成后移除并加 `DONE`。只有命令回复与异常提示才发文字消息。零打扰、状态可见。

## 技术栈与架构约定

- TS strict + oxlint + oxfmt + esbuild + node:test（Node 原生 type-stripping 跑测试，零测试框架依赖）
- Node type-stripping 约束：不用 enum / constructor parameter properties 等不可擦除语法
- `minAppVersion 1.11.4`（SecretStorage 硬要求）；`isDesktopOnly: true`
- 长连接用 `@larksuiteoapi/node-sdk` WSClient（唯一 SDK 依赖面）；发消息/表情/下载用自封装 REST（`feishu/client.ts`），便于在 Electron 下排查
- 事件 handler 3 秒内返回且不抛异常；重活异步化；按 message_id 去重（飞书事件可能重复推送）
- 写入只追加、统一走原子读-改-写；frontmatter 仅创建时写；附件永不删

## Phase 0 待实测（结论回填处）

| # | 问题 | 状态 |
|---|---|---|
| 1 | 断线期间事件是否补推（决定要不要历史消息补拉模块） | ⏳ 待跑 `npm run p0` |
| 2 | ASR 免费版可用性 | ⏳ 待跑 `npm run p0:asr` |
| 3 | SDK 在 Obsidian Electron 内兼容性 | ⏳ 插件装好后验证 |
| 4 | 个人版账号建应用 | ⏳ 用户走一遍接入流程 |
| 5 | Obsidian 播放 .opus | ⏳ Phase 2 |
