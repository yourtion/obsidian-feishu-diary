/**
 * service.ts 编排层测试：注入假通道/假客户端/内存存储，
 * 覆盖认主、去重、p2p 过滤、意图分发、两态回执（含失败摘表情）、串行队列。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FeishuDiaryService } from "../src/service.ts";
import type { ChannelLike, ClientLike } from "../src/service.ts";
import type { IncomingMessage } from "../src/feishu/channel.ts";
import type { HttpApi } from "../src/feishu/http.ts";
import type { StorageAdapter } from "../src/core/writer.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import type { FeishuDiarySettings } from "../src/settings.ts";
import type { HttpInstance } from "@larksuiteoapi/node-sdk";

class MemoryStorage implements StorageAdapter {
  files = new Map<string, string>();
  binaries = new Map<string, ArrayBuffer>();
  failProcess = false;
  inFlight = 0;
  maxInFlight = 0;

  async process(path: string, fn: (content: string) => string): Promise<string> {
    if (this.failProcess) throw new Error("disk full");
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setTimeout(r, 1)); // 拉长窗口暴露并发
    const next = fn(this.files.get(path) ?? "");
    this.inFlight--;
    this.files.set(path, next);
    return next;
  }

  async trash(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<string> {
    this.binaries.set(path, data);
    return path.slice(path.lastIndexOf("/") + 1);
  }
}

class FakeClient implements ClientLike {
  texts: { openId: string; text: string }[] = [];
  reactions: { messageId: string; emoji: string }[] = [];
  removedReactionIds: string[] = [];
  addReactionHook: ((emoji: string) => Promise<string>) | null = null;

  async sendText(openId: string, text: string): Promise<void> {
    this.texts.push({ openId, text });
  }

  async addReaction(messageId: string, emoji: string): Promise<string> {
    this.reactions.push({ messageId, emoji });
    if (this.addReactionHook) return this.addReactionHook(emoji);
    return `r${this.reactions.length}`;
  }

  async removeReaction(_messageId: string, reactionId: string): Promise<void> {
    this.removedReactionIds.push(reactionId);
  }

  async downloadResource(): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
    return { buffer: new ArrayBuffer(8), contentType: "image/png" };
  }
}

let seq = 0;
function textMsg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  const text = over.text ?? "今天很开心";
  return {
    messageId: `om_${++seq}`,
    chatId: "oc_1",
    chatType: "p2p",
    messageType: "text",
    createTimeMs: Date.parse("2026-09-05T10:00:00+08:00"),
    senderOpenId: "ou_me",
    content: JSON.stringify({ text }),
    text,
    ...over,
  };
}

interface Harness {
  svc: FeishuDiaryService;
  storage: MemoryStorage;
  client: FakeClient;
  settings: FeishuDiarySettings;
  send: (msg: IncomingMessage) => Promise<void>;
  persisted: () => FeishuDiarySettings | null;
}

async function makeService(ownerOpenId: string | null = "ou_me"): Promise<Harness> {
  const storage = new MemoryStorage();
  const client = new FakeClient();
  const settings: FeishuDiarySettings = {
    ...DEFAULT_SETTINGS,
    ownerOpenId,
    reminderEnabled: false,
  };
  let persisted: FeishuDiarySettings | null = null;
  let onMessage: (msg: IncomingMessage) => Promise<void> | void = async () => {};
  const fakeChannel: ChannelLike = {
    start: async () => {},
    stop: async () => {},
  };
  const svc = new FeishuDiaryService({
    creds: { appId: "cli_x", appSecret: "s" },
    http: {} as HttpApi,
    httpInstance: {} as HttpInstance,
    storage,
    settings,
    persist: (s) => {
      persisted = s;
    },
    channelFactory: (_creds, _httpInstance, handler) => {
      onMessage = handler;
      return fakeChannel;
    },
    clientFactory: () => client,
  });
  await svc.start();
  return {
    svc,
    storage,
    client,
    settings,
    send: (msg) => Promise.resolve(onMessage(msg)),
    persisted: () => persisted,
  };
}

/** 等消息队列排空（队列是私有串行尾链，测试经结构断言取引用）。 */
function drain(h: Harness): Promise<void> {
  return (h.svc as unknown as { queue: Promise<void> }).queue;
}

test("文字消息写入当天文件并走完两态回执 OnIt→摘除→DONE", async () => {
  const h = await makeService();
  await h.send(textMsg());
  await drain(h);
  const content = h.storage.files.get("FeishuDiary/2026/2026-09-05.md") ?? "";
  assert.ok(content.includes("今天很开心"));
  assert.deepEqual(
    h.client.reactions.map((r) => r.emoji),
    ["OnIt", "DONE"],
  );
  assert.equal(h.client.removedReactionIds.length, 1);
  await h.svc.stop();
});

test("同一 message_id 重复推送只处理一次", async () => {
  const h = await makeService();
  const msg = textMsg();
  await h.send(msg);
  await h.send(msg);
  await drain(h);
  const content = h.storage.files.get("FeishuDiary/2026/2026-09-05.md") ?? "";
  assert.equal(content.split("今天很开心").length - 1, 1);
  assert.deepEqual(
    h.client.reactions.map((r) => r.emoji),
    ["OnIt", "DONE"],
  );
  await h.svc.stop();
});

test("群聊消息直接忽略", async () => {
  const h = await makeService();
  await h.send(textMsg({ chatType: "group" }));
  await drain(h);
  assert.equal(h.storage.files.size, 0);
  assert.equal(h.client.reactions.length, 0);
  await h.svc.stop();
});

test("非主人消息忽略（不写不回执）", async () => {
  const h = await makeService();
  await h.send(textMsg({ senderOpenId: "ou_other" }));
  await drain(h);
  assert.equal(h.storage.files.size, 0);
  assert.equal(h.client.reactions.length, 0);
  assert.equal(h.client.texts.length, 0);
  await h.svc.stop();
});

test("首条消息自动认主并回复，且该消息继续按正文落库", async () => {
  const h = await makeService(null);
  await h.send(textMsg({ senderOpenId: "ou_new", text: "你好" }));
  await drain(h);
  assert.equal(h.settings.ownerOpenId, "ou_new");
  assert.match(h.client.texts[0]?.text ?? "", /已认主/);
  assert.ok(h.persisted());
  const content = h.storage.files.get("FeishuDiary/2026/2026-09-05.md") ?? "";
  assert.ok(content.includes("你好"));
  await h.svc.stop();
});

test("写入失败：摘掉 OnIt、文字回执、不加 DONE", async () => {
  const h = await makeService();
  h.storage.failProcess = true;
  await h.send(textMsg());
  await drain(h);
  assert.equal(h.client.removedReactionIds.length, 1);
  assert.match(h.client.texts[0]?.text ?? "", /^没存上：disk full$/);
  assert.deepEqual(
    h.client.reactions.map((r) => r.emoji),
    ["OnIt"],
  );
  await h.svc.stop();
});

test("撤回：回复被删内容摘要", async () => {
  const h = await makeService();
  await h.send(textMsg({ text: "第一条" }));
  await drain(h);
  await h.send(textMsg({ text: "撤回", messageId: "om_recall" }));
  await drain(h);
  assert.match(h.client.texts.at(-1)?.text ?? "", /^已撤回：第一条$/);
  await h.svc.stop();
});

test("叫我XX：设置称呼并持久化", async () => {
  const h = await makeService();
  await h.send(textMsg({ text: "叫我小白" }));
  await drain(h);
  assert.equal(h.settings.nickname, "小白");
  assert.equal(h.persisted()?.nickname, "小白");
  assert.match(h.client.texts.at(-1)?.text ?? "", /小白/);
  await h.svc.stop();
});

test("事件 handler 快速返回：重活挂起时 handler 已返回（3 秒时限）", async () => {
  const h = await makeService();
  // 回执工作挂起不放行：handler 若同步等它，await send 就永远不返回
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  h.client.addReactionHook = async () => {
    await gate;
    return "r_gate";
  };
  let handlerReturned = false;
  await h.send(textMsg());
  handlerReturned = true; // 能执行到这行 = handler 没被重活阻塞
  assert.ok(handlerReturned);
  releaseGate();
  await drain(h);
  assert.deepEqual(
    h.client.reactions.map((r) => r.emoji),
    ["OnIt", "DONE"],
  );
  await h.svc.stop();
});

test("消息处理串行：process 读-改-写不并发", async () => {
  const h = await makeService();
  await h.send(textMsg({ text: "第一条" }));
  await h.send(textMsg({ text: "第二条", messageId: "om_2" }));
  await drain(h);
  assert.equal(h.storage.maxInFlight, 1);
  await h.svc.stop();
});

test("媒体消息：下载附件入库并写笔记块", async () => {
  const h = await makeService();
  await h.send(
    textMsg({
      messageId: "om_img",
      messageType: "image",
      content: JSON.stringify({ image_key: "img_v2_abc" }),
      text: "",
    }),
  );
  await drain(h);
  assert.equal(h.storage.binaries.size, 1);
  const content = h.storage.files.get("FeishuDiary/2026/2026-09-05.md") ?? "";
  assert.ok(content.includes("image"));
  assert.deepEqual(
    h.client.reactions.map((r) => r.emoji),
    ["OnIt", "DONE"],
  );
  await h.svc.stop();
});

test("畸形媒体 content：OnIt 被摘除并文字回执，不崩", async () => {
  const h = await makeService();
  await h.send(
    textMsg({
      messageId: "om_bad",
      messageType: "image",
      content: "{{not-json",
      text: "",
    }),
  );
  await drain(h);
  assert.equal(h.storage.files.size, 0);
  assert.equal(h.client.removedReactionIds.length, 1);
  assert.match(h.client.texts.at(-1)?.text ?? "", /^没存上：/);
  await h.svc.stop();
});
