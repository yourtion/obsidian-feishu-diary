/**
 * 附件入库：路径规则与笔记块构造（纯函数）。
 *
 * 布局（契约 D2）：{rootDir}/attachments/{YYYY}/{YYYY-MM-DD-HHmm}-{消毒名}
 * 笔记块：图片/语音/视频用嵌入 ![[...]]，普通文件用链接 [[...]]；
 * 语音固定 🎤 前缀（原声直存 .opus，转写文字后续版本追加在下一行）。
 */
import { attachmentStamp, timeParts } from "../util/time.ts";
import { ensureExt, sanitizeFileName } from "../util/filename.ts";

export type MediaKind = "image" | "file" | "audio" | "media";

/** 附件相对路径（vault 内）。stampTime 取消息真实时间。 */
export function attachmentPath(
  rootDir: string,
  stampTimeMs: number,
  displayName: string,
  ext: string,
): string {
  const stamp = attachmentStamp(stampTimeMs);
  const year = timeParts(stampTimeMs).year;
  const name = ensureExt(sanitizeFileName(displayName), ext);
  return `${rootDir}/attachments/${year}/${stamp}-${name}`;
}

/** 从附件路径取文件名（wikilink 用）。 */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 构造笔记内的附件块（一条消息 = 一个块），fileName 为 vault 内实际文件名。 */
export function attachmentBlock(kind: MediaKind, fileName: string): string {
  switch (kind) {
    case "image":
    case "media":
      return `![[${fileName}]]`;
    case "audio":
      return `🎤 ![[${fileName}]]`;
    case "file":
      return `[[${fileName}]]`;
  }
}
