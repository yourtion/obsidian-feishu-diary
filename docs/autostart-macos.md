# macOS 开机自启（launchd）

CLI 不内置自启动命令：launchd 对路径的要求（不继承 shell PATH、`~` 不展开）
与每台机器的 node 安装方式强相关（Homebrew / nvm / fnm 各不相同），写成命令
反而不如一份可按机器微调的 plist 直接。前置：先跑 `feishu-diary init` 生成
`~/.feishu-diary.json`。

## 第一步：定位可执行文件（绝对路径）

launchd 不继承 shell 的 `PATH`，node 与 CLI 都要写**绝对路径**：

```sh
which node          # node 绝对路径，如 ~/.nvm/versions/node/v22.14.0/bin/node
                    # （nvm/fnm 用户注意：每升一个 node 大版本路径会变，plist 要跟着改）
npm i -g feishu-diary   # 全局安装 CLI
npm root -g         # 全局 node_modules 根，如 ~/.nvm/versions/node/v22.14.0/lib/node_modules
                    # CLI 产物 = <该路径>/feishu-diary/dist/cli.cjs
```

不建议用 npx 缓存路径（会随版本清理失效），也不建议直接指向 bin 符号链接
（shebang 里 `env node` 依赖 PATH，launchd 下解析不到）。

## 第二步：写 plist

存为 `~/Library/LaunchAgents/com.feishu-diary.plist`（把三处 `YOUR_NAME`
与 node 版本换成你的实际路径）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.feishu-diary</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOUR_NAME/.nvm/versions/node/v22.14.0/bin/node</string>
    <string>/Users/YOUR_NAME/.nvm/versions/node/v22.14.0/lib/node_modules/feishu-diary/dist/cli.cjs</string>
    <string>--config</string>
    <string>/Users/YOUR_NAME/.feishu-diary.json</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/Users/YOUR_NAME/.feishu-diary.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR_NAME/.feishu-diary.log</string>
</dict>
</plist>
```

要点：

- **所有路径写绝对路径**——plist 里 `~` 与 `$HOME` 都不展开。
- `KeepAlive: true`：进程崩溃自动重启；也意味着手动 kill 会被立即拉起，
  停服务见下方 `bootout`。
- stdout/stderr 合并到一个日志文件，`tail -f` 一处看全。

## 第三步：启停命令

```sh
# 加载并启动（登录后生效；plist 已在 LaunchAgents 目录里，开机自动加载）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.feishu-diary.plist

# 看运行状态（pid、上次退出码等）
launchctl print gui/$(id -u)/com.feishu-diary | head -20

# 看日志
tail -f ~/.feishu-diary.log

# 重启进程（改了 ~/.feishu-diary.json 后用这个）
launchctl kickstart -k gui/$(id -u)/com.feishu-diary

# 停止并卸载（KeepAlive 下唯一正确的停法；改了 plist 也必须先 bootout 再 bootstrap）
launchctl bootout gui/$(id -u)/com.feishu-diary
```

旧式 `launchctl load/unload` 仍可用但已废弃，推荐上面这套。

## 常见坑

1. **kickstart 不重读 plist**：改了 plist 内容必须 `bootout` 再 `bootstrap`，
   只 `kickstart -k` 重启的还是旧配置。
2. **nvm/fnm 升级 node 后服务起不来**：node 绝对路径变了，plist 要跟着改。
   症状是日志里出现 `No such file or directory`。
3. **别与本机 Obsidian 插件同时在线**：同一应用多个长连接客户端在线时，
   飞书会把事件随机推给其中一个（调试「消息丢了」的头号原因）。跑 CLI
   自启动就关掉插件的本机总闸。
4. **日志不轮转**：长期运行 `~/.feishu-diary.log` 会慢慢变大，定期清空
   （`> ~/.feishu-diary.log`）即可，无需重启服务。
