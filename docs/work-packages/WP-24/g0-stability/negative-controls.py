"""Run two expected-failure controls, restore owned source bytes in finally.
No dependency, environment, threshold, or application state changes.
"""
import pathlib, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[4]
project = root / 'systems/project-ops'
runner = pathlib.Path(sys.argv[1])
controls = [
 ('16-negative-old-runtime', project/'lib/runtime-health.ts',
  subprocess.check_output(['git','show','875fb80613e7626c774d4d7ec3a9eadafb7ae66f:systems/project-ops/lib/runtime-health.ts'],cwd=root),
  '启动器版本每次', 'tests/runtime-health.test.ts'),
 ('17-negative-early-result', project/'tests/integration-foundation.test.ts',
  (project/'tests/integration-foundation.test.ts').read_bytes().replace(
   b'else result = message as WorkerResult;', b'else { result = message as WorkerResult; resolve(result); }'),
  'worker结果先于关闭', 'tests/integration-foundation.test.ts'),
]
for label, path, replacement, pattern, testfile in controls:
 original=path.read_bytes()
 try:
  assert replacement != original
  path.write_bytes(replacement)
  result=subprocess.run([sys.executable,str(runner),label,'node','--experimental-strip-types','--test','--test-name-pattern='+pattern,testfile],cwd=project)
  assert result.returncode == 1, (label,'negative control must fail',result.returncode)
 finally:
  path.write_bytes(original)
 print(label+': expected test exit 1; original working source bytes restored')
