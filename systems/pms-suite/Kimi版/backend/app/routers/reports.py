import csv
import io
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from decimal import Decimal

from ..services import (confirmed_received, finance_summary, overdue_amount,
                        plan_allocated, project_progress, receivable_amount, risk_level)

router = APIRouter(tags=["报告"])


@router.get("/reports/project/{pid}/weekly")
def project_weekly(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """项目周报：本周进度/完成任务/新风险/财务快照/下周重点"""
    p = db.get(models.Project, pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    tasks = db.query(models.Task).filter(models.Task.project_id == pid).all()
    done_this_week = [t for t in tasks if t.status == "已完成" and t.updated_at
                      and t.updated_at.date() >= week_start]
    overdue_tasks = [t for t in tasks if t.status not in ("已完成", "已取消")
                     and t.due_date and t.due_date < today]
    risks = db.query(models.Risk).filter(models.Risk.project_id == pid).all()
    open_risks = [r for r in risks if r.status != "已关闭"]
    high = [r for r in open_risks if risk_level(r.probability, r.impact, r.due_date, r.status)[0] == "高"]
    fin = finance_summary(db, pid)
    plans = [pl for pl in db.query(models.PaymentPlan).filter(
        models.PaymentPlan.project_id == pid).all()
        if plan_allocated(db, pl.id) < Decimal(str(pl.amount))]  # 未全额核销=未收
    due_next_week = [pl for pl in plans
                     if pl.due_date and today <= pl.due_date <= today + timedelta(days=7)]
    return {
        "project": {"id": p.id, "code": p.code, "name": p.name, "stage": p.stage},
        "week_start": str(week_start), "generated_at": str(today),
        "progress": project_progress(db, pid),
        "done_this_week": [t.title for t in done_this_week],
        "overdue_tasks": [t.title for t in overdue_tasks],
        "open_risk_count": len(open_risks), "high_risk_count": len(high),
        "finance": fin,
        "next_week_plans": [{"due_date": str(pl.due_date), "amount": float(pl.amount)}
                            for pl in due_next_week],
    }


@router.get("/reports/receivables/daily")
def receivables_daily(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """回款日报 CSV：当日回款 + 当前应收/逾期快照"""
    today = date.today()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["日期", "项目", "回款金额", "状态", "银行流水号"])
    for pay in db.query(models.Payment).filter(models.Payment.pay_date == today).all():
        p = db.get(models.Project, pay.project_id)
        w.writerow([str(today), p.name if p else pay.project_id,
                    float(pay.amount), pay.status, pay.bank_serial or ""])
    w.writerow([])
    w.writerow(["项目", "应收合计", "逾期金额"])
    for p in db.query(models.Project).filter(models.Project.is_archived == False).all():  # noqa: E712
        w.writerow([p.name, receivable_amount(db, p.id), overdue_amount(db, p.id)])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue().encode("utf-8-sig")]),
                             media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=receivables_daily.csv"})
