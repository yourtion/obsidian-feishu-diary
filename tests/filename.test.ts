import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureExt,
  extFromContentType,
  randomSuffix,
  sanitizeFileName,
} from "../src/util/filename.ts";

test("sanitizeFileName 去除非法字符与控制字符", () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), "a_b_c_d_e_f_g_h_i_j");
  // oxlint-disable-next-line no-control-regex
  assert.equal(sanitizeFileName("bad\x00\x1fname"), "bad__name");
  assert.equal(sanitizeFileName("  trim  "), "trim");
});

test("sanitizeFileName 分隔符替换为下划线与限长", () => {
  assert.equal(sanitizeFileName("///"), "___");
  assert.equal(sanitizeFileName("x".repeat(200)).length, 120);
});

test("randomSuffix 为 4 位", () => {
  assert.match(randomSuffix(), /^[a-z0-9]{4}$/);
});

test("extFromContentType 常见映射与未知类型", () => {
  assert.equal(extFromContentType("image/jpeg"), ".jpg");
  assert.equal(extFromContentType("image/png;charset=utf8"), ".png");
  assert.equal(extFromContentType("application/pdf"), "");
  assert.equal(extFromContentType(null), "");
});

test("ensureExt 不重复追加", () => {
  assert.equal(ensureExt("photo", ".jpg"), "photo.jpg");
  assert.equal(ensureExt("photo.JPG", ".jpg"), "photo.JPG");
  assert.equal(ensureExt("doc.pdf", ".pdf"), "doc.pdf");
  assert.equal(ensureExt("file", ""), "file");
});
