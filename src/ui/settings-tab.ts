/**
 * 设置页（1.13.0+ 声明式 API）：定义即渲染 + 进入 Obsidian 设置搜索。
 *
 * 常规项走 control（默认值读写 plugin.settings）；App Secret 走 render 自定义
 * （存 SecretStorage，不进 settings）；扫码创建/重连/解绑走 action。
 * display() 已弃用，不再 override——框架按 getSettingDefinitions 渲染。
 */
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App, SettingDefinitionItem } from "obsidian";
import type FeishuDiaryPlugin from "../main.ts";
import { ScanSetupModal } from "./scan-setup-modal.ts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class FeishuDiarySettingTab extends PluginSettingTab {
  private readonly plugin: FeishuDiaryPlugin;

  constructor(app: App, plugin: FeishuDiaryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const owner = this.plugin.settings.ownerOpenId;
    const hasSecret = this.plugin.appSecret.length > 0;

    return [
      {
        type: "group",
        heading: "接入",
        items: [
          {
            name: "一键创建应用",
            desc: "用手机飞书扫码确认后，自动创建自建应用、开通所需权限与事件订阅，凭据自动保存。创建后需在开发者后台发布一次版本",
            aliases: ["扫码", "scan", "setup", "创建应用"],
            action: () => {
              new ScanSetupModal(this.app, async (result) => {
                await this.plugin.applyScanResult(result.appId, result.appSecret, result.openId);
                this.update();
              }).open();
            },
          },
          {
            name: "App ID",
            desc: "飞书自建应用的 App ID",
            control: { type: "text", key: "appId", placeholder: "cli_xxxx" },
          },
          {
            name: "App Secret",
            desc: hasSecret
              ? "已安全存储（输入新值即覆盖）"
              : "飞书自建应用的 App Secret，仅存于本机凭据库，不写入插件数据文件",
            render: (setting: Setting) => {
              setting.addText((text) => {
                text.inputEl.type = "password";
                text.setPlaceholder(hasSecret ? "••••••（已存储）" : "输入 App Secret");
                text.onChange(async (value) => {
                  const trimmed = value.trim();
                  if (trimmed.length === 0) return;
                  await this.plugin.storeAppSecret(trimmed);
                  text.setValue("");
                  new Notice("App Secret 已保存，正在重连");
                  await this.plugin.restartChannel();
                  this.update();
                });
              });
            },
          },
          {
            name: "重新连接",
            desc: "凭据或订阅方式变更后，重启长连接",
            action: async () => {
              await this.plugin.restartChannel();
              new Notice("已触发重连");
            },
          },
        ],
      },
      {
        type: "group",
        heading: "日记",
        items: [
          {
            name: "日记根目录",
            desc: "vault 内的目录，日记按「根目录/年/日期.md」落盘",
            control: { type: "folder", key: "rootDir" },
          },
        ],
      },
      {
        type: "group",
        heading: "每日提醒",
        items: [
          {
            name: "开启提醒",
            desc: "当天没记才提醒；连续 3 天没记自动沉默；错过到点在启动时补发",
            control: { type: "toggle", key: "reminderEnabled" },
          },
          {
            name: "提醒时间",
            desc: "HH:mm（东八区），默认 21:30",
            control: { type: "text", key: "reminderTime", placeholder: "21:30" },
          },
        ],
      },
      owner
        ? {
            name: "认主",
            desc: `当前主人：${owner}`,
            action: async () => {
              this.plugin.settings.ownerOpenId = null;
              await this.plugin.saveSettings();
              new Notice("已解绑，下一条消息的发送者将成为新主人");
              this.update();
            },
          }
        : {
            name: "认主",
            desc: "尚未认主——启动后在飞书里给机器人发第一条消息即完成认主",
          },
    ];
  }

  /** 值规范化：默认实现会写入并持久化 plugin.settings，这里只做约束。 */
  override setControlValue(key: string, value: unknown): void | Promise<void> {
    if (key === "rootDir") {
      return super.setControlValue(key, String(value).trim() || "FeishuDiary");
    }
    if (key === "reminderTime" && !TIME_RE.test(String(value))) {
      return; // 无效时间直接忽略，保留原值
    }
    return super.setControlValue(key, value);
  }
}
