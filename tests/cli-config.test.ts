import assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  parseEnvFile,
  resolveConfig,
  saveState,
  loadState,
  buildSettings,
  readConfigFile,
  type FileConfig,
} from "../src/node/config.ts";

test("args 优先于 env，env 优先于默认", () => {
  const { config } = resolveConfig(["--app-id", "cli_args"], {
    FEISHU_APP_ID: "cli_env",
    FEISHU_APP_SECRET: "s_env",
    FEISHU_DIARY_DIR: "/tmp/env-dir",
  });
  assert.ok(config);
  assert.equal(config.appId, "cli_args");
  assert.equal(config.appSecret, "s_env");
  assert.equal(config.dir, path.resolve("/tmp/env-dir"));
});

test("缺凭据抛错并指出修复途径", () => {
  assert.throws(
    () => resolveConfig([], {}),
    /--app-id \/ FEISHU_APP_ID.*--app-secret \/ FEISHU_APP_SECRET/s,
  );
  assert.throws(() => resolveConfig(["--app-id", "a"], {}), /--app-secret \/ FEISHU_APP_SECRET/);
});

test("dir 相对路径按 cwd 解析为绝对路径；state-file 默认落在 dir 下", () => {
  const { config } = resolveConfig(
    ["--app-id", "a", "--app-secret", "s", "--dir", "Notes/Diary"],
    {},
  );
  assert.ok(config);
  assert.equal(config.dir, path.resolve("Notes/Diary"));
  assert.equal(
    config.stateFile,
    path.join(path.resolve("Notes/Diary"), ".feishu-diary-state.json"),
  );
});

test("hooks-file：默认 <dir>/hooks.json，args > env 覆盖", () => {
  const def = resolveConfig(["--app-id", "a", "--app-secret", "s", "--dir", "/tmp/d"], {});
  assert.ok(def.config);
  assert.equal(def.config.hooksFile, path.join("/tmp/d", "hooks.json"));

  const fromEnv = resolveConfig(["--app-id", "a", "--app-secret", "s"], {
    FEISHU_HOOKS_FILE: "/tmp/env-hooks.json",
  });
  assert.ok(fromEnv.config);
  assert.equal(fromEnv.config.hooksFile, "/tmp/env-hooks.json");

  const fromArg = resolveConfig(
    ["--app-id", "a", "--app-secret", "s", "--hooks-file", "/tmp/arg-hooks.json"],
    { FEISHU_HOOKS_FILE: "/tmp/env-hooks.json" },
  );
  assert.ok(fromArg.config);
  assert.equal(fromArg.config.hooksFile, "/tmp/arg-hooks.json");
});

test("提醒时间格式校验与开关", () => {
  assert.throws(
    () => resolveConfig(["--app-id", "a", "--app-secret", "s", "--reminder", "25:00"], {}),
    /HH:mm/,
  );
  assert.throws(
    () => resolveConfig(["--app-id", "a", "--app-secret", "s", "--reminder", "9:30"], {}),
    /HH:mm/,
  );
  const ok = resolveConfig(["--app-id", "a", "--app-secret", "s"], {
    FEISHU_REMINDER_TIME: "22:00",
  });
  assert.ok(ok.config);
  assert.equal(ok.config.reminderTime, "22:00");
  assert.equal(ok.config.reminderEnabled, true);
  const off = resolveConfig(["--app-id", "a", "--app-secret", "s", "--no-reminder"], {});
  assert.ok(off.config);
  assert.equal(off.config.reminderEnabled, false);
});

test("--help 优先于必填校验", () => {
  const { help, config } = resolveConfig(["--help"], {});
  assert.equal(help, true);
  assert.equal(config, null);
});

test("未知参数在 strict 模式下报错", () => {
  assert.throws(() => resolveConfig(["--what"], {}));
});

test("parseEnvFile：注释/空行忽略，成对引号剥壳，值可含 =", () => {
  const env = parseEnvFile(
    [
      "# 注释\n",
      'FEISHU_APP_ID="cli_x"',
      "",
      "FEISHU_APP_SECRET='s'",
      "BAD_LINE",
      "FEISHU_X=k=v",
    ].join("\n"),
  );
  assert.deepEqual(env, { FEISHU_APP_ID: "cli_x", FEISHU_APP_SECRET: "s", FEISHU_X: "k=v" });
});

test("状态文件：saveState 原子写、loadState 读回、损坏返回 null", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "feishu-state-")), "state.json");
  await saveState(file, {
    ownerOpenId: "ou_1",
    nickname: "老板",
    reminderState: { lastRemindDate: "2026-09-01", missStreak: 2 },
  });
  const loaded = await loadState(file);
  assert.deepEqual(loaded, {
    ownerOpenId: "ou_1",
    nickname: "老板",
    reminderState: { lastRemindDate: "2026-09-01", missStreak: 2 },
  });

  await writeFile(file, "{broken", "utf8");
  assert.equal(await loadState(file), null);
  assert.equal(await loadState(path.join(path.dirname(file), "nope.json")), null);
});

test("buildSettings：显式配置 > 状态文件 > 默认", () => {
  const { config } = resolveConfig(
    ["--app-id", "a", "--app-secret", "s", "--dir", "/tmp/d", "--nickname", "显式"],
    {},
  );
  assert.ok(config);
  const fromState = buildSettings(config, {
    ownerOpenId: "ou_state",
    nickname: "状态里的",
    reminderState: { lastRemindDate: null, missStreak: 0 },
  });
  assert.equal(fromState.ownerOpenId, "ou_state");
  assert.equal(fromState.nickname, "显式"); // args 显式给值优先

  const fresh = buildSettings(config, null);
  assert.equal(fresh.ownerOpenId, null);
  assert.equal(fresh.nickname, "显式");
  assert.deepEqual(fresh.reminderState, { lastRemindDate: null, missStreak: 0 });

  // 未显式给 nickname 时回退状态文件
  const noArg = resolveConfig(["--app-id", "a", "--app-secret", "s"], {});
  assert.ok(noArg.config);
  assert.equal(buildSettings(noArg.config, { nickname: "状态里的" }).nickname, "状态里的");
});

// ---------- 配置文件层（~/.feishu-diary.json，init 的产物） ----------

const FILE: FileConfig = {
  appId: "cli_file",
  appSecret: "s_file",
  dir: "/tmp/file-dir",
  ownerOpenId: "ou_file",
  nickname: "文件称呼",
};

test("配置文件层：args > env > 文件 > 默认", () => {
  const onlyFile = resolveConfig([], {}, FILE);
  assert.ok(onlyFile.config);
  assert.equal(onlyFile.config.appId, "cli_file");
  assert.equal(onlyFile.config.appSecret, "s_file");
  assert.equal(onlyFile.config.dir, path.resolve("/tmp/file-dir"));
  assert.equal(onlyFile.config.ownerOpenId, "ou_file");
  assert.equal(onlyFile.config.nickname, "文件称呼");
  assert.equal(onlyFile.config.hooksInline, null);

  const fromEnv = resolveConfig([], { FEISHU_APP_ID: "cli_env", FEISHU_APP_SECRET: "s_env" }, FILE);
  assert.ok(fromEnv.config);
  assert.equal(fromEnv.config.appId, "cli_env"); // env 覆盖文件
  assert.equal(fromEnv.config.appSecret, "s_env");

  const fromEnvPartial = resolveConfig([], { FEISHU_APP_ID: "cli_env" }, FILE);
  assert.ok(fromEnvPartial.config);
  assert.equal(fromEnvPartial.config.appSecret, "s_file"); // env 未给的仍取文件

  const fromArg = resolveConfig(["--app-id", "cli_args"], {}, FILE);
  assert.ok(fromArg.config);
  assert.equal(fromArg.config.appId, "cli_args");
});

test("配置文件 hooks 内联：生效；显式 hooks-file（args/env）时失效；坏结构报错", () => {
  const hooks = {
    timeoutSec: 120,
    hooks: [{ match: "https://x\\.cn/", cmd: "echo hi" }],
  };
  const base = ["--app-id", "a", "--app-secret", "s", "--dir", "/tmp/d"];

  const inline = resolveConfig(base, {}, { hooks });
  assert.ok(inline.config);
  assert.ok(inline.config.hooksInline);
  assert.equal(inline.config.hooksInline.rules.length, 1);
  assert.equal(inline.config.hooksInline.timeoutMs, 120_000);
  assert.equal(inline.config.hooksInline.rules[0]?.cmd, "echo hi");

  const explicitArg = resolveConfig([...base, "--hooks-file", "/tmp/h.json"], {}, { hooks });
  assert.ok(explicitArg.config);
  assert.equal(explicitArg.config.hooksInline, null);
  assert.equal(explicitArg.config.hooksFile, "/tmp/h.json");

  const explicitEnv = resolveConfig(base, { FEISHU_HOOKS_FILE: "/tmp/h.json" }, { hooks });
  assert.ok(explicitEnv.config);
  assert.equal(explicitEnv.config.hooksInline, null);

  assert.throws(
    () => resolveConfig(base, {}, { hooks: { hooks: [{ match: "", cmd: "x" }] } }),
    /配置文件 hooks 字段/,
  );
});

test("配置文件 reminder 字段：file 可关提醒/改时间，flag 与 env 仍最高", () => {
  const base = ["--app-id", "a", "--app-secret", "s"];
  const off = resolveConfig(base, {}, { reminderEnabled: false });
  assert.ok(off.config);
  assert.equal(off.config.reminderEnabled, false);

  const time = resolveConfig(base, {}, { reminderTime: "20:00" });
  assert.ok(time.config);
  assert.equal(time.config.reminderTime, "20:00");

  const envWins = resolveConfig(base, { FEISHU_NO_REMINDER: "1" }, { reminderEnabled: true });
  assert.ok(envWins.config);
  assert.equal(envWins.config.reminderEnabled, false);

  assert.throws(() => resolveConfig(base, {}, { reminderTime: "9:30" }), /HH:mm/);
});

test("readConfigFile：不存在返回 null；正常读回；非法 JSON/字段类型错抛", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "feishu-config-"));
  const file = path.join(dir, "config.json");
  assert.equal(await readConfigFile(file), null);

  await writeFile(file, `${JSON.stringify({ appId: "cli_x", reminderEnabled: false })}\n`, "utf8");
  const cfg = await readConfigFile(file);
  assert.equal(cfg?.appId, "cli_x");
  assert.equal(cfg?.reminderEnabled, false);

  await writeFile(file, "{broken", "utf8");
  await assert.rejects(readConfigFile(file), /合法 JSON/);

  await writeFile(file, JSON.stringify({ appId: 123 }), "utf8");
  await assert.rejects(readConfigFile(file), /appId 应为字符串/);

  await writeFile(file, JSON.stringify({ reminderEnabled: "yes" }), "utf8");
  await assert.rejects(readConfigFile(file), /reminderEnabled 应为布尔值/);
});
