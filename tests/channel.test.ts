import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeIncoming } from "../src/feishu/channel.ts";

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
