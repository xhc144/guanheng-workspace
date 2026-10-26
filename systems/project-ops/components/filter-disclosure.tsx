import type { ReactNode } from "react";

export function FilterDisclosure({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <details className="filter-disclosure" open={active}>
      <summary>筛选与排序{active ? " · 已应用" : ""}</summary>
      {children}
    </details>
  );
}
