import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import catalog from "../lib/capabilities/catalog.ts";

const generator = new URL("../../../tools/capability-inventory/generate.mjs", import.meta.url);
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "guanheng-catalog-shards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, "original.json");
  writeFileSync(input, JSON.stringify(catalog));
  const run = (body: string) => spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {catalogArtifacts,checkCatalogArtifacts,writeCatalogArtifacts} from ${JSON.stringify(generator.href)};
    import {existsSync,readFileSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
    import {join} from 'node:path';
    import {createHash} from 'node:crypto';
    const root=process.argv[2],catalog=JSON.parse(readFileSync(process.argv[1],'utf8'));
    const directory=join(root,'systems/project-ops/lib/capabilities/catalog');
    const indexPath=join(directory,'index.json');
    ${body}
  `, input, root], { encoding: "utf8", timeout: 30000 });
  const initialized = run("writeCatalogArtifacts(root,catalog);checkCatalogArtifacts(root,catalog);");
  assert.equal(initialized.status, 0, initialized.stderr);
  return { root, run };
}

test("分片聚合与build/stdout完整对象逐字段逐顺序等价，所有JSON小于256000字节", t => {
  const f = fixture(t), output = join(f.root, "stdout.json"), fd = openSync(output, "w");
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(generator), "--stdout"], {
      encoding: "utf8", timeout: 30000, stdio: ["ignore", fd, "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
  } finally { closeSync(fd); }
  const raw = readFileSync(output, "utf8");
  assert.deepEqual(JSON.parse(raw), catalog);
  assert.equal(raw, JSON.stringify(catalog) + "\n");
  assert.equal(catalog.entries.length, 409);
  const result = f.run(`
    const index=JSON.parse(readFileSync(indexPath,'utf8'));
    const entries=index.chunks.flatMap(chunk=>JSON.parse(readFileSync(join(directory,chunk.file),'utf8')));
    console.log(JSON.stringify({equal:JSON.stringify({...index.metadata,entries})===JSON.stringify(catalog),
      counts:index.chunks.map(chunk=>chunk.count),sizes:readdirSync(directory).map(file=>Buffer.byteLength(readFileSync(join(directory,file))))}));
  `);
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.equal, true);
  assert.deepEqual(proof.counts, [54, 57, 74, 121, 103]);
  assert.ok(proof.sizes.every((bytes: number) => bytes <= 256000));
});

const mutations = [
  ["缺片", "unlinkSync(join(directory,'entries-000.json'));"],
  ["多片", "writeFileSync(join(directory,'entries-999.json'),'[]\\n');"],
  ["改片", `const path=join(directory,'entries-000.json'),part=JSON.parse(readFileSync(path,'utf8'));part[0].route+='-tampered';writeFileSync(path,JSON.stringify(part)+'\\n');`],
  ["伪造同步索引", `
    const index=JSON.parse(readFileSync(indexPath,'utf8')),chunk=index.chunks[0],path=join(directory,chunk.file);
    const part=JSON.parse(readFileSync(path,'utf8'));part[0].owner='伪造owner';const content=JSON.stringify(part)+'\\n';writeFileSync(path,content);
    chunk.bytes=Buffer.byteLength(content);chunk.sha256=createHash('sha256').update(content).digest('hex');
    index.metadata.sourceDigest=createHash('sha256').update(JSON.stringify(index.chunks.flatMap(chunk=>JSON.parse(readFileSync(join(directory,chunk.file),'utf8'))))).digest('hex');
    writeFileSync(indexPath,JSON.stringify(index)+'\\n');
  `],
  ["记录乱序", `const path=join(directory,'entries-000.json'),part=JSON.parse(readFileSync(path,'utf8'));part.reverse();writeFileSync(path,JSON.stringify(part)+'\\n');`],
  ["索引乱序", `const index=JSON.parse(readFileSync(indexPath,'utf8'));index.chunks.reverse();writeFileSync(indexPath,JSON.stringify(index)+'\\n');`],
  ["聚合入口篡改", `const path=join(root,'systems/project-ops/lib/capabilities/catalog.ts');writeFileSync(path,readFileSync(path,'utf8').replace('...part0, ...part1','...part1, ...part0'));`],
  ["Markdown篡改", "writeFileSync(join(root,'docs/功能对照.md'),'伪造文档');"],
  ["旧单体残留", "writeFileSync(join(root,'systems/project-ops/lib/capabilities/catalog.json'),'{}');"],
];
for (const [name, mutation] of mutations) {
  test(`分片检查拒绝${name}，隔离失败不改变生产目录`, t => {
    const f = fixture(t);
    const result = f.run(mutation + "console.log('mutation-ready');checkCatalogArtifacts(root,catalog);");
    assert.equal(result.stdout, "mutation-ready\n", "失败必须来自目录检查，不能来自注入脚本错误");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /能力目录/);
    const clean = f.run("writeCatalogArtifacts(root,catalog);checkCatalogArtifacts(root,catalog);");
    if (name === "多片") assert.equal(clean.status, 1, "生成器不能静默删除未审查的多片");
    else assert.equal(clean.status, 0, clean.stderr);
  });
}

test("单条记录超过256000字节时拒绝生成，不丢字段或截断", t => {
  const f = fixture(t);
  const result = f.run(`catalog.entries[0].rationale='中'.repeat(100000);catalogArtifacts(catalog);`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /单条能力记录超过256000字节/);
  const unchanged = f.run("checkCatalogArtifacts(root,catalog);");
  assert.equal(unchanged.status, 0, unchanged.stderr);
});
