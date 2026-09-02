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
import { DEFAULT_SETTINGS, SECRET_ID } from "./settings.ts";
import type { FeishuDiarySettings } from "./settings.ts";
import { FeishuDiarySettingTab } from "./ui/settings-tab.ts";

export default class FeishuDiaryPlugin extends Plugin {
  override settings: FeishuDiarySettings = DEFAULT_SETTINGS;
  private service: FeishuDiaryService | null = null;
  private statusBarItem: HTMLElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new FeishuDiarySettingTab(this.app, this));
    this.statusBarItem = this.addStatusBarItem();
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
      onStatus: (status) => this.setStatus(status),
    });
    this.register(() => void this.service?.stop());
    await this.service.restart(this.currentCreds());
  }

  override onunload(): void {
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

  /** 扫码一键创建应用成功后：写入凭据、扫码者提前认主、重连。 */
  async applyScanResult(appId: string, appSecret: string, openId?: string): Promise<void> {
    this.settings.appId = appId;
    if (!this.settings.ownerOpenId && openId) this.settings.ownerOpenId = openId;
    await this.saveSettings();
    await this.storeAppSecret(appSecret);
    await this.service?.restart({ appId, appSecret });
  }

  /** 凭据变更 / 首次配置后调用。 */
  async restartChannel(): Promise<void> {
    await this.service?.restart(this.currentCreds());
  }

  private setStatus(status: string): void {
    this.statusBarItem?.setText(`🪶 ${status}`);
  }
}
