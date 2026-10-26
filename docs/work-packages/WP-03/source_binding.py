"""将验收命令绑定到冻结提交及实际源文件内容，不读取环境秘密。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = Path(__file__).resolve().parent / 'evidence/p2-source-manifest.json'
EDITIONS = {'basic': '基础版', 'deepseek': 'DeepSeek版', 'kimi': 'Kimi版'}


def git(*arguments):
    return subprocess.check_output(['git', *arguments], cwd=ROOT).decode().strip()


def blob_id(data):
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()


def source_paths():
    prefixes = [f'systems/pms-suite/{edition}/{part}' for edition in EDITIONS.values()
                for part in ('backend', 'frontend')]
    prefixes += ['docs/work-packages/WP-03', 'docs/PMS账号与配置.md',
                 'systems/pms-suite/DeepSeek版/ASSUMPTIONS.md']
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--', *prefixes], cwd=ROOT).decode().split('\0')
    return sorted(path for path in filter(None, paths)
                  if not Path(path).name.startswith('.env')
                  and (not path.startswith('docs/work-packages/WP-03/') or path.endswith('.py')))


def tree_entries(revision, prefix=None):
    command = ['git', 'ls-tree', '-r', '-z', revision]
    if prefix:
        command += ['--', prefix]
    result = {}
    for item in filter(None, subprocess.check_output(command, cwd=ROOT).decode().split('\0')):
        metadata, path = item.split('\t', 1)
        mode, kind, sha = metadata.split()
        if kind == 'blob':
            result[path] = sha
    return result


def freeze(revision):
    if MANIFEST.exists():
        raise RuntimeError('冻结清单已存在，拒绝覆盖旧验收绑定')
    if git('rev-parse', 'HEAD') != revision:
        raise RuntimeError('冻结提交必须是当前精确HEAD')
    tree = tree_entries(revision)
    files = []
    for path in source_paths():
        data = (ROOT / path).read_bytes()
        actual = blob_id(data)
        if tree.get(path) != actual:
            raise RuntimeError(f'源码未提交或与冻结提交不符：{path}')
        files.append({'path': path, 'git_blob': actual, 'sha256': hashlib.sha256(data).hexdigest()})
    record = {'source_commit': revision, 'source_tree': git('rev-parse', f'{revision}^{{tree}}'),
              'created_at': datetime.now(timezone.utc).isoformat(), 'files': files}
    MANIFEST.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    return verify_source()


def load_manifest():
    return json.loads(MANIFEST.read_text())


def verify_source():
    if not MANIFEST.exists():
        raise RuntimeError('缺少P2冻结清单；请先固定源码提交并创建清单')
    record = load_manifest()
    if source_paths() != sorted(item['path'] for item in record['files']):
        raise RuntimeError('源码路径集合已变化，不能沿用旧冻结清单')
    for item in record['files']:
        data = (ROOT / item['path']).read_bytes()
        if blob_id(data) != item['git_blob'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise RuntimeError(f"源码blob已变化，拒绝冒充旧源码验收：{item['path']}")
    return {'source_commit': record['source_commit'], 'source_tree': record['source_tree'],
            'execution_head': git('rev-parse', 'HEAD'),
            'manifest': MANIFEST.relative_to(ROOT).as_posix(),
            'manifest_sha256': hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
            'source_blobs_match': True}


def verify_backend(backend, edition, revision=None):
    prefix = f'systems/pms-suite/{EDITIONS[edition]}/backend/'
    if revision is None:
        record = load_manifest()
        revision = record['source_commit']
        expected = {item['path'][len(prefix):]: item['git_blob'] for item in record['files']
                    if item['path'].startswith(prefix)}
    else:
        expected = {path[len(prefix):]: sha for path, sha in tree_entries(revision, prefix).items()
                    if not Path(path).name.startswith('.env')}
    for relative, sha in expected.items():
        target = Path(backend) / relative
        if not target.is_file() or blob_id(target.read_bytes()) != sha:
            raise RuntimeError(f'实际执行副本blob不匹配：{edition}/{relative}')
    actual_python = {path.relative_to(backend).as_posix() for path in Path(backend).rglob('*.py')}
    if actual_python != {path for path in expected if path.endswith('.py')}:
        raise RuntimeError(f'实际执行副本存在遗漏或额外Python源码：{edition}')
    digest = hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest()
    return {'edition': edition, 'backend_cwd': str(backend), 'backend_source_commit': revision,
            'backend_blobs_match': True, 'backend_blob_map_sha256': digest}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source_commit')
    options = parser.parse_args()
    print(json.dumps(freeze(options.source_commit), ensure_ascii=False, indent=2))
