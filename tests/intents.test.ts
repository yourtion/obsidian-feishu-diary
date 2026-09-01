import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "../src/core/intents.ts";

test("普通文本 → note", () => {
  assert.deepEqual(classify("今天散步了两小时"), { kind: "note", text: "今天散步了两小时" });
});

test("空白 → ignore", () => {
  assert.equal(classify("   \n\t ").kind, "ignore");
  assert.equal(classify("").kind, "ignore");
});

test("命令词精确匹配", () => {
  assert.equal(classify("撤回").kind, "recall");
  assert.equal(classify("晚安").kind, "seal");
  assert.equal(classify("结束").kind, "seal");
  assert.equal(classify("在吗").kind, "ping");
  assert.equal(classify("帮助").kind, "help");
  assert.equal(classify("?").kind, "help");
});

test("命令词出现在长消息中不触发（长度闸门）", () => {
  assert.equal(classify("今天有点累，感觉需要撤回一些说过的话，明天再说吧").kind, "note");
  assert.equal(classify("在吗在吗在吗在吗在吗在吗在吗在吗在吗").kind, "note");
});

test("命令词做前缀/后缀不触发（精确匹配）", () => {
  assert.equal(classify("撤回上一条").kind, "note");
  assert.equal(classify("帮我撤回").kind, "note");
});

test("「记：」逃生口强制落库，全角半角冒号均可", () => {
  assert.deepEqual(classify("记：晚安"), { kind: "forced-note", text: "晚安" });
  assert.deepEqual(classify("记:今天走了 8000 步"), {
    kind: "forced-note",
    text: "今天走了 8000 步",
  });
});

test("「记：」后为空不误吞", () => {
  assert.equal(classify("记：").kind, "note");
});

test("「叫我XX」设置称呼", () => {
  assert.deepEqual(classify("叫我小王"), { kind: "callme", name: "小王" });
  assert.deepEqual(classify("叫我  老张 "), { kind: "callme", name: "老张" });
  assert.equal(classify("叫我" + "一二三四五六七八九十一二三四五六七").kind, "note");
});

test("trim 后再判定", () => {
  assert.equal(classify("  撤回  ").kind, "recall");
  assert.deepEqual(classify("  记：测试  "), { kind: "forced-note", text: "测试" });
});
