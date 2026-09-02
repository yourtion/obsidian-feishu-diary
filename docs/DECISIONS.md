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

Ogg/Opus 直存（Obsidian 可直接播）；飞书官方 ASR 是设置开关而非主路径；后期可选自配 OpenAI 兼容接口。
✅ P0-2 实测结论（2026-09-01）：免费租户调 ASR 单次即返回 99991400 频控（配额为零，与文档「免费版不支持调用」吻合）——ASR 开关默认关，付费版用户可自行开启。

## D7 · 回执：表情两态，不发文字

普通消息回执用表情回复表达：`OnIt`（收到/执行中）→ 完成后移除并加 `DONE`。只有命令回复与异常提示才发文字消息。零打扰、状态可见。

## D8 · 接入：扫码一键创建应用（2026-09-01 补）

飞书 SDK ≥1.61.1 提供 `registerApp`（OAuth 2.0 Device Flow，RFC 8628）：用户飞书扫码确认后自动创建自建应用、按 `addons` 预填权限与事件订阅、直接返回凭据。设置页内置「扫码创建」按钮，成功后凭据自动入 SecretStorage、扫码者自动认主。

- `preset: false` 最小基座（仅机器人能力），只申请显式声明的能力，与隐私理念一致
- `createOnly: true` 防止误绑已有应用
- 手动创建路径保留（README 提供权限批量导入 JSON）
- ✅ P0-7 实测结论（2026-09-01，后台截图确认）：扫码创建的应用**默认订阅方式即「长连接」**，addons 预填的事件（im.message.receive_v1，应用身份）与权限全部生效——扫码后无需进后台改订阅方式
- ⚠️ 踩坑记录：配置界面对 ≠ 配置已生效——权限/事件/订阅方式的每次变更都需「创建新版本并发布」才在线上生效，这是首次跑 p0 收不到事件的真实原因
- ⚠️ 踩坑记录：scope 名必须精确——不存在的权限名（如 `im:message.reactions:send`）会被 addons 确认页静默忽略，直到调 API 才 403（99991672）。正确名是 `im:message.reactions:write_only`。教训：权限名不确定时先查 scope-list 文档，不要按语义猜
- ⚠️ 踩坑记录（同类第二例）：下载消息资源的权限不是 `im:resource`（该 scope 存在但端点不认可），实测错误信息给出正确候选 `[im:message.history:readonly, im:message:readonly, im:message]`，取最小集 `im:message:readonly`。教训升级：**API 调用报 99991672 时，错误信息里的 scope 列表就是权威答案**
- ✅ 实测（2026-09-01）：飞书确实会重复推送事件（同一 message_id 收到两遍，并发消息时触发）——message_id 去重是硬需求，p0 脚本与插件均已实现
- 兜底：p0:diag 第 [4] 步会 PATCH application/v7/config 幂等自愈（需 application:application:patch 权限，已加入 init 与插件的 addons）

## D9 · CLI 版：单包双产物，编排抽成环境无关 service（2026-09-02 补）

无 Obsidian 场景（家用服务器/NAS/树莓派）经 npm 包 `feishu-diary` 直接 `npx feishu-diary` 启动。关键拍板：

- **单包双产物，不做 monorepo**：同一 package.json 既是插件（GitHub release 装 main.js）又是 npm 包（files 只含 dist/，bin 指 dist/cli.cjs）。版本天然同步，release 脚本/CI 校验零改动；workspace 化要大改发版链路，收益只有「两个包名」，不值。
- **npm 包名 = 插件 id = `feishu-diary`**（D4 的扩展）：npx 按包名找包，短名命令体验优先。插件市场看 manifest id，不受 package name 影响。
- **编排抽 `src/service.ts`（零 obsidian import）**：消息管线/提醒/回执全部搬入，`main.ts`（插件壳）与 `cli.ts`（CLI 壳）只做装配。注入面收敛为四个：HttpApi（requestUrl/fetch 二选一）、SDK HttpInstance、StorageAdapter（Vault/fs 二选一）、persist 回调。
- **CLI 产物 format 用 cjs 不用 esm**：SDK 的 axios 依赖链含 CJS require，esm 输出下 esbuild 的 `__require` shim 运行时抛 `Dynamic require of "util"`。cjs 与 main.js 同管线（已验证）。
- **配置优先级 args > env > 默认；状态文件只存运行时习得**（认主/称呼/提醒状态机，`<dir>/.feishu-diary-state.json`，点开头 Obsidian 不索引）——用户显式配置不落盘，每次启动重解析。
- **CLI 的 trash 移 `<dir>/.trash/`** 而非系统废纸篓：零依赖、跨平台、可恢复；NodeFsVaultAdapter 的原子性为单进程语义（tmp+rename），与「同一应用仅一客户端在线」约束一致。
- **集群约束对 CLI 同样适用**：同一 appId 的插件与 CLI 勿同时在线（事件随机分推）。
- lint 适配：`eslint.config.mjs` 对 `src/cli.ts`+`src/node/**` 关 no-console/no-restricted-globals（CLI 运行时 stdout 是本职、Node 下 fetch 无 CORS）；对 `src/service.ts` 关 obsidianmd/no-global-this（双运行时共用模块的刻意 Node 兼容分支）；oxlint `ignorePatterns` 排除 bundle 产物。
- v1 不含 `init` 扫码子命令（`p0:init` 已覆盖），后续可加。

## 技术栈与架构约定

- TS strict + oxlint + oxfmt + esbuild + node:test（Node 原生 type-stripping 跑测试，零测试框架依赖）
- Node type-stripping 约束：不用 enum / constructor parameter properties 等不可擦除语法
- `minAppVersion 1.11.4`（SecretStorage 硬要求）；`isDesktopOnly: true`
- 长连接用 `@larksuiteoapi/node-sdk` WSClient（唯一 SDK 依赖面）；HTTP 出站统一 `HttpApi` 接口注入：Obsidian 下 requestUrl 实现（Electron CORS，见 AGENTS 硬知识 9），CLI 下 fetch 实现（`node/http.ts`）；发消息/表情/下载用自封装 REST（`FeishuClient`）
- 编排在 `service.ts`（环境无关），`main.ts`/`cli.ts` 两个宿主壳装配；存储统一 `StorageAdapter` 接口（Obsidian Vault / Node fs 两个实现）
- 事件 handler 3 秒内返回且不抛异常；重活异步化；按 message_id 去重（飞书事件可能重复推送，实测证实）
- 写入只追加、统一走原子读-改-写；frontmatter 仅创建时写；附件永不删；插件内删除走 FileManager.trashFile（尊重用户删除偏好），CLI 内移 `<dir>/.trash/`
- **产物体积策略**：不 minify（审核要求可审查）+ `mainFields: [module, main]` 强制 SDK ESM 入口做 tree-shaking（6.1MB → ~1MB）；产物必须 <5MB（Obsidian Sync Standard 单文件上限）。**改 SDK 相关 import 后务必检查两个产物体积**（main.js 与 dist/cli.cjs）
- **版本联动**：`npm run release` 单一入口（三处版本 + tag），CI 校验 tag == manifest == package；npm 发布（手动 `npm publish`，prepublishOnly 自动 build+test）与插件发版共用同一版本号

## Phase 0 实测结论（2026-09-01/02，明细见 scripts/p0/README.md）

| #   | 问题                              | 结论                                                    |
| --- | --------------------------------- | ------------------------------------------------------- |
| 1   | 断线期间事件是否补推              | ⏳ 待实验（唯一剩余）                                   |
| 2   | ASR 免费版可用性                  | ✅ 不可用（99991400，配额为零），转写开关默认关         |
| 3   | SDK 在 Obsidian Electron 内兼容性 | ✅ HTTP 层 CORS 拦截，requestUrl 注入 httpInstance 解决 |
| 4   | 个人版账号建应用                  | ✅ 个人免费团队可扫码创建                               |
| 5   | Obsidian 播放 .opus               | ⏳ 语音入库后点播验证                                   |
| 6   | 3 秒时限                          | ✅ handler 轻活、重活异步                               |
| 7   | 扫码创建的应用默认订阅方式        | ✅ 默认即长连接（见 D8）                                |
| 8   | 全链路真机                        | ✅ 2026-09-01 通过（收发/表情/扫码/附件）               |
