"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export function EditFeedback() {
  const query = useSearchParams().toString();

  useEffect(() => {
    const editing = [...new URLSearchParams(query).entries()].some(([key, value]) => key.startsWith("edit") && Boolean(value));
    const target = editing ? document.querySelector<HTMLElement>("details.form-disclosure[open]") : null;
    if (!target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.tabIndex = -1;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
    const toast = document.createElement("div");
    toast.className = "edit-ready-toast";
    toast.role = "status";
    toast.textContent = "已进入编辑模式，编辑表单已展开。";
    document.body.append(toast);
    const timeout = window.setTimeout(() => toast.remove(), 4500);
    return () => { window.clearTimeout(timeout); toast.remove(); };
  }, [query]);

  return null;
}
