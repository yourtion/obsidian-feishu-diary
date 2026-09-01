# P0 通道验证

在写插件代码前，先用这里的脚本验证飞书通道的 6 个关键问题（结论直接决定架构取舍）。

## 1. 创建测试应用

### 方式 A：扫码一键创建（推荐，插件内置同款流程）

写一个 10 行脚本调 SDK 的 `registerApp`（OAuth 设备授权流），手机飞书扫码确认后自动创建应用、预填权限与事件订阅，直接在终端打出 App ID / App Secret：

```ts
import * as Lark from "@larksuiteoapi/node-sdk";
const result = await Lark.registerApp({
  createOnly: true,
  addons: {
    preset: false,
    scopes: {
      tenant: [
        "im:message.p2p_msg:readonly",
        "im:message:send_as_bot",
        "im:resource",
        "im:message.reactions:write_only",
        "speech_to_text:speech",
      ],
      user: [],
    },
    events: { items: { tenant: ["im.message.receive_v1"], user: [] } },
  },
  onQRCodeReady: (info) => console.log(`请在飞书打开: ${info.url}`),
});
console.log(result.client_id, result.client_secret);
```

参考：https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs

⚠️ 待实测（P0-7）：这样创建的应用**事件订阅方式是否默认为长连接**。事件订阅方式属敏感配置不能随 addons 预填；若默认不是长连接，仍需去后台切一次。

### 方式 B：手动创建（一次性，约 5 分钟）

1. 打开 https://open.feishu.cn/app → 「创建企业自建应用」（个人可免费创建飞书团队，自己即管理员）
2. 应用详情 → 「添加应用能力」→ 添加「机器人」
3. 「权限管理」→「批量导入」→ 粘贴以下 JSON → 确认开通（一次粘贴替代逐个搜索）：

   ```json
   {
     "scopes": {
       "tenant": [
         "im:message.p2p_msg:readonly",
         "im:message:send_as_bot",
         "im:resource",
         "im:message.reactions:write_only",
         "speech_to_text:speech"
       ],
       "user": []
     }
   }
   ```

4. 「事件与回调」→ 订阅方式选「使用长连接接收事件」→ 添加事件 `im.message.receive_v1`（接收消息 v2.0）
   - ⚠️ 顺序很重要：必须先把本脚本跑起来（长连接在线），后台才允许保存「长连接」模式
5. 「版本管理与发布」→ 创建版本 → 申请发布（自建应用自己审核即过）
6. 飞书客户端搜索机器人名字，开一个单聊

## 2. 配置凭据

```sh
cp scripts/p0/.env.example scripts/p0/.env
# 编辑 scripts/p0/.env，填入 App ID 和 App Secret
# （凭据目录：应用详情 →「凭证与基础信息」）
```

## 3. 跑主验证脚本

```sh
npm run p0
```

脚本会：

- 建立长连接并打印收到的每条事件（含 event_id / message_id / create_time）
- 对每条 p2p 消息执行完整回执管线：
  1. 加「执行中」表情（裸 REST，验证自实现路线）
  2. 回一条文本消息（官方 SDK，验证 SDK 路线）
  3. 若是图片/文件/语音/视频，下载到 `scripts/p0/downloads/`
  4. 删除执行中表情，加「完成」表情
- 所有事件写入 `scripts/p0/p0-log.jsonl`（断线补推观察用）

### 观察断线补推（P0-1，最重要）

脚本在线时发几条消息（记录在案）→ 断网 5 分钟（期间手机再发 2 条）→ 恢复网络。观察：

- 断网期间发的消息，重连后有没有补推回来？（对照 `p0-log.jsonl`）
- 分别试 5min / 1h / 6h / 24h 四档，结论决定要不要做「历史消息 API 补拉模块」

## 4. ASR 可用性实测（P0-2）

```sh
npm run p0:asr
```

脚本会合成 1 秒 16kHz PCM 正弦波音调并调用 `speech_to_text/v1/speech/file_recognize`。

- 返回 200 + 空文本：接口可用（正弦波无可识别语音，空文本正常）
- 返回 403 / 错误码：免费版（租户）不支持 → 语音转写策略按「存原声为默认」落地

## 验证清单对照

| #   | 问题                                 | 验证方式                                                   |
| --- | ------------------------------------ | ---------------------------------------------------------- |
| 1   | 断线期间事件是否补推                 | `npm run p0` + 断网/恢复实验                               |
| 2   | ASR 免费版可用性                     | `npm run p0:asr`                                           |
| 3   | SDK 在 Obsidian 内兼容性             | 插件骨架好后把 SDK 打包进 main.js 实测（Phase 1 验证）     |
| 4   | 个人版账号建应用                     | 方式 A / B 亲自走一遍即知                                  |
| 5   | Obsidian 播放 .opus                  | Phase 2 存一条语音到 vault 手点验证                        |
| 6   | 3 秒时限                             | 本脚本 handler 只打印+入队即返回；插件里同样异步化         |
| 7   | 扫码创建的应用默认订阅方式是否长连接 | ✅ 已实测：默认即长连接，事件/权限预填均生效，无需后台操作 |
