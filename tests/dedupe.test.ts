import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageDeduper } from "../src/util/dedupe.ts";

test("重复 message_id 返回 false", () => {
  const d = new MessageDeduper();
  assert.equal(d.checkAndAdd("om_1"), true);
  assert.equal(d.checkAndAdd("om_1"), false);
  assert.equal(d.size, 1);
});

test("超容量淘汰最旧", () => {
  const d = new MessageDeduper(2);
  d.checkAndAdd("a");
  d.checkAndAdd("b");
  d.checkAndAdd("c");
  assert.equal(d.has("a"), false);
  assert.equal(d.has("b"), true);
  assert.equal(d.has("c"), true);
});
