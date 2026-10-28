"""运行冻结源码检查，逐条保存命令、退出码和源码/副本一致性证据。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
BASIC = "systems/pms-suite/基础版"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def binding(ref, backend=None):
    sha = git("rev-parse", ref)
    records = []
    raw = subprocess.check_output(["git", "ls-tree", "-rz", "--name-only", sha,
                                   BASIC, "docs/work-packages/WP-25/verify.py",
                                   "docs/work-packages/WP-25/browser_check.py"], cwd=ROOT)
    paths = [p.decode() for p in raw.split(b"\0") if p and b"/scripts/" not in p]
    for name in paths:
        current = ROOT / name
        expected = subprocess.check_output(["git", "show", f"{sha}:{name}"], cwd=ROOT)
        if not current.is_file() or current.read_bytes() != expected:
            raise RuntimeError(f"冻结源码不匹配：{name}")
        digest = hashlib.sha256(expected).hexdigest()
        record = {"path": name, "sha256": digest}
        prefix = BASIC + "/backend/"
        if backend and name.startswith(prefix):
            copied = Path(backend) / name.removeprefix(prefix)
            if not copied.is_file() or copied.read_bytes() != expected:
                raise RuntimeError(f"执行副本不匹配：{name}")
            record["backend_match"] = True
        records.append(record)
    if not any(p["path"].endswith("test_archive_regressions.py") for p in records):
        raise RuntimeError("冻结提交缺少归档回归")
    return {"source_sha": sha, "source_tree": git("rev-parse", f"{sha}^{{tree}}"),
            "files": records}


def run(label, command, cwd, ref, backend=None, timeout=300, env=None):
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", label):
        raise ValueError("日志标签只能使用字母、数字、下划线和连字符")
    source = binding(ref, backend)
    log = EVIDENCE / f"{label}.log"
    metadata = EVIDENCE / f"{label}-command.json"
    if log.exists() or metadata.exists():
        raise FileExistsError(f"保留已有结果，请使用新标签：{label}")
    record = {"command": command, "cwd": str(Path(cwd).resolve()),
              "started_at": datetime.now(timezone.utc).isoformat(), "binding": source}
    metadata.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    started = time.monotonic()
    try:
        completed = subprocess.run(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, timeout=timeout)
        output, code = completed.stdout, completed.returncode
    except subprocess.TimeoutExpired as error:
        output = error.stdout or b""
        if isinstance(output, bytes):
            output = output.decode(errors="replace")
        output += "\n命令超时；未记为通过。\n"
        code = 124
    # 测试失败的 fixture repr 可能包含临时合成令牌；证据不保留这些值。
    output, count = re.subn(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
                            "[合成令牌已脱敏]", output)
    with log.open("x") as handle:
        handle.write(output)
    record.update(exit_code=code, duration_seconds=round(time.monotonic() - started, 3),
                  finished_at=datetime.now(timezone.utc).isoformat(), redacted_tokens=count,
                  log_sha256=hashlib.sha256(log.read_bytes()).hexdigest())
    try:
        record["binding_after"] = binding(ref, backend)
    except RuntimeError as error:
        record["binding_error"] = str(error)
        record["exit_code"] = code or 125
    metadata.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"label": label, "exit_code": record["exit_code"],
                      "source_sha": source["source_sha"], "log": str(log)}, ensure_ascii=False))
    return record["exit_code"]


def test_environment(backend):
    env = {k: v for k, v in os.environ.items() if k.upper() not in {
        "DATABASE_URL", "SECRET_KEY", "ENVIRONMENT", "DEMO_MODE",
        "VITE_API_BASE_URL", "VITE_API_BASE"}}
    env.update(PYTHONPATH=str(backend), ENVIRONMENT="test")
    return env


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("label")
    parser.add_argument("--cwd", type=Path, required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--backend", type=Path)
    parser.add_argument("--timeout", type=int, default=300)
    argv = sys.argv[1:]
    if "--" not in argv:
        parser.error("需要 -- 后的命令")
    separator = argv.index("--")
    args = parser.parse_args(argv[:separator])
    command = argv[separator + 1:]
    if not command:
        parser.error("需要 -- 后的命令")
    env = test_environment(args.backend) if args.backend else None
    sys.exit(run(args.label, command, args.cwd, args.source_ref, args.backend, args.timeout, env))
