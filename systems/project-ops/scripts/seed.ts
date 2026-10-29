import { resolve } from "node:path";
import { hashPassword } from "../lib/auth.ts";
import { inTransaction, openDatabase } from "../lib/db.ts";
import { safeComponent, workspaceDatabase } from "../lib/migrations/backup.ts";
import { upgradeWorkspace } from "./upgrade.ts";

function seedDemo() {
  const filename = process.env.DATABASE_FILENAME ?? "demo.db";
  safeComponent(filename);
  if (filename.toLowerCase() === "app.db" || process.env.NODE_ENV === "production") throw new Error("拒绝向正式库或生产环境写入演示数据，请使用 --upgrade-only");
  const db = openDatabase(workspaceDatabase(process.cwd(), filename));
  try {
    inTransaction(db, () => {
      const departmentIds = { delivery: "dept-delivery", finance: "dept-finance", development: "dept-development" };
      for (const [id, name] of [
        [departmentIds.delivery, "项目交付部"], [departmentIds.finance, "财务部"], [departmentIds.development, "研发部"],
      ] as const) db.prepare("INSERT OR IGNORE INTO departments (id, name) VALUES (?, ?)").run(id, name);

      const users = [
        ["user-admin", "admin", "系统管理员", "admin@example.com", "ADMIN", departmentIds.finance],
        ["user-finance", "finance", "刘会计", "finance@example.com", "FINANCE", departmentIds.finance],
        ["user-manager", "manager", "王珂", "manager@example.com", "DEPARTMENT_MANAGER", departmentIds.delivery],
        ["user-member", "member", "李敏", "member@example.com", "PROJECT_MEMBER", departmentIds.delivery],
      ] as const;
      const defaultPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "Admin@123456";
      for (const [id, username, name, email, role, departmentId] of users) {
        db.prepare(`INSERT OR IGNORE INTO users
          (id, username, name, email, password_hash, role, department_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, username, name, email, hashPassword(defaultPassword), role, departmentId);
      }

      db.prepare("UPDATE departments SET manager_user_id = ? WHERE id = ? AND manager_user_id IS NULL").run("user-manager", departmentIds.delivery);

      const customerId = "customer-ruida";
      db.prepare(`INSERT OR IGNORE INTO customers
        (id, name, short_name, contact_name, phone, address, bank_name, bank_account, invoice_title, tax_id, owner_user_id, department_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(customerId, "安徽睿达科技有限公司", "睿达科技", "张经理", "13800000000", "合肥市高新区",
          "中国建设银行合肥分行", "6217000000000000000", "安徽睿达科技有限公司", "91340100DEMO00001",
          "user-manager", departmentIds.delivery);

      const contractId = "contract-ruida-2026";
      db.prepare(`INSERT OR IGNORE INTO contracts
        (id, number, name, customer_id, signed_date, amount_cents, status, description)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`)
        .run(contractId, "HT-2026-001", "数字化经营平台建设合同", customerId, "2026-01-15", 1_280_000_00, "年度重点项目");

      const projectId = "project-ruida-platform";
      db.prepare(`INSERT OR IGNORE INTO projects
        (id, name, customer_id, manager_user_id, department_id, start_date, planned_end_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`)
        .run(projectId, "数字化经营平台", customerId, "user-manager", departmentIds.delivery, "2026-02-01", "2026-10-31");
      db.prepare("INSERT OR IGNORE INTO contract_projects (contract_id, project_id) VALUES (?, ?)").run(contractId, projectId);
      db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, duty, commission_basis_points) VALUES (?, ?, ?, ?)")
        .run(projectId, "user-member", "实施顾问", 300);

      for (const [id, name, category, amount, due] of [
        ["recv-ruida-first", "首期款", "首期款", 384_000_00, "2026-02-15"],
        ["recv-ruida-blueprint", "蓝图款", "蓝图款", 256_000_00, "2026-04-30"],
        ["recv-ruida-implementation", "实施款", "实施款", 384_000_00, "2026-08-30"],
        ["recv-ruida-acceptance", "验收款", "验收款", 256_000_00, "2026-11-15"],
      ] as const) {
        db.prepare(`INSERT OR IGNORE INTO receivables
          (id, contract_id, project_id, name, category, amount_cents, due_date, owner_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, contractId, projectId, name, category, amount, due, "user-manager");
      }

      db.prepare(`INSERT OR IGNORE INTO receivables
        (id, contract_id, project_id, name, category, amount_cents, due_date, owner_user_id)
        VALUES ('recv-ruida-service-2026', ?, ?, '2026年度服务费', '服务费', 12000000, '2026-09-01', 'user-manager')`)
        .run(contractId, projectId);
      db.prepare(`INSERT OR IGNORE INTO service_periods
        (id, project_id, start_date, end_date, amount_cents, owner_user_id, receivable_id, status)
        VALUES ('service-ruida-2026', ?, '2026-09-01', '2027-08-31', 12000000, 'user-manager', 'recv-ruida-service-2026', 'PLANNED')`)
        .run(projectId);

      db.prepare(`INSERT OR IGNORE INTO work_items
        (id, type, title, description, customer_id, project_id, reporter_user_id, assignee_user_id, priority, status, planned_end, estimated_minutes)
        VALUES (?, 'REQUIREMENT', ?, ?, ?, ?, ?, ?, 'HIGH', 'IN_PROGRESS', ?, ?)`)
        .run("work-ruida-report", "经营分析报表优化", "增加按部门和项目经理筛选", customerId, projectId,
          "user-manager", "user-member", "2026-09-05", 960);
    });
    console.log("演示数据初始化完成（可重复执行）。账号：admin、finance、manager、member；密码不会输出到日志。");
    console.log(JSON.stringify({ mode: "demo", cwd: process.cwd(), dataRoot: resolve("data"), database: resolve("data", filename) }));
  } finally { db.close(); }
}

try {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  if (args.length === 1 && args[0] === "--upgrade-only") {
    const result = upgradeWorkspace(process.cwd(), process.env.DATABASE_FILENAME ?? "app.db");
    console.log("结构升级完成，未写入演示数据；领域迁移注册待 WP24 G1");
    console.log(JSON.stringify(result));
  } else {
    if (args.length) throw new Error("仅支持 --upgrade-only 参数");
    seedDemo();
  }
} catch (error) {
  console.error(`初始化失败：${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
}
