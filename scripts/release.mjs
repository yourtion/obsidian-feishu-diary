/**
 * 版本联动发布脚本（npm run release [patch|minor|major|x.y.z] [--push]）
 *
 * 单一入口同步四处版本，杜绝漂移：
 *   package.json / manifest.json / versions.json / git tag（无 v 前缀，与 manifest 一致）
 *
 * release.yml 会校验 tag == manifest == package，不一致直接失败。
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const push = args.includes("--push");
const bump = args.find((a) => !a.startsWith("--")) ?? "patch";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const current = manifest.version;

const next = resolveVersion(bump, current);
if (versions[next]) {
  console.error(`版本 ${next} 已存在于 versions.json（当前 ${current}）`);
  process.exit(1);
}

// 已跟踪文件的未提交修改会挡发版（本地与 CI 从 tag 构建必须一致）；
// untracked 不进构建产物，不挡——但提示确认，防新源码忘 add 后发布旧产物。
const statusLines = execSync("git status --porcelain", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const blocking = statusLines.filter((l) => !l.startsWith("??"));
const untracked = statusLines.filter((l) => l.startsWith("??"));
if (blocking.length > 0) {
  console.error("已跟踪文件有未提交变更，先提交再发布：\n" + blocking.join("\n"));
  process.exit(1);
}
if (untracked.length > 0) {
  console.warn("⚠ 未跟踪文件不参与 CI 构建（确认无需提交后忽略）：\n" + untracked.join("\n"));
}

pkg.version = next;
manifest.version = next;
versions[next] = manifest.minAppVersion;

writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

execSync("git add package.json manifest.json versions.json");
execSync(`git commit -m "chore: release ${next}"`);
execSync(`git tag ${next}`);

console.log(`✅ ${current} → ${next}，已提交并打 tag`);
if (push) {
  execSync("git push origin main");
  execSync(`git push origin ${next}`);
  console.log("✅ 已推送，release workflow 将自动构建发布");
} else {
  console.log(`下一步：git push origin main && git push origin ${next}`);
}

function resolveVersion(bump, current) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [major, minor, patch] = current.split(".").map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      console.error(`未知版本参数：${bump}（可选 patch / minor / major / x.y.z）`);
      process.exit(1);
  }
}
