import assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  tokenize,
  runShellHook,
  parseHooksFile,
  loadHooks,
  DEFAULT_HOOK_TIMEOUT_MS,
} from "../src/node/hooks.ts";

test("tokenize：空白切分，引号内空格保留", () => {
  assert.deepEqual(tokenize("yt-dlp -x --audio-format mp3"), [
    "yt-dlp",
    "-x",
    "--audio-format",
    "mp3",
  ]);
  assert.deepEqual(tokenize('feishu-dl --out "/abs/my notes"'), [
    "feishu-dl",
    "--out",
    "/abs/my notes",
  ]);
  assert.deepEqual(tokenize("dl '~/My Vault/notes'"), ["dl", "~/My Vault/notes"]);
  assert.deepEqual(tokenize(""), []);
});

test("parseHooksFile：合法配置编译正则，timeoutSec 可选", () => {
  const loaded = parseHooksFile(
    JSON.stringify({
      hooks: [
        { match: "https?://[^/]*\\.feishu\\.cn/", cmd: "feishu-dl" },
        { match: "example\\.com", cmd: "yt-dlp -x" },
      ],
    }),
  );
  assert.equal(loaded.rules.length, 2);
  assert.ok(loaded.rules[0]?.match.test("https://x.feishu.cn/docx/a"));
  assert.equal(loaded.rules[1]?.cmd, "yt-dlp -x");
  assert.equal(loaded.timeoutMs, DEFAULT_HOOK_TIMEOUT_MS);

  const withTimeout = parseHooksFile(JSON.stringify({ timeoutSec: 30, hooks: [] }));
  assert.equal(withTimeout.timeoutMs, 30_000);
});

test("parseHooksFile：各类坏配置报错并指出位置", () => {
  assert.throws(() => parseHooksFile("{broken"), /合法 JSON/);
  assert.throws(() => parseHooksFile("{}"), /hooks.*数组/);
  assert.throws(() => parseHooksFile('{"hooks":[{"match":"a"}]}'), /第 1 条缺少非空 cmd/);
  assert.throws(() => parseHooksFile('{"hooks":[{"cmd":"a"}]}'), /第 1 条缺少非空 match/);
  assert.throws(() => parseHooksFile('{"hooks":[{"match":"a(","cmd":"a"}]}'), /合法正则/);
  assert.throws(() => parseHooksFile('{"timeoutSec":-1,"hooks":[]}'), /timeoutSec/);
});

test("loadHooks：文件不存在视为未启用；存在则解析", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "feishu-hooks-"));
  const missing = await loadHooks(path.join(dir, "nope.json"));
  assert.deepEqual(missing, { rules: [], timeoutMs: DEFAULT_HOOK_TIMEOUT_MS });

  const file = path.join(dir, "hooks.json");
  await writeFile(file, JSON.stringify({ hooks: [{ match: "a\\.com", cmd: "dl" }] }), "utf8");
  const loaded = await loadHooks(file);
  assert.equal(loaded.rules.length, 1);
});

test("runShellHook：URL 追加为最后一个参数，stdout 返回", async () => {
  // 用 node 自身当被测命令，跨平台不依赖 sh
  const cmd = `"${process.execPath}" -e "console.log(process.argv[1])"`;
  const out = await runShellHook(cmd, "https://example.com/ep/42", 10_000);
  assert.equal(out.trim(), "https://example.com/ep/42");
});

test("runShellHook：非零退出码报错并带 stderr 摘要", async () => {
  const cmd = `"${process.execPath}" -e "console.error('boom');process.exit(3)"`;
  await assert.rejects(runShellHook(cmd, "https://a.com/", 10_000), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /退出码 3/);
    assert.match(err.message, /boom/);
    return true;
  });
});

test("runShellHook：超时终止并报错", async () => {
  const cmd = `"${process.execPath}" -e "setTimeout(()=>{},5000)"`;
  await assert.rejects(runShellHook(cmd, "https://a.com/", 100), /超时/);
});

test("runShellHook：命令为空报错", async () => {
  await assert.rejects(runShellHook("", "https://a.com/", 1000), /命令为空/);
});
