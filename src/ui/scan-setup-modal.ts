/**
 * 扫码一键创建应用 Modal。
 *
 * 展示 registerApp 返回的验证链接（二维码 + 可点链接），
 * 用户飞书扫码确认后自动写入凭据并触发回调；关闭弹窗即中止轮询。
 */
import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import { qrSvgDataUri } from "../util/qrcode-svg.ts";
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

    const qrEl = this.contentEl.createDiv({ cls: "feishu-diary-qr" });
    this.statusEl = this.contentEl.createEl("p", {
      cls: "feishu-diary-scan-status",
      text: "正在获取验证链接…",
    });
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "用手机飞书扫码：可创建新应用，也可在确认页选择已有应用复用（自动补齐所需权限与事件）。扫码的账号即成为日记主人。",
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
            this.renderQr(qrEl, url);
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
      new Notice("Feishu diary：应用已创建并连接");
      this.close();
    } catch (err) {
      if (this.abort.signal.aborted) return;
      this.stopCountdown();
      // 完整错误进控制台（含 axios 的 code/response，诊断 Electron 网络问题用）
      console.error("[feishu-diary] 扫码创建失败:", err);
      const message = err instanceof Error ? err.message : String(err);
      const detail = (err as { response?: { status?: number; data?: unknown } }).response
        ? ` HTTP ${(err as { response: { status?: number } }).response.status}`
        : "";
      this.setStatus(
        `❌ 流程未完成（${message}${detail}）。完整错误已打印到控制台（Ctrl+Cmd+I）。`,
      );
      const retry = this.contentEl.createEl("button", { text: "重新获取二维码" });
      retry.onclick = () => {
        retry.remove();
        this.setStatus("正在获取验证链接…");
        void this.run(qrEl, linkEl);
      };
    }
  }

  private renderQr(qrEl: HTMLElement, url: string): void {
    try {
      // 纯 SVG 字符串渲染，不创建 canvas/DOM（社区审查要求）
      qrEl.empty();
      const img = qrEl.createEl("img");
      img.src = qrSvgDataUri(url);
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
