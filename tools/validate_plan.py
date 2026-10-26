#!/usr/bin/env python3
"""Validate dispatch metadata; never starts tasks, installs, or changes git."""
import json
import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {"id", "title", "branch", "owns", "depends_on", "done_when", "min_minutes"}
SELF_CHECK = "完成标准通过后不要停：继续补边界测试、错误提示、中文文案、375px 布局和文档，直到连续两轮自查都找不到问题；本包至少需要 30 分钟的工作量。"


def reachability(queue):
    """Strict transitive order: ancestor -> descendants."""
    children = {item["id"]: set() for item in queue}
    for item in queue:
        for dep in item["depends_on"]:
            if dep in children:
                children[dep].add(item["id"])
    result = {}
    for ident in children:
        seen, pending = set(), list(children[ident])
        while pending:
            next_id = pending.pop()
            if next_id not in seen:
                seen.add(next_id)
                pending.extend(children[next_id] - seen)
        result[ident] = seen
    return result


def maximum_antichain_size(queue):
    """Dilworth: DAG width = vertices - maximum matching on its transitive order."""
    order = reachability(queue)
    matched_right = {}

    def augment(left, visited):
        for right in sorted(order[left]):
            if right in visited:
                continue
            visited.add(right)
            if right not in matched_right or augment(matched_right[right], visited):
                matched_right[right] = left
                return True
        return False

    size = sum(augment(left, set()) for left in sorted(order))
    return len(queue) - size


def ready_after(queue, completed):
    return [item["id"] for item in queue if item["id"] not in completed and set(item["depends_on"]) <= completed]


def validate():
    queue = json.loads((ROOT / "tasks/queue.json").read_text())
    errors = []
    by_id = {entry["id"]: entry for entry in queue}
    if not 20 <= len(queue) <= 30 or len(by_id) != len(queue):
        errors.append("expected 20–30 unique packages")
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
    frozen = json.loads((ROOT / "tasks/frozen-dispatch.json").read_text())
    if frozen["source_sha"] != "d14f98939429e4f860fd82ac6c48ea4fbf1629a4":
        errors.append("frozen dispatch source changed")
    for entry in frozen["entries"]:
        ident = entry["id"]
        instruction_hash = hashlib.sha256((ROOT / "tasks" / f"{ident}.md").read_bytes()).hexdigest()
        canonical = json.dumps(by_id[ident], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        if instruction_hash != entry["instruction_sha256"] or hashlib.sha256(canonical).hexdigest() != entry["queue_entry_sha256"]:
            errors.append(f"{ident}: already-dispatched instruction or execution contract changed")
    gates = json.loads((ROOT / "tasks/dispatch-gates.json").read_text())
    foundation = set(gates["foundation_ids"])
    if not foundation <= by_id.keys() or any(set(by_id[x]["depends_on"]) - foundation for x in foundation):
        errors.append("foundation is not a dependency-closed existing set")
    ready = ready_after(queue, foundation)
    declared = gates["parallel_candidates"]
    extra = set(gates.get("additional_ready_not_in_wave", []))
    if set(ready) != set(declared) | extra or len(declared) != len(set(declared)):
        errors.append("declared ready set differs from actual dependency-ready set")
    eligible_ready = set(ready) & set(declared)
    if gates["minimum_parallel"] < 20 or len(eligible_ready) < gates["minimum_parallel"]:
        errors.append(f"only {len(eligible_ready)} eligible independent ready packages after foundation; at least 20 required")
    optional_foundation = set(gates.get("optional_foundation_ids", []))
    after_optional = ready_after(queue, foundation | optional_foundation)
    if not set(declared) <= set(after_optional):
        errors.append("parallel wave changes when optional Windows implementation completes")
    order = reachability(queue)
    if any(right in order[left] for left in declared for right in declared if left != right):
        errors.append("parallel candidates contain a real transitive dependency")
    width = maximum_antichain_size(queue)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"PASS: {len(queue)} self-contained packages; no ownership collisions; acyclic dependencies; protected owners unique.")
    for number, wave in enumerate(waves):
        print(f"Wave {number}: {', '.join(wave)}")
    print(f"Maximum antichain: {width}")
    print(f"Independent parallel wave after actual G0/runner/G1 gate: {len(declared)}: {', '.join(declared)}")
    print(f"Optional separately ready package: {', '.join(sorted(extra))}; Windows is a final experience gate, not a dependency of the 22.")
    print("PASS: dispatched WP01/03/18 instructions and full queue entries unchanged.")
    print("WP24 dependency means G0 only; actual WP23 runner + same-owner G1 approval is mandatory before the declared parallel wave.")
    return 0


if __name__ == "__main__":
    raise SystemExit(validate())
