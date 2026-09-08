/**
 * 终端 ASCII 二维码（CLI init 专用；不进 main.js 产物）。
 *
 * 与插件侧 util/qrcode-svg.ts 同源：直接用 qrcode 包核心生成器（lib/core/qrcode）
 * 的位图矩阵自绘——顶层 qrcode API 是 CJS barrel，会把 pngjs/canvas 渲染器整包
 * 拉进 bundle。上下两模块行并一个半块字符（▀▄█ ），quiet zone 2 模块压宽度。
 */
import { create } from "qrcode/lib/core/qrcode.js";

/** 渲染二维码为多行字符串（等宽字体终端可直接扫）。 */
export function qrTerminal(
  text: string,
  errorCorrectionLevel: "L" | "M" | "Q" | "H" = "M",
): string {
  const qr = create(text, { errorCorrectionLevel });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const quiet = 2;
  const span = size + quiet * 2;
  const isDark = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < size && y < size && data[y * size + x] === 1;

  const lines: string[] = [];
  for (let y = -quiet; y < span; y += 2) {
    let line = "";
    for (let x = -quiet; x < span; x++) {
      const top = isDark(x, y);
      const bottom = isDark(x, y + 1);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
