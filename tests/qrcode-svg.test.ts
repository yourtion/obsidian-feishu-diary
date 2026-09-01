import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "qrcode/lib/core/qrcode.js";
import { qrSvgDataUri, qrToSvg } from "../src/util/qrcode-svg.ts";

test("qrToSvg 输出合法 SVG（viewBox 含 4 模块 quiet zone，暗块为 path）", () => {
  const qr = create("https://example.com");
  const svg = qrToSvg(qr);
  const size = qr.modules.size;
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes(`viewBox="-4 -4 ${size + 8} ${size + 8}"`));
  assert.ok(svg.includes('fill="#1e1e3e'.slice(0, 8)) || svg.includes('fill="'));
  assert.ok(svg.includes("<path"));
  assert.ok(svg.endsWith("</svg>"));
});

test("qrToSvg 暗块数量与位图矩阵一致", () => {
  const qr = create("hello feishu diary");
  let dark = 0;
  for (let i = 0; i < qr.modules.data.length; i++) if (qr.modules.data[i]) dark++;
  const svg = qrToSvg(qr);
  const rects = svg.match(/h1v1h-1z/g) ?? [];
  assert.equal(rects.length, dark);
});

test("qrSvgDataUri 返回 data URI 前缀且 URL 编码", () => {
  const uri = qrSvgDataUri("https://open.feishu.cn/page/launcher?user_code=ABCD");
  assert.ok(uri.startsWith("data:image/svg+xml;utf8,"));
  assert.ok(uri.includes("%3Csvg")); // '<' 被编码
});
