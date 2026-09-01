/**
 * 二维码 SVG 渲染（纯字符串，零 canvas/DOM 依赖）。
 *
 * 直接使用 qrcode 包的核心生成器（lib/core/qrcode）拿位图矩阵，自己拼 SVG：
 * 社区审查禁止 document.createElement（canvas 渲染路径会被拒），
 * 顶层 qrcode API（CJS barrel）也无法 tree-shake 掉 pngjs/canvas 渲染器。
 */
import { create } from "qrcode/lib/core/qrcode.js";

/** 生成二维码的 SVG data URI（quiet zone 4 模块，显示尺寸由 CSS 控制）。 */
export function qrSvgDataUri(
  text: string,
  errorCorrectionLevel: "L" | "M" | "Q" | "H" = "M",
): string {
  const qr = create(text, { errorCorrectionLevel });
  const svg = qrToSvg(qr);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 位图矩阵 → SVG 字符串（白底黑码 + 4 模块 quiet zone；白底固定，主题无关）。 */
export function qrToSvg(qr: { modules: { size: number; data: ArrayLike<number> } }): string {
  const size = qr.modules.size;
  const data = qr.modules.data;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) path += `M${x},${y}h1v1h-1z`;
    }
  }
  const quiet = 4;
  const span = size + quiet * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-quiet} ${-quiet} ${span} ${span}" shape-rendering="crispEdges">` +
    `<rect x="${-quiet}" y="${-quiet}" width="${span}" height="${span}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/></svg>`
  );
}
