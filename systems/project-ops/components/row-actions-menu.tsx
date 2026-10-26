import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function RowActionsMenu({ children, label = "更多操作" }: { children: ReactNode; label?: string }) {
  return <details className="row-editor">
    <summary aria-label={label}><MoreHorizontal aria-hidden="true" size={16}/><span className="sr-only">{label}</span></summary>
    <div className="row-editor-popover">{children}</div>
  </details>;
}
