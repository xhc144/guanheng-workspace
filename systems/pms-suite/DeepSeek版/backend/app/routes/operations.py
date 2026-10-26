"""风险、问题、看板、导入导出"""
from decimal import Decimal
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from io import BytesIO
from app.database import get_db
from app.models import (
    Risk, RiskFollowUp, Issue, Project, ProjectMember, Task, Receipt, Customer,
    Contract, ActivityLog, AuditLog, Notification, User
)
from app.schemas import RiskCreate, RiskFollowUpCreate, DashboardData
from app.auth import get_current_user

risk_router = APIRouter(prefix="/api/risks", tags=["风险"])


@risk_router.get("")
def list_risks(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Risk)
    if project_id:
        q = q.filter(Risk.project_id == project_id)
    return q.order_by(Risk.created_at.desc()).all()


@risk_router.post("")
def create_risk(req: RiskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # 自动计算风险等级
    prob_map = {"low": 1, "medium": 2, "high": 3}
    impact_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
    score = prob_map.get(req.probability, 2) * impact_map.get(req.impact, 2)
    if score <= 3:
        level = "low"
    elif score <= 6:
        level = "medium"
    elif score <= 9:
        level = "high"
    else:
        level = "critical"
    level_reason = f"概率={req.probability}({prob_map.get(req.probability,2)}) x 影响={req.impact}({impact_map.get(req.impact,2)}) = 评分{score} → 等级{level}"
    r = Risk(**req.model_dump(), risk_level=level, level_reason=level_reason)
    db.add(r)
    db.add(ActivityLog(project_id=r.project_id, user_id=current_user.id, action="登记风险", detail=r.title))
    db.flush()
    # 通知负责人
    if r.responsible_id:
        db.add(Notification(user_id=r.responsible_id, title=f"新风险分配: {r.title}", content=f"项目中的风险已分配给您，等级: {level}", ntype="risk", link=f"/projects/{r.project_id}"))
    db.commit()
    db.refresh(r)
    return r


def _parse_commitment_date(value):
    """接受 datetime 或 ISO 日期字符串，返回 datetime。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


@risk_router.post("/{risk_id}/follow-up")
def add_follow_up(risk_id: str, req: RiskFollowUpCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(status_code=404, detail="风险不存在")
    fu = RiskFollowUp(
        risk_id=risk_id,
        content=req.content,
        commitment_date=_parse_commitment_date(req.commitment_date),
        created_by=current_user.id,
    )
    db.add(fu)
    db.add(ActivityLog(project_id=risk.project_id, user_id=current_user.id, action="风险跟进", detail=req.content[:100]))
    db.commit()
    db.refresh(fu)
    return fu


@risk_router.delete("/{risk_id}")
def delete_risk(risk_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(Risk).filter(Risk.id == risk_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="风险不存在")
    db.delete(r)
    db.commit()
    return {"ok": True}


dashboard_router = APIRouter(prefix="/api/dashboard", tags=["看板"])


@dashboard_router.get("")
def get_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_projects = db.query(Project).filter(Project.is_archived == False).count()
    active_projects = db.query(Project).filter(Project.status == "active", Project.is_archived == False).count()
    total_contract_amount = db.query(func.coalesce(func.sum(Contract.amount), 0)).scalar() or Decimal("0")
    total_received = db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(Receipt.status == "confirmed").scalar() or Decimal("0")
    total_invoiced = db.query(func.coalesce(func.sum(Contract.amount), 0)).scalar() or Decimal("0")
    total_receivable = total_invoiced - total_received
    overdue_projects = db.query(Project).filter(Project.planned_end < now, Project.status == "active").count()
    high_risk_projects = db.query(Risk).filter(Risk.risk_level.in_(["high", "critical"]), Risk.status == "open").count()

    # 月度回款趋势（最近12个月）
    monthly_receipts = []
    for i in range(11, -1, -1):
        m_start = datetime(now.year, now.month, 1) - timedelta(days=i * 30)
        m_start = m_start.replace(day=1)
        if i == 0:
            m_end = now
        else:
            next_m = m_start.replace(day=28) + timedelta(days=4)
            m_end = next_m.replace(day=1) - timedelta(days=1)
        amt = db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(
            Receipt.received_date >= m_start, Receipt.received_date <= m_end, Receipt.status == "confirmed"
        ).scalar() or Decimal("0")
        monthly_receipts.append({"month": m_start.strftime("%Y-%m"), "amount": float(amt)})

    # 项目健康度分布
    health_dist = []
    for h in ["green", "yellow", "red"]:
        cnt = db.query(Project).filter(Project.health == h, Project.is_archived == False).count()
        health_dist.append({"health": h, "count": cnt})

    # TOP风险
    from sqlalchemy import case
    top_risks = []
    for r in db.query(Risk).filter(Risk.status == "open").order_by(
        case({"critical": 0, "high": 1, "medium": 2, "low": 3}, value=Risk.risk_level)
    ).limit(10).all():
        top_risks.append({"id": r.id, "title": r.title, "level": r.risk_level, "project_id": r.project_id})

    # 应收账龄（基于未收款发票/未核销合同）
    aging_0_30 = aging_31_60 = aging_61_90 = aging_90_plus = 0.0
    from app.models import Invoice
    unpaid = db.query(Invoice).filter(Invoice.status.in_(["issued", "partial_paid"])).all()
    for inv in unpaid:
        days = (now - (inv.due_date or inv.issued_date or now)).days
        amt = float(inv.amount or 0)
        if days <= 30: aging_0_30 += amt
        elif days <= 60: aging_31_60 += amt
        elif days <= 90: aging_61_90 += amt
        else: aging_90_plus += amt

    # 项目阶段分布
    stage_dist = []
    for stage in db.query(Project.stage, func.count(Project.id)).filter(Project.is_archived == False).group_by(Project.stage).all():
        stage_dist.append({"stage": stage[0] or "未设置", "count": stage[1]})

    # 项目状态分布
    status_dist = []
    for status, cnt in db.query(Project.status, func.count(Project.id)).filter(Project.is_archived == False).group_by(Project.status).all():
        status_dist.append({"status": status or "未设置", "count": cnt})

    return {
        "total_projects": total_projects,
        "active_projects": active_projects,
        "total_contract_amount": float(total_contract_amount),
        "total_received": float(total_received),
        "total_receivable": float(total_receivable),
        "total_budget": 0,
        "total_cost": 0,
        "overdue_projects": overdue_projects,
        "high_risk_projects": high_risk_projects,
        "monthly_receipts": monthly_receipts,
        "project_health_dist": health_dist,
        "top_risks": top_risks,
        "aging_0_30": aging_0_30,
        "aging_31_60": aging_31_60,
        "aging_61_90": aging_61_90,
        "aging_90_plus": aging_90_plus,
        "stage_dist": stage_dist,
        "status_dist": status_dist,
        "top_overdue": [],
        "top_receivable": [],
    }


@dashboard_router.get("/summary")
def get_dashboard_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """仪表盘摘要：仅返回关键KPI"""
    from decimal import Decimal
    now = datetime.utcnow()
    active = db.query(Project).filter(Project.status == "active", Project.is_archived == False).count()
    receipts = db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(Receipt.status == "confirmed").scalar() or Decimal("0")
    risks = db.query(Risk).filter(Risk.status == "open", Risk.risk_level.in_(["high", "critical"])).count()
    overdue = db.query(Project).filter(Project.planned_end < now, Project.status == "active").count()
    return {
        "active_projects": active,
        "total_received": float(receipts),
        "high_risk_count": risks,
        "overdue_projects": overdue,
        "generated_at": now.isoformat(),
    }


import_router = APIRouter(prefix="/api/import", tags=["导入"])


@import_router.post("/excel")
async def import_excel(file: UploadFile = File(...), import_type: str = Query("projects"), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Excel 导入：识别明细、排除合计行、输出错误报告"""
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=500, detail="需要安装 openpyxl")

    contents = await file.read()
    wb = openpyxl.load_workbook(BytesIO(contents), data_only=True)
    errors = []
    imported = 0

    if import_type == "projects":
        rows = []
        headers = []
        header_row = 0
        best_size = 0
        for ws in wb.worksheets:
            sheet_rows = list(ws.iter_rows(values_only=True))
            for pos, candidate in enumerate(sheet_rows[:10]):
                candidate_headers = [str(h or "").strip() for h in candidate]
                if ("项目编号" in candidate_headers and "客户名称" in candidate_headers
                        and len(sheet_rows) > best_size):
                    rows = sheet_rows
                    headers = candidate_headers
                    header_row = pos
                    best_size = len(sheet_rows)
                    break
        if not headers:
            return {"imported": 0, "errors": ["未找到项目明细表头"], "report": "导入失败：未找到项目编号和客户名称列"}

        for idx, row in enumerate(rows[header_row + 1:], start=header_row + 2):
            row_dict = dict(zip(headers, row))
            code = str(row_dict.get("项目编号", "")).strip()
            customer_name = str(row_dict.get("客户名称", "")).strip()
            name = str(row_dict.get("项目名称", "")).strip() or customer_name
            contract_amt_str = str(row_dict.get("合同金额", "")).strip()

            if not code or code.lower() in ("合计", "总计", "total", ""):
                continue
            if "合计" in name.lower() or "总计" in name.lower():
                continue

            if not name or not customer_name:
                errors.append(f"第{idx}行: 项目名称或客户名称为空")
                continue

            customer = db.query(Customer).filter(Customer.name == customer_name).first()
            if not customer:
                customer = Customer(name=customer_name)
                db.add(customer)
                db.flush()

            try:
                contract_amt = Decimal(str(contract_amt_str).replace(",", "").replace("¥", "").replace(" ", "") or "0")
            except Exception:
                contract_amt = Decimal("0")

            project = db.query(Project).filter(Project.code == code).first()
            if not project:
                p = Project(
                    code=code, name=name, customer_id=customer.id,
                    manager_id=current_user.id, budget=contract_amt
                )
                db.add(p)
                db.flush()
                db.add(ProjectMember(project_id=p.id, user_id=current_user.id, role_in_project="manager"))
                project = p
            else:
                project.name = name
                project.customer_id = customer.id
                project.budget = contract_amt

            contract = db.query(Contract).filter(Contract.project_id == project.id).first()
            if not contract and contract_amt > 0:
                contract = Contract(
                    project_id=project.id, code=f"HT-{code}", name=f"{name}合同",
                    amount=contract_amt, status="active"
                )
                db.add(contract)

            received_raw = row_dict.get("初始已收金额")
            try:
                received = Decimal(str(received_raw or "0").replace(",", "").replace("¥", ""))
            except Exception:
                received = Decimal("0")
            bank_ref = f"IMPORT-{code}"
            if received > 0 and not db.query(Receipt).filter(Receipt.bank_ref == bank_ref).first():
                db.add(Receipt(
                    project_id=project.id, amount=received, received_date=datetime.utcnow(),
                    payer=customer_name, bank_ref=bank_ref, status="confirmed",
                    confirmed_by=current_user.id, confirmed_at=datetime.utcnow(),
                    notes="Excel 初始已收金额导入"
                ))
            imported += 1

    elif import_type == "receipts":
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        headers = [str(h or "").strip() for h in rows[0]]
        for idx, row in enumerate(rows[1:], start=2):
            row_dict = dict(zip(headers, row))
            proj_code = str(row_dict.get("项目编号", "")).strip()
            payer = str(row_dict.get("付款方", "")).strip()
            amt_str = str(row_dict.get("回款金额", "")).strip()
            date_str = str(row_dict.get("回款日期", "")).strip()
            bank_ref = str(row_dict.get("银行流水号", "")).strip()

            if not proj_code or not payer or not amt_str:
                errors.append(f"第{idx}行: 必要字段为空")
                continue

            proj = db.query(Project).filter(Project.code == proj_code).first()
            if not proj:
                errors.append(f"第{idx}行: 项目编号 {proj_code} 不存在")
                continue

            try:
                amt = Decimal(amt_str.replace(",", "").replace("¥", "").replace(" ", "") or "0")
            except Exception:
                errors.append(f"第{idx}行: 回款金额格式错误")
                continue

            try:
                received_date = datetime.strptime(date_str, "%Y-%m-%d")
            except Exception:
                received_date = datetime.utcnow()

            db.add(Receipt(
                project_id=proj.id, amount=amt, payer=payer,
                received_date=received_date, bank_ref=bank_ref or None,
                status="draft"
            ))
            imported += 1

    db.commit()
    return {"imported": imported, "errors": errors, "report": f"成功导入 {imported} 条，{len(errors)} 条错误"}


workbench_router = APIRouter(prefix="/api/workbench", tags=["工作台"])


@workbench_router.get("")
def get_workbench(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    my_tasks = db.query(Task).filter(Task.assignee_id == current_user.id, Task.status != "done").order_by(Task.due_date.asc()).limit(20).all()
    due_today = [t for t in my_tasks if t.due_date and t.due_date.date() == now.date()]
    overdue = [t for t in my_tasks if t.due_date and t.due_date < now]
    unread_notifications = db.query(Notification).filter(Notification.user_id == current_user.id, Notification.is_read == False).count()
    subq = db.query(ProjectMember).filter(ProjectMember.user_id == current_user.id).subquery()
    my_projects = db.query(Project).join(subq, Project.id == subq.c.project_id).limit(10).all()
    # 最近活动
    recent = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(10).all()
    return {
        "my_tasks": len(my_tasks),
        "due_today": len(due_today),
        "overdue": len(overdue),
        "unread_notifications": unread_notifications,
        "recent_projects": [{"id": p.id, "name": p.name, "code": p.code} for p in my_projects],
        "recent_activities": [{"id": a.id, "action": a.action, "detail": a.detail, "time": a.created_at.isoformat()} for a in recent],
        "tasks": [{"id": t.id, "title": t.title, "status": t.status, "due_date": t.due_date, "project_id": t.project_id} for t in my_tasks[:10]],
        "task_status_counts": {
            "todo": db.query(Task).filter(Task.assignee_id == current_user.id, Task.status == "todo").count(),
            "in_progress": db.query(Task).filter(Task.assignee_id == current_user.id, Task.status == "in_progress").count(),
            "done": db.query(Task).filter(Task.assignee_id == current_user.id, Task.status == "done").count(),
        },
    }


notification_router = APIRouter(prefix="/api/notifications", tags=["通知"])


@notification_router.get("")
def list_notifications(unread_only: bool = False, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.is_read == False)
    return q.order_by(Notification.created_at.desc()).limit(50).all()


@notification_router.put("/{notification_id}/read")
def mark_read(notification_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == current_user.id).first()
    if n:
        n.is_read = True
        db.commit()
    return {"ok": True}


@notification_router.delete("/{notification_id}")
def delete_notification(notification_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == current_user.id).first()
    if not n:
        raise HTTPException(status_code=404, detail="通知不存在")
    db.delete(n)
    db.commit()
    return {"ok": True}


@notification_router.put("/read-all")
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Notification).filter(Notification.user_id == current_user.id, Notification.is_read == False).update({"is_read": True})
    db.commit()
    return {"ok": True}


audit_router = APIRouter(prefix="/api/audit-logs", tags=["审计日志"])


@audit_router.get("")
def list_audit_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).all()


activity_router = APIRouter(prefix="/api/activities", tags=["活动日志"])


@activity_router.get("")
def list_activities(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(ActivityLog).order_by(ActivityLog.created_at.desc())
    if project_id:
        q = q.filter(ActivityLog.project_id == project_id)
    return q.limit(100).all()
