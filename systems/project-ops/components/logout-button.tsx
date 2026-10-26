"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
    router.replace("/login"); router.refresh();
  }
  return <button className="icon-button" aria-label="退出登录" title="退出登录" disabled={busy} onClick={logout}><LogOut aria-hidden="true" size={17}/></button>;
}
