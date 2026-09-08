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

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
}

const AUG = "FeishuDiary/2026/2026-08.md";
const SEP = "FeishuDiary/2026/2026-09.md";

test("追加到空文件：月骨架 + 日段标题 + 段头 + 内容", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T23:05:00+08:00"), "第一条");
  assert.deepEqual(vault.files.get(AUG)?.split("\n\n"), [
    "---\nmonth: 2026-08\nsource: feishu-diary\n---",
    "# 2026-08",
    "## 08-31 周一",
    "**23:05**",
    "第一条",
  ]);
});

test("同分钟追加共享段头，跨分钟新起段头（段内）", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T23:05:10+08:00"), "第一条");
  await writer.append(at("2026-08-31T23:05:50+08:00"), "同分钟第二条");
  await writer.append(at("2026-08-31T23:07:00+08:00"), "新分钟");
  const content = vault.files.get(AUG) ?? "";
  assert.deepEqual(content.split("\n\n").slice(3), [
    "**23:05**",
    "第一条",
    "同分钟第二条",
    "**23:07**",
    "新分钟",
  ]);
});

test("同月跨日追加各自建段", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-09-01T10:00:00+08:00"), "一号");
  await writer.append(at("2026-09-02T10:00:00+08:00"), "二号");
  await writer.append(at("2026-09-02T10:01:00+08:00"), "二号又一条");
  const content = vault.files.get(SEP) ?? "";
  assert.deepEqual(content.split("\n\n").slice(2), [
    "## 09-01 周二",
    "**10:00**",
    "一号",
    "## 09-02 周三",
    "**10:00**",
    "二号",
    "**10:01**",
    "二号又一条",
  ]);
});

test("凌晨消息归前一逻辑日段，段头写真实时间", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-09-01T03:30:00+08:00"), "凌晨碎碎念");
  // 落上月月文件 2026-08.md 的 08-31 日段
  const content = vault.files.get(AUG) ?? "";
  assert.ok(content.includes("month: 2026-08"));
  assert.ok(content.includes("## 08-31 周一"));
  assert.ok(content.includes("**03:30**"));
  assert.ok(content.includes("凌晨碎碎念"));
});

test("乱序（补推）消息插入日期正确的日段，不拆段不乱序", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-09-05T10:00:00+08:00"), "五号");
  await writer.append(at("2026-09-08T10:00:00+08:00"), "八号");
  // 补推的六号消息晚到，须插在五号与八号之间
  await writer.append(at("2026-09-06T10:00:00+08:00"), "六号补推");
  const content = vault.files.get(SEP) ?? "";
  assert.deepEqual(content.split("\n\n").slice(2), [
    "## 09-05 周六",
    "**10:00**",
    "五号",
    "## 09-06 周日",
    "**10:00**",
    "六号补推",
    "## 09-08 周二",
    "**10:00**",
    "八号",
  ]);
});

test("跨年凌晨消息落上一年 12 月月文件", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2027-01-01T03:00:00+08:00"), "跨年一条");
  const content = vault.files.get("FeishuDiary/2026/2026-12.md") ?? "";
  assert.ok(content.includes("month: 2026-12"));
  assert.ok(content.includes("## 12-31 周四"));
  assert.ok(content.includes("跨年一条"));
});

test("appendBlockToContent 纯函数：已有段直接拼接", () => {
  const base =
    "---\nmonth: 2026-08\nsource: feishu-diary\n---\n\n# 2026-08\n\n## 08-31 周一\n\n**08:00**\n\n早";
  assert.equal(appendBlockToContent(base, "同分钟", "08:00", "2026-08-31"), `${base}\n\n同分钟`);
  assert.equal(
    appendBlockToContent(base, "下一分钟", "08:01", "2026-08-31"),
    `${base}\n\n**08:01**\n\n下一分钟`,
  );
});

test("封存追加注脚到当天日段尾，重复封存幂等返回 null", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T22:00:00+08:00"), "今天写完了");
  const footnote = await writer.seal(at("2026-08-31T23:02:00+08:00"));
  assert.equal(footnote, "23:02");
  const content = vault.files.get(AUG) ?? "";
  assert.ok(content.endsWith("---\n_(今日封存于 23:02)_"));
  assert.equal(await writer.seal(at("2026-08-31T23:59:00+08:00")), null);
});

test("封存按日段幂等：A 天已封存不影响 B 天封存", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-09-01T22:00:00+08:00"), "一号写完");
  await writer.append(at("2026-09-02T22:00:00+08:00"), "二号写完");
  await writer.seal(at("2026-09-01T23:00:00+08:00"));
  // 二号仍可封存（v1 全文 contains 会把任一天封存误判为已封存）
  assert.equal(await writer.seal(at("2026-09-02T23:00:00+08:00")), "23:00");
  const content = vault.files.get(SEP) ?? "";
  assert.ok(content.includes("_(今日封存于 23:00)_"));
});

test("当天无内容时封存：建日段留痕（晚安也生效）", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-09-01T10:00:00+08:00"), "一号有内容");
  assert.equal(await writer.seal(at("2026-09-02T23:00:00+08:00")), "23:00");
  const content = vault.files.get(SEP) ?? "";
  assert.deepEqual(content.split("\n\n").slice(-2), ["## 09-02 周三", "---\n_(今日封存于 23:00)_"]);
});

test("sealContent 纯函数", () => {
  const base = "# 2026-08\n\n## 08-31 周一\n\n**08:00**\n\nhi";
  assert.equal(sealContent(base, "21:30", "2026-08-31"), `${base}\n\n---\n_(今日封存于 21:30)_`);
  assert.equal(sealContent(`${base}\n\n---\n_(今日封存于 21:30)_`, "22:00", "2026-08-31"), null);
});

test("撤回删除段内最后内容块，保留注脚与段头结构", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T22:00:00+08:00"), "要删的");
  await writer.append(at("2026-08-31T22:00:30+08:00"), "保留的");
  await writer.seal(at("2026-08-31T23:02:00+08:00"));

  const removed = await writer.recall(at("2026-08-31T23:05:00+08:00"));
  assert.equal(removed, "保留的");
  const content = vault.files.get(AUG) ?? "";
  assert.deepEqual(content.split("\n\n").slice(3), [
    "**22:00**",
    "要删的",
    "---\n_(今日封存于 23:02)_",
  ]);
  assert.deepEqual(vault.trashed, []);
});

test("撤空当天日段后回收该段，月文件保留（月内还有其他天）", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-09-01T10:00:00+08:00"), "一号保留");
  await writer.append(at("2026-09-02T10:00:00+08:00"), "二号唯一一条");

  const removed = await writer.recall(at("2026-09-02T10:01:00+08:00"));
  assert.equal(removed, "二号唯一一条");
  const content = vault.files.get(SEP) ?? "";
  assert.ok(content.includes("## 09-01 周二"));
  assert.ok(!content.includes("## 09-02"));
  assert.deepEqual(vault.trashed, []);
});

test("整月撤空后 trash 月文件", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T22:00:00+08:00"), "唯一一条");

  const removed = await writer.recall(at("2026-08-31T22:01:00+08:00"));
  assert.equal(removed, "唯一一条");
  assert.deepEqual(vault.trashed, [AUG]);
});

test("撤回跨分钟多条后只删最后块，不回收仍有效的段头", () => {
  const content =
    "---\nmonth: 2026-08\nsource: feishu-diary\n---\n\n# 2026-08\n\n## 08-31 周一\n\n**22:00**\n\n早\n\n**22:05**\n\n晚";
  const result = recallLastFromContent(content, "2026-08-31");
  assert.equal(result.removed, "晚");
  assert.deepEqual(result.content.split("\n\n").slice(3), ["**22:00**", "早", "**22:05**"]);
  assert.equal(result.empty, false);
});

test("撤回作用于当前逻辑日段（凌晨撤回昨晚内容）", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-08-31T23:00:00+08:00"), "昨晚最后一条");
  // 09-01 03:00 仍属 08-31 逻辑日
  const removed = await writer.recall(at("2026-09-01T03:00:00+08:00"));
  assert.equal(removed, "昨晚最后一条");
});

test("撤回跨凌晨 4 点边界：新逻辑日无内容时回退上一逻辑日（跨到上月月文件）", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  // 03:58 记的内容落 08-31 逻辑日（上月月文件）；04:01 撤回时已属 09-01 新逻辑日
  await writer.append(at("2026-09-01T03:58:00+08:00"), "凌晨一条");
  const removed = await writer.recall(at("2026-09-01T04:01:00+08:00"));
  assert.equal(removed, "凌晨一条");
  assert.deepEqual(vault.trashed, [AUG]);
});

test("撤回跨年边界：1 月 1 日凌晨回退到上一年月文件", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  await writer.append(at("2026-01-01T03:00:00+08:00"), "跨年一条");
  const removed = await writer.recall(at("2026-01-01T05:00:00+08:00"));
  assert.equal(removed, "跨年一条");
});

test("撤回时文件不存在：不建空文件，返回 null", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  const removed = await writer.recall(at("2026-08-31T10:00:00+08:00"));
  assert.equal(removed, null);
  assert.deepEqual([...vault.files.keys()], []);
});

test("hasEntry：无文件/无日段 false，有日段/封存留痕段 true，撤光后 false", async () => {
  const vault = new MemoryVault();
  const writer = new DiaryWriter(vault, "FeishuDiary");
  assert.equal(await writer.hasEntry("2026-09-01"), false);

  await writer.append(at("2026-09-01T10:00:00+08:00"), "一号");
  assert.equal(await writer.hasEntry("2026-09-01"), true);
  assert.equal(await writer.hasEntry("2026-09-02"), false);

  // 封存留痕的段也算「今天写过」（晚安后不再提醒）
  assert.equal(await writer.seal(at("2026-09-02T23:00:00+08:00")), "23:00");
  assert.equal(await writer.hasEntry("2026-09-02"), true);

  // 撤回删掉唯一内容块 → 日段回收 → hasEntry 归 false（封存段不受影响）
  const removed = await writer.recall(at("2026-09-01T10:01:00+08:00"));
  assert.equal(removed, "一号");
  assert.equal(await writer.hasEntry("2026-09-01"), false);
  assert.equal(await writer.hasEntry("2026-09-02"), true);
});
