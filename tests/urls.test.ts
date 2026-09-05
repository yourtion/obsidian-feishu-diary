import assert from "node:assert/strict";
import { test } from "node:test";
import { extractUrls, matchHooks } from "../src/core/urls.ts";
import type { UrlHookRule } from "../src/core/urls.ts";

test("extractUrls：裸 URL、markdown 链接、多 URL 去重保序", () => {
  assert.deepEqual(extractUrls("看看 https://a.com/x 这个"), ["https://a.com/x"]);
  assert.deepEqual(extractUrls("[飞书文档](https://a.com/docx/abc) 写得不错"), [
    "https://a.com/docx/abc",
  ]);
  assert.deepEqual(
    extractUrls("先看 https://a.com/1 再看 https://b.com/2 最后回味 https://a.com/1"),
    ["https://a.com/1", "https://b.com/2"],
  );
});

test("extractUrls：中文标点作为边界，不吞进 URL", () => {
  assert.deepEqual(extractUrls("这个https://a.com/x，很好用。"), ["https://a.com/x"]);
  assert.deepEqual(extractUrls("链接（https://a.com/y）在括号里"), ["https://a.com/y"]);
});

test("extractUrls：剥掉句尾悬挂半角标点", () => {
  assert.deepEqual(extractUrls("see https://a.com/page."), ["https://a.com/page"]);
  assert.deepEqual(extractUrls("one https://a.com/a, two https://b.com/b;"), [
    "https://a.com/a",
    "https://b.com/b",
  ]);
});

test("extractUrls：无 URL 返回空数组", () => {
  assert.deepEqual(extractUrls("今天散步了两小时"), []);
  assert.deepEqual(extractUrls(""), []);
  // ftp 等非 http(s) scheme 不算
  assert.deepEqual(extractUrls("ftp://a.com/x"), []);
});

test("matchHooks：每个 URL 取首个命中规则，无命中为空", () => {
  const rules: UrlHookRule[] = [
    { match: /example\.com/, cmd: "dl" },
    { match: /\.feishu\.cn/, cmd: "fs" },
  ];
  const hits = matchHooks(rules, [
    "https://example.com/1",
    "https://x.feishu.cn/docx/a",
    "https://other.com/z",
  ]);
  assert.deepEqual(
    hits.map((h) => h.url),
    ["https://example.com/1", "https://x.feishu.cn/docx/a"],
  );
  assert.equal(hits[0]?.rule.cmd, "dl");
  assert.equal(hits[1]?.rule.cmd, "fs");
  assert.deepEqual(matchHooks(rules, ["https://other.com/z"]), []);
  assert.deepEqual(matchHooks([], ["https://example.com/1"]), []);
});

test("matchHooks：同 URL 命中多条规则时取配置顺序第一条", () => {
  const rules: UrlHookRule[] = [
    { match: /podcast/, cmd: "yt-dlp" },
    { match: /example\.com/, cmd: "generic" },
  ];
  const hits = matchHooks(rules, ["https://example.com/podcast/1"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.rule.cmd, "yt-dlp");
});
