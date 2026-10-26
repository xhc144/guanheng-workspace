# API 接口文档

Base URL: `http://localhost:8000/api`

> v1.0.0 新增接口见文末「P1 扩展接口」。

## P1 扩展接口 (v1.0.0)

### 甘特图
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /gantt/{project_id} | 项目甘特数据(任务+里程碑) | 登录用户 |

### 日历
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /calendar?start=&end=&project_id= | 区间内任务与里程碑 | 登录用户 |

### 工时
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /timesheets | 工时列表(可按人/项目/状态/日期过滤) | 登录用户 |
| POST | /timesheets | 填报工时 (0<hours≤24) | 登录用户 |
| DELETE | /timesheets/{id} | 删除工时(本人或pm+) | 登录用户 |
| POST | /timesheets/{id}/approve | 审批通过 | pm及以上 |
| POST | /timesheets/{id}/reject | 驳回 | pm及以上 |
| GET | /timesheets/summary/hours | 工时汇总(按人/项目) | 登录用户 |

### 资源负载
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /resource-load?project_id= | 成员负载(负载率/过载检测) | 登录用户 |

### 成本与利润
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /expenses?project_id= | 成本列表 | 登录用户 |
| POST | /expenses | 登记成本 | 登录用户 |
| DELETE | /expenses/{id} | 删除成本 | 登录用户 |
| GET | /reports/cost-profit | 成本-利润分析 | 登录用户 |

### 文档版本
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /documents?project_id= | 文档列表 | 登录用户 |
| POST | /documents | 新建文档 | 登录用户 |
| DELETE | /documents/{id} | 删除文档 | 登录用户 |
| GET | /documents/{id}/versions | 版本列表 | 登录用户 |
| POST | /documents/{id}/versions | 上传新版本(multipart) | 登录用户 |
| GET | /documents/{id}/versions/{vid}/download | 下载版本 | 登录用户 |

### 保存视图
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /saved-views?page= | 我的保存视图 | 登录用户 |
| POST | /saved-views | 保存视图 | 登录用户 |
| DELETE | /saved-views/{id} | 删除视图 | 登录用户 |

### 财务统一入口
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /finance/receipts | 回款列表 | 登录用户 |
| POST | /finance/receipts | 创建回款(支持 idempotency_key 幂等) | 登录用户 |
| POST | /finance/receipts/{id}/write-off | 冲销回款(留审计) | 登录用户 |

### 客户门户
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | /portal/login | 门户登录(仅 client 角色) | 公开 |
| GET | /portal/projects | 授权客户的项目列表 | client |
| GET | /portal/projects/{id} | 项目详情(财务+里程碑+风险) | client |
| POST | /customers/{cid}/portal-users | 给客户授权门户账号 | enterprise_admin+ |
| GET | /customers/{cid}/portal-users | 客户门户账号列表 | 登录用户 |

### 用户
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /users | 用户列表(别名) | 登录用户(非client) |

---


## 认证
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | /auth/login | 登录 | 公开 |
| GET  | /auth/users | 用户列表 | enterprise_admin |
| POST | /auth/users | 创建用户 | enterprise_admin |
| DELETE | /auth/users/{id} | 停用用户 | enterprise_admin |

## 部门
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /departments | 部门列表 | 登录用户 |
| POST | /departments | 创建部门 | enterprise_admin |

## 项目
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /projects | 项目列表(分页) | 登录用户 |
| POST | /projects | 创建项目 | 登录用户 |
| GET  | /projects/{id} | 项目详情 | 登录用户 |
| PUT  | /projects/{id} | 更新项目 | 登录用户 |

## 任务
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /tasks | 任务列表 | 登录用户 |
| POST | /tasks | 创建任务 | 登录用户 |
| PUT  | /tasks/{id} | 更新任务 | 登录用户 |

## 里程碑
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /milestones | 里程碑列表 | 登录用户 |
| POST | /milestones | 创建里程碑 | 登录用户 |

## 客户
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /customers | 客户列表 | 登录用户 |
| POST | /customers | 创建客户 | 登录用户 |

## 合同
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /contracts | 合同列表 | 登录用户 |
| POST | /contracts | 创建合同 | 登录用户 |

## 收款计划
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /payment-plans | 收款计划列表 | 登录用户 |
| POST | /payment-plans | 创建收款计划 | 登录用户 |

## 发票
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /invoices | 发票列表 | 登录用户 |
| POST | /invoices | 创建发票 | 登录用户 |
| PUT  | /invoices/{id}/red-invoice | 红冲 | 登录用户 |

## 回款
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /receipts | 回款列表 | 登录用户 |
| POST | /receipts | 登记回款 | 登录用户 |
| PUT  | /receipts/{id}/confirm | 确认回款 | finance |
| PUT  | /receipts/{id}/reverse | 冲销回款 | finance |
| GET  | /receipts/project/{id}/stats | 项目回款统计 | 登录用户 |

## 风险
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /risks | 风险列表 | 登录用户 |
| POST | /risks | 创建风险 | 登录用户 |
| POST | /risks/{id}/follow-up | 风险跟进 | 登录用户 |

## 看板 & 工作台
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /dashboard | 高管看板 | 登录用户 |
| GET  | /workbench | 个人工作台 | 登录用户 |

## 审批
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /approvals/templates | 审批模板 | 登录用户 |
| POST | /approvals/templates | 创建模板 | enterprise_admin |
| POST | /approvals/submit | 提交审批 | 登录用户 |
| GET  | /approvals/instances | 审批实例 | 登录用户 |
| GET  | /approvals/my-pending | 我的待批 | 登录用户 |
| PUT  | /approvals/instances/{id}/step/{sid} | 审批决策 | 登录用户 |

## 搜索、文件、导出
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /search | 全局搜索 | 登录用户 |
| POST | /files/upload | 上传文件 | 登录用户 |
| GET  | /files/list | 文件列表 | 登录用户 |
| GET  | /export/projects | 导出项目 | 登录用户 |
| GET  | /export/receipts | 导出回款 | 登录用户 |

## 系统
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET  | /health | 健康检查 | 公开 |
| GET  | /status | 系统状态 | 登录用户 |
| GET  | /notifications | 通知列表 | 登录用户 |
| PUT  | /notifications/{id}/read | 已读 | 登录用户 |
| PUT  | /notifications/read-all | 全部已读 | 登录用户 |
| GET  | /audit-logs | 审计日志 | 登录用户 |
| POST | /import/excel | Excel导入 | 登录用户 |

## 角色层级
super_admin(100) > enterprise_admin(90) > executive(80) > dept_head(70) > pm(60) > finance(50) > member(30)
