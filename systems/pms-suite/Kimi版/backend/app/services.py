import json
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models


def audit(db: Session, user, action: str, obj_type: str, obj_id, before=None, after=None):
    db.add(models.AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else None,
        action=action, object_type=obj_type, object_id=str(obj_id) if obj_id is not None else None,
        before=json.dumps(before, ensure_ascii=False, default=str) if before is not None else None,
        after=json.dumps(after, ensure_ascii=False, default=str) if after is not None else None,
    ))


def customer_health(db: Session, customer_id: int) -> dict:
    """客户健康度(0-100)：应收逾期、回款率、高风险、近90天活跃度综合"""
    from .models import Activity, Customer, Project, Risk
    c = db.get(Customer, customer_id)
    if not c:
        return {"score": 0, "level": "未知", "factors": {}}
    projects = db.query(Project).filter(Project.customer_id == customer_id,
                                        Project.is_archived == False).all()  # noqa: E712
    score = 100.0
    factors = {}
    overdue = sum(overdue_amount(db, p.id) for p in projects)
    contract = sum(float(contract_amount(db, p.id)) for p in projects)
    if contract > 0:
        o_ratio = overdue / contract
        penalty = min(40, o_ratio * 100)
        score -= penalty
        factors["逾期扣减"] = round(penalty, 1)
    received = sum(confirmed_received(db, p.id) for p in projects)
    if contract > 0 and received / contract < 0.5:
        score -= 10
        factors["回款率低"] = -10
    high_risks = sum(1 for p in projects for r in db.query(Risk).filter(
        Risk.project_id == p.id, Risk.status != "已关闭")
        if risk_level(r.probability, r.impact, r.due_date, r.status)[0] == "高")
    if high_risks:
        penalty = min(20, high_risks * 5)
        score -= penalty
        factors["高风险扣减"] = -penalty
    recent = db.query(Activity).join(Project, Activity.project_id == Project.id).filter(
        Project.customer_id == customer_id,
        Activity.created_at >= datetime.now() - timedelta(days=90)).count()
    if recent == 0 and projects:
        score -= 10
        factors["90天无动态"] = -10
    score = max(0, round(score, 1))
    level = "健康" if score >= 80 else "关注" if score >= 60 else "预警"
    return {"score": score, "level": level, "factors": factors,
            "project_count": len(projects), "overdue_amount": round(overdue, 2)}


def activity(db: Session, project_id: int | None, user, action: str, detail: str = ""):
    db.add(models.Activity(project_id=project_id, actor_id=user.id if user else None,
                           action=action, detail=detail))


def project_progress(db: Session, project_id: int) -> float:
    """进度 = 已完成任务权重 / 全部任务权重（无任务时看里程碑）"""
    total, done = db.query(
        func.coalesce(func.sum(models.Task.weight), 0),
        func.coalesce(func.sum(models.Task.weight).filter(models.Task.status == "已完成"), 0),
    ).filter(models.Task.project_id == project_id, models.Task.status != "已取消").first()
    if total and total > 0:
        return round(float(done) / float(total) * 100, 1)
    mt, md = db.query(
        func.coalesce(func.sum(models.Milestone.weight), 0),
        func.coalesce(func.sum(models.Milestone.weight).filter(models.Milestone.status == "已完成"), 0),
    ).filter(models.Milestone.project_id == project_id).first()
    if mt and mt > 0:
        return round(float(md) / float(mt) * 100, 1)
    return 0.0


def confirmed_received(db: Session, project_id: int) -> Decimal:
    # 已冲销原回款与其负向冲销记录一并计入，合计自动回退
    v = db.query(func.coalesce(func.sum(models.Payment.amount), 0)).filter(
        models.Payment.project_id == project_id,
        models.Payment.status.in_(["已确认", "已冲销"])).scalar()
    return Decimal(str(v))


def invoiced_amount(db: Session, project_id: int) -> Decimal:
    v = db.query(func.coalesce(func.sum(models.Invoice.amount), 0)).filter(
        models.Invoice.project_id == project_id, models.Invoice.status == "已开票").scalar()
    return Decimal(str(v))


def contract_amount(db: Session, project_id: int) -> Decimal:
    v = db.query(func.coalesce(func.sum(models.Contract.amount), 0)).filter(
        models.Contract.project_id == project_id, models.Contract.status != "作废").scalar()
    return Decimal(str(v))


def planned_amount(db: Session, project_id: int) -> Decimal:
    v = db.query(func.coalesce(func.sum(models.PaymentPlan.amount), 0)).filter(
        models.PaymentPlan.project_id == project_id).scalar()
    return Decimal(str(v))


def plan_allocated(db: Session, plan_id: int) -> Decimal:
    """某应收节点已被确认回款核销的金额"""
    v = db.query(func.coalesce(func.sum(models.PaymentAllocation.amount), 0)).join(
        models.Payment, models.Payment.id == models.PaymentAllocation.payment_id).filter(
        models.PaymentAllocation.plan_id == plan_id,
        models.Payment.status.in_(["已确认", "已冲销"])).scalar()
    return Decimal(str(v))


def overdue_amount(db: Session, project_id: int) -> Decimal:
    """逾期应收 = 到期日在今天之前的未核销计划余额"""
    plans = db.query(models.PaymentPlan).filter(
        models.PaymentPlan.project_id == project_id, models.PaymentPlan.due_date < date.today()).all()
    total = Decimal("0")
    for p in plans:
        total += Decimal(str(p.amount)) - plan_allocated(db, p.id)
    return max(total, Decimal("0"))


def receivable_amount(db: Session, project_id: int) -> Decimal:
    """应收 = 已到期收款计划未核销余额"""
    plans = db.query(models.PaymentPlan).filter(
        models.PaymentPlan.project_id == project_id, models.PaymentPlan.due_date <= date.today()).all()
    total = Decimal("0")
    for p in plans:
        total += Decimal(str(p.amount)) - plan_allocated(db, p.id)
    return max(total, Decimal("0"))


def finance_summary(db: Session, project_id: int) -> dict:
    ca, pa = contract_amount(db, project_id), planned_amount(db, project_id)
    rec, inv = confirmed_received(db, project_id), invoiced_amount(db, project_id)
    ar = receivable_amount(db, project_id)
    rate = float(rec / ca * 100) if ca and ca > 0 else 0.0
    return {
        "contract_amount": float(ca), "planned_amount": float(pa),
        "received_amount": float(rec), "invoiced_amount": float(inv),
        "receivable_amount": float(ar), "uninvoiced_receivable": float(max(ar - inv, Decimal("0"))),
        "collection_rate": round(rate, 1),
    }


_RISK_SCORE = {"低": 1, "中": 2, "高": 3}


def risk_level(probability: str, impact: str, due_date=None, status: str = "开放"):
    """风险等级判定（含判定原因，非黑盒）"""
    p, i = _RISK_SCORE.get(probability, 2), _RISK_SCORE.get(impact, 2)
    score = p * i
    reasons = [f"概率={probability}({p})", f"影响={impact}({i})", f"乘积={score}"]
    overdue = due_date is not None and due_date < date.today() and status != "已关闭"
    if overdue:
        score += 2
        reasons.append("已过期(+2)")
    if score >= 7:
        level = "高"
    elif score >= 3:
        level = "中"
    else:
        level = "低"
    reasons.append(f"阈值判定: {level}(高>=7,中>=3)")
    return level, "；".join(reasons)
