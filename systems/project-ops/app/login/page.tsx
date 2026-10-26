"use client";

import { FormEvent, MouseEvent, useState } from "react";
import { ArrowRight, FolderKanban, LockKeyhole, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [method, setMethod] = useState<"password" | "code">("password");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(withBasePath("/api/auth/login"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(method === "password"
          ? { method, username: form.get("username"), password: form.get("password") }
          : { method, username: form.get("username"), code: form.get("code") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "登录失败");
      router.replace("/"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败"); setLoading(false); }
  }

  async function requestCode(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    const username = form.elements.namedItem("username") as HTMLInputElement | null;
    if (!username?.reportValidity()) return;
    setError(""); setMessage(""); setSending(true);
    try {
      const response = await fetch(withBasePath("/api/auth/request-code"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: new FormData(form).get("username") }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "验证码发送失败");
      setMessage(data.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "验证码发送失败"); }
    finally { setSending(false); }
  }

  return (
    <main className="login-shell">
      <section className="login-intro">
        <div className="login-brand"><span><FolderKanban aria-hidden="true" size={21}/></span><strong>项目经营管理系统</strong></div>
        <div>
          <p className="eyebrow">经营、财务与交付协同</p>
          <h1>让每一份合同、每一笔回款都有据可查。</h1>
          <p>统一管理客户、项目、应收、发票、服务费、提成和研发任务。</p>
        </div>
        <div className="security-note"><ShieldCheck aria-hidden="true" size={20} /><span>财务操作保留完整审计记录</span></div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <div className="login-icon"><LockKeyhole aria-hidden="true" size={22} /></div>
          <h2>登录工作台</h2>
          <p>使用公司分配的账号进入系统</p>
          <div className="login-tabs" role="tablist" aria-label="登录方式"><button aria-selected={method === "password"} onClick={() => { setMethod("password"); setError(""); setMessage(""); }} role="tab" type="button">密码登录</button><button aria-selected={method === "code"} onClick={() => { setMethod("code"); setError(""); setMessage(""); }} role="tab" type="button">验证码登录</button></div>
          <label>用户名或邮箱<input name="username" autoComplete="username" required /></label>
          {method === "password" ? <label>密码<input name="password" type="password" autoComplete="current-password" required /></label> : <label>验证码<span className="code-field"><input aria-label="验证码" autoComplete="one-time-code" inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" placeholder="6 位验证码" required/><button disabled={sending} onClick={requestCode} type="button">{sending ? "发送中…" : "获取验证码"}</button></span></label>}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {message ? <div className="form-success" aria-live="polite">{message}</div> : null}
          <button className="primary-button login-submit" disabled={loading}>
            {loading ? "正在登录…" : "登录"}<ArrowRight aria-hidden="true" size={18} />
          </button>
          <small>{method === "password" ? "首次本地运行请使用 README 中的开发账号，生产环境必须更换初始密码。" : "验证码 10 分钟内有效；账号需先在个人中心绑定邮箱，且系统已配置邮件通道。"}</small>
        </form>
      </section>
    </main>
  );
}
