import assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "node:path";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildInitConfig, writeConfigFile } from "../src/node/init.ts";
import { qrTerminal } from "../src/node/qrcode-terminal.ts";

test("buildInitConfig：凭据 + 目录 + 扫码者 open_id 预填；无 user_info 则无该字段", () => {
  const withOwner = buildInitConfig(
    { client_id: "cli_a", client_secret: "s", user_info: { open_id: "ou_1" } },
    "/tmp/diary",
  );
  assert.deepEqual(withOwner, {
    appId: "cli_a",
    appSecret: "s",
    dir: "/tmp/diary",
    ownerOpenId: "ou_1",
  });

  const noUser = buildInitConfig({ client_id: "cli_a", client_secret: "s" }, "/tmp/diary");
  assert.equal("ownerOpenId" in noUser, false);
});

test("writeConfigFile：合法 JSON 落盘且权限 600（凭据明文）", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "feishu-init-")), "config.json");
  await writeConfigFile(file, { appId: "a", appSecret: "s", dir: "/tmp/d" });
  const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
  assert.equal(parsed.appId, "a");
  assert.equal(parsed.appSecret, "s");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("qrTerminal：输出多行等宽（quiet zone 2 模块，宽度 = 矩阵 + 4）", () => {
  const lines = qrTerminal("https://example.com/init").split("\n");
  assert.ok(lines.length >= 10);
  const width = lines[0]?.length ?? 0;
  assert.ok(width > 0);
  for (const line of lines) assert.equal(line.length, width);
  // quiet zone 应为全空白（首行前 2 列与后 2 列）
  assert.ok(lines.every((l) => l.slice(0, 2).trim() === "" && l.slice(-2).trim() === ""));
});
