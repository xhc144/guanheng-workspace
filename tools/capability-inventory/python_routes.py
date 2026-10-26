"""Parse Python AST only. Never import the scanned application or open its database."""
import ast
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
records = []
tests = []
for system in ('基础版', 'Kimi版', 'DeepSeek版'):
    app = root / 'systems/pms-suite' / system / 'backend/app'
    main = ast.parse((app / 'main.py').read_text())
    mounts = {}
    imports = {}
    for node in ast.walk(main):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                imports[alias.asname or alias.name] = ((node.module or '').split('.')[-1], alias.name)
    for node in ast.walk(main):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'include_router':
            prefix = next((ast.literal_eval(x.value) for x in node.keywords if x.arg == 'prefix'), '')
            target = node.args[0]
            if isinstance(target, ast.Name) and target.id in imports:
                module, name = imports[target.id]
                mounts[(module, name)] = prefix
            elif isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                # Kimi's explicit router list is mounted in a for-loop with /api/v1.
                if system == 'Kimi版' and target.value.id == 'r':
                    for stmt in main.body:
                        if isinstance(stmt, ast.For) and isinstance(stmt.iter, (ast.List, ast.Tuple)):
                            for item in stmt.iter.elts:
                                if isinstance(item, ast.Name): mounts[(item.id, target.attr)] = prefix
                else: mounts[(target.value.id, target.attr)] = prefix
            else: raise ValueError('无法静态解析路由挂载')
    for path in sorted(app.rglob('*.py')):
        text = path.read_text()
        tree = ast.parse(text)
        prefixes = {'app': ''} if path.name == 'main.py' else {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'APIRouter':
                prefix = next((ast.literal_eval(x.value) for x in node.value.keywords if x.arg == 'prefix'), '')
                for target in node.targets:
                    if isinstance(target, ast.Name): prefixes[target.id] = prefix
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)): continue
            for dec in node.decorator_list:
                if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute): continue
                if not isinstance(dec.func.value, ast.Name) or dec.func.value.id not in prefixes: continue
                if dec.func.value.id == 'app' and dec.func.attr in ('on_event', 'middleware', 'exception_handler'): continue
                if dec.func.attr not in ('get', 'post', 'put', 'patch', 'delete', 'head', 'options'):
                    raise ValueError(f'不支持的路由装饰器: {path}:{dec.lineno}')
                mount = '' if dec.func.value.id == 'app' else mounts.get((path.stem, dec.func.value.id))
                if mount is None: raise ValueError(f'路由未挂载: {path}:{dec.lineno}')
                route = mount + prefixes[dec.func.value.id] + ast.literal_eval(dec.args[0])
                records.append(dict(system=system, kind='http', method=dec.func.attr.upper(), route=route or '/',
                    path=str(path.relative_to(root)), line=node.lineno, symbol=node.name,
                    sourceCalls=sorted(set(ast.unparse(x.func) for x in ast.walk(node) if isinstance(x, ast.Call)))[:32],
                    sha256=hashlib.sha256(text.encode()).hexdigest()))
    for path in sorted((app.parent / 'tests').rglob('test_*.py')):
        text = path.read_text()
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith('test_'):
                tests.append(dict(system=system, path=str(path.relative_to(root)), line=node.lineno,
                    symbol=node.name, sha256=hashlib.sha256(text.encode()).hexdigest()))
print(json.dumps(dict(routes=records, tests=tests), ensure_ascii=False))
