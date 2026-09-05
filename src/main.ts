/**
 * Feishu Diary 插件入口（Obsidian 壳）。
 *
 * 只做宿主装配：SecretStorage 凭据 + Obsidian Vault 存储 + requestUrl HTTP，
 * 喂给 FeishuDiaryService（service.ts）。消息管线/提醒等编排与 CLI（cli.ts）共用。
 */
import { Notice, Plugin } from "obsidian";
import { FeishuDiaryService } from "./service.ts";
import type { FeishuCreds } from "./feishu/client.ts";
import { ObsidianVaultAdapter } from "./feishu/vault-adapter.ts";
import { createObsidianHttpInstance, obsidianHttp } from "./feishu/http.ts";
import { channelStatusLabel } from "./feishu/channel.ts";
import { DEFAULT_SETTINGS, SECRET_ID } from "./settings.ts";
import type { FeishuDiarySettings } from "./settings.ts";
import { FeishuDiarySettingTab } from "./ui/settings-tab.ts";

/** 本机启用开关存 App#saveLocalStorage（本机 localStorage、vault 间隔离）：data.json 随 vault 同步，多机共用 vault 时一台开全机器开，存不得。 */
const ENABLED_KEY = "feishu-diary#enabled";

export default class FeishuDiaryPlugin extends Plugin {
  override settings: FeishuDiarySettings = DEFAULT_SETTINGS;
  private service: FeishuDiaryService | null = null;
  private statusBarItem: HTMLElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new FeishuDiarySettingTab(this.app, this));
    this.statusBarItem = this.addStatusBarItem();
    this.registerDomEvent(this.statusBarItem, "click", () => void this.restartChannel());
    this.service = new FeishuDiaryService({
      creds: { appId: "", appSecret: "" }, // 首次 restart 时以实际凭据启动
      http: obsidianHttp,
      httpInstance: createObsidianHttpInstance(),
      storage: new ObsidianVaultAdapter(this.app.vault, this.app.fileManager),
      settings: this.settings,
      persist: async (s) => {
        await this.saveData(s);
      },
      notify: (message) => {
        new Notice(message);
      },
      onStatus: (status, detail) => this.setStatus(status, detail),
    });
    this.register(() => void this.service?.stop());
    if (this.channelEnabled) {
      await this.service.restart(this.currentCreds());
    } else {
      this.setStatus("已停用");
    }
  }

  override onunload(): void {
    // onunload 钩子先于 register 回调执行，须在此直接停服；
    // 先置 null 会让 register 里的 stop 永不触发（残留 WSClient，事件随机分推）。
    void this.service?.stop();
    this.service = null;
  }

  private async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<FeishuDiarySettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  get appSecret(): string {
    return this.app.secretStorage.getSecret(SECRET_ID) ?? "";
  }

  async storeAppSecret(secret: string): Promise<void> {
    this.app.secretStorage.setSecret(SECRET_ID, secret);
  }

  private currentCreds(): FeishuCreds {
    return { appId: this.settings.appId, appSecret: this.appSecret };
  }

  /** 服务总闸：默认关。存 App#saveLocalStorage（本机独立、vault 间隔离），同一 vault 多机运行时只应在跑服务的机器上打开。 */
  get channelEnabled(): boolean {
    return this.app.loadLocalStorage(ENABLED_KEY) === "1";
  }

  setChannelEnabled(value: boolean): void {
    this.app.saveLocalStorage(ENABLED_KEY, value ? "1" : "0");
  }

  /** 扫码一键创建应用成功后：写入凭据、扫码者提前认主、开闸重连。 */
  async applyScanResult(appId: string, appSecret: string, openId?: string): Promise<void> {
    this.settings.appId = appId;
    if (!this.settings.ownerOpenId && openId) this.settings.ownerOpenId = openId;
    await this.saveSettings();
    await this.storeAppSecret(appSecret);
    this.setChannelEnabled(true); // 扫码是明确的启用动作，自动开本机总闸
    await this.restartChannel();
  }

  /** 凭据变更 / 首次配置后调用；总闸关闭时不建连。 */
  async restartChannel(): Promise<void> {
    if (!this.channelEnabled) {
      this.setStatus("已停用");
      return;
    }
    await this.service?.restart(this.currentCreds());
  }

  /** 总闸关闭：停服务并更新状态栏。 */
  async stopChannel(): Promise<void> {
    await this.service?.stop();
    this.setStatus("已停用");
  }

  /** 状态栏：中文化 + tooltip（状态与失败原因）+ 点击重连。 */
  private setStatus(status: string, detail?: string): void {
    const label = channelStatusLabel(status);
    this.statusBarItem?.setText(`🪶 ${label}`);
    this.statusBarItem?.setAttribute(
      "data-tooltip",
      `Feishu Diary · ${label}${detail ? `：${detail}` : ""}（点击重连）`,
    );
  }
}
