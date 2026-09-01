import * as Lark from "@larksuiteoapi/node-sdk";
const result = await Lark.registerApp({
  createOnly: true,
  addons: {
    preset: false,
    scopes: {
      tenant: [
        "im:message.p2p_msg:readonly",
        "im:message:send_as_bot",
        "im:resource",
        "im:message.reactions:send",
        "speech_to_text:speech",
      ],
      user: [],
    },
    events: { items: { tenant: ["im.message.receive_v1"], user: [] } },
  },
  onQRCodeReady: (info) => console.log(`请在飞书打开: ${info.url}`),
});
console.log(result.client_id, result.client_secret);
