/** qrcode 包核心生成器（lib/core 子路径）的类型声明——@types/qrcode 只覆盖顶层 API。 */
declare module "qrcode/lib/core/qrcode.js" {
  export interface QRCode {
    modules: { size: number; data: Uint8Array };
  }
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
  ): QRCode;
}
