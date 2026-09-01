/**
 * P0-2 ASR 可用性实测。
 *
 * 飞书官方语音转文字：POST /open-apis/speech_to_text/v1/speech/file_recognize
 *  - 仅支持 pcm（16bit 单声道）、≤60s、引擎 16k_auto（中英文）
 *  - 权限 speech_to_text:speech
 *  - 文档注明「免费版（租户）不支持」——本脚本验证个人免费团队是否真的 403
 *
 * 脚本内合成 1 秒 440Hz 正弦波 PCM（16kHz/16bit/单声道），无可识别语音，
 * 因此 200 + 空文本 = 接口可用；403 / 错误码 = 免费版受限。
 */
import process from "node:process";

const FEISHU_BASE = "https://open.feishu.cn";
const SAMPLE_RATE = 16000;
const DURATION_SECONDS = 1;

const appId = requireEnv("FEISHU_APP_ID");
const appSecret = requireEnv("FEISHU_APP_SECRET");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少 ${name}。请先 cp scripts/p0/.env.example scripts/p0/.env 并填写。`);
    process.exit(1);
  }
  return value;
}

async function tenantAccessToken(): Promise<string> {
  const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const body = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string };
  if (body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`获取 token 失败: HTTP ${res.status} ${body.code} ${body.msg}`);
  }
  return body.tenant_access_token;
}

function synthTonePcm(): Buffer {
  const samples = SAMPLE_RATE * DURATION_SECONDS;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const amplitude = 0.25 * 0x7fff * (1 - t / DURATION_SECONDS); // 渐弱避免爆音
    pcm.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * 440 * t)), i * 2);
  }
  return pcm;
}

async function main(): Promise<void> {
  const token = await tenantAccessToken();
  const audio = synthTonePcm();

  console.log(
    `合成 PCM: ${audio.length} bytes（${DURATION_SECONDS}s @ ${SAMPLE_RATE}Hz 16bit mono）`,
  );
  console.log("调用 speech_to_text/v1/speech/file_recognize（engine=16k_auto）…\n");

  // 请求体结构（官方文档）：speech.speech = 裸 base64（不带 data: 前缀）；
  // config 必须带 file_id（16 位字母数字下划线，调用方生成）与 format。
  const fileId = "p0probe" + Math.random().toString(36).slice(2, 10);
  const res = await fetch(`${FEISHU_BASE}/open-apis/speech_to_text/v1/speech/file_recognize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      speech: { speech: audio.toString("base64") },
      config: { file_id: fileId, format: "pcm", engine_type: "16k_auto" },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    data?: unknown;
  };

  console.log(`HTTP ${res.status}`);
  console.log(`code=${body.code ?? "?"} msg=${body.msg ?? "?"}`);
  console.log(`data=${JSON.stringify(body.data ?? null)}`);

  if (body.code === 0) {
    console.log("\n结论：✅ 接口可用（正弦波无可识别语音，空文本属正常）→ 转写可进主链路候选。");
    return;
  }
  console.log(`\n结论：❌ 接口不可用（code=${body.code}）`);
  console.log("  - 99991400 = 频控（2026-09-01 实测：免费租户单次调用即触发，");
  console.log("    与文档「免费版不支持调用」吻合 = 免费版 ASR 配额为零）");
  console.log("  → 语音按「存原声为默认、转写做成开关（默认关）」落地（DECISIONS D6）");
}

main().catch((err) => {
  console.error("ASR 实测失败:", err);
  process.exit(1);
});
