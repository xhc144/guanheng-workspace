# 直接财务入口补审

追加授权在冻结 `b3fbef42aa151d377375d5b6bf16c4ff61920168` 后由总控明确给出；只修改 Kimi `backend/app/routers/finance.py` 的现有10条路由及对应测试。不是全系统重构，没有修改 `security.py`、`projects.py`、播种角色或依赖声明。

| 路由 | 复用权限键 | 项目范围 |
| --- | --- | --- |
| GET `/contracts` | `contract:read` | 指定项目先核范围；无筛选仅可访问项目 |
| POST `/contracts` | `contract:create` | 请求项目先核范围，再查重/写入 |
| POST `/payment-plans` | `contract:update` | 请求项目与合同所属项目均可访问，且必须相同 |
| GET `/invoices` | `invoice:read` | 指定项目先核范围；无筛选仅可访问项目 |
| POST `/invoices` | `invoice:create` | 项目范围；可选合同须同项目 |
| POST `/invoices/{iid}/red-flush` | `invoice:update` | 现有发票项目；可选合同也须同项目 |
| GET `/payments` | `payment:read` | 指定项目先核范围；无筛选仅可访问项目 |
| POST `/payments` | `payment:create` | 请求项目、幂等命中项目、核销节点及其合同均核范围/一致性 |
| POST `/payments/{pid}/confirm` | `payment:confirm` | 回款项目、所有核销引用；先校验，再返回合法幂等结果 |
| POST `/payments/{pid}/reverse` | `payment:reverse` | 回款项目、所有核销引用；再检查状态并按原逻辑冲销 |

动作叶子由原 `require_perm` 解析；finance已有 `contract:* / invoice:* / payment:*`，admin已有 `*`，没有新增生产角色或另写权限策略。只读viewer和无财务权限PM不能直接读写财务路由；finance角色还必须是项目owner/member，或另有既有全局项目访问权限。测试同时保留纯finance owner/member正例，而非只用超级管理员掩盖项目范围问题。

关联检查不是重算或改写历史金额：项目外引用返回403；管理员可访问两端但引用跨项目时返回422。列表中的异常跨项目子计划/核销引用不返回。未提供修复历史异常数据的迁移，也没有删除源记录。

保留原金额计算、核销超额422、负向冲销、同项目幂等重试、重复银行流水409和重复冲销409。新增直接API审计失败注入，确认/冲销中途异常仍回滚；权限检查均在变更之前，合法原流程继续运行。

新测试 `backend/tests/test_finance_access.py` 复用此前隔离fixture，使用合成数据和已有Role模型。覆盖7类写操作的项目外财务人员/项目内只读人员拒绝、3个列表的范围与动作校验、4类合法角色完整金额/冲销流程、幂等绕过、跨项目外键引用和历史异常引用、审计失败回滚。结果、红测和命令见报告最新段及 `evidence/finance/`。
