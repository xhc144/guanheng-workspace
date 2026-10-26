# 关衡软件 60 秒动态宣传片

这是一个使用 React、Remotion 4 和 FFmpeg 9 制作的可编辑动态宣传片工程。画面、字幕、旁白和音乐保持独立，后续可修改文案、数字、电话、镜头节奏或素材后重新渲染。

## 已交付内容

- `output/guanheng-brand-master.mp4`：1080p 高质量母版。
- `output/guanheng-brand-web.mp4`：适合官网加载的压缩版本，带 Fast Start。
- `output/preview.png`：数据实力场景预览图。
- `script/narration.txt`：中文旁白原稿。
- `script/subtitles.srt`：独立中文字幕。
- `public/audio/voice.mp3`：中文神经女声旁白。
- `public/audio/music.wav`：原创程序化背景音乐。
- `src/GuanhengVideo.tsx`：完整的 60 秒画面与动画时间线。

## 软件栈

- Node.js 24
- React 19
- Remotion 4.0.517
- TypeScript 5.7
- FFmpeg 9
- edge-tts 7.2.8，使用 `zh-CN-XiaoxiaoNeural` 女声
- NumPy，用于生成原创背景音乐

## 本地预览

```powershell
npm install
npm start
```

Remotion Studio 会打开可拖动时间线，可逐帧检查字幕和动画。

## 重新生成声音与音乐

```powershell
powershell -ExecutionPolicy Bypass -File tools/generate_voice.ps1
python tools/generate_music.py
```

修改 `script/narration.txt` 后需要重新生成旁白，并同步调整 `src/GuanhengVideo.tsx` 中的字幕时间。

## 重新渲染

```powershell
npm run check
npm run render
npm run render:web
```

母版为 1920×1080、25fps、H.264、AAC，网页版本为 `yuv420p` 并将 MP4 索引移动到文件头，便于边下载边播放。

## 品牌与内容口径

- 品牌配色来自当前官网：深海军蓝、钢蓝、暖金、白色和 Slate 灰。
- 数据口径采用当前官网公开信息：1997 年起、10000+ 企业、12 个国家、212 个细分行业、100+ 软件著作权。
- 客户仅使用官网已公开的名称文字，不包含客户商标图形。
- 片尾转化信息为“预约产品演示”和全国服务热线 `400 880 9138`。

## 商业使用说明

官网正式发布前，请由公司确认 Remotion 的商业许可证是否已覆盖当前组织。视频内容、原创音乐、工程代码与从公司官网取得的素材仍由公司自行管理。
