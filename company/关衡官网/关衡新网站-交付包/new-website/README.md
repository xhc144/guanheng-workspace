# 关衡软件 · 新版官网

> 与旧站完全分离的独立静态站点。设计对标华为/苹果/麦肯锡的商务专业风格。

## 目录结构

```
newweb/
├── index.html        首页
├── products.html     产品方案
├── case.html         行业案例（带行业筛选）
├── service.html      服务与支持
├── news.html         新闻洞察
├── about.html        关于我们（含企业宣传视频）
├── contact.html      联系我们（预约演示表单）
├── sitemap.xml       SEO 站点地图
├── robots.txt        SEO 抓取规则
├── replace-info.sh   真实信息一键替换脚本
├── assets/
│   ├── css/main.css  全站样式（设计规范落地）
│   ├── js/main.js    交互脚本（导航/表单/筛选）
│   └── img/
└── media/            素材（真实图片/视频）
    ├── logo/         公司 Logo
    ├── hero/         首屏主视觉
    ├── industry/     行业案例图
    ├── office/       办公/团队场景
    ├── culture/      企业文化（旧站真实图）
    └── video/        企业宣传片（旧站真实视频）
```

## 本地预览

```bash
cd newweb
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 上线前必做：替换真实信息

编辑 `replace-info.sh` 顶部的 3 个变量（电话、备案号、邮箱），然后运行：

```bash
bash replace-info.sh
```

## 上线部署

这是纯静态站点，无需 PHP/数据库。把 `newweb/` 里的所有文件上传到网站根目录即可。
支持任何静态托管：Nginx、Apache、OSS、CDN、GitHub Pages 等。

### Nginx 示例
```nginx
server {
    listen 80;
    server_name www.zgsoft.com.cn;
    root /path/to/newweb;
    index index.html;
}
```

## 仍需补充的内容（占位）

| 项目 | 位置 | 说明 |
|---|---|---|
| 服务热线 | 全站导航/页脚/转化区 | 用 replace-info.sh 替换 |
| ICP 备案号 | 页脚 | 用 replace-info.sh 替换 |
| 客户 Logo 图 | 首页/案例页客户墙 | 现为文字，提供 Logo 图后替换 |
| 发展历程年份 | 关于我们页时间轴 | 现为示例框架，需真实节点 |
| 新闻文章正文 | 新闻洞察页 | 列表用真实标题，详情页待建 |

## 已用的真实内容（来自旧站）

- 客户：创维、TCL、道达尔、神舟电脑、格林美、鲁清石化、中化弘润、中一橡胶
- 数据：20+年、50+著作权、1000+客户、32关区、212行业、80%中标率
- 文章：主动披露、加工贸易监管、AEO互认、原产地审核等真实政策解读标题
- 媒体：企业宣传片、公司环境图

## 设计规范

- 主色：深海军蓝 `#0A2A5E`，辅助钢蓝 `#2E5A9E`，点缀暖金 `#C8A24B`（极少用）
- 中性色：Slate 灰阶
- 正文 16px，标题 44/32/22px 强对比
- 区块间距 96px，内容宽 1200px
- 微圆角 6-8px，细边框，几乎无阴影
- 动效只用淡入 + 微浮，0.2-0.3s
