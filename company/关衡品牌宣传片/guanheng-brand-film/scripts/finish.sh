#!/usr/bin/env bash
# Package the rendered masters into the delivery files.
#   input : renders/_vo_tmp.mp4      (index.html rendered with subtitles, mix_vo soundtrack)
#           renders/_silent_tmp.mp4  (rendered with --variables '{"subtitles":false}')
#   output: renders/关衡宣传片_旁白版_1080p.mp4
#           renders/关衡宣传片_纯音乐版_1080p.mp4
#           renders/关衡宣传片_官网版_720p.mp4
#           renders/封面_片头.jpg, renders/封面_片尾.jpg
set -euo pipefail
cd "$(dirname "$0")/.."
R=renders

# 1080p narrated master: same streams, index moved to the front for web playback
ffmpeg -loglevel error -y -i "$R/_vo_tmp.mp4" -c copy -movflags +faststart "$R/关衡宣传片_旁白版_1080p.mp4"

# 1080p music-only: subtitle-free picture + score/SFX soundtrack
ffmpeg -loglevel error -y -i "$R/_silent_tmp.mp4" -i assets/audio/mix_music.wav \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k -ar 48000 -t 60 -movflags +faststart \
  "$R/关衡宣传片_纯音乐版_1080p.mp4"

# 720p web cut of the narrated version
ffmpeg -loglevel error -y -i "$R/关衡宣传片_旁白版_1080p.mp4" \
  -vf "scale=1280:720:flags=lanczos" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart "$R/关衡宣传片_官网版_720p.mp4"

# posters: opening title over the earth, and the brand end card
ffmpeg -loglevel error -y -ss 4.2 -i "$R/关衡宣传片_纯音乐版_1080p.mp4" -frames:v 1 -q:v 2 "$R/封面_片头.jpg"
ffmpeg -loglevel error -y -ss 59.5 -i "$R/关衡宣传片_纯音乐版_1080p.mp4" -frames:v 1 -q:v 2 "$R/封面_片尾.jpg"

rm -f "$R/_vo_tmp.mp4" "$R/_silent_tmp.mp4"
ls -la "$R"
