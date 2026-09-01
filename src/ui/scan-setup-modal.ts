/**
 * 扫码一键创建应用 Modal。
 *
 * 展示 registerApp 返回的验证链接（二维码 + 可点链接），
 * 用户飞书扫码确认后自动写入凭据并触发回调；关闭弹窗即中止轮询。
 */
import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import QRCode from "qrcode";
import { createAppByScan } from "../feishu/register.ts";

export interface ScanResult {
  appId: string;
  appSecret: string;
  /** 扫码用户的 open_id（可用于提前认主）。 */
  openId?: string;
}

export class ScanSetupModal extends Modal {
  private readonly abort = new AbortController();
  private countdown: number | undefined;
  private statusEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly onDone: (result: ScanResult) => Promise<void>,
  ) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    this.titleEl.setText("一键创建飞书应用");
    this.contentEl.empty();
    this.contentEl.addClass("feishu-diary-scan-modal");

    const qrEl = this.contentEl.createEl("div", { cls: "feishu-diary-qr" });
    this.statusEl = this.contentEl.createEl("p", {
      cls: "feishu-diary-scan-status",
      text: "正在获取验证链接…",
    });
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "用手机飞书扫码，确认后自动创建应用并配置好权限——无需进开发者后台。扫码的账号即成为日记主人。",
    });
    const linkEl = this.contentEl.createEl("p");

    await this.run(qrEl, linkEl);
  }

  override onClose(): void {
    this.abort.abort();
    if (this.countdown !== undefined) window.clearInterval(this.countdown);
    this.contentEl.empty();
  }

  private async run(qrEl: HTMLElement, linkEl: HTMLElement): Promise<void> {
    try {
      const result = await createAppByScan(
        {
          onQRCodeReady: ({ url, expireInSeconds }) => {
            void this.renderQr(qrEl, url);
            linkEl.empty();
            linkEl.createEl("a", { text: "扫码不便？点此在浏览器打开", href: url });
            this.setStatus(`等待扫码确认…（${formatSeconds(expireInSeconds)} 后过期）`);
            this.startCountdown(expireInSeconds);
          },
          onStatus: (status) => {
            if (status === "slow_down") this.setStatus("等待扫码确认…（稍慢，仍在轮询）");
          },
        },
        this.abort.signal,
      );

      this.stopCountdown();
      this.setStatus("✅ 应用创建成功，正在保存凭据…");
      const scanResult: ScanResult = { appId: result.client_id, appSecret: result.client_secret };
      const openId = result.user_info?.open_id;
      if (openId) scanResult.openId = openId;
      await this.onDone(scanResult);
      new Notice("Feishu Diary：应用已创建并连接");
      this.close();
    } catch (err) {
      if (this.abort.signal.aborted) return;
      const code = err instanceof Error ? err.message : String(err);
      this.stopCountdown();
      this.setStatus(`❌ 流程未完成（${code}）。二维码过期或被取消后可重试。`);
      const retry = this.contentEl.createEl("button", { text: "重新获取二维码" });
      retry.onclick = () => {
        retry.remove();
        this.setStatus("正在获取验证链接…");
        void this.run(qrEl, linkEl);
      };
    }
  }

  private async renderQr(qrEl: HTMLElement, url: string): Promise<void> {
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 240, margin: 2 });
      qrEl.empty();
      const img = qrEl.createEl("img");
      img.src = dataUrl;
    } catch (err) {
      console.error("[feishu-diary] 二维码渲染失败:", err);
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  private startCountdown(seconds: number): void {
    this.stopCountdown();
    let left = seconds;
    this.countdown = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        this.stopCountdown();
        this.setStatus("二维码已过期，请点击下方按钮重试。");
      } else {
        this.setStatus(`等待扫码确认…（${formatSeconds(left)} 后过期）`);
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdown !== undefined) {
      window.clearInterval(this.countdown);
      this.countdown = undefined;
    }
  }
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
