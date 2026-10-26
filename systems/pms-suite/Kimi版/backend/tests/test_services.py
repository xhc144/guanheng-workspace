"""services 纯单元测试：风险等级判定、进度与财务口径（不依赖 HTTP）"""
import os
import tempfile
from datetime import date, timedelta

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mktemp(suffix='.db')}"

from app import models  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.services import (confirmed_received, finance_summary, plan_allocated,  # noqa: E402
                          project_progress, receivable_amount, risk_level)


def setup_module():
    Base.metadata.create_all(bind=engine)


def _session():
    return SessionLocal()


def test_risk_level_matrix_and_reason():
    lv, reason = risk_level("高", "高")
    assert lv == "高" and "乘积=9" in reason and "阈值判定" in reason
    lv, _ = risk_level("低", "低")
    assert lv == "低"
    lv, _ = risk_level("中", "中")
    assert lv == "中"
    # 过期加权：低*低=1 +2 = 3 → 中
    lv, reason = risk_level("低", "低", due_date=date.today() - timedelta(days=1))
    assert lv == "中" and "已过期(+2)" in reason
    # 已关闭不加权
    lv, _ = risk_level("低", "低", due_date=date.today() - timedelta(days=1), status="已关闭")
    assert lv == "低"


def test_progress_and_finance_rollback():
    s = _session()
    try:
        _run(s)
    finally:
        s.rollback()
        s.close()


def _run(s):
    p = models.Project(code="UT1", name="单元测试项目")
    s.add(p); s.flush()
    s.add_all([
        models.Task(project_id=p.id, title="t1", weight=1, status="已完成"),
        models.Task(project_id=p.id, title="t2", weight=3, status="进行中"),
        models.Task(project_id=p.id, title="t3", weight=1, status="已取消"),
    ])
    assert project_progress(s, p.id) == 25.0  # 1/(1+3)，已取消不计

    ct = models.Contract(code="UT-HT1", project_id=p.id, amount=100000)
    s.add(ct); s.flush()
    plan = models.PaymentPlan(contract_id=ct.id, project_id=p.id,
                              due_date=date.today() - timedelta(days=10), amount=60000)
    s.add(plan); s.flush()
    pay = models.Payment(project_id=p.id, amount=50000, pay_date=date.today(), status="已确认")
    s.add(pay); s.flush()
    s.add(models.PaymentAllocation(payment_id=pay.id, plan_id=plan.id, amount=50000))
    s.flush()

    assert confirmed_received(s, p.id) == 50000
    assert plan_allocated(s, plan.id) == 50000
    assert receivable_amount(s, p.id) == 10000
    fs = finance_summary(s, p.id)
    assert fs["collection_rate"] == 50.0

    # 冲销：原回款置已冲销 + 负向记录 → 全部回退
    pay.status = "已冲销"
    rev = models.Payment(project_id=p.id, amount=-50000, pay_date=date.today(),
                         status="已确认", reverses_id=pay.id)
    s.add(rev); s.flush()
    s.add(models.PaymentAllocation(payment_id=rev.id, plan_id=plan.id, amount=-50000))
    s.flush()
    assert confirmed_received(s, p.id) == 0
    assert plan_allocated(s, plan.id) == 0
    assert receivable_amount(s, p.id) == 60000
