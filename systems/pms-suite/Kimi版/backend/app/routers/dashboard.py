from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..services import plan_allocated

router = APIRouter(tags=["看板"])


def _sum(db, model, col, *filters):
    return Decimal(str(db.query(func.coalesce(func.sum(col), 0)).filter(*filters).scalar()))


@router.get("/dashboard/executive")
def executive(db: Session = Depends(get_db), user=Depends(get_current_user)):
    today = date.today()
    projects = db.query(models.Project).filter(models.Project.is_archived == False).all()  # noqa: E712
    contract = _sum(db, models.Contract, models.Contract.amount, models.Contract.status != "作废")
    received = _sum(db, models.Payment, models.Payment.amount, models.Payment.status.in_(["已确认", "已冲销"]))
    invoiced = _sum(db, models.Invoice, models.Invoice.amount, models.Invoice.status == "已开票")

    receivable = Decimal("0")
    overdue_receivable = Decimal("0")
    plans = db.query(models.PaymentPlan).all()
    for pl in plans:
        rest = Decimal(str(pl.amount)) - plan_allocated(db, pl.id)
        if rest > 0 and pl.due_date <= today:
            receivable += rest
            overdue_receivable += rest

    delayed = [p for p in projects if p.plan_end and p.plan_end < today
               and p.status not in ("已完成", "已归档")]
    risks = db.query(models.Risk).filter(models.Risk.status != "已关闭").all()
    high_risks = sorted([r for r in risks if r.level == "高"],
                        key=lambda r: r.id)[:10]
    stage_dist, status_dist = {}, {}
    for p in projects:
        stage_dist[p.stage] = stage_dist.get(p.stage, 0) + 1
        status_dist[p.status] = status_dist.get(p.status, 0) + 1

    return {
        "generated_at": str(date.today()),
        "project_count": len(projects),
        "contract_amount": float(contract),
        "received_amount": float(received),
        "invoiced_amount": float(invoiced),
        "receivable_amount": float(receivable),
        "overdue_receivable": float(overdue_receivable),
        "collection_rate": round(float(received / contract * 100), 1) if contract > 0 else 0.0,
        "delayed_projects": [{"id": p.id, "code": p.code, "name": p.name,
                              "delay_days": (today - p.plan_end).days} for p in delayed][:10],
        "high_risks": [{"id": r.id, "project_id": r.project_id, "title": r.title,
                        "level": r.level, "reason": r.level_reason} for r in high_risks],
        "stage_distribution": stage_dist,
        "status_distribution": status_dist,
        "risk_level_distribution": {
            lv: sum(1 for r in risks if r.level == lv) for lv in ("高", "中", "低")},
    }


@router.get("/dashboard/receivables")
def receivables(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """应收看板：账龄、月度趋势、负责人敞口、高风险项目榜（全部动态计算）"""
    today = date.today()
    aging = {"0-30": Decimal("0"), "31-60": Decimal("0"), "61-90": Decimal("0"), "90+": Decimal("0")}
    monthly: dict[str, Decimal] = {}
    exposure: dict[int, Decimal] = {}
    project_ar: dict[int, Decimal] = {}
    plans = db.query(models.PaymentPlan).all()
    for pl in plans:
        rest = Decimal(str(pl.amount)) - plan_allocated(db, pl.id)
        if rest <= 0 or pl.due_date > today:
            continue
        days = (today - pl.due_date).days
        bucket = "0-30" if days <= 30 else "31-60" if days <= 60 else "61-90" if days <= 90 else "90+"
        aging[bucket] += rest
        month = pl.due_date.strftime("%Y-%m")
        monthly[month] = monthly.get(month, Decimal("0")) + rest
        proj = db.get(models.Project, pl.project_id)
        if proj:
            if proj.owner_id:
                exposure[proj.owner_id] = exposure.get(proj.owner_id, Decimal("0")) + rest
            project_ar[pl.project_id] = project_ar.get(pl.project_id, Decimal("0")) + rest

    received_monthly: dict[str, Decimal] = {}
    for p in db.query(models.Payment).filter(models.Payment.status.in_(["已确认", "已冲销"])).all():
        m = p.pay_date.strftime("%Y-%m")
        received_monthly[m] = received_monthly.get(m, Decimal("0")) + Decimal(str(p.amount))

    top = sorted(project_ar.items(), key=lambda kv: kv[1], reverse=True)[:10]
    return {
        "aging": {k: float(v) for k, v in aging.items()},
        "overdue_by_month": {k: float(v) for k, v in sorted(monthly.items())},
        "received_by_month": {k: float(v) for k, v in sorted(received_monthly.items())},
        "owner_exposure": [{"owner_id": k, "amount": float(v)}
                           for k, v in sorted(exposure.items(), key=lambda kv: kv[1], reverse=True)],
        "top_receivable_projects": [
            {"project_id": pid, "project_code": (db.get(models.Project, pid).code if db.get(models.Project, pid) else None),
             "project_name": (db.get(models.Project, pid).name if db.get(models.Project, pid) else None),
             "amount": float(v)} for pid, v in top],
    }


@router.get("/dashboard/workbench")
def workbench(db: Session = Depends(get_db), user=Depends(get_current_user)):
    today = date.today()
    my_tasks = db.query(models.Task).filter(
        models.Task.assignee_id == user.id, models.Task.status.notin_(["已完成", "已取消"])).all()
    today_due = [t for t in my_tasks if t.due_date == today]
    overdue = [t for t in my_tasks if t.due_date and t.due_date < today]
    my_risks = db.query(models.Risk).filter(
        models.Risk.owner_id == user.id, models.Risk.status != "已关闭").all()
    followups = db.query(models.RiskFollowup).join(models.Risk).filter(
        models.Risk.owner_id == user.id,
        models.RiskFollowup.promise_date <= today,
        models.Risk.status != "已关闭").all()
    notifs = db.query(models.Notification).filter(models.Notification.user_id == user.id)\
        .order_by(models.Notification.id.desc()).limit(20).all()
    my_projects = db.query(models.Project).join(models.ProjectMember).filter(
        models.ProjectMember.user_id == user.id, models.Project.is_archived == False).all()  # noqa: E712
    pending_approvals = [a for a in db.query(models.Approval).filter(
        models.Approval.status == "待审批").all()
        if str(user.id) in a.approver_ids.split(",")
        and [int(x) for x in a.approver_ids.split(",")][a.current_step] == user.id]
    return {
        "pending_approvals": [{"id": a.id, "type": a.type, "title": a.title} for a in pending_approvals],
        "my_tasks": [{"id": t.id, "title": t.title, "status": t.status, "project_id": t.project_id,
                      "due_date": str(t.due_date) if t.due_date else None} for t in my_tasks],
        "today_due": [{"id": t.id, "title": t.title} for t in today_due],
        "overdue_tasks": [{"id": t.id, "title": t.title,
                           "overdue_days": (today - t.due_date).days} for t in overdue],
        "pending_risks": [{"id": r.id, "title": r.title, "level": r.level} for r in my_risks],
        "pending_followups": [{"id": f.id, "risk_id": f.risk_id, "content": f.content,
                               "promise_date": str(f.promise_date)} for f in followups],
        "notifications": [{"id": n.id, "type": n.type, "title": n.title, "is_read": n.is_read,
                           "created_at": str(n.created_at)} for n in notifs],
        "recent_projects": [{"id": p.id, "code": p.code, "name": p.name, "status": p.status}
                            for p in my_projects[:5]],
    }

