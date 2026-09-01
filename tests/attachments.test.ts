import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentBlock, attachmentPath } from "../src/core/attachments.ts";

const at = (s: string) => Date.parse(s);

test("attachmentPath：按消息时间戳分年目录 + 消毒名", () => {
  assert.equal(
    attachmentPath("FeishuDiary", at("2026-09-01T23:05:00+08:00"), "照片.jpg", ""),
    "FeishuDiary/attachments/2026/2026-09-01-2305-照片.jpg",
  );
});

test("attachmentPath：无扩展名时追加推断扩展", () => {
  assert.equal(
    attachmentPath("FeishuDiary", at("2026-09-01T23:05:00+08:00"), "image", ".png"),
    "FeishuDiary/attachments/2026/2026-09-01-2305-image.png",
  );
});

test("attachmentPath：语音固定 .opus（不重复追加）", () => {
  assert.equal(
    attachmentPath("FeishuDiary", at("2026-09-01T23:05:00+08:00"), "voice", ".opus"),
    "FeishuDiary/attachments/2026/2026-09-01-2305-voice.opus",
  );
});

test("attachmentPath：非法文件名消毒", () => {
  assert.equal(
    attachmentPath("FeishuDiary", at("2026-09-01T23:05:00+08:00"), "a/b报告.pdf", ""),
    "FeishuDiary/attachments/2026/2026-09-01-2305-a_b报告.pdf",
  );
});

test("attachmentPath：凌晨消息按真实时间戳（逻辑日不影响附件名）", () => {
  assert.equal(
    attachmentPath("FeishuDiary", at("2026-09-01T03:30:00+08:00"), "voice", ".opus"),
    "FeishuDiary/attachments/2026/2026-09-01-0330-voice.opus",
  );
});

test("attachmentBlock：各类型块格式", () => {
  assert.equal(
    attachmentBlock("image", "2026-09-01-2305-image.png"),
    "![[2026-09-01-2305-image.png]]",
  );
  assert.equal(
    attachmentBlock("media", "2026-09-01-2305-video.mp4"),
    "![[2026-09-01-2305-video.mp4]]",
  );
  assert.equal(
    attachmentBlock("audio", "2026-09-01-2305-voice.opus"),
    "🎤 ![[2026-09-01-2305-voice.opus]]",
  );
  assert.equal(attachmentBlock("file", "2026-09-01-2305-报告.pdf"), "[[2026-09-01-2305-报告.pdf]]");
});
