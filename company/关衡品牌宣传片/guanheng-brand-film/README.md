# 关衡集团 · 品牌宣传片 2026（「关与衡 · 光之平衡」）

60 秒，1920×1080，30fps。用 HyperFrames（HTML + GSAP）制作，画面、旁白、配乐、字幕都可单独修改后重新渲染。

## 成片（`renders/`）

| 文件 | 用途 |
|---|---|
| `关衡宣传片_旁白版_1080p.mp4` | 主版本：旁白 + 配乐 + 字幕。官网、销售拜访、会议开场、视频号/公众号 |
| `关衡宣传片_纯音乐版_1080p.mp4` | 无旁白、无字幕。展会大屏循环、活动暖场、门店/前台屏 |
| `关衡宣传片_官网版_720p.mp4` | 旁白版压缩到 720p，Fast Start，适合网页内嵌 |
| `封面_片头.jpg` / `封面_片尾.jpg` | 视频封面 / 播放器海报图 |

## 创意结构

整片从「深夜」走向「天亮」，用 logo 本身——一条蓝色飘带和两颗球——作为主视觉：两颗球是「效率」和「合规」，飘带让它们平衡。

| 时间 | 场景 | 旁白 |
|---|---|---|
| 0–6s | 夜晚地球，贸易航线点亮 | 全球贸易，越走越远。 |
| 6–14s | 港口 + 漂浮的编码/规则，风险标红 | 每一票货物背后，是繁杂的编码、多变的规则，和看不见的风险。 |
| 14–20s | 两颗光球失衡 → 飘带出现，拼成关衡标志 | 关衡，让效率与合规，不必二选一。 |
| 20–28s | GTM 真实系统界面 3D 展示 + 五大模块 | GTM 全球关务系统，打通商品归类、通关申报、保税加工、仓储物流与经营分析。 |
| 28–36s | 三张价值卡：风险预警 / 单证追溯 / 系统协同 | 合规风险提前预警，单证全程追溯，与 ERP 等业务系统无缝协同。 |
| 36–44s | 1997→2026 时间轴，五代产品 | 从一九九七年起，关衡近三十年，只专注关务这一件事。 |
| 44–52s | 10000+ / 12 / 212 / 100+ 数据 | 今天，关衡已服务一万多家进出口企业，覆盖全球十二个国家、二百一十二个细分行业。 |
| 52–60s | 天亮转白场，标语 → 标志 → 预约演示 | 进出口关务合规，一套系统管清楚。关衡集团。 |

## 事实与素材来源

- 数据（1997、10000+、12 国、212 行业、100+ 软著、国家级高新、双软、总部东莞）：新官网 `about.html` 与投标文件「公司概况 / 核心资质与荣誉 / 行业积淀」。
- 产品历程五代：投标文件「行业积淀」。「5 类 11 个维度 3 级预警」「一键穿行」「SAP/SRM/WMS/MES/财务/单一窗口」：《关衡关务数智化合规管理解决方案介绍（加工贸易）V1.0》。
- 系统截图、行业图片：新官网 `media/system/`、`media/industry/`、`media/hero/`。
- 标志：委托方提供的官方横版透明 PNG。图形部分仅做 3 倍放大和抠图残留修补（`scripts/extract_mark.py`），没有重绘。
- 不出现客户名称、客户商标和可识别人像。

## 声音

- 旁白：阿里云百炼 CosyVoice `cosyvoice-v3-flash`，音色「龙天」`longtian_v3`（官方定位：磁性理性，适合纪录片与品牌配音）。密钥放在 `.env`（已加入 `.gitignore`，不要提交或外发）。
- 配乐与音效：`scripts/music.py` 用代码原创合成（120 BPM，D 小调，结尾在 F 大调「天亮」），每个转场、数字落定和标志出现都对齐到画面，不涉及第三方音乐版权。
- 混音：`scripts/mix.py`，人声出现时配乐自动压低约 11 dB，两个版本都做了 EBU R128 响度标准化（-14 LUFS / -1 dBTP）。

## 修改与重新出片

```powershell
# 1. 改旁白：编辑 scripts/vo_lines.txt，然后
python scripts/gen_vo.py            # 全部重新生成（或 python scripts/gen_vo.py L3 只生成一句）
python scripts/asr_check.py         # 用语音识别回听，检查读音
# 2. 改配乐：编辑 scripts/music.py
python scripts/music.py
# 3. 混音（旁白时间点在 mix.py 的 VO_AT，需与 index.html 的字幕时间保持一致）
python scripts/mix.py
# 4. 预览 / 检查 / 渲染
npx hyperframes preview
npx hyperframes check
npx hyperframes render --quality high --output renders/_vo_tmp.mp4
npx hyperframes render --quality high --variables '{"subtitles":false}' --output renders/_silent_tmp.mp4
# 5. 封装：旁白版 / 纯音乐版（换成 mix_music.wav 音轨）/ 720p 官网版 / 两张封面图
bash scripts/finish.sh
```

画面全部在 `index.html`：每个场景是一个 `<section class="clip">`，动画在文件末尾的 GSAP 时间线里，按场景分块并标了时间。电话、网址、标语都是普通文本，直接改即可。
