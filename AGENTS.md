# AGENTS.md — 给 AI 助手与协作者的项目指南

飞书机器人 → Obsidian 日记插件：用户对着飞书自建应用机器人发消息，内容按数据契约落进本地 vault。不依赖服务器，全部走飞书官方开放 API（WebSocket 长连接）。

**先读 [docs/DECISIONS.md](docs/DECISIONS.md)**——所有已拍板的设计决策（License、数据契约、时区硬编码、表情回执、扫码建应用）都在那里，改任何一条前先看它背后的理由。

## 常用命令

```sh
npm run build      # tsc --noEmit + esbuild 产出 main.js（production minify）
npm run test       # node --test（Node 26 原生 type-stripping，零测试框架）
npm run lint       # oxlint
npm run fmt        # oxfmt（会重排文件——编辑前重读文件，避免 Edit 冲突）
npm run dev        # esbuild watch
```

P0 通道脚本（凭据在 `scripts/p0/.env`，不入库）见 [scripts/p0/README.md](scripts/p0/README.md)：`p0:init`（扫码建应用）/ `p0`（收发验证）/ `p0:debug`（看服务端推帧）/ `p0:diag`（一键分诊）/ `p0:asr`。

## 架构地图

```
src/
├── main.ts            # 插件入口：生命周期、状态栏、消息管线编排（去重→p2p→认主→意图→动作）
├── settings.ts        # 设置类型与默认值（App Secret 走 SecretStorage，不在此）
├── feishu/            # 通道层
│   ├── channel.ts     #   WSClient 包装 + normalizeIncoming（★ 事件规范化，有单测固化结构）
│   ├── client.ts      #   REST 封装（token 自管理、发消息、表情、下载）
│   ├── register.ts    #   扫码一键建应用（registerApp + addons 权限/事件预填）
│   └── vault-adapter.ts # Obsidian Vault → VaultLike 原子写适配
├── core/              # 业务层（纯逻辑，可单测）
│   ├── intents.ts     #   意图识别（精确匹配 + 长度闸门 + 「记：」逃生口）
│   ├── writer.ts      #   DiaryWriter：追加/封存/撤回的纯字符串变换 + VaultLike
│   └── contract.ts    #   数据契约常量（布局见 DECISIONS D2）
├── ui/                # 设置页 + 扫码创建 Modal（qrcode 渲染）
└── util/              # time（唯一时间入口）/ dedupe（message_id LRU）
```

分层原则：`core/` 不依赖 obsidian 与 SDK；`feishu/` 只管通道；业务编排在 `main.ts`。

## 飞书通道硬知识（2026-09-01 实测踩坑，别再踩）

1. **SDK 长连接事件是展平结构**：`EventDispatcher.parse` 把 v2 事件的
   `header`/`event` 展平到顶层，handler 收到的是 `{schema, event_id, event_type,
sender, message}`——**`data.message` 直接取，没有 `data.event` 包装**。写错
   路径会静默吞掉全部事件（tests/channel.test.ts 固化了正确结构）。
2. **配置变必须发布**：权限/事件/订阅方式的每次变更都要「创建新版本并发布」
   才线上生效。**配置页面对 ≠ 已生效**——这是「连接成功但收不到事件」的头号原因。
3. **权限名必须精确**：不存在的 scope 会被 addons 确认页**静默忽略**，直到调
   API 才 403（99991672）。例：表情回复是 `im:message.reactions:write_only`
   （不是 `reactions:send`）。全部 scope 见 `src/feishu/register.ts` 的
   REQUIRED_SCOPES。
4. **扫码建应用（registerApp）**：默认订阅方式即长连接，addons 预填的事件/
   权限全部生效（P0-7 已实测）——扫码后无需进后台，但发布一次仍是必须的。
   订阅方式等敏感配置不能随 addons 预填，可用
   `PATCH /application/v7/applications/{app_id}/config` 程序化改（需
   `application:application:patch` 权限，diag 第 [4] 步即此自愈）。
5. **3 秒时限**：长连接事件 handler 须 3 秒内返回且不抛异常（否则重推）——
   handler 只做去重+入队+立即返回，重活异步。事件可能重复推送，按
   `message_id`（不是 event_id）去重。
6. **集群模式**：同一应用多个长连接客户端在线时，事件随机推给其中一个——
   调试时确保只有一个进程。
7. **无用的线索**：SDK 启动时打印的英文配置提示是无条件输出；`ws client ready`
   只代表 WS 层连上；debug 日志 `data: undefined` 正常。判断服务端是否推帧用
   `npm run p0:debug` 看有没有 `receive message` 行。
8. **官方文档有 markdown 源**：`open.feishu.cn/document/...` 的 URL 加 `.md`
   后缀直接 curl 可得，无需浏览器。

## 代码约定（工具链强制的）

- **Node 26 type-stripping 跑测试**：源码禁用 enum、constructor parameter
  properties 等**不可擦除** TS 语法（用了会在测试加载期报
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`——本项目已因此炸过两次）。用字面量
  union + 显式字段赋值替代。
- 相对导入**带 `.ts` 后缀**（tsconfig 已开 `allowImportingTsExtensions`）；
  类型导入用 `import type`（verbatimModuleSyntax）。
- `exactOptionalPropertyTypes: true`：可选属性不能显式赋 `undefined`。
- 全项目时间走 `util/time.ts`（硬编码 Asia/Shanghai），禁止散落 `new Date()`
  取字段。写入只追加、统一 `vault.process` 原子读改写（见 contract.ts 头注释）。
- 注释密度低、只写代码本身说不清的约束；中文注释与文案。

## 当前状态（2026-09-01）

Phase 1（消息管线）+ Phase 2（媒体入库）+ Phase 3 核心（每日提醒）代码完成，
51 单测全绿。P0 实测：事件接收/表情两态/机器人回复全通；ASR 免费版不可用
（99991400，配额为零，转写开关默认关）。

待验证（用户侧）：P0-1 断线补推实验（决定要不要补拉模块）、附件下载实测
（发图/文件/语音）、Obsidian 播放 .opus、插件装进 Obsidian 真机（SDK 在
Electron 的兼容性是最大未知数；不兼容则自实现长连接，协议公开）。

待开发：P0-1 结论若需补拉则加历史消息模块；Phase 4（语音气泡样式、撤回事件
同步 im.message.recalled_v1、富文本消息、ASR 自配 OpenAI 兼容开关、上架社区
市场）。
