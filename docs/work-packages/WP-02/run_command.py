"""Record actual commands without collecting the process environment."""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/work-packages/WP-02/evidence'

def manifest():
    names = subprocess.check_output(['git', 'ls-files', '-z', 'systems/pms-suite'], cwd=ROOT, text=True).strip('\0').split('\0')
    names += ['systems/pms-suite/tests/bootstrap.Tests.ps1']
    names += [str(p.relative_to(ROOT)) for p in (ROOT/'docs/work-packages/WP-02').glob('*.py')]
    return {n: hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in sorted(set(names)) if (ROOT/n).is_file()}

def run(name, command, cwd=ROOT, timeout=600):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    start = dt.datetime.now(dt.timezone.utc).isoformat()
    before = manifest()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    try:
        result = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        code, output = result.returncode, result.stdout.decode('utf-8', errors='replace')
    except FileNotFoundError as exc:
        code, output = 127, str(exc)
    except subprocess.TimeoutExpired as exc:
        code, output = 124, (exc.stdout or b'').decode('utf-8', errors='replace') + '\nTIMEOUT'
    # Registry messages may contain authenticated URLs. Never publish URL credentials.
    output = re.sub(r'(https?://)[^\s/@]+:[^\s/@]+@', r'\1[REDACTED]@', output)
    row = dict(command=command, cwd=str(cwd), start=start, end=dt.datetime.now(dt.timezone.utc).isoformat(), exit_code=code, head=head, before=before, after=manifest())
    (EVIDENCE/f'{name}.log').write_text(json.dumps(row, ensure_ascii=False)+'\n'+output, encoding='utf-8')
    (EVIDENCE/f'{name}.json').write_text(json.dumps(row, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k:v for k,v in row.items() if k not in ('before','after')}, ensure_ascii=False))
    print(output[-3500:])
    return code

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', required=True)
    parser.add_argument('--cwd', type=pathlib.Path, default=ROOT)
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    raise SystemExit(run(args.name, command, args.cwd, args.timeout))
