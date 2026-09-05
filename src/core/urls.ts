/**
 * URL 提取与 hook 规则匹配——纯函数，插件与 CLI 共用。
 *
 * hooks 的命令执行器（spawn）在 node/hooks.ts（CLI 侧，不进 main.js 产物）；
 * 本模块只回答「文本里有哪些 URL、命中哪条规则」。
 */

/** 一条 URL hook 规则：match 对 URL 全文做正则测试，cmd 为命令行（URL 追加为末参）。 */
export interface UrlHookRule {
  match: RegExp;
  cmd: string;
}

export interface HookHit {
  rule: UrlHookRule;
  url: string;
}

// 排除空白、成对/半角括号方括号尖括号、引号与中英文标点：
// markdown 链接 [文字](url) 停在 ")" 前；中文句子里夹的 URL 停在全角标点前。
// 字符类内的 "]" 必须转义（"[" 不必）——去掉会提前闭合字符类、正则整体失配。
const URL_RE = /https?:\/\/[^\s<>"'`(){}[\]，。！？；：、（）【】《》]+/g;

/** 提取文本中的 URL（去重、保持出现顺序）；剥掉句尾悬挂的半角标点。 */
export function extractUrls(text: string): string[] {
  const urls: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (url.length > "https://".length && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** 每个 URL 取首个命中的规则（按配置顺序）；无命中返回空数组。 */
export function matchHooks(rules: readonly UrlHookRule[], urls: readonly string[]): HookHit[] {
  const hits: HookHit[] = [];
  for (const url of urls) {
    const rule = rules.find((r) => r.match.test(url));
    if (rule) hits.push({ rule, url });
  }
  return hits;
}
