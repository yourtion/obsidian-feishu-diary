import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendBlockToContent,
  DiaryWriter,
  recallLastFromContent,
  sealContent,
} from "../src/core/writer.ts";
import type { VaultLike } from "../src/core/writer.ts";

const at = (s: string) => Date.parse(s);

class MemoryVault implements VaultLike {
  files = new Map<string, string>();
  trashed: string[] = [];

  async process(path: string, fn: (content: string) => string): Promise<string> {
    const next = fn(this.files.get(path) ?? "");
    this.files.set(path, next);
    return next;
  }

  async trash(path: string): Promise<void> {
    this.trashed.push(path);
    this.files.delete(path);
  }
}

test("追加到空文件：frontmatter + 标题 + 段头 + 内容", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T23:05:00+08:00"), "第一条");
  const path = "FeishuDiary/2026/2026-08-31.md";
  assert.deepEqual(vault.files.get(path)?.split("\n\n"), [
    "---\ndate: 2026-08-31\nweekday: 周一\nsource: feishu-diary\n---",
    "# 2026-08-31",
    "**23:05**",
    "第一条",
  ]);
});

test("同分钟追加共享段头，跨分钟新起段头", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T23:05:10+08:00"), "第一条");
  await writer.append(at("2026-08-31T23:05:50+08:00"), "同分钟第二条");
  await writer.append(at("2026-08-31T23:07:00+08:00"), "新分钟");
  const content = vault.files.get("FeishuDiary/2026/2026-08-31.md") ?? "";
  assert.deepEqual(content.split("\n\n").slice(2), [
    "**23:05**",
    "第一条",
    "同分钟第二条",
    "**23:07**",
    "新分钟",
  ]);
});

test("凌晨消息落前一天逻辑日文件，段头写真实时间", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-09-01T03:30:00+08:00"), "凌晨碎碎念");
  const content = vault.files.get("FeishuDiary/2026/2026-08-31.md") ?? "";
  assert.ok(content.includes("date: 2026-08-31"));
  assert.ok(content.includes("**03:30**"));
  assert.ok(content.includes("凌晨碎碎念"));
});

test("appendBlockToContent 纯函数：已有内容直接拼接", () => {
  const base =
    "---\ndate: 2026-08-31\nweekday: 周一\nsource: feishu-diary\n---\n\n# 2026-08-31\n\n**08:00**\n\n早";
  assert.equal(appendBlockToContent(base, "同分钟", "08:00", "2026-08-31"), `${base}\n\n同分钟`);
  assert.equal(
    appendBlockToContent(base, "下一分钟", "08:01", "2026-08-31"),
    `${base}\n\n**08:01**\n\n下一分钟`,
  );
});

test("封存追加注脚，重复封存幂等返回 null", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T22:00:00+08:00"), "今天写完了");
  const footnote = await writer.seal(at("2026-08-31T23:02:00+08:00"));
  assert.equal(footnote, "23:02");
  const content = vault.files.get("FeishuDiary/2026/2026-08-31.md") ?? "";
  assert.ok(content.endsWith("---\n_(今日封存于 23:02)_"));
  assert.equal(await writer.seal(at("2026-08-31T23:59:00+08:00")), null);
});

test("sealContent 纯函数", () => {
  assert.equal(
    sealContent("# t\n\n**08:00**\n\nhi", "21:30"),
    "# t\n\n**08:00**\n\nhi\n\n---\n_(今日封存于 21:30)_",
  );
  assert.equal(sealContent("# t\n\n---\n_(今日封存于 21:30)_", "22:00"), null);
});

test("撤回删除最后内容块，保留注脚与段头结构", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T22:00:00+08:00"), "要删的");
  await writer.append(at("2026-08-31T22:00:30+08:00"), "保留的");
  await writer.seal(at("2026-08-31T23:02:00+08:00"));

  const removed = await writer.recall(at("2026-08-31T23:05:00+08:00"));
  assert.equal(removed, "保留的");
  const content = vault.files.get("FeishuDiary/2026/2026-08-31.md") ?? "";
  assert.deepEqual(content.split("\n\n").slice(2), [
    "**22:00**",
    "要删的",
    "---\n_(今日封存于 23:02)_",
  ]);
  assert.deepEqual(vault.trashed, []);
});

test("撤回唯一一条后回收孤立段头并 trash 文件", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T22:00:00+08:00"), "唯一一条");

  const removed = await writer.recall(at("2026-08-31T22:01:00+08:00"));
  assert.equal(removed, "唯一一条");
  assert.deepEqual(vault.trashed, ["FeishuDiary/2026/2026-08-31.md"]);
});

test("撤回跨分钟多条后只删最后块，不回收仍有效的段头", () => {
  const content =
    "---\ndate: 2026-08-31\nweekday: 周一\nsource: feishu-diary\n---\n\n# 2026-08-31\n\n**22:00**\n\n早\n\n**22:05**\n\n晚";
  const result = recallLastFromContent(content);
  assert.equal(result.removed, "晚");
  assert.deepEqual(result.content.split("\n\n").slice(2), ["**22:00**", "早", "**22:05**"]);
  assert.equal(result.empty, false);
});

test("空文件撤回返回 null 不动文件", () => {
  const result = recallLastFromContent("---\ndate: d\n---\n\n# t");
  assert.equal(result.removed, null);
  assert.equal(result.empty, false);
});

test("撤回作用于当前逻辑日文件（凌晨撤回昨晚内容）", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T23:00:00+08:00"), "昨晚最后一条");
  // 09-01 03:00 仍属 08-31 逻辑日
  const removed = await writer.recall(at("2026-09-01T03:00:00+08:00"));
  assert.equal(removed, "昨晚最后一条");
});
