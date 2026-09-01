# P0 通道验证

动手写插件业务前，先用这里的脚本验证飞书通道（结论直接决定架构取舍）。

## 快速开始（一条龙）

```sh
ppnpm run p0:init    # 扫码一键创建/更新应用，凭据自动写入 scripts/p0/.env
pnpm run p0         # 长连接收发验证（保持在线，去飞书给机器人发消息）
```

`p0:init` 基于 SDK `registerApp`（OAuth 设备授权流，[官方文档](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs)），
自动完成：创建企业自建应用（`.env` 已有 App ID 则走更新模式，幂等可重跑）→
预填权限与事件订阅（含 `im.message.receive_v1`）→ App ID / App Secret /
扫码用户 open_id 写入 `.env`。

> ⚠️ **发布是最后一公里（最高频的坑）**：权限/事件/订阅方式的每次变更，都必须
> 「版本管理与发布 → 创建版本 → 申请发布」（自建应用自审自批，几秒钟）才线上生效。
> **配置界面对 ≠ 已生效**。p0:init 之后请发布一次再跑 p0。

## 脚本一览

| 命令               | 用途                                                            |
| ------------------ | --------------------------------------------------------------- |
| `ppnpm run p0:init`  | 扫码创建/更新应用（幂等）                                       |
| `pnpm run p0`       | 主验证：长连接收消息 → 表情两态回执 → 机器人回复 → 附件下载     |
| `pnpm run p0:debug` | 同 p0，加 SDK debug 日志——观测服务端推送的每个事件帧            |
| `pnpm run p0:diag`  | 一键分诊：进程抢占检查 + 凭据验证 + 出站测试 + 入站配置自动修复 |
| `pnpm run p0:asr`   | ASR 免费版可用性实测（合成 PCM 直接探测）                       |

## 收不到消息？按实测踩坑概率排查

1. **版本没发布**（最高频）：改过权限/事件/订阅方式后没有创建新版本并发布。
   症状：配置页全对、`ws client ready`、出站能发（p0:diag [3] 过），但事件不来。
2. **多进程抢占**：长连接是集群模式，多个 p0 进程在线时事件随机推给其中一个。
   `ps -Ao command | grep p0/run.ts` 查，杀到只剩一个。
3. **权限名不对**：scope 名必须精确（例：表情回复是
   `im:message.reactions:write_only`，写错名字会被 addons 确认页**静默忽略**，
   直到调 API 才 403/99991672）。
4. **事件没订阅**：后台「事件与回调」→ 已订阅事件里要有
   `im.message.receive_v1`（应用身份）。
5. 分不清时：`pnpm run p0:diag` 一键分诊；`pnpm run p0:debug` 看服务端推帧。

**无用的线索**（别被误导）：SDK 打印的英文配置提示是无条件输出；`ws client ready`
只代表 WS 层连上，不代表服务端会推事件；debug 日志里 `data: undefined` 正常
（事件对象本无 `.data` 字段）。

## 断线补推实验（P0-1，剩余最关键）

p0 在线时发 2 条消息（记录在案）→ 断网 5 分钟（期间手机再发 2 条）→ 恢复网络：

- 断网期间发的消息，重连后有没有补推回来？（对照 `p0-log.jsonl`）
- 分别试 5min / 1h / 6h / 24h 四档，结论决定要不要做「历史消息 API 补拉模块」

## ASR 可用性实测（P0-2）

```sh
pnpm run p0:asr
```

合成 1 秒 16kHz PCM 正弦波调用 `speech_to_text/v1/speech/file_recognize`。
✅ 已实测（2026-09-01）：免费租户单次调用即返回 99991400 频控（配额为零，与文档
「免费版不支持调用」吻合）——语音策略按「存原声为默认」落地，ASR 做成开关且默认关。

## P0 实测清单

| #   | 问题                                 | 状态                                                                |
| --- | ------------------------------------ | ------------------------------------------------------------------- |
| 1   | 断线期间事件是否补推（决定补拉模块） | ⏳ 待实验（见上）                                                   |
| 2   | ASR 免费版可用性                     | ✅ 不可用：免费租户单次即 99991400 频控（配额为零），转写开关默认关 |
| 3   | SDK 在 Obsidian Electron 内兼容性    | ✅ 已过：HTTP 层被 CORS 拦，注入 requestUrl 版 httpInstance 解决    |
| 4   | 个人版账号建应用                     | ✅ 已验证：个人免费团队可扫码创建                                   |
| 5   | Obsidian 播放 .opus                  | ⏳ 语音消息入库后点播验证                                           |
| 6   | 3 秒时限                             | ✅ 架构已按「handler 轻活、重活异步」设计                           |
| 7   | 扫码创建的应用默认订阅方式           | ✅ 默认即长连接，事件/权限预填均生效，无需后台操作                  |
| 8   | 全链路（收发/表情/附件/写库/真机）   | ✅ 2026-09-01 真机全通（插件装入 Obsidian，扫码创建+消息管线正常）  |

## 手动创建应用（备选路径）

1. https://open.feishu.cn/app → 创建企业自建应用 → 添加「机器人」能力
2. 权限管理 → 批量导入，粘贴：

   ```json
   {
     "scopes": {
       "tenant": [
         "im:message.p2p_msg:readonly",
         "im:message:send_as_bot",
         "im:message:readonly",
         "im:message.reactions:write_only",
         "speech_to_text:speech",
         "application:application:patch"
       ],
       "user": []
     }
   }
   ```

3. 事件与回调 → 订阅方式「使用长连接接收事件」→ 添加事件 `im.message.receive_v1`
4. 版本管理与发布 → 创建版本 → 发布
5. 凭据写入 `scripts/p0/.env`（App ID / App Secret）
