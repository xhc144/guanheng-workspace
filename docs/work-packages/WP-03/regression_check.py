"""使用同一已安装依赖，比较指定基线与工作副本的完整 PMS 回归。"""
import argparse
from pathlib import Path
import shutil
import subprocess

from verify import EDITIONS, ROOT, run

BASE = 'd14f98939429e4f860fd82ac6c48ea4fbf1629a4'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('edition', choices=EDITIONS)
    parser.add_argument('revision', choices=['baseline', 'current'])
    parser.add_argument('--run-name', default='original')
    args = parser.parse_args()
    prefix = f'systems/pms-suite/{EDITIONS[args.edition]}/backend'
    destination = Path(f'/tmp/guanheng-WP-03-regression/{args.run_name}/{args.revision}/{args.edition}/backend')
    if destination.exists():
        raise SystemExit('临时回归副本已存在，拒绝覆盖')
    if args.revision == 'current':
        shutil.copytree(ROOT / prefix, destination, ignore=shutil.ignore_patterns(
            '.env*', '.demo', '*.db*', '.venv', '__pycache__', '.pytest_cache', 'logs', 'storage'))
    else:
        paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', '-z', BASE, prefix], cwd=ROOT).decode().split('\0')
        for path in filter(None, paths):
            relative = Path(path).relative_to(prefix)
            if relative.name.startswith('.env') or relative.suffix == '.db':
                continue
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(subprocess.check_output(['git', 'show', f'{BASE}:{path}'], cwd=ROOT))
    python = f'/tmp/guanheng-WP-03-{args.edition}/venv/bin/python'
    raise SystemExit(run(f'PYTHONPATH=. {python} -m pytest', destination,
                         f'{args.run_name}-{args.edition}-full-{args.revision}',
                         edition=args.edition, backend=destination,
                         backend_revision=BASE if args.revision == 'baseline' else None))


if __name__ == '__main__':
    main()
