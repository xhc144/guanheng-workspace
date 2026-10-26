$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$master = Join-Path $projectRoot 'output\guanheng-brand-master.mp4'
$web = Join-Path $projectRoot 'output\guanheng-brand-web.mp4'

if (-not (Test-Path -LiteralPath $master)) {
    throw 'Master video not found. Run npm run render first.'
}

ffmpeg -y -i $master `
    -c:v libx264 `
    -preset medium `
    -crf 23 `
    -pix_fmt yuv420p `
    -color_range tv `
    -movflags +faststart `
    -an `
    $web

if ($LASTEXITCODE -ne 0) {
    throw "Web encoding failed with exit code: $LASTEXITCODE"
}

Write-Output "Web video generated: $web"
