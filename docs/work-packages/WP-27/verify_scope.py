"""Check WP-27's delegated ownership without changing shared files or refs."""
import ast
import json
from pathlib import Path
import subprocess

BASE = '52714fa8acce62fbfef67c1ba218e1bc2b269e1c'
ROOT = Path(__file__).resolve().parents[3]
PREFIX = 'systems/pms-suite/DeepSeek版/'
ALLOWED = (PREFIX, 'docs/work-packages/WP-27/')
PROTECTED_NAMES = {'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
                   'requirements.txt', 'pyproject.toml', 'setup.ps1', 'start.bat', 'reset-demo.ps1'}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


changed = set(git('diff', '--name-only', '-z', BASE).decode().rstrip('\0').split('\0'))
changed.update(git('ls-files', '--others', '--exclude-standard', '-z').decode().rstrip('\0').split('\0'))
changed.discard('')
unauthorized = [p for p in sorted(changed) if not (p.startswith(ALLOWED) or p == 'reports/WP-27.md')]
protected = [p for p in sorted(changed) if p.startswith(PREFIX) and (Path(p).name in PROTECTED_NAMES or '/.env' in p)]
deleted = git('diff', '--name-only', '--diff-filter=D', BASE).decode().splitlines()
assert not unauthorized, unauthorized
assert not protected, protected
assert not deleted, deleted

# Global roles/configuration stay frozen. The root follow-up explicitly permits
# reconnecting existing action permissions and project ownership in owned routes.
for path in ['backend/app/auth.py', 'backend/app/config.py', 'backend/app/main.py',
             'backend/app/seeder.py', 'backend/app/routes/portal.py']:
    assert (ROOT / PREFIX / path).read_bytes() == git('show', f'{BASE}:{PREFIX}{path}'), path
finance_path = PREFIX + 'backend/app/routes/finance.py'


def permissions(source):
    result = {}
    for node in ast.parse(source).body:
        if not isinstance(node, ast.FunctionDef) or not node.decorator_list:
            continue
        defaults = dict(zip([arg.arg for arg in node.args.args][-len(node.args.defaults):], node.args.defaults))
        if 'current_user' in defaults:
            result[node.name] = ast.dump(defaults['current_user'], include_attributes=False)
    return result


expected = permissions(git('show', f'{BASE}:{finance_path}').decode())
expected['finance_write_off_receipt'] = ast.dump(
    ast.parse('Depends(require_role("finance"))', mode='eval').body, include_attributes=False,
)
assert permissions((ROOT / finance_path).read_text()) == expected
print(json.dumps({'base': BASE, 'changed_files': sorted(changed), 'out_of_scope': unauthorized,
                  'protected_changes': protected, 'deleted_files': deleted,
                  'global_auth_and_roles': 'unchanged',
                  'authorized_route_permission_change': 'write-off reconnects existing require_role(finance); project scope uses existing owner/membership data',
                  'result': 'passed'}, ensure_ascii=False, indent=2))
