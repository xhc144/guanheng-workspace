# api_smoke_test.ps1 — API 冒烟测试
# Usage: pwsh -File api_smoke_test.ps1 [-Port 8000]

param([int]$Port = 8000)
$Base = "http://localhost:$Port/api"
$ErrorActionPreference = "Stop"
$failed = 0

function Test-Endpoint($method, $path, $expectedStatus=200, $body=$null, $extraHeaders=@{}) {
    $uri = "$Base$path"
    try {
        $params = @{ Uri=$uri; Method=$method; ContentType='application/json'; SkipCertificateCheck=$true; Headers=$extraHeaders }
        if ($body) { $params.Body = ($body | ConvertTo-Json -Compress) }
        $r = Invoke-RestMethod @params -StatusCodeVariable sc
        if ($sc -ne $expectedStatus) { throw "Expected $expectedStatus, got $sc" }
        Write-Host "  PASS $method $path" -ForegroundColor Green
    } catch {
        Write-Host "  FAIL $method ${path}: $_" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host "=== API Smoke Test ===`n"

# Health
Test-Endpoint GET "/health"

# Login
$token = $null
try {
    $r = Invoke-RestMethod "$Base/auth/login" -Method Post -Body '{"username":"admin","password":"admin123"}' -ContentType 'application/json'
    $token = $r.access_token
    Write-Host "  PASS POST /auth/login" -ForegroundColor Green
} catch { Write-Host "  FAIL POST /auth/login: $_" -ForegroundColor Red; $failed++ }

if (-not $token) { Write-Host "FATAL: Cannot continue without token"; exit 1 }

$headers = @{ Authorization="Bearer $token" }

# Basic CRUD
Test-Endpoint GET "/projects" 200 $null $headers
Test-Endpoint GET "/customers" 200 $null $headers
Test-Endpoint GET "/tasks" 200 $null $headers
Test-Endpoint GET "/contracts" 200 $null $headers
Test-Endpoint GET "/receipts" 200 $null $headers
Test-Endpoint GET "/risks" 200 $null $headers
Test-Endpoint GET "/dashboard" 200 $null $headers
Test-Endpoint GET "/workbench" 200 $null $headers
Test-Endpoint GET "/approvals/templates" 200 $null $headers
Test-Endpoint GET "/search?q=项目" 200 $null $headers
Test-Endpoint GET "/audit-logs" 200 $null $headers
Test-Endpoint GET "/notifications" 200 $null $headers
Test-Endpoint GET "/status" 200 $null $headers
Test-Endpoint GET "/dashboard/summary" 200 $null $headers
Test-Endpoint GET "/milestones?project_id=p001" 200 $null $headers
Test-Endpoint GET "/issues?project_id=p001" 200 $null $headers
Test-Endpoint GET "/reports/budget-vs-actual" 200 $null $headers
Test-Endpoint GET "/customers?page=1&page_size=5" 200 $null $headers

Write-Host "`n=== $failed failure(s) ===" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
exit $failed
