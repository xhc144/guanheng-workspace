# Changelog

## v1.0.0 (完整完善版) — 2026

### 新增 (P1 路线图全部落地)
- 甘特图视图 (ECharts 自研实现, 任务条 + 里程碑菱形 + 计划区间背景)
- 日历视图 (任务/里程碑按日期展示, 月面板联动)
- 工时填报与审批 (填报/审批/驳回/工时统计, 24h 校验)
- 资源负载视图 (负载率计算, 过载/偏高/正常/闲置分级)
- 预算执行跟踪页面 (预算 vs 合同额 vs 已回款 + 执行率)
- 成本归集与利润分析 (成本录入 + 人工成本折算 + 利润率)
- 文档版本管理 (多版本上传/下载/历史)
- 客户门户 (client 角色独立登录, 仅看授权客户项目)
- 保存列表视图 (筛选条件按用户持久化)
- 客户页门户账号授权管理
- 回款幂等键 + /api/finance 财务统一入口 (幂等回款/冲销)
- /api/users 用户列表别名路由
- 客户角色全局 API 隔离 (client 仅可访问 /api/portal/*)

### 修复
- create_project manager_id 重复传参 (TypeError)
- create_project/create_invoice 未 flush 即使用自增 id 导致 NOT NULL 约束失败
- CORS 白名单缺少 5173 端口
- 风险跟进 commitment_date 字符串未转 datetime
- 路由重复定义 (delete_user)
- ProjectDetail.tsx 缺少 Select 导入 (tsc 零错误)
- 版本号统一升级 1.0.0 (后端/前端/测试/文档)

### 测试
- 后端 104 测试全部通过 (含 8 个 P1 新测试)
- 前端 4 测试通过 + tsc --noEmit 零错误 + vite build 成功

## v0.2.1 (迭代 452, 368改进) — 2025

### 新增
- 422/500 异常处理器（结构化字段级errors）
- 安全响应头（X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS）
- /api/config 公共配置端点 + Cache-Control
- LOG_LEVEL 动态日志级别
- 数据完整性检查扩展至通知/审计日志
- 风险创建自动通知负责人
- 工作台增加最近活动动态
- 全链路集成测试 (test_integration.py, 12步)
- 用户注册/当前用户信息/收款计划/暴力韧性/安全头测试
- 前端底部栏版本号
- Settings页面集成 /api/config 特性标志

### 修复
- RiskFollowUpCreate 移除冗余 risk_id 字段（422修复）
- 测试去重（5个重复函数重命名）
- 搜索测试断言匹配扁平API结构

### 测试
- 68+ 后端测试 + 全链路集成测试 + 3前端测试

## v0.2.0 (迭代 100-214) — 2024

### 新增
- 请求计时中间件 + X-Response-Time-Ms header
- 内存级速率限制 (300 req/min/IP)
- 错误边界组件 (ErrorBoundary.tsx)
- 面包屑导航
- 仪表盘摘要端点 `/api/dashboard/summary`
- 批量完成任务端点 `PUT /api/tasks/batch-complete`
- 删除端点: `DELETE /api/tasks/{id}`, `DELETE /api/risks/{id}`, `DELETE /api/issues/{id}`
- `deleteRisk`, `exportAging`, `markAllRead` API函数
- `self_check.py` — 纯Python自检验证
- `.env.production` 生产配置模板
- 数据完整性启动检查
- 通知中心侧边栏菜单入口
- 4笔多样化账龄种子回款

### 修复
- 风险跟进API调用缺失（弹窗数据未发送到后端）
- `overdue_days` 种子字段不存在 → 移除
- `from fastapi import Request` 重复导入 → 合并到顶部
- `JSONResponse` 内联导入 → 移至模块顶部
- `ErrorBoundary` `window.location.href` → 改用 setState reset
- 项目-回款双向ORM关联
- 生产环境默认密钥安全警告

### 改进
- 工作台: 任务状态计数 + 服务端 `task_status_counts`
- 登录页: 验证码占位符
- 导入页: 合同模板下载按钮
- 任务页: 详情抽屉 (单击名称)
- test_run.bat: 交付物清单扩展
- verify_goal.py: 里程碑/问题/报告/中间件路由断言
- api_tests.http: +9 新端点烟雾测试
- README: 一键验收章节
- 数据库连接池: pool_pre_ping + pool_size + max_overflow

## v0.1.0 — 初始版本
- 22 数据模型, 19 校验 Schema
- 14 前端页面, 7 Dashboard ECharts, 7 ProjectDetail 标签页
- 39 后端测试 + 3 前端测试
- Alembic 迁移, 种子数据, Docker, CI/CD
- 全面 CRUD, 多实体搜索, Excel 导入导出
