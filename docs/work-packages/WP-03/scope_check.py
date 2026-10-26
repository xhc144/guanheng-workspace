"""核对本包修改归属与仅代码/文本交付，不读取凭据或真实数据。"""
import json
from pathlib import Path
import subprocess

from verify import ROOT

BASE = 'd14f98939429e4f860fd82ac6c48ea4fbf1629a4'


def main():
    tasks = json.loads((ROOT / 'tasks/queue.json').read_text())
    package = next(task for task in tasks if task['id'] == 'WP-03')
    assert package['branch'] == subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
    assert not package['depends_on']
    changed = subprocess.check_output(['git', 'diff', '--name-only', '-z', BASE], cwd=ROOT).decode().split('\0')
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
    checked = []
    for path in sorted(set(filter(None, changed + untracked))):
        assert any(path.startswith(owned) if owned.endswith('/') else path == owned for owned in package['owns']), f'越界改动：{path}'
        target = ROOT / path
        assert target.is_file(), f'不允许删除：{path}'
        assert not target.is_symlink(), f'不提交符号链接：{path}'
        data = target.read_bytes()
        assert b'\0' not in data, f'二进制文件：{path}'
        data.decode('utf-8')
        assert target.suffix.lower() not in {'.db', '.zip', '.png', '.jpg', '.pdf', '.xlsx', '.gz', '.br'}, f'非代码/文本成品：{path}'
        assert not target.name.startswith('.env'), f'环境配置文件：{path}'
        checked.append(path)
    print(json.dumps({'base': BASE, 'branch': package['branch'], 'owned_text_paths': checked}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
