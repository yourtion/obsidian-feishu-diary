/** 插件设置。App Secret 不在此处——走 Obsidian SecretStorage（≥1.11.4）。 */
export interface FeishuDiarySettings {
  /** 日记根目录（vault 内相对路径）。 */
  rootDir: string;
  /** 飞书自建应用 App ID（非敏感，存 data.json）。 */
  appId: string;
  /** 已认主的用户 open_id；null = 未认主。 */
  ownerOpenId: string | null;
  /** 「叫我XX」设置的称呼。 */
  nickname: string;
}

/** SecretStorage id（约束：小写字母数字与连字符）。 */
export const SECRET_ID = "feishu-diary-app-secret";

export const DEFAULT_SETTINGS: FeishuDiarySettings = {
  rootDir: "FeishuDiary",
  appId: "",
  ownerOpenId: null,
  nickname: "",
};
