import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { isEmailDeliveryConfigured } from "@/lib/notifications.ts";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";
const roleNames: Record<string, string> = { ADMIN: "管理员", FINANCE: "财务", DEPARTMENT_MANAGER: "部门负责人", PROJECT_MEMBER: "项目人员" };

export default async function ProfilePage() {
  const db = getDb(), user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  const department = user.departmentId ? db.prepare("SELECT name FROM departments WHERE id=?").get(user.departmentId) as { name: string } | undefined : undefined;
  return <AppShell active="/profile" eyebrow="账号与联系资料" title="个人中心" user={user}><div className="profile-layout"><section className="profile-summary"><p className="eyebrow">当前账号</p><h2>{user.name}</h2><dl><div><dt>登录账号</dt><dd>{user.username}</dd></div><div><dt>角色</dt><dd>{roleNames[user.role]}</dd></div><div><dt>部门</dt><dd>{department?.name ?? "未分配部门"}</dd></div><div><dt>验证码登录</dt><dd>{user.email && isEmailDeliveryConfigured() ? "可用" : "待配置"}</dd></div></dl></section><ProfileForm codeLoginAvailable={Boolean(user.email && isEmailDeliveryConfigured())} email={user.email ?? ""} name={user.name}/></div></AppShell>;
}
