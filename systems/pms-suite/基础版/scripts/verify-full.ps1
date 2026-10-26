$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Python not found: $python" }
$env:PYTHONPATH = $backend
& $python -m compileall -q (Join-Path $backend 'app')
if ($LASTEXITCODE -ne 0) { throw 'Python compile check failed' }
Push-Location $backend
try {
  & $python scripts/demo_db.py reset
  if ($LASTEXITCODE -ne 0) { throw 'Demo reset failed' }
} finally { Pop-Location }
$env:PYTHONPATH = $backend
$code = @'
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
assert c.get('/api/health').status_code == 200
r = c.post('/api/auth/login', json={'username':'admin','password':'Admin@123456'})
assert r.status_code == 200
h = {'Authorization': 'Bearer ' + r.json()['access_token']}
checks = ['/api/dashboard','/api/projects','/api/finance/summary','/api/risks','/api/approvals','/api/timesheets','/api/templates','/api/search?q=demo','/api/reports/portfolio','/api/exports/projects.csv','/api/backups']
results = [(path, c.get(path, headers=h).status_code) for path in checks]
print(results)
assert all(status == 200 for _, status in results)
'@
& $python -c $code
if ($LASTEXITCODE -ne 0) { throw 'Backend smoke check failed' }
Push-Location (Join-Path $root 'frontend')
try {
  npm run check
  if ($LASTEXITCODE -ne 0) { throw 'Frontend lint failed' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
} finally { Pop-Location }
Write-Host 'Basic edition full smoke, lint, and build passed.' -ForegroundColor Green
