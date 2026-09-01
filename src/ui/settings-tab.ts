/**
 * 设置页：凭据、日记目录、认主状态。
 * App Secret 存 SecretStorage（不落 data.json）；其余存 data.json。
 */
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type FeishuDiaryPlugin from "../main.ts";
import { SECRET_ID } from "../settings.ts";
import { ScanSetupModal } from "./scan-setup-modal.ts";

export class FeishuDiarySettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: FeishuDiaryPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Feishu Diary" });
    containerEl.createEl("p", {
      text: "推荐直接扫码创建应用（自动配置权限与事件订阅）；也可手动在飞书开放平台创建后填入凭据（见项目 scripts/p0/README.md）。",
    });

    new Setting(containerEl)
      .setName("一键创建应用（推荐）")
      .setDesc("用手机飞书扫码确认后，自动创建自建应用、开通所需权限与事件订阅，凭据自动保存")
      .addButton((button) =>
        button.setButtonText("扫码创建").onClick(() => {
          new ScanSetupModal(this.app, async (result) => {
            await this.plugin.applyScanResult(result.appId, result.appSecret, result.openId);
            this.display();
          }).open();
        }),
      );

    new Setting(containerEl)
      .setName("App ID")
      .setDesc("飞书自建应用的 App ID")
      .addText((text) =>
        text
          .setPlaceholder("cli_xxxx")
          .setValue(this.plugin.settings.appId)
          .onChange(async (value) => {
            this.plugin.settings.appId = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    const hasSecret = this.plugin.appSecret.length > 0;
    new Setting(containerEl)
      .setName("App Secret")
      .setDesc(
        hasSecret ? "已安全存储（留空保持不变）" : "飞书自建应用的 App Secret，仅存于本机凭据库",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(hasSecret ? "••••••（已存储）" : "输入 App Secret");
        text.onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed.length === 0) return;
          await this.plugin.storeAppSecret(trimmed);
          text.setValue("");
          new Notice("App Secret 已保存");
          await this.plugin.restartChannel();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("日记根目录")
      .setDesc("vault 内的目录，日记按「根目录/年/日期.md」落盘")
      .addText((text) =>
        text.setValue(this.plugin.settings.rootDir).onChange(async (value) => {
          this.plugin.settings.rootDir = value.trim() || "FeishuDiary";
          await this.plugin.saveSettings();
        }),
      );

    const owner = this.plugin.settings.ownerOpenId;
    new Setting(containerEl)
      .setName("认主")
      .setDesc(
        owner ? `当前主人：${owner}` : "尚未认主——启动后在飞书里给机器人发第一条消息即完成认主",
      )
      .addButton((button) => {
        if (!owner) {
          button.setDisabled(true);
          button.setButtonText("等待认主");
          return;
        }
        button.setButtonText("解绑");
        button.onClick(async () => {
          this.plugin.settings.ownerOpenId = null;
          await this.plugin.saveSettings();
          new Notice("已解绑，下一条消息的发送者将成为新主人");
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("每日提醒")
      .setDesc(
        "当天还没记才提醒；连续 3 天没记就沉默，记一篇即恢复。Obsidian 未运行时错过会在启动时补发",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.reminderEnabled).onChange(async (value) => {
          this.plugin.settings.reminderEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("提醒时间")
      .setDesc("HH:mm（东八区），默认 21:30")
      .addText((text) =>
        text
          .setPlaceholder("21:30")
          .setValue(this.plugin.settings.reminderTime)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
              this.plugin.settings.reminderTime = trimmed;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("重新连接")
      .setDesc("凭据或订阅方式变更后，重启长连接")
      .addButton((button) =>
        button.setButtonText("重连").onClick(async () => {
          await this.plugin.restartChannel();
          new Notice("已触发重连");
        }),
      );

    new Setting(containerEl)
      .setName("凭据存储位置")
      .setDesc(`App Secret 存于 Obsidian 凭据库（id: ${SECRET_ID}），不写入插件数据文件。`);
  }
}
