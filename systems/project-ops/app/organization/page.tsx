import { FilterableTable } from "@/components/filterable-table";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Pencil, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { OrganizationForms } from "./organization-forms";

export const dynamic = "force-dynamic";
const roleNames: Record<string, string> = { ADMIN: "管理员", FINANCE: "财务", DEPARTMENT_MANAGER: "部门负责人", PROJECT_MEMBER: "项目人员" };

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ q?: string; editDepartment?: string; editUser?: string }> }) {
  const db = getDb(), currentUser = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!currentUser) redirect("/login");
  if (currentUser.role !== "ADMIN") redirect("/");
  const { q = "", editDepartment, editUser } = await searchParams, like = `%${q.trim()}%`;
  const departments = db.prepare(`SELECT d.id,d.name,d.parent_id,d.manager_user_id,p.name parent_name,m.name manager_name,COUNT(u.id) user_count
    FROM departments d LEFT JOIN departments p ON p.id=d.parent_id LEFT JOIN users m ON m.id=d.manager_user_id
    LEFT JOIN users u ON u.department_id=d.id AND u.active=1 GROUP BY d.id ORDER BY d.name`).all() as Record<string, unknown>[];
  const users = db.prepare(`SELECT u.id,u.username,u.name,u.email,u.role,u.department_id,u.active,d.name department_name FROM users u LEFT JOIN departments d ON d.id=u.department_id
    WHERE (?='' OR u.name LIKE ? OR u.username LIKE ? OR COALESCE(u.email,'') LIKE ?) ORDER BY u.active DESC,u.name`)
    .all(q.trim(), like, like, like) as Record<string, unknown>[];
  const allUsers = q ? db.prepare("SELECT u.id,u.username,u.name,u.email,u.role,u.department_id,u.active,d.name department_name FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.active DESC,u.name").all() as Record<string, unknown>[] : users;
  const department = editDepartment ? departments.find(row => row.id === editDepartment) : undefined;
  const user = editUser ? allUsers.find(row => row.id === editUser) : undefined;
  const managers = allUsers.filter(row => row.role === "DEPARTMENT_MANAGER" && Number(row.active));
  return <AppShell active="/organization" eyebrow="部门 · 角色 · 在职状态" title="组织与人员" user={currentUser}
    actions={<form className="search-box"><Search aria-hidden="true" size={17}/><label className="sr-only" htmlFor="organization-search">搜索人员</label><input defaultValue={q} id="organization-search" name="q" placeholder="姓名、账号或邮箱"/></form>}>
    <div className="business-stack">
      <details className="form-disclosure" open={Boolean(department||user)}><summary>{department||user?"编辑组织档案":"新增部门或人员"}</summary><div className="form-disclosure-body"><OrganizationForms department={department && { ...department }} departments={departments.map(row => ({ ...row }))} managers={managers.map(row => ({ ...row }))} user={user && { ...user }}/></div></details>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">部门档案</p><h2>{departments.length} 个部门</h2></div><Link className="text-link" href="/organization">新增部门</Link></div>
        <FilterableTable><table><thead><tr><th>部门 / 上级</th><th>负责人</th><th>在职人数</th><th>操作</th></tr></thead><tbody>{departments.map(row => <tr key={String(row.id)}><td><strong>{String(row.name)}</strong><span>{String(row.parent_name ?? "无上级部门")}</span></td><td>{String(row.manager_name ?? "未指定")}</td><td>{Number(row.user_count)} 人</td><td><div className="row-actions"><Link aria-label={`编辑${row.name}`} href={`/organization?editDepartment=${String(row.id)}`}><Pencil aria-hidden="true" size={15}/></Link></div></td></tr>)}</tbody></table></FilterableTable>
      </section>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">人员档案</p><h2>{users.length} 人</h2></div><Link className="text-link" href="/organization">新增人员</Link></div>
        <FilterableTable><table><thead><tr><th>姓名 / 账号</th><th>邮箱</th><th>角色 / 部门</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map(row => <tr key={String(row.id)}><td><strong>{String(row.name)}</strong><span>{String(row.username)}</span></td><td>{String(row.email ?? "—")}</td><td>{roleNames[String(row.role)] ?? String(row.role)}<span>{String(row.department_name ?? "未分配部门")}</span></td><td><span className={`status ${Number(row.active) ? "partial" : "muted"}`}>{Number(row.active) ? "在职" : "离职 / 停用"}</span></td><td><div className="row-actions"><Link aria-label={`编辑${row.name}`} href={`/organization?editUser=${String(row.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}><Pencil aria-hidden="true" size={15}/></Link></div></td></tr>)}</tbody></table></FilterableTable>
        {!users.length && <p className="empty-state">没有找到符合条件的人员。</p>}
      </section>
    </div>
  </AppShell>;
}
