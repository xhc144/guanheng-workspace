"""Read-only provenance and ownership review. No database or environment files."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BASE = "44b05e5e3e6917bc60041d29657e67cc37a5c551"
AUTHOR = "65146233002cb1a279a5a79fe4905c7549cdea8d"
CATALOG = "systems/project-ops/lib/capabilities/catalog.json"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


catalog = json.loads((ROOT / CATALOG).read_text())
old = json.loads(git("show", f"{AUTHOR}:{CATALOG}"))
key = lambda item: (item["system"], item["kind"], item["method"], item["route"])
before = {key(item): item for item in old["entries"]}
after = {key(item): item for item in catalog["entries"]}
assert len(before) == len(after) == 409
assert before.keys() == after.keys()
changed = []
for identity, entry in before.items():
    fields = [field for field in entry if entry[field] != after[identity][field]]
    if fields:
        changed.append(dict(identity=identity, fields=fields))
assert {item["identity"][-1] for item in changed} == {"/capabilities", "/runtime-health"}
assert all(item["fields"] == ["sha256"] for item in changed)
assert (ROOT / "tools/capability-inventory/mapping.json").read_bytes() == git(
    "show", f"{AUTHOR}:tools/capability-inventory/mapping.json"
)
assert catalog["sourceBase"] == BASE
assert catalog["sourceDigest"] == sha(canonical(catalog["entries"]))
assert catalog["sourceFilesDigest"] == sha(canonical(catalog["sourceFiles"]))
files = {item["path"]: item["sha256"] for item in catalog["sourceFiles"]}
assert len(files) == len(catalog["sourceFiles"])
assert list(files) == sorted(files)
for path, fingerprint in files.items():
    assert sha((ROOT / path).read_bytes()) == fingerprint, path
for entry in catalog["entries"]:
    assert entry["runtimeStatus"] == "未逐项运行"
    assert entry["decision"] != "舍弃"
    assert files[entry["path"]] == entry["sha256"]
    for path in entry["primarySources"] + entry["relatedTests"]:
        assert path in files, path
    for reference in entry["referenceTests"]:
        assert files[reference["path"]] == reference["sha256"]

runtime = {}
for path in ["systems/project-ops/lib/runtime-health.ts",
             "systems/project-ops/app/runtime-health/page.tsx",
             "systems/project-ops/tests/runtime-health.test.ts"]:
    previous = sha(git("show", f"{AUTHOR}:{path}"))
    current = sha(git("show", f"{BASE}:{path}"))
    assert files[path] == current
    assert previous != current, path
    runtime[path] = dict(previousSha256=previous, currentSha256=current,
                         matchesIntegration=True)

for ancestor in [BASE, AUTHOR]:
    subprocess.run(["git", "merge-base", "--is-ancestor", ancestor, "HEAD"],
                   cwd=ROOT, check=True)
queue = json.loads((ROOT / "tasks/queue.json").read_text())
owns = next(package["owns"] for package in queue if package["id"] == "WP-04")
paths = set(git("diff", "--name-only", "-z", BASE).decode().strip("\0").split("\0"))
paths.update(git("ls-files", "--others", "--exclude-standard", "-z").decode().strip("\0").split("\0"))
paths.discard("")
violations = [path for path in paths if not any(
    path.startswith(owned) if owned.endswith("/") else path == owned for owned in owns)]
assert not violations, violations
for path in paths:
    if (ROOT / path).is_file():
        assert b"\0" not in (ROOT / path).read_bytes(), f"binary: {path}"
subprocess.run(["git", "diff", "--check"], cwd=ROOT, check=True)
print(json.dumps(dict(
    status="passed", head=git("rev-parse", "HEAD").decode().strip(),
    tree=git("rev-parse", "HEAD^{tree}").decode().strip(), base=BASE, author=AUTHOR,
    oldEntries=len(before), newEntries=len(after), changedOriginalEntries=changed,
    businessDecisionsUnchanged=True, mappingByteIdentical=True,
    sourceDigest=catalog["sourceDigest"], sourceFiles=len(files),
    sourceFilesDigest=catalog["sourceFilesDigest"], runtimeHealth=runtime,
    outsideOwnedPaths=violations, changedAndUntrackedPaths=sorted(paths),
    limits="源码指纹/祖先/所有权检查；不证明业务、CI、G1、Windows或生产验收"),
    ensure_ascii=False, indent=2))
