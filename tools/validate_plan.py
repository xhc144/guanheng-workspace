#!/usr/bin/env python3
"""Validate dispatch metadata; never starts tasks, installs, or changes git."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {"id", "title", "branch", "owns", "depends_on", "done_when", "min_minutes"}
SELF_CHECK = "完成标准通过后不要停：继续补边界测试、错误提示、中文文案、375px 布局和文档，直到连续两轮自查都找不到问题；本包至少需要 30 分钟的工作量。"


def validate():
    queue = json.loads((ROOT / "tasks/queue.json").read_text())
    errors = []
    by_id = {entry["id"]: entry for entry in queue}
    if len(queue) != 25 or len(by_id) != 25:
        errors.append("expected 25 unique packages")
    if len({e["branch"] for e in queue}) != len(queue):
        errors.append("duplicate branches")
    for entry in queue:
        ident = entry["id"]
        if REQUIRED - entry.keys():
            errors.append(f"{ident}: missing required fields")
        if entry["min_minutes"] < 30 or not 30 <= entry["estimated_minutes"] <= 120:
            errors.append(f"{ident}: invalid scope estimate")
        if not entry["owns"]:
            errors.append(f"{ident}: no owned paths")
        for path in entry["owns"]:
            if path.startswith("/") or ".." in Path(path).parts or "*" in path:
                errors.append(f"{ident}: ambiguous/unsafe path {path}")
        for dep in entry["depends_on"]:
            if dep not in by_id or dep == ident:
                errors.append(f"{ident}: unknown/self dependency {dep}")
        document = (ROOT / "tasks" / f"{ident}.md").read_text()
        for token in [ident, entry["branch"], SELF_CHECK, "## 最低真实断言", "## done_when", "reports/" + ident + ".md"]:
            if token not in document:
                errors.append(f"{ident}: missing self-contained requirement {token}")
        for path in entry["owns"]:
            if f"`{path}`" not in document:
                errors.append(f"{ident}: task/queue ownership differs for {path}")
        for command in entry["done_when"][:-2]:
            if command not in document:
                errors.append(f"{ident}: task/queue command mismatch")
    for index, left in enumerate(queue):
        for right in queue[index + 1:]:
            for a in left["owns"]:
                for b in right["owns"]:
                    if a == b or (a.endswith("/") and b.startswith(a)) or (b.endswith("/") and a.startswith(b)):
                        errors.append(f"ownership collision {left['id']}:{a} / {right['id']}:{b}")
    completed = set()
    waves = []
    while len(completed) < len(queue):
        ready = [entry["id"] for entry in queue if entry["id"] not in completed and set(entry["depends_on"]) <= completed]
        if not ready:
            errors.append("dependency graph contains cycle")
            break
        waves.append(ready)
        completed.update(ready)
    locked = {
        "systems/project-ops/package.json": "WP-01",
        "systems/project-ops/pnpm-lock.yaml": "WP-01",
        "systems/project-ops/lib/schema.ts": "WP-24",
        "systems/project-ops/lib/db.ts": "WP-24",
        "systems/project-ops/components/app-shell.tsx": "WP-24",
        "systems/project-ops/lib/permissions.ts": "WP-24",
        "systems/project-ops/lib/audit.ts": "WP-24",
        "systems/project-ops/lib/migrations/": "WP-23",
        ".github/workflows/": "WP-06",
        "docs/待确认问题.md": "WP-05",
    }
    for path, owner in locked.items():
        owners = [entry["id"] for entry in queue if any(x == path or (x.endswith("/") and path.startswith(x)) for x in entry["owns"])]
        if owners != [owner]:
            errors.append(f"{path}: expected only {owner}, got {owners}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("PASS: 25 self-contained packages; no ownership collisions; acyclic dependencies; protected owners unique.")
    for number, wave in enumerate(waves):
        print(f"Wave {number}: {', '.join(wave)}")
    print("WP24 dependency means G0 only; WP23 runner registration is an explicit manual gate before new-schema packages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(validate())
