"""总管 AI 的派发器：为队列里的每个工作包开一个 git worktree，并启动一个子 AI。

用法：
    python orchestrator/run.py --repo <仓库路径> --queue tasks/queue.json --max-workers 24

队列长度不限；同时运行的子 AI 数量由 --max-workers 控制，跑完一个补一个。
拆包、复审和合并由总管 AI 自己完成，本脚本只负责并行执行和收集日志。
"""

import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

WORKER_PROMPT = """你是子 AI，负责工作包 {id}：{title}。
工作目录是独立 git worktree，分支 {branch}。只修改这些路径：{owns}。
任务说明：
{brief}

完成标准（全部通过才算完成）：{done_when}

要求：
1. 先读 README、AGENTS.md 和相关代码再动手；不要重新初始化项目、不要升级无关依赖。
2. 完成标准通过后不要停：继续补边界测试、错误处理、中文提示、375px 手机布局和文档，
   直到连续两轮自查都找不到问题。本包预计至少 {min_minutes} 分钟工作量。
3. 每完成一个阶段就 git commit（中文提交信息）。
4. 结束时写 reports/{id}.md：做了什么、改了哪些文件、执行过的命令及结果、遗留问题。
5. 不得写入密码、密钥或真实客户数据；不得部署、推送或删除数据。
6. 启动开发服务器时使用环境变量 WP_PORT 指定的端口。
"""


def build_command(worktree: Path, prompt: str) -> list[str]:
    # 换成 GPT API 或其他 agent CLI 时只需改这里。
    return ["codex", "exec", "--full-auto", "-C", str(worktree), prompt]


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True)


def run_package(repo: Path, wt_root: Path, log_dir: Path, base: str, index: int, wp: dict) -> tuple[str, int, float]:
    worktree = wt_root / wp["id"]
    if not worktree.exists():
        git(repo, "worktree", "add", "-b", wp["branch"], str(worktree), base)
    prompt = WORKER_PROMPT.format(
        id=wp["id"],
        title=wp["title"],
        branch=wp["branch"],
        owns="、".join(wp.get("owns", [])),
        brief=wp["brief"],
        done_when="；".join(wp.get("done_when", [])),
        min_minutes=wp.get("min_minutes", 30),
    )
    env = {**os.environ, "WP_PORT": str(30000 + index)}
    started = time.time()
    with open(log_dir / f"{wp['id']}.log", "w", encoding="utf-8") as log:
        code = subprocess.run(build_command(worktree, prompt), stdout=log, stderr=subprocess.STDOUT, env=env).returncode
    return wp["id"], code, (time.time() - started) / 60


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--queue", required=True, type=Path)
    parser.add_argument("--max-workers", type=int, default=24)
    parser.add_argument("--base", default="HEAD", help="所有工作包共同的起点提交")
    args = parser.parse_args()

    repo = args.repo.resolve()
    queue = json.loads(args.queue.read_text(encoding="utf-8"))
    wt_root = repo.parent / f"{repo.name}-worktrees"
    log_dir = repo / "logs" / "orchestrator"
    wt_root.mkdir(exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    print(f"共 {len(queue)} 个工作包，并发 {args.max_workers}")
    results = []
    with ThreadPoolExecutor(max_workers=args.max_workers) as pool:
        futures = [pool.submit(run_package, repo, wt_root, log_dir, args.base, i, wp) for i, wp in enumerate(queue, 1)]
        for future in as_completed(futures):
            wp_id, code, minutes = future.result()
            flag = "完成" if code == 0 else f"失败({code})"
            short = "  ⚠ 少于30分钟，总管需检查是否提前收工" if minutes < 30 else ""
            print(f"[{wp_id}] {flag}，用时 {minutes:.0f} 分钟{short}")
            results.append({"id": wp_id, "exit_code": code, "minutes": round(minutes, 1)})

    (log_dir / "summary.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if all(r["exit_code"] == 0 for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
