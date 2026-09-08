# CLI 配置与 URL hooks

CLI（`feishu-diary`）的全部用户配置：一份 `~/.feishu-diary.json` 管到底——凭据、
目录、提醒，以及 URL hooks。命令行参数与环境变量随时可覆盖文件里的任何字段。
快速开始见 `npx feishu-diary --help`；本文是完整展开。

## 配置文件 `~/.feishu-diary.json`

### 三种给法与优先级

```
命令行参数 > 环境变量 > 配置文件 > 默认值
```

- 最省事：`feishu-diary init` 扫码生成配置文件，之后 `feishu-diary` 零参数启动。
- 文件路径可改：`--config <path>` 或环境变量 `FEISHU_DIARY_CONFIG`。
- 同名参数/环境变量总能覆盖文件——临时换个目录跑一次，不必改文件：
  `feishu-diary --dir /tmp/once`。
- 文件不存在？视为未配置（正常路径，靠参数/环境变量）。文件损坏或字段类型
  错误？**启动即退出（退出码 2，报错含文件路径）**——凭据在里面，静默降级到
  默认值会把日记写错目录。

### 字段一览

| 字段              | 类型     | 默认                          | 说明                                   |
| ----------------- | -------- | ----------------------------- | -------------------------------------- |
| `appId`           | string   | —（必填三选一）               | 飞书自建应用 App ID（env: FEISHU_APP_ID） |
| `appSecret`       | string   | —（必填三选一）               | App Secret（env: FEISHU_APP_SECRET）   |
| `dir`             | string   | `./FeishuDiary`（相对启动处） | 日记根目录，写绝对路径最稳             |
| `ownerOpenId`     | string   | —                             | 主人 open_id；缺省时第一条消息的发送者自动认主（init 扫码自动预填） |
| `nickname`        | string   | `""`                          | 机器人称呼（也可聊天里发「叫我XX」）   |
| `reminderTime`    | string   | `21:30`                       | 提醒时间 HH:mm（东八区）               |
| `reminderEnabled` | boolean  | `true`                        | 每日提醒开关                           |
| `hooks`           | object   | —                             | 内联 URL hooks（见下文）               |

`stateFile`（状态文件路径）与 `hooksFile`（hooks 文件路径）不进配置文件：前者是
运行时习得状态不属于用户配置（`--state-file` / `FEISHU_STATE_FILE` 可改），后者被
内联 `hooks` 字段取代（想用独立文件就 `--hooks-file` 显式指定）。

### 完整示例

```json
{
  "appId": "cli_xxx",
  "appSecret": "your-secret",
  "dir": "/Users/you/FeishuDiary",
  "ownerOpenId": "ou_xxx",
  "nickname": "",
  "reminderTime": "21:30",
  "reminderEnabled": true,
  "hooks": {
    "timeoutSec": 600,
    "hooks": [
      { "match": "https://[a-z]+\\.feishu\\.cn/(docx|wiki|docs|doc)/", "cmd": "node /abs/path/scripts/hooks/feishu-doc.ts" },
      { "match": "https://([^/]*\\.)?example\\.com/podcast/", "cmd": "yt-dlp -x --audio-format opus -o /abs/podcasts/%(title)s.%(ext)s" }
    ]
  }
}
```

init 生成的文件只含 `appId`/`appSecret`/`dir`/`ownerOpenId` 四个字段，其余按需
自己加。改完重启进程生效（自启动用户：`launchctl kickstart -k`）。

### 权限与备份

- init 写文件后自动 `chmod 600`（凭据明文，仅本人可读写）；手动编辑一般不会
  改掉权限，介意可随时再 `chmod 600 ~/.feishu-diary.json`。
- 已有配置时重跑 init 会先问确认，旧文件改名保留为 `.bak`。

### 状态文件不是配置

`<dir>/.feishu-diary-state.json` 存的是**运行时习得**的状态（认主结果、称呼、
提醒进度），由进程自动读写：备份日记目录时带上它即可，不要手动编辑。

## URL hooks（仅 CLI）

### 是什么

文本消息里的 URL 命中规则（正则）时，**原文照常记日记**，随后把每个命中的 URL
交给你的命令处理，命令的 stdout（非空）追加进当天日记。适合：飞书文档存档、
播客下载、任意「链接 → 命令」的自动化。

触发面刻意收窄：只有文本类消息（text / post / rich_text）里、会被记为笔记的
正文才参与匹配——「记：」逃生口、命令词（撤回/晚安等）、媒体消息一律不触发，
hook 无法误吞消息。

### 配置位置（二选一，文件优先级低）

1. **内联**：配置文件的 `hooks` 字段（上例）——推荐，一个文件管全部。
2. **独立文件** `hooks.json`：默认 `<dir>/hooks.json`，`--hooks-file` /
   `FEISHU_HOOKS_FILE` 显式指定。

规则：显式指定了 `--hooks-file` / `FEISHU_HOOKS_FILE` 就读那个文件（内联失效）；
否则内联优先于默认路径的 hooks.json。两处结构完全一致，校验同源，坏规则
（缺 match/cmd、非法正则、timeoutSec 非正数）都是启动即退出并指出第几条。

### 规则字段

| 字段        | 说明                                                                 |
| ----------- | -------------------------------------------------------------------- |
| `match`     | JS 正则（字符串），对消息里提取出的**每个 URL** 测试，命中即执行      |
| `cmd`       | 命令行；URL 追加为**最后一个参数**                                    |
| `timeoutSec`| 超时（秒），默认 600；超时 SIGTERM，以文字消息回执失败               |

### 执行语义（重要）

- **不经 shell**：命令按空白切分（支持成对引号）后直接 `spawn`，URL 作为单个
  参数追加——无注入风险，但也意味着 `~`、通配符、`$VAR`、管道重定向都不展开，
  **路径一律写绝对路径**。
- stdout 截断 256KB 后进日记；stderr 只用于错误回执（截断 16KB）。
- 非零退出码 / 无法启动 / 超时 = 失败：摘掉处理中表情，回执文字（含 stderr
  摘要），并注明「原文已记入日记」。
- hook 跑在**并发通道**：下载几分钟也不堵后续「记一条」；只有两段日记落盘
  （原文、stdout）串行排队保原子。
- 一条消息命中多个 URL 会逐个执行。

### hook 里要用飞书凭据？（环境变量的坑）

hook 子进程继承的是**进程环境变量**（`process.env`）。注意：

- CLI 自己的 `--env-file` 只用于 CLI 配置解析，**不会**注入 `process.env`，
  hook 拿不到；
- 想让 hook 拿到凭据，用 Node 原生注入或 shell 导出：

```sh
# Node ≥ 20.6：原生 --env-file 写进 process.env，hook 子进程天然继承
node --env-file=/abs/.env /abs/path/dist/cli.cjs

# 或 shell 导出（launchd 用户：写在 plist 的 EnvironmentVariables 字典里）
export FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy
feishu-diary
```

仓库自带的示例 `scripts/hooks/feishu-doc.ts`（飞书文档 → 正文落日记）就是这么
工作的：凭据从环境变量读，hooks 配置里无需重复。它的权限前提见文件头注释
（应用要开 doc 读取 scope，且文档要把机器人加为协作者）。

## 相关文档

- macOS 开机自启（launchd）：[autostart-macos.md](autostart-macos.md)
- 设计决策（hooks 为何仅 CLI、并发模型等）：[DECISIONS.md](DECISIONS.md) D11 / D12
- ⚠️ 同一应用勿与本机 Obsidian 插件同时在线（飞书把事件随机推给其中一个客户端）
