/** 附件文件名工具：消毒、扩展名推断、同名冲突消解。 */

/** 消毒文件名：去除路径分隔符/非法字符/控制字符，限长。 */
export function sanitizeFileName(name: string): string {
  // 控制字符匹配是有意为之（消毒）。
  // oxlint-disable-next-line no-control-regex
  const cleaned = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").trim();
  return cleaned.slice(0, 120);
}

/** 生成 4 位随机小写后缀（同名冲突时消解用，如 a3f1）。 */
export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, "0");
}

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "application/octet-stream": "",
};

/** 从 Content-Type 推断扩展名（未知类型返回空串）。 */
export function extFromContentType(contentType: string | null): string {
  if (!contentType) return "";
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return CONTENT_TYPE_EXT[base] ?? "";
}

/** 确保文件名带扩展名：没有则追加（如飞书图片下载无原始文件名时）。 */
export function ensureExt(name: string, ext: string): string {
  if (ext.length === 0 || name.toLowerCase().endsWith(ext)) return name;
  return `${name}${ext}`;
}
