$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$edgeTts = Join-Path $projectRoot '.venv\Scripts\edge-tts.exe'
$scriptPath = Join-Path $projectRoot 'script\narration.txt'
$voicePath = Join-Path $projectRoot 'public\audio\voice.mp3'
$rawVoicePath = Join-Path $projectRoot 'public\audio\voice.raw.mp3'
$subtitlePath = Join-Path $projectRoot 'public\audio\voice.vtt'

if (-not (Test-Path -LiteralPath $edgeTts)) {
    throw 'edge-tts is not installed. Create .venv and install edge-tts first.'
}

& $edgeTts `
    --file $scriptPath `
    --voice 'zh-CN-YunyangNeural' `
    --rate=+0% `
    --pitch=-4Hz `
    --write-media $rawVoicePath `
    --write-subtitles $subtitlePath

& ffmpeg `
    -hide_banner `
    -loglevel error `
    -y `
    -i $rawVoicePath `
    -af 'loudnorm=I=-16:LRA=11:TP=-1.5' `
    -ar 48000 `
    -ac 2 `
    -c:a libmp3lame `
    -b:a 192k `
    $voicePath

Remove-Item -LiteralPath $rawVoicePath

Write-Output "Voice generated: $voicePath"
