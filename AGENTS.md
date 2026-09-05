# AGENTS.md — 给 AI 助手与协作者的项目指南

飞书机器人 → 日记：用户对着飞书自建应用机器人发消息，内容按数据契约落盘。两种宿主形态共用同一套编排：**Obsidian 插件**（落 vault）与 **npm CLI**（`npx feishu-diary`，落任意本地目录，无需 Obsidian）。不依赖服务器，全部走飞书官方开放 API（WebSocket 长连接）。

**先读 [docs/DECISIONS.md](docs/DECISIONS.md)**——所有已拍板的设计决策（License、数据契约、时区硬编码、表情回执、扫码建应用、CLI 单包双产物 D9）都在那里，改任何一条前先看它背后的理由。

## 常用命令

```sh
pnpm run build      # tsc --noEmit + esbuild 产出 main.js（插件，约 0.95MB）+ dist/cli.cjs（CLI，约 0.89MB）
pnpm run test       # node --test（Node 26 原生 type-stripping，零测试框架）
pnpm run lint       # oxlint（快速语法层）
pnpm run lint:obsidian  # eslint + eslint-plugin-obsidianmd——社区自动审查同款规则，提交前必须清零
pnpm run fmt        # oxfmt（会重排文件——编辑前重读文件，避免 Edit 冲突）
pnpm run dev        # esbuild watch
pnpm run release    # 发版唯一入口：同步 package/manifest/versions 三处版本 + commit + tag
                     # 用法 pnpm run release [patch|minor|major|x.y.z] [--push]
                     # tag push 后 CI 同时发 GitHub release（插件）与 npm（CLI，--provenance）
```

包管理器为 **pnpm 11**（锁文件 pnpm-lock.yaml；CI 用 pnpm/action-setup@v4）。
pnpm 11 的坑（都踩过）：

- 设置的新家是 **pnpm-workspace.yaml**，package.json 的 `pnpm` 字段已不读
  （`onlyBuiltDependencies` 构建脚本白名单、`minimumReleaseAge: 0`（默认供应链
  策略会拦截刚发布的依赖版本）、`verifyDepsBeforeRun: false` 都在这里）
- `pnpm run` 默认先自动 `pnpm install` 校验依赖，ignored-builds 报错会卡住
  所有脚本——上面的 yaml 配置就是解法
- esbuild 的平台二进制走 optionalDependencies，postinstall 被忽略不影响构建

P0 通道脚本（凭据在 `scripts/p0/.env`，不入库）见 [scripts/p0/README.md](scripts/p0/README.md)：`p0:init`（扫码建应用）/ `p0`（收发验证）/ `p0:debug`（看服务端推帧）/ `p0:diag`（一键分诊）/ `p0:asr`。

## 架构地图

```
src/
├── service.ts        # ★ 环境无关编排核心（去重→p2p→认主→意图→动作 + 提醒 tick + 回执），
│                     #   零 obsidian import；注入 HttpApi/HttpInstance/StorageAdapter/persist
├── main.ts           # 插件壳：生命周期/SecretStorage/设置页/状态栏 + 装配 service
├── cli.ts            # CLI 壳（bin）：args/env 配置 + 装配 service + SIGINT/SIGTERM 优雅退出
├── node/             # Node 运行时实现（CLI 侧）
│   ├── http.ts       #   fetch 版 HttpApi + fetch 版 SDK HttpInstance
│   ├── vault.ts      #   NodeFsVaultAdapter（tmp+rename 原子写 / trash→.trash / exists）
│   └── config.ts     #   args>env>默认 配置解析（纯函数）+ 状态文件读写
├── settings.ts       # 设置类型与默认值（插件 App Secret 走 SecretStorage，CLI 走 env，均不在此）
├── feishu/           # 通道层
│   ├── channel.ts    #   WSClient 包装 + normalizeIncoming（★ 事件规范化，有单测固化结构）
│   ├── client.ts     #   REST 封装（token 自管理、发消息、表情、下载；HttpApi 注入）
│   ├── http.ts       #   ★ obsidian requestUrl 版 HttpApi/HttpInstance + 环境无关接口定义
│   ├── register.ts   #   扫码一键建应用（设备流 requestUrl 自实现 + addons 预填）
│   └── vault-adapter.ts # Obsidian Vault → StorageAdapter 原子写适配（trash 走 FileManager）
├── core/             # 业务层（纯逻辑，可单测）
│   ├── intents.ts    #   意图识别（精确匹配 + 长度闸门 + 「记：」逃生口）
│   ├── writer.ts     #   DiaryWriter：追加/封存/撤回的纯字符串变换 + VaultLike/StorageAdapter
│   ├── attachments.ts #  附件路径与笔记块构造
│   └── reminder.ts   #   每日提醒决策纯函数
├── ui/               # 设置页 + 扫码创建 Modal（qrcode 渲染，仅插件）
└── util/             # time（唯一时间入口）/ dedupe（message_id LRU）/ filename（消毒）
```

分层原则：`core/` 不依赖 obsidian 与 SDK；`feishu/` 只管通道；编排在 `service.ts`（环境无关），`main.ts`/`cli.ts` 是两个宿主壳；`node/` 只被 CLI 引用（不进 main.js 产物）。lint 豁免集中在 `eslint.config.mjs`（cli/node 关 no-console 与 fetch 限制、service 关 no-global-this），oxlint 的 `ignorePatterns` 排除 bundle 产物。

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
9. **Electron 兼容性（P0-3 实测结论）**：SDK 的 HTTP（WSClient 建连拉配置
   POST /callback/ws/endpoint、registerApp 设备流）全部走 axios/XHR，在
   Electron renderer（origin `app://obsidian.md`）被 CORS 拦——飞书域不返回
   CORS 头。**解法不是自实现长连接**：`WSClient` 构造参数支持注入
   `httpInstance`，用 obsidian `requestUrl`（主进程网络栈）实现并注入即可；
   插件所有 HTTP 出站统一走 `feishu/http.ts` 的 requestUrl 封装。WebSocket
   本身不受 CORS（ws 库直连）。**禁止在插件运行时代码（main.js 引用链）里用
   fetch/axios 访问飞书域**——`src/node/` 与 `src/cli.ts` 是 CLI 运行时（不进
   main.js），Node 下无 CORS，用 fetch 是正解（eslint 豁免已注明）。
10. **SDK 体积与 tree-shaking**：SDK 的 CJS（`lib/`）与 ESM（`es/`）都是单文件
    barrel（6MB+），但 ESM 版 esbuild 可以做级联死代码删除——esbuild 配置
    `mainFields: ["module", "main"]` 强制走 ESM 入口后，main.js 从 6.1MB 降到
    约 1MB（不 minify、可审查）。产物超 5MB 会导致 Obsidian Sync Standard
    用户无法同步。**改 SDK 相关 import 后务必检查两个产物体积**（main.js 与
    dist/cli.cjs；tree-shaking 依赖引用链，新增引用可能把大块代码拉回来）。
    另：CLI 产物必须 `format: "cjs"`——SDK 的 axios 依赖链含 CJS require，
    esm 输出下运行时抛 `Dynamic require of "util"`（2026-09-02 实测踩坑）。
11. **社区审核自动审查的坑**：`display()` 已 deprecated（声明式设置 API
    `getSettingDefinitions()` 是方向，1.13.0+ 支持设置搜索——未迁移会 Warning
    不阻塞）；`Vault.trash` 要换 `FileManager.trashFile`；定时器用
    `window.setTimeout`（popout 兼容）；标题用 `new Setting().setHeading()`；
    打包依赖内部代码（如 qrcode 的 createElement）触发的告警是误报，可注明不改。
12. **审核机器人不读仓库的 eslint 豁免，也不读 pnpm-lock.yaml**：自动审查用
    自己的规则集扫全 repo 源码——`src/cli.ts`/`src/node/`（CLI 运行时，不进
    main.js 产物）会被报 fs 直访/fetch/console/no-unsafe-*；`register.ts` 的
    node:zlib 因其环境缺 @types/node 也误报 unsafe（本地 lint:obsidian 干净
    可证）。这些 Warning 在审核 PR 注明即可，Error 才阻塞。真坑是**构建校验**：
    机器人按 npm 语义装依赖（无 lock 可读），`^` 范围解析到新 esbuild（0.25→
    0.28）就触发 "Build output does not match the released main.js"——进
    bundle 的依赖（esbuild / @larksuiteoapi/node-sdk / qrcode）必须锁精确
    版本（2026-09-02 已锁，验证过 main.js 逐字节不变）。

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
- **版本号单一入口**：`npm run release`（手改 package/manifest/versions 或手打
  tag 都会漂移——CI 校验 tag == manifest == package，不一致构建失败）。
- **进 bundle 的依赖锁精确版本**（不带 `^`，现有 esbuild / SDK / qrcode）：
  审核机器人 npm 语义安装不读 pnpm-lock，`^` 漂移触发构建产物不匹配（见硬知识 12）。
- 注释密度低、只写代码本身说不清的约束；中文注释与文案。

## 当前状态（2026-09-02）

Phase 1-3 代码完成（68 单测全绿），真机验证通过，已提交 community.obsidian.md
审核（2026-09-01）。体积优化：tree-shaking 后 main.js 0.95MB（过 Sync 5MB 线），
release 带 artifact attestation。社区自动审查的 Error 与主要 Warning 已修
（0.2.1），版本联动机制上线（npm run release）。

**CLI 版（2026-09-02）**：编排抽成 `service.ts`（环境无关），npm 包 `feishu-diary`
（`npx feishu-diary`，Node ≥18，产物 dist/cli.cjs 0.89MB 单文件零依赖）。真机
验证：--env-file 凭据加载、认主预填、WS 连接 connecting→online（fetch 版
HttpInstance）、SIGINT 优雅退出均通过。npm 首发已手动完成（0.2.3），
**release.yml 已整合 npm publish**（tag → GitHub release + npm 一条链，幂等可
重跑）。npm 认证走 **Trusted Publishers（OIDC）**：无需 NPM_TOKEN，但要求
Node ≥22.14 + npm ≥11.5.1（CI 用 Node 24）、id-token: write、package.json 的
repository 字段；npmjs.com 后台绑定须与 workflow 完全一致（repo +
release.yml + 无 environment，大小写敏感），provenance 自动生成。完整收发
管线与插件共用 service（测试保护），CLI 侧专项测试覆盖 fs 存储与配置解析。
决策记录见 D9。

**URL hooks + 富文本（2026-09-05）**：CLI 支持 `hooks.json`（默认 `<dir>/hooks.json`，
`--hooks-file` / `FEISHU_HOOKS_FILE` 可改）——文本消息里的 URL 命中 match（正则）即
分流：原文照常记日记、命令逐 URL 执行（spawn **无 shell**、URL 追加为末参、超时默认
600s、stdout 截断 256KB）、stdout 追加进当天日记。hook 命令走**并发 lane** 不占串行
队列（下载分钟级不堵「记一条」），两段落盘借队列保原子。service 经注入缝
`hooks`/`hookRunner` 保持环境无关，插件不注入即无此路径（child_process 是插件审核
红线），spawn 实现在 `node/hooks.ts`。触发面严格收窄：仅文本类消息 + classify 为
note 的正文，「记：」逃生口/命令词/媒体不受影响。富文本 post 消息（链接分享的真身，
飞书无独立 link 类型）同日支持：`channel.ts` 的 `flattenPost` 扁平化为 markdown
（`a`→`[文字](href)`），post 从「没学会」变为正常记日记，插件同样受益。决策见 D11。

待验证：P0-1 断线补推实验（决定要不要历史消息补拉模块）。

待开发：CLI 的 init 扫码子命令（可选）；审核反馈跟进（getSettingDefinitions
声明式设置迁移——1.13.0+ 设置搜索，非阻塞）；P0-1 结论若需补拉则加历史消息
模块；Phase 4（语音气泡样式、撤回事件同步 im.message.recalled_v1、ASR 自配
OpenAI 兼容开关）。
