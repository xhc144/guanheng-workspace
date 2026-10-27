# WP23 声明式迁移交接

入口：`systems/project-ops/lib/migrations/index.ts`，类型直接复用 G0 `extension-contracts.ts`。`applyMigrations(db, readonly Migration[])` 返回 `{applied, skipped}`；执行器内部持有 DatabaseSync，贡献声明只有普通 JSON 数据。

```ts
import { applyMigrations } from "../../lib/migrations/index.ts";
import type { AdditiveOperation, Migration } from "../../lib/migrations/index.ts";
const operations = [
  { kind: "createTable", table: "example_items", columns: [
    { name: "id", type: "TEXT", nullable: false },
    { name: "amount_cents", type: "INTEGER", nullable: false, minimum: 0,
      default: { kind: "value", value: 0 } },
  ], primaryKey: ["id"] },
] as const satisfies readonly AdditiveOperation[];
const id = "example.001";
// 生成时用 migrationChecksum(id, operations) 核算，审阅后冻结；运行时不重算声明值。
const checksum = "fe526efb7a0ac77c1aade4c12920dc152772e3e9ef2bdc0ca70ac94733072122";
const item: Migration = { id, checksum, operations };
// 在本域测试的合成库显式调用；生产注册交 WP24 G1。
applyMigrations(db, [item]);
```

## 校验和与执行语义

- checksum 为 `{id,operations}` 的 canonical JSON UTF-8 SHA-256：对象键按 JS 默认字典序排序，数组保留顺序，无空白；64 位小写十六进制。`migrationChecksum` 先验证完整声明。运行时再次核算，已应用 ID 对应 checksum 或完整 canonical operations 改变均拒绝。新增 id 承担新升级，禁止编辑已发布迁移。
- 只接受 G0 的 `createTable/addColumn/createIndex` 精确键。拒绝函数、访问器、Proxy、循环对象、隐藏键、未知键/操作、SQL/up/exec/prepare/raw、非法标识符、非安全整数、任意默认表达式。TEXT 默认按 SQL 字面量编码；NUL 和不完整 Unicode 拒绝。
- 新表支持 TEXT/INTEGER、nullable、value/currentTimestamp 默认、minimum、oneOf、primaryKey、unique、foreignKeys。addColumn 必须可兼容旧行：nullable 或有效常量默认，不允许 CURRENT_TIMESTAMP。标识符遵守 G0 白名单，不接收 SQL 片段。
- 完整批次先验证、再进入 G0 `inTransaction`；顶层 BEGIN IMMEDIATE、已有事务用 SAVEPOINT。声明严格按数组顺序执行，依赖新列的索引须放在 addColumn 后。失败整批 DDL 和账本一起撤回，原有历史/账本保留；失败后修正未应用声明可重试。
- `schema_migrations` 是内部表，不算业务表；存 id、checksum、canonical operations、applied_at。首次非空成功批次建立，空批次不创建；贡献不能操作或引用它。相同迁移跳过，不检查所有业务数据是否被外部更改。
- 不使用 IF NOT EXISTS 掩盖未登记的表/列/索引冲突，不重建旧表、不修改原 CHECK、不自动改状态/去重。结构冲突或唯一索引碰到历史重复会失败，须由 owner 核对。SQLite 外键必须启用；并发等待策略由连接 owner 决定，runner 不改 PRAGMA 超时或重试业务。
- 新表在整批结束后编译但不执行内部 INSERT，验证父表/父键是否真正可用；不插探针行，允许父表同批后建。缺失父表或父键不唯一会撤回整批，不能把 CREATE TABLE 成功当作外键关系可用。

## 运维与注册边界

`seed.ts --upgrade-only` 与 `upgrade.ts --upgrade-only` 目前只调用已有 G0 schema 兼容升级和空迁移批次，不灌演示。`backup.ts` 生成数据库/附件/清单，`upgrade.ts --restore … --to …` 只恢复新目录；均有中文失败和非零退出码。备份前应停止全部写入，哈希校验用于完整性检查，清单仍应来自可信保管位置。

临时驱动的允许复制输入只有 package.json、pnpm-lock.yaml、pnpm-workspace.yaml 和已安装 pnpm 元数据；源码 lib/scripts 与已安装依赖链接复用。依赖元数据只在临时 node_modules 内复制、重定位项目路径，不改源依赖、store、源配置或安全策略；保留原 lastValidatedTimestamp，pnpm 仍真实比较 manifest/lock，校验失败直接报错，绝不自动安装。源码 data/uploads、.env 和真实库无输入路径。两个驱动可同时运行于不同 mkdtemp 根，结束清理。

WP24 G1 接回申请：导入本 runner，接入公共启动汇总与真实迁移状态；各域的声明路径/id/冻结 checksum 由各域 PR 单独申请。WP23 没有生产领域迁移、页面/API/导航/角色/公共环境变量新增，没有编辑 schema/db/auth/nav/注册表。根尚未放行 G1 或 22 路门；本报告与测试不改变该状态。
