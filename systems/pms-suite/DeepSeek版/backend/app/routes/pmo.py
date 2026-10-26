"""PMO 扩展路由：甘特、日历、工时、资源负载、成本归集、文档版本、保存视图"""
import json
import shutil
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_role, ROLE_HIERARCHY
from app.database import get_db
from app.models import (
    Contract, Customer, Document, DocumentVersion, ExpenseEntry, Milestone,
    Project, ProjectMember, Receipt, SavedView, Task, TimesheetEntry, User,
)

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"


# ============ 甘特图 ============
gantt_router = APIRouter(prefix="/api/gantt", tags=["甘特图"])


def _task_payload(t: Task) -> dict:
    start = t.start_date or t.created_at
    end = t.due_date or start
    return {
        "id": t.id,
        "title": t.title,
        "status": t.status,
        "priority": t.priority,
        "assignee_id": t.assignee_id,
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "milestone_id": t.milestone_id,
        "parent_id": t.parent_id,
        "weight": t.weight,
    }


@gantt_router.get("/{project_id}")
def get_gantt(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    tasks = db.query(Task).filter(Task.project_id == project_id).order_by(Task.created_at).all()
    milestones = db.query(Milestone).filter(Milestone.project_id == project_id).order_by(Milestone.sort_order).all()
    return {
        "project": {
            "id": project.id, "name": project.name, "code": project.code,
            "planned_start": project.planned_start.isoformat() if project.planned_start else None,
            "planned_end": project.planned_end.isoformat() if project.planned_end else None,
            "progress": project.progress,
        },
        "tasks": [_task_payload(t) for t in tasks],
        "milestones": [
            {
                "id": m.id, "name": m.name, "status": m.status,
                "date": m.due_date.isoformat() if m.due_date else None,
                "weight": m.weight,
            }
            for m in milestones
        ],
    }


# ============ 日历视图 ============
calendar_router = APIRouter(prefix="/api/calendar", tags=["日历"])


@calendar_router.get("")
def get_calendar(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """返回起止范围内的任务与里程碑（带日期），供日历视图渲染。"""
    now = datetime.utcnow()
    start_dt = datetime.fromisoformat(start) if start else now.replace(day=1)
    end_dt = datetime.fromisoformat(end) if end else (start_dt + timedelta(days=62))

    task_q = db.query(Task).filter(Task.due_date.isnot(None), Task.due_date >= start_dt, Task.due_date <= end_dt)
    if project_id:
        task_q = task_q.filter(Task.project_id == project_id)
    ms_q = db.query(Milestone).filter(Milestone.due_date.isnot(None), Milestone.due_date >= start_dt, Milestone.due_date <= end_dt)
    if project_id:
        ms_q = ms_q.filter(Milestone.project_id == project_id)

    tasks = [
        {"id": t.id, "title": t.title, "project_id": t.project_id, "status": t.status,
         "due_date": t.due_date.isoformat(), "assignee_id": t.assignee_id, "type": "task"}
        for t in task_q.order_by(Task.due_date).all()
    ]
    milestones = [
        {"id": m.id, "name": m.name, "project_id": m.project_id, "status": m.status,
         "due_date": m.due_date.isoformat(), "type": "milestone"}
        for m in ms_q.order_by(Milestone.due_date).all()
    ]
    return {"tasks": tasks, "milestones": milestones}


# ============ 工时填报 ============
timesheet_router = APIRouter(prefix="/api/timesheets", tags=["工时"])


class TimesheetCreate(BaseModel):
    project_id: str
    task_id: Optional[str] = None
    work_date: datetime
    hours: Decimal
    description: str = ""


class TimesheetDecision(BaseModel):
    comment: str = ""


def _ts_payload(t: TimesheetEntry) -> dict:
    return {
        "id": t.id, "user_id": t.user_id, "project_id": t.project_id, "task_id": t.task_id,
        "work_date": t.work_date.isoformat() if t.work_date else None,
        "hours": float(t.hours or 0), "description": t.description,
        "status": t.status, "decided_by": t.decided_by, "decided_at": t.decided_at.isoformat() if t.decided_at else None,
        "decided_comment": t.decided_comment, "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@timesheet_router.get("")
def list_timesheets(
    user_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(TimesheetEntry)
    if user_id:
        q = q.filter(TimesheetEntry.user_id == user_id)
    if project_id:
        q = q.filter(TimesheetEntry.project_id == project_id)
    if status:
        q = q.filter(TimesheetEntry.status == status)
    if start:
        q = q.filter(TimesheetEntry.work_date >= datetime.fromisoformat(start))
    if end:
        q = q.filter(TimesheetEntry.work_date <= datetime.fromisoformat(end))
    return [_ts_payload(t) for t in q.order_by(TimesheetEntry.work_date.desc()).limit(500).all()]


@timesheet_router.post("")
def create_timesheet(req: TimesheetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.hours <= 0:
        raise HTTPException(status_code=400, detail="工时必须大于0")
    if req.hours > 24:
        raise HTTPException(status_code=400, detail="单日工时不能超过24小时")
    t = TimesheetEntry(
        user_id=current_user.id, project_id=req.project_id, task_id=req.task_id,
        work_date=req.work_date, hours=req.hours, description=req.description,
        status="submitted",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _ts_payload(t)


@timesheet_router.delete("/{entry_id}")
def delete_timesheet(entry_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(TimesheetEntry).filter(TimesheetEntry.id == entry_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="工时记录不存在")
    if t.user_id != current_user.id and ROLE_HIERARCHY.get(current_user.role, 0) < 60:
        raise HTTPException(status_code=403, detail="只能删除自己的工时记录")
    db.delete(t)
    db.commit()
    return {"ok": True}


def _can_decide(current_user: User) -> bool:
    return ROLE_HIERARCHY.get(current_user.role, 0) >= 60  # pm 及以上


@timesheet_router.post("/{entry_id}/approve")
def approve_timesheet(entry_id: str, req: TimesheetDecision, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _can_decide(current_user):
        raise HTTPException(status_code=403, detail="需要项目经理及以上角色审批工时")
    t = db.query(TimesheetEntry).filter(TimesheetEntry.id == entry_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="工时记录不存在")
    if t.status != "submitted":
        raise HTTPException(status_code=400, detail="只能审批已提交的工时")
    t.status = "approved"
    t.decided_by = current_user.id
    t.decided_at = datetime.utcnow()
    t.decided_comment = req.comment
    db.commit()
    return _ts_payload(t)


@timesheet_router.post("/{entry_id}/reject")
def reject_timesheet(entry_id: str, req: TimesheetDecision, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _can_decide(current_user):
        raise HTTPException(status_code=403, detail="需要项目经理及以上角色审批工时")
    t = db.query(TimesheetEntry).filter(TimesheetEntry.id == entry_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="工时记录不存在")
    if t.status != "submitted":
        raise HTTPException(status_code=400, detail="只能审批已提交的工时")
    t.status = "rejected"
    t.decided_by = current_user.id
    t.decided_at = datetime.utcnow()
    t.decided_comment = req.comment
    db.commit()
    return _ts_payload(t)


@timesheet_router.get("/summary/hours")
def timesheet_summary(
    project_id: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """按用户/项目聚合已提交+已审批工时。"""
    q = db.query(TimesheetEntry).filter(TimesheetEntry.status.in_(["submitted", "approved"]))
    if project_id:
        q = q.filter(TimesheetEntry.project_id == project_id)
    if start:
        q = q.filter(TimesheetEntry.work_date >= datetime.fromisoformat(start))
    if end:
        q = q.filter(TimesheetEntry.work_date <= datetime.fromisoformat(end))
    by_user: dict[str, float] = {}
    by_project: dict[str, float] = {}
    total = Decimal("0")
    for t in q.all():
        by_user[t.user_id] = round(by_user.get(t.user_id, 0) + float(t.hours or 0), 2)
        by_project[t.project_id] = round(by_project.get(t.project_id, 0) + float(t.hours or 0), 2)
        total += t.hours or Decimal("0")
    users = {u.id: u.real_name or u.username for u in db.query(User).filter(User.id.in_(by_user.keys())).all()} if by_user else {}
    projects = {p.id: p.name for p in db.query(Project).filter(Project.id.in_(by_project.keys())).all()} if by_project else {}
    return {
        "total_hours": float(total),
        "by_user": [{"user_id": k, "name": users.get(k, k), "hours": v} for k, v in by_user.items()],
        "by_project": [{"project_id": k, "name": projects.get(k, k), "hours": v} for k, v in by_project.items()],
    }


# ============ 资源负载 ============
resource_router = APIRouter(prefix="/api/resource-load", tags=["资源负载"])


@resource_router.get("")
def get_resource_load(
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """按成员统计进行中任务数与预估工时，判断负载状态。"""
    now = datetime.utcnow()
    horizon = now + timedelta(days=30)
    q = db.query(Task).filter(Task.status.in_(["todo", "in_progress", "review"]), Task.assignee_id.isnot(None))
    if project_id:
        q = q.filter(Task.project_id == project_id)
    tasks = q.all()

    per_user: dict[str, dict] = {}
    for t in tasks:
        item = per_user.setdefault(t.assignee_id, {"task_count": 0, "estimated_hours": Decimal("0"), "overdue_count": 0, "projects": set()})
        item["task_count"] += 1
        item["estimated_hours"] += t.estimated_hours or Decimal("0")
        if t.due_date and t.due_date < now and t.status != "done":
            item["overdue_count"] += 1
        item["projects"].add(t.project_id)

    user_ids = list(per_user.keys())
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    project_names = {p.id: p.name for p in db.query(Project).filter(Project.id.in_({pid for v in per_user.values() for pid in v["projects"]})).all()}

    result = []
    for uid, item in per_user.items():
        u = users.get(uid)
        est = float(item["estimated_hours"])
        capacity = 160.0  # 月容量 160 小时（约 8h × 20 工作日）
        load_pct = round(est / capacity * 100, 1) if capacity else 0
        if load_pct > 120:
            level = "overloaded"
        elif load_pct >= 80:
            level = "heavy"
        elif load_pct >= 40:
            level = "normal"
        else:
            level = "idle"
        result.append({
            "user_id": uid,
            "name": u.real_name or u.username if u else uid,
            "role": u.role if u else "",
            "task_count": item["task_count"],
            "estimated_hours": round(est, 1),
            "overdue_count": item["overdue_count"],
            "load_pct": load_pct,
            "level": level,
            "projects": [{"id": pid, "name": project_names.get(pid, pid)} for pid in item["projects"]],
        })
    result.sort(key=lambda x: -x["load_pct"])
    return {
        "items": result,
        "summary": {
            "total_users": len(result),
            "overloaded": sum(1 for r in result if r["level"] == "overloaded"),
            "heavy": sum(1 for r in result if r["level"] == "heavy"),
            "normal": sum(1 for r in result if r["level"] == "normal"),
            "idle": sum(1 for r in result if r["level"] == "idle"),
        },
    }


# ============ 成本归集 ============
expense_router = APIRouter(prefix="/api/expenses", tags=["成本"])


class ExpenseCreate(BaseModel):
    project_id: str
    category: str = "other"
    amount: Decimal
    expense_date: Optional[datetime] = None
    description: str = ""


def _exp_payload(e: ExpenseEntry) -> dict:
    return {
        "id": e.id, "project_id": e.project_id, "category": e.category,
        "amount": float(e.amount or 0),
        "expense_date": e.expense_date.isoformat() if e.expense_date else None,
        "description": e.description, "created_by": e.created_by,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


@expense_router.get("")
def list_expenses(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(ExpenseEntry)
    if project_id:
        q = q.filter(ExpenseEntry.project_id == project_id)
    return [_exp_payload(e) for e in q.order_by(ExpenseEntry.expense_date.desc()).limit(500).all()]


@expense_router.post("")
def create_expense(req: ExpenseCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    e = ExpenseEntry(
        project_id=req.project_id, category=req.category, amount=req.amount,
        expense_date=req.expense_date or datetime.utcnow(), description=req.description,
        created_by=current_user.id,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _exp_payload(e)


@expense_router.delete("/{expense_id}")
def delete_expense(expense_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    e = db.query(ExpenseEntry).filter(ExpenseEntry.id == expense_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="成本记录不存在")
    db.delete(e)
    db.commit()
    return {"ok": True}


# ============ 成本-利润分析 ============
cost_profit_router = APIRouter(prefix="/api/reports/cost-profit", tags=["成本利润"])


@cost_profit_router.get("")
def get_cost_profit(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    projects = db.query(Project).filter(Project.is_archived == False).all()
    rows = []
    for p in projects:
        budget = float(p.budget or 0)
        contract_amount = float(
            db.query(func.coalesce(func.sum(Contract.amount), 0)).filter(Contract.project_id == p.id).scalar() or 0
        )
        received = float(
            db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(Receipt.project_id == p.id, Receipt.status == "confirmed").scalar() or 0
        )
        expenses = float(
            db.query(func.coalesce(func.sum(ExpenseEntry.amount), 0)).filter(ExpenseEntry.project_id == p.id).scalar() or 0
        )
        approved_hours = float(
            db.query(func.coalesce(func.sum(TimesheetEntry.hours), 0))
            .filter(TimesheetEntry.project_id == p.id, TimesheetEntry.status == "approved").scalar() or 0
        )
        labor_cost = approved_hours * 150.0  # 默认人时费率 ¥150/小时
        total_cost = round(expenses + labor_cost, 2)
        profit = round(received - total_cost, 2)
        margin = round(profit / received * 100, 1) if received > 0 else 0
        rows.append({
            "project_id": p.id, "code": p.code, "name": p.name,
            "budget": budget, "contract_amount": contract_amount,
            "received": received, "expenses": expenses,
            "approved_hours": round(approved_hours, 1), "labor_cost": round(labor_cost, 2),
            "total_cost": total_cost, "profit": profit, "margin": margin,
        })
    rows.sort(key=lambda r: -r["received"])
    return rows


# ============ 文档版本管理 ============
doc_router = APIRouter(prefix="/api/documents", tags=["文档"])


def _doc_payload(d: Document, db: Session) -> dict:
    latest = db.query(DocumentVersion).filter(DocumentVersion.document_id == d.id).order_by(DocumentVersion.version_no.desc()).first()
    return {
        "id": d.id, "project_id": d.project_id, "name": d.name, "description": d.description,
        "created_by": d.created_by, "created_at": d.created_at.isoformat() if d.created_at else None,
        "latest_version": latest.version_no if latest else 0,
        "latest_file": latest.file_name if latest else "",
    }


@doc_router.get("")
def list_documents(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Document)
    if project_id:
        q = q.filter(Document.project_id == project_id)
    return [_doc_payload(d, db) for d in q.order_by(Document.updated_at.desc()).all()]


@doc_router.post("")
def create_document(req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project_id = req.get("project_id")
    name = (req.get("name") or "").strip()
    if not project_id or not name:
        raise HTTPException(status_code=400, detail="项目与文档名称必填")
    d = Document(project_id=project_id, name=name, description=req.get("description", ""), created_by=current_user.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _doc_payload(d, db)


@doc_router.get("/{doc_id}/versions")
def list_versions(doc_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    versions = db.query(DocumentVersion).filter(DocumentVersion.document_id == doc_id).order_by(DocumentVersion.version_no.desc()).all()
    return {
        "document": {"id": doc.id, "name": doc.name, "description": doc.description, "project_id": doc.project_id},
        "versions": [
            {
                "id": v.id, "version_no": v.version_no, "file_name": v.file_name,
                "file_size": v.file_size, "uploaded_by": v.uploaded_by, "notes": v.notes,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in versions
        ],
    }


@doc_router.post("/{doc_id}/versions")
async def upload_version(
    doc_id: str,
    file: UploadFile = File(...),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    latest = db.query(DocumentVersion).filter(DocumentVersion.document_id == doc_id).order_by(DocumentVersion.version_no.desc()).first()
    version_no = (latest.version_no + 1) if latest else 1
    save_dir = UPLOAD_DIR / doc_id
    save_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or f"v{version_no}").name
    dest = save_dir / f"v{version_no}_{safe_name}"
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
            size += len(chunk)
    v = DocumentVersion(
        document_id=doc_id, version_no=version_no, file_name=safe_name,
        file_path=str(dest), file_size=size, uploaded_by=current_user.id, notes=notes,
    )
    db.add(v)
    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(v)
    return {
        "id": v.id, "version_no": v.version_no, "file_name": v.file_name,
        "file_size": v.file_size, "uploaded_by": v.uploaded_by, "notes": v.notes,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@doc_router.get("/{doc_id}/versions/{version_id}/download")
def download_version(doc_id: str, version_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    v = db.query(DocumentVersion).filter(DocumentVersion.id == version_id, DocumentVersion.document_id == doc_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="版本不存在")
    path = Path(v.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(str(path), filename=v.file_name)


@doc_router.delete("/{doc_id}")
def delete_document(doc_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    doc_dir = UPLOAD_DIR / doc_id
    if doc_dir.exists():
        shutil.rmtree(doc_dir, ignore_errors=True)
    db.delete(doc)
    db.commit()
    return {"ok": True}


# ============ 保存列表视图 ============
view_router = APIRouter(prefix="/api/saved-views", tags=["保存视图"])


@view_router.get("")
def list_saved_views(page: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(SavedView).filter(SavedView.user_id == current_user.id)
    if page:
        q = q.filter(SavedView.page == page)
    return [
        {
            "id": v.id, "page": v.page, "name": v.name,
            "filters": json.loads(v.filters or "{}"), "is_default": v.is_default,
        }
        for v in q.order_by(SavedView.created_at.desc()).all()
    ]


@view_router.post("")
def create_saved_view(req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    page = (req.get("page") or "").strip()
    name = (req.get("name") or "").strip()
    if not page or not name:
        raise HTTPException(status_code=400, detail="页面与视图名称必填")
    v = SavedView(
        user_id=current_user.id, page=page, name=name,
        filters=json.dumps(req.get("filters", {}), ensure_ascii=False),
        is_default=bool(req.get("is_default", False)),
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return {"id": v.id, "page": v.page, "name": v.name, "filters": json.loads(v.filters), "is_default": v.is_default}


@view_router.delete("/{view_id}")
def delete_saved_view(view_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    v = db.query(SavedView).filter(SavedView.id == view_id, SavedView.user_id == current_user.id).first()
    if not v:
        raise HTTPException(status_code=404, detail="保存视图不存在")
    db.delete(v)
    db.commit()
    return {"ok": True}
