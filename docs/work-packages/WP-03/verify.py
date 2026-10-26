"""按 WP-03 原始验收命令运行，并保存每条命令的完整文本证据。"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

from source_binding import verify_backend, verify_source

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent / 'evidence'
EDITIONS = {'basic': '基础版', 'deepseek': 'DeepSeek版', 'kimi': 'Kimi版'}


def run(command, cwd, name, env=None, *, edition=None, backend=None, backend_revision=None):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    before = verify_source()
    if backend is not None and Path(backend).exists():
        before['executed_backend'] = verify_backend(Path(backend), edition, backend_revision)
    start = datetime.now(timezone.utc).isoformat()
    result = subprocess.run(command, cwd=cwd, shell=True, executable='/bin/bash',
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    end = datetime.now(timezone.utc).isoformat()
    binding_error = None
    try:
        after = verify_source()
        if backend is not None and Path(backend).exists():
            after['executed_backend'] = verify_backend(Path(backend), edition, backend_revision)
    except RuntimeError as error:
        binding_error = str(error)
        after = {'binding_error': binding_error}
    record = {'cwd': str(cwd), 'command': command, 'start': start, 'end': end,
              'exit_code': result.returncode, 'source_binding_before': before, 'source_binding_after': after}
    target = EVIDENCE / f'{name}.log'
    attempt = 1
    while target.exists():
        attempt += 1
        target = EVIDENCE / f'{name}-attempt-{attempt}.log'
    target.write_text(json.dumps(record, ensure_ascii=False) + '\n' + result.stdout)
    print(json.dumps(record, ensure_ascii=False), flush=True)
    print(result.stdout[-2500:], flush=True)
    if binding_error:
        raise RuntimeError(binding_error)
    return result.returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['prepare', 'test', 'frontend'])
    parser.add_argument('edition', choices=EDITIONS)
    args = parser.parse_args()
    edition = EDITIONS[args.edition]
    temporary = Path(f'/tmp/guanheng-WP-03-{args.edition}')
    backend = temporary / 'backend'
    python = temporary / 'venv/bin/python'
    if args.stage == 'prepare':
        source = f'systems/pms-suite/{edition}/backend'
        copy = f'python3 -c \'import shutil; shutil.copytree("{source}", "{backend}", ignore=shutil.ignore_patterns(".venv", "__pycache__", ".demo", ".pytest_cache", ".env*"))\''
        commands = [(copy, ROOT), (f'python3 -m venv {temporary}/venv', ROOT),
                    (f'{python} -m pip install -r requirements.txt', backend)]
    elif args.stage == 'frontend':
        cwd = ROOT / 'systems/pms-suite' / edition / 'frontend'
        commands = [('npm ci', cwd), ('npm run build', cwd)]
    else:
        tests = 'tests/test_auth_config.py'
        if args.edition == 'basic':
            tests += ' tests/test_login_flow.py'
        if args.edition == 'kimi':
            tests += ' tests/test_auth_smoke.py'
        commands = [(f'PYTHONPATH=. {python} -m pytest {tests}', backend)]
    for index, (command, cwd) in enumerate(commands):
        code = run(command, cwd, f'p2-{args.edition}-{args.stage}-{index + 1}',
                   edition=args.edition, backend=backend if args.stage != 'frontend' else None)
        if code:
            raise SystemExit(code)


if __name__ == '__main__':
    main()
