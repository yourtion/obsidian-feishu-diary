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
