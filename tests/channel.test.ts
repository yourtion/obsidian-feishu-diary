import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenPost, normalizeIncoming } from "../src/feishu/channel.ts";

/**
 * SDK 长连接 handler 收到的真实结构（EventDispatcher.parse 已把 header/event
 * 展平到顶层：sender/message 直接在根上，没有 event 包装）。
 * 此前曾误用 webhook 包装结构 { event: { message } } 导致事件被静默丢弃——
 * 本测试固化正确结构防回归。
 */
const flattenedP2pTextEvent = {
  schema: "2.0",
  event_id: "e1",
  event_type: "im.message.receive_v1",
  create_time: "1756684800000",
  token: "t",
  app_id: "cli_x",
  tenant_key: "k",
  sender: { sender_id: { open_id: "ou_abc", user_id: "", union_id: "un_" }, sender_type: "user" },
  message: {
    message_id: "om_1",
    root_id: "",
    parent_id: "",
    create_time: "1756684800000",
    chat_id: "oc_1",
    chat_type: "p2p",
    message_type: "text",
    content: '{"text":"今天散步了两小时"}',
    mentions: [],
  },
};

test("normalizeIncoming 解析 SDK 展平格式的 p2p 文本消息", () => {
  const msg = normalizeIncoming(flattenedP2pTextEvent);
  assert.ok(msg);
  assert.equal(msg.messageId, "om_1");
  assert.equal(msg.chatId, "oc_1");
  assert.equal(msg.chatType, "p2p");
  assert.equal(msg.messageType, "text");
  assert.equal(msg.senderOpenId, "ou_abc");
  assert.equal(msg.text, "今天散步了两小时");
  assert.equal(msg.content, '{"text":"今天散步了两小时"}');
  assert.equal(msg.createTimeMs, 1756684800000);
});

test("normalizeIncoming 对 webhook 包装结构（无展平）返回 null 而非误判", () => {
  // SDK 展平后不存在 event 字段；若上游结构变化应显式暴露为 null
  const wrapped = {
    header: { event_type: "im.message.receive_v1" },
    event: flattenedP2pTextEvent.message,
  };
  assert.equal(normalizeIncoming(wrapped), null);
});

test("normalizeIncoming 缺关键字段返回 null", () => {
  assert.equal(normalizeIncoming(null), null);
  assert.equal(normalizeIncoming({}), null);
  assert.equal(normalizeIncoming({ sender: { sender_id: { open_id: "ou" } } }), null);
  assert.equal(normalizeIncoming({ message: { message_id: "om", chat_id: "oc" } }), null);
});

test("normalizeIncoming 非 text 类型 text 为空、content 原样保留", () => {
  const msg = normalizeIncoming({
    ...flattenedP2pTextEvent,
    message: {
      ...flattenedP2pTextEvent.message,
      message_type: "image",
      content: '{"image_key":"img_v2_abc"}',
    },
  });
  assert.ok(msg);
  assert.equal(msg.messageType, "image");
  assert.equal(msg.text, "");
  assert.equal(msg.content, '{"image_key":"img_v2_abc"}');
});

test("normalizeIncoming 容忍非 JSON 的 text content", () => {
  const msg = normalizeIncoming({
    ...flattenedP2pTextEvent,
    message: { ...flattenedP2pTextEvent.message, content: "not-json" },
  });
  assert.ok(msg);
  assert.equal(msg.text, "");
});

// ---------- 富文本 post（链接/分享消息的真身） ----------

const postContent = {
  title: "周报",
  content: [
    [
      { tag: "text", text: "本周看了 " },
      { tag: "a", text: "这篇文章", href: "https://example.com/post/1" },
      { tag: "text", text: "，作者" },
      { tag: "at", user_id: "ou_9", user_name: "老王" },
    ],
    [{ tag: "img", image_key: "img_v2_x" }],
    [{ tag: "emotion", emoji_type: "SMILE" }],
  ],
};

test("normalizeIncoming 解析 post 富文本为扁平 markdown", () => {
  const msg = normalizeIncoming({
    ...flattenedP2pTextEvent,
    message: {
      ...flattenedP2pTextEvent.message,
      message_type: "post",
      content: JSON.stringify(postContent),
    },
  });
  assert.ok(msg);
  assert.equal(
    msg.text,
    ["周报", "本周看了 [这篇文章](https://example.com/post/1)，作者@老王", "[图片]", "[表情]"].join(
      "\n",
    ),
  );
});

test("normalizeIncoming 对 rich_text 类型同样解析", () => {
  const msg = normalizeIncoming({
    ...flattenedP2pTextEvent,
    message: {
      ...flattenedP2pTextEvent.message,
      message_type: "rich_text",
      content: JSON.stringify(postContent),
    },
  });
  assert.ok(msg);
  assert.ok(msg.text.includes("[这篇文章](https://example.com/post/1)"));
});

test("normalizeIncoming 容忍畸形 post content（降级空 text）", () => {
  const msg = normalizeIncoming({
    ...flattenedP2pTextEvent,
    message: { ...flattenedP2pTextEvent.message, message_type: "post", content: "{{not-json" },
  });
  assert.ok(msg);
  assert.equal(msg.text, "");
});

test("flattenPost：兼容发送 API 的语言键包装；media/hr/code_block 占位", () => {
  const wrapped = JSON.stringify({ zh_cn: postContent });
  assert.ok(flattenPost(wrapped).includes("[这篇文章](https://example.com/post/1)"));

  const rich = flattenPost(
    JSON.stringify({
      content: [
        [{ tag: "media", file_key: "f1", image_key: "i1" }],
        [{ tag: "hr" }],
        [{ tag: "code_block", language: "GO", text: "func main() {}" }],
        [{ tag: "unknown_tag", x: 1 }],
      ],
    }),
  );
  assert.equal(rich, "[视频]\n---\nfunc main() {}");
});

test("flattenPost：content 缺失时回退 content_v2 的 md 标签", () => {
  const text = flattenPost(
    JSON.stringify({ content_v2: [[{ tag: "md", text: "一行[链接](https://a.com)" }]] }),
  );
  assert.equal(text, "一行[链接](https://a.com)");
});
