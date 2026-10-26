import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Archive, BadgeDollarSign, BarChart3, Bell, BriefcaseBusiness, Building2, Code2, FileSpreadsheet, FolderKanban, HandCoins, LayoutDashboard, ScrollText, Search, ShieldCheck, SlidersHorizontal, UserRound, UsersRound, WalletCards } from "lucide-react";
import type { SessionUser } from "@/lib/auth.ts";
import { LogoutButton } from "@/components/logout-button";
import { ResizableTables } from "@/components/filterable-table";
import { EditFeedback } from "@/components/edit-feedback";

const nav = [
  { href: "/", label: "经营总览", icon: LayoutDashboard },
  { href: "/search", label: "全局搜索", icon: Search },
  { href: "/customers", label: "客户档案", icon: Building2 },
  { href: "/contracts", label: "合同与应收", icon: BriefcaseBusiness },
  { href: "/projects", label: "项目档案", icon: FolderKanban },
  { href: "/finance", label: "发票与回款", icon: WalletCards },
  { href: "/services", label: "年度服务费", icon: HandCoins },
  { href: "/commissions", label: "提成管理", icon: BadgeDollarSign },
  { href: "/work", label: "研发管理", icon: Code2 },
  { href: "/rules", label: "业务规则", icon: SlidersHorizontal },
  { href: "/notifications", label: "通知中心", icon: Bell },
  { href: "/documents", label: "档案中心", icon: Archive },
  { href: "/data", label: "导入与导出", icon: FileSpreadsheet },
  { href: "/reports", label: "组合报表", icon: BarChart3 },
  { href: "/organization", label: "组织与人员", icon: UsersRound, adminOnly: true },
  { href: "/audit", label: "审计日志", icon: ScrollText, adminOnly: true },
];

export function AppShell({ user, active, title, eyebrow, actions, children }: {
  user: SessionUser;
  active: string;
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const visibleNav = nav.filter(item=>!item.adminOnly||user.role==="ADMIN");
  const activeLabel = visibleNav.find(item=>item.href===active)?.label ?? "功能导航";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark"><FolderKanban aria-hidden="true" size={20} /></span>
          <span><strong>项目经营管理</strong><span>经营与交付中枢</span></span>
        </Link>
        <nav aria-label="主要导航" className="desktop-nav">
          {visibleNav.map(({ href, label, icon: Icon }) => (
            <Link aria-current={active === href ? "page" : undefined} className={active === href ? "nav-item active" : "nav-item"} href={href} key={href}>
              <Icon aria-hidden="true" size={18} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <details className="mobile-nav">
          <summary>菜单 · {activeLabel}</summary>
          <nav aria-label="移动端主要导航">
            {visibleNav.map(({ href, label, icon: Icon }) => (
              <Link aria-current={active === href ? "page" : undefined} className={active === href ? "nav-item active" : "nav-item"} href={href} key={href}>
                <Icon aria-hidden="true" size={18} /><span>{label}</span>
              </Link>
            ))}
          </nav>
        </details>
        <div className="sidebar-footer">
          <ShieldCheck size={18} aria-hidden="true" />
          <span><strong>财务数据已保护</strong><span>所有操作保留审计记录</span></span>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div><p className="eyebrow">{eyebrow ?? "经营与交付中枢"}</p><h1>{title}</h1></div>
          <div className="top-actions">{actions}<Link className="profile-link" href="/profile" title={user.name}><UserRound aria-hidden="true" size={16}/><span>{user.name}</span></Link><LogoutButton /></div>
        </header>
        <ResizableTables>{children}</ResizableTables>
        <Suspense fallback={null}><EditFeedback /></Suspense>
      </main>
    </div>
  );
}
