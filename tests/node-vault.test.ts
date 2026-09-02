import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { NodeFsVaultAdapter } from "../src/node/vault.ts";

async function tmpRoot(): Promise<{ root: string; adapter: NodeFsVaultAdapter }> {
  const root = await mkdtemp(path.join(tmpdir(), "feishu-vault-"));
  return { root, adapter: new NodeFsVaultAdapter(root) };
}

test("process：文件不存在时空串起步并落盘，父目录自动创建", async () => {
  const { root, adapter } = await tmpRoot();
  const file = path.join(root, "2026", "2026-09-02.md");
  const out = await adapter.process(file, (c) => `${c}第一条`);
  assert.equal(out, "第一条");
  assert.equal(await readFile(file, "utf8"), "第一条");
});

test("process：已有内容读-改-写；fn 抛错时文件不动、无 tmp 残留", async () => {
  const { root, adapter } = await tmpRoot();
  const file = path.join(root, "d", "a.md");
  await adapter.process(file, () => "原内容");
  const out = await adapter.process(file, (c) => `${c}\n追加`);
  assert.equal(out, "原内容\n追加");
  assert.equal(await readFile(file, "utf8"), "原内容\n追加");

  await assert.rejects(
    adapter.process(file, () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await readFile(file, "utf8"), "原内容\n追加");
  assert.deepEqual(await readdir(path.join(root, "d")), ["a.md"]);
});

test("trash：移入 rootDir/.trash 并可恢复；目标不存在时静默", async () => {
  const { root, adapter } = await tmpRoot();
  const file = path.join(root, "2026", "a.md");
  await adapter.process(file, () => "要删的");
  await adapter.trash(file);
  assert.equal(await adapter.exists(file), false);
  const trashed = path.join(root, ".trash", "a.md");
  assert.equal(await readFile(trashed, "utf8"), "要删的");

  // 不存在的路径不抛
  await adapter.trash(path.join(root, "nope.md"));
});

test("writeBinary：同名冲突加 4 位随机后缀，返回 basename，父目录自动创建", async () => {
  const { root, adapter } = await tmpRoot();
  const target = path.join(root, "attachments", "2026", "a.png");
  const name1 = await adapter.writeBinary(target, new Uint8Array([1]).buffer);
  const name2 = await adapter.writeBinary(target, new Uint8Array([2]).buffer);
  assert.equal(name1, "a.png");
  assert.match(name2, /^a-[a-z0-9]{4}\.png$/);
  const files = await readdir(path.join(root, "attachments", "2026"));
  assert.equal(files.length, 2);
});

test("exists：文件 true；目录与缺失 false", async () => {
  const { root, adapter } = await tmpRoot();
  const file = path.join(root, "a.md");
  await writeFile(file, "x", "utf8");
  await mkdir(path.join(root, "sub"));
  assert.equal(await adapter.exists(file), true);
  assert.equal(await adapter.exists(path.join(root, "sub")), false);
  assert.equal(await adapter.exists(path.join(root, "nope.md")), false);
});
