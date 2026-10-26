# UI Contract · 关衡集团官网

设计方向：东方编辑美学 × 全球贸易科技。黛蓝墨色为底，朱砂印章红为唯一强调色，
宋体衬线承担标题（品牌为 30 年 heritage 企业，serif 属 brief 正当覆写），
竖排中文与印章元素作文化点缀。禁止紫色渐变、Inter、em-dash、三联等宽卡片。

## Tokens（CSS 自定义属性，定义于 index.html `:root`）

### Color
| Token | Value | 用途 |
|---|---|---|
| `--paper` | #F4F1EA | 全局底色（暖米纸白，非纯白） |
| `--paper-2` | #EBE6DA | 次级底色 / 卡片 |
| `--ink` | #101C24 | 主文字（黛蓝墨黑，非纯黑） |
| `--ink-2` | #3D4A53 | 次文字 |
| `--ink-3` | #7A838A | 辅助说明文字（仅用于 ≥14px 且对比达标的场景） |
| `--brand` | #0E2A3A | 品牌黛蓝（深色带、按钮、导航滚动态） |
| `--brand-2` | #16405A | 黛蓝亮阶（hover、渐变端点） |
| `--accent` | #B33A24 | 朱砂红（唯一强调色：印章、关键数据、当前态） |
| `--accent-deep` | #8F2C1A | 朱砂暗阶（红底文字的 hover） |
| `--line` | rgba(16,28,36,.14) | 浅分隔线 |
| `--line-dark` | rgba(244,241,234,.16) | 深底分隔线 |
| `--gold-pale` | #C8BFA9 | 装饰性淡金（仅图形线条，永不用于文字） |

### Type
| Token | Value |
|---|---|
| `--font-serif` | "Noto Serif SC","Songti SC","STSong","SimSun",serif |
| `--font-sans` | "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif |
| `--fs-display` | clamp(2.6rem, 6.2vw, 5rem) |
| `--fs-h2` | clamp(2rem, 4vw, 3.1rem) |
| `--fs-h3` | clamp(1.25rem, 2vw, 1.6rem) |
| `--fs-body` | 1.0625rem / line-height 1.9 |
| `--fs-small` | .875rem |

### Space / Radius / Elevation / Motion
| Token | Value |
|---|---|
| `--space-section` | clamp(5rem, 11vw, 9rem) 上下padding |
| `--space-gutter` | clamp(1.25rem, 5vw, 4.5rem) 页边距 |
| `--radius` | 2px（全局锐利直角，仅印章用 4px） |
| `--shadow-card` | 0 24px 60px -32px rgba(16,28,36,.28) |
| `--motion` | 260ms cubic-bezier(.22,.61,.36,1) |
| 滚动揭示 | IntersectionObserver + transform/opacity，禁用 scroll 监听驱动动画 |
| 降级 | `@media (prefers-reduced-motion: reduce)` 全部动画关闭 |

## 组件不变量
- 每屏仅一个视觉主行动（Von Restorff）；主 CTA 为黛蓝实心按钮，文案以动词开头。
- 强调色 `--accent` 全站唯一，禁止第二强调色。
- 分隔用发丝线 `--line`，长列表 >5 项必须分组为组件（tab/索引表），禁止逐行 border-top 堆叠。
- 图标：统一线性 SVG（stroke 1.5），同一图标族风格；印章图形例外。
- 无 `—`/`–` 分隔符；区间用半角连字符（1997-2024）。
- 每 3 个 section 至多 1 个小标签（eyebrow），优先省略。
