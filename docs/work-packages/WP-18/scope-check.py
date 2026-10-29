"""Validate this work package's branch, baseline, ownership and text-only diff."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = 'd14f98939429e4f860fd82ac6c48ea4fbf1629a4'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf-8')


def owned(path, entries):
    return any(path.startswith(entry) if entry.endswith('/') else path == entry for entry in entries)


def run():
    queue = json.loads((ROOT / 'tasks/queue.json').read_text())
    package = next(item for item in queue if item['id'] == 'WP-18')
    assert git('branch', '--show-current').strip() == package['branch'], '当前分支不是WP-18分支'
    assert git('merge-base', BASE, 'HEAD').strip() == BASE, '基线不匹配'
    assert package['depends_on'] == [], '队列依赖与开工依据不同'
    paths = set(filter(None, git('diff', '--name-only', '-z', BASE).split('\0')))
    paths.update(filter(None, git('ls-files', '--others', '--exclude-standard', '-z').split('\0')))
    assert len(paths) >= 5, '必须有实质修改，不能用空文件凑数'
    secrets = re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{24,}')
    for name in sorted(paths):
        assert owned(name, package['owns']), '越界修改：' + name
        for other in queue:
            if other['id'] != 'WP-18':
                assert not owned(name, other['owns']), '与其他工作包冲突：' + name
        path = ROOT / name
        assert path.is_file() and not path.is_symlink(), '删除或非普通文件：' + name
        assert not path.name.startswith('.env'), '禁止提交环境配置：' + name
        assert path.name not in {'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'}, '依赖文件属于WP01：' + name
        assert path.suffix.lower() not in {'.db', '.sqlite', '.pdf', '.pptx', '.png', '.jpg', '.zip', '.pem', '.key', '.env'}, '禁止产物或凭据：' + name
        data = path.read_bytes()
        assert data and b'\0' not in data, '空文件或二进制：' + name
        text = data.decode('utf-8')
        assert not secrets.search(text), '发现疑似凭据，需人工核查（不打印值）：' + name
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    print(json.dumps({'ok': True, 'base': BASE, 'head': git('rev-parse', 'HEAD').strip(),
                      'branch': package['branch'], 'files': sorted(paths),
                      'textOnly': True, 'ownershipPassed': True, 'credentialPatternCheckPassed': True}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    run()
