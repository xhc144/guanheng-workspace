"""审批、预算、工时、文档、知识库、模板、字典、问题和变更 API。"""
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..core.config import BACKEND_DIR
from ..core.db import get_db
from ..deps import get_current_user, require_perm, check_project_access
from .. import models
from ..audit import audit, log_activity

router = APIRouter(prefix="/api", tags=["governance"])

class ApprovalTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    object_type: str = Field(min_length=1, max_length=50)
    active: bool = True
class ApprovalStartIn(BaseModel):
    template_id: int
    object_type: str
    object_id: int
    approver_ids: list[int] = Field(min_length=1)
class ApprovalDecisionIn(BaseModel):
    decision: str
    comment: str | None = None
class BudgetIn(BaseModel):
    project_id: int
    category: str
    amount: Decimal = Field(gt=0)
class CostIn(BaseModel):
    project_id: int
    category: str
    amount: Decimal = Field(gt=0)
    occurred_on: date | None = None
    description: str | None = None
class TimesheetIn(BaseModel):
    project_id: int
    task_id: int | None = None
    work_date: date
    hours: Decimal = Field(gt=0, le=24)
    description: str | None = None
class WikiIn(BaseModel):
    project_id: int
    title: str
    content: str = ""
class TemplateIn(BaseModel):
    name: str
    description: str | None = None
class TemplateItemIn(BaseModel):
    item_type: str
    name: str
    weight: Decimal = Field(default=1, gt=0)
class DictIn(BaseModel):
    dict_type: str
    code: str
    label: str
    sort_order: int = 0
class IssueIn(BaseModel):
    project_id: int
    title: str
    description: str | None = None
    status: str = "open"
    priority: str = "medium"
    owner_id: int | None = None
class ChangeIn(BaseModel):
    project_id: int
    title: str
    description: str | None = None
    impact: str | None = None


def _approval(x):
    return {"id": x.id, "template_id": x.template_id, "object_type": x.object_type, "object_id": x.object_id, "applicant_id": x.applicant_id, "status": x.status, "comment": x.comment, "steps": [{"id": s.id, "approver_id": s.approver_id, "step_order": s.step_order, "status": s.status, "comment": s.comment} for s in getattr(x, "steps", [])]}

def _budget(x):
    return {"id": x.id, "project_id": x.project_id, "category": x.category, "amount": str(x.amount), "status": x.status}

def _cost(x):
    return {"id": x.id, "project_id": x.project_id, "category": x.category, "amount": str(x.amount), "occurred_on": x.occurred_on, "description": x.description, "status": x.status}

def _timesheet(x):
    return {"id": x.id, "project_id": x.project_id, "task_id": x.task_id, "user_id": x.user_id, "work_date": x.work_date, "hours": str(x.hours), "description": x.description, "status": x.status}

# 审批
@router.get("/approvals/templates")
def list_approval_templates(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": x.id, "name": x.name, "object_type": x.object_type, "active": x.active} for x in db.query(models.ApprovalTemplate).order_by(models.ApprovalTemplate.id.desc()).all()]

@router.post("/approvals/templates")
def create_approval_template(body: ApprovalTemplateIn, db: Session = Depends(get_db), user=Depends(require_perm("approval:manage"))):
    x = models.ApprovalTemplate(**body.model_dump()); db.add(x); db.flush(); audit(db, user, "approval_template", x.id, "create"); db.commit(); return {"id": x.id}

@router.post("/approvals")
def start_approval(body: ApprovalStartIn, db: Session = Depends(get_db), user=Depends(require_perm("approval:submit"))):
    template = db.get(models.ApprovalTemplate, body.template_id)
    if not template or not template.active: raise HTTPException(404, "审批模板不存在或已停用")
    if body.object_type == "project": check_project_access(user, db, body.object_id)
    if any(not db.get(models.User, uid) for uid in body.approver_ids): raise HTTPException(422, "审批人不存在")
    x = models.ApprovalInstance(template_id=template.id, object_type=body.object_type, object_id=body.object_id, applicant_id=user.id)
    db.add(x); db.flush()
    for order, uid in enumerate(body.approver_ids, 1): db.add(models.ApprovalStep(instance_id=x.id, approver_id=uid, step_order=order))
    audit(db, user, "approval", x.id, "submit"); db.commit(); return {"id": x.id, "status": x.status}

@router.get("/approvals")
def list_approvals(db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.ApprovalInstance).filter((models.ApprovalInstance.applicant_id == user.id) | (models.ApprovalInstance.id.in_(db.query(models.ApprovalStep.instance_id).filter(models.ApprovalStep.approver_id == user.id))))
    return [_approval(x) for x in q.order_by(models.ApprovalInstance.id.desc()).all()]

@router.post("/approvals/{approval_id}/decision")
def decide_approval(approval_id: int, body: ApprovalDecisionIn, db: Session = Depends(get_db), user=Depends(require_perm("approval:approve"))):
    x = db.get(models.ApprovalInstance, approval_id)
    if not x: raise HTTPException(404, "审批不存在")
    step = db.query(models.ApprovalStep).filter_by(instance_id=x.id, approver_id=user.id, status="pending").order_by(models.ApprovalStep.step_order).first()
    if not step: raise HTTPException(403, "当前用户不是待审批人")
    if body.decision not in ("approve", "reject"): raise HTTPException(422, "审批决定无效")
    step.status = "approved" if body.decision == "approve" else "rejected"; step.comment = body.comment
    if body.decision == "reject": x.status = "rejected"; x.comment = body.comment
    elif not db.query(models.ApprovalStep).filter_by(instance_id=x.id, status="pending").filter(models.ApprovalStep.id != step.id).count(): x.status = "approved"
    audit(db, user, "approval", x.id, body.decision); db.commit(); return _approval(x)

# 预算与成本
@router.get("/budgets")
def list_budgets(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id); return [_budget(x) for x in db.query(models.Budget).filter_by(project_id=project_id).all()]

@router.post("/budgets")
def create_budget(body: BudgetIn, db: Session = Depends(get_db), user=Depends(require_perm("budget:manage"))):
    check_project_access(user, db, body.project_id); x = models.Budget(**body.model_dump()); db.add(x); db.flush(); audit(db, user, "budget", x.id, "create"); db.commit(); return _budget(x)

@router.get("/costs")
def list_costs(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id); return [_cost(x) for x in db.query(models.Cost).filter_by(project_id=project_id).all()]

@router.post("/costs")
def create_cost(body: CostIn, db: Session = Depends(get_db), user=Depends(require_perm("budget:manage"))):
    check_project_access(user, db, body.project_id); x = models.Cost(**body.model_dump()); db.add(x); db.flush(); audit(db, user, "cost", x.id, "create"); db.commit(); return _cost(x)

@router.get("/projects/{project_id}/budget-summary")
def budget_summary(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id)
    budget = sum((Decimal(x.amount) for x in db.query(models.Budget).filter_by(project_id=project_id)), Decimal("0"))
    cost = sum((Decimal(x.amount) for x in db.query(models.Cost).filter_by(project_id=project_id, status="approved")), Decimal("0"))
    return {"budget": str(budget), "cost": str(cost), "remaining": str(budget - cost), "usage_pct": float(cost / budget * 100) if budget else 0}

# 工时
@router.get("/timesheets")
def list_timesheets(project_id: int | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Timesheet).filter_by(user_id=user.id)
    if project_id: check_project_access(user, db, project_id); q = q.filter_by(project_id=project_id)
    return [_timesheet(x) for x in q.order_by(models.Timesheet.work_date.desc()).all()]

@router.post("/timesheets")
def create_timesheet(body: TimesheetIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    project = check_project_access(user, db, body.project_id)
    if body.task_id:
        task = db.get(models.Task, body.task_id)
        if not task or task.project_id != project.id: raise HTTPException(422, "任务不属于该项目")
    x = models.Timesheet(user_id=user.id, **body.model_dump()); db.add(x); db.flush(); audit(db, user, "timesheet", x.id, "create"); db.commit(); return _timesheet(x)

@router.post("/timesheets/{timesheet_id}/submit")
def submit_timesheet(timesheet_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    x = db.get(models.Timesheet, timesheet_id)
    if not x or x.user_id != user.id: raise HTTPException(404, "工时记录不存在")
    if x.status != "draft": raise HTTPException(409, "工时记录状态不可提交")
    x.status = "submitted"; db.commit(); return _timesheet(x)

# 文档
@router.get("/documents")
def list_documents(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id)
    return [{"id": x.id, "project_id": x.project_id, "filename": x.filename, "content_type": x.content_type, "size": x.size, "created_at": x.created_at} for x in db.query(models.Document).filter_by(project_id=project_id).all()]

@router.post("/documents")
def upload_document(project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(require_perm("document:manage"))):
    check_project_access(user, db, project_id)
    if not file.filename or Path(file.filename).suffix.lower() not in {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".txt"}: raise HTTPException(422, "不支持的文件类型")
    directory = (BACKEND_DIR / ".demo" / "uploads").resolve(); directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{uuid4().hex}{Path(file.filename).suffix.lower()}"
    data = file.file.read()
    if len(data) > 20 * 1024 * 1024: raise HTTPException(413, "文件不能超过20MB")
    target.write_bytes(data)
    x = models.Document(project_id=project_id, filename=file.filename, storage_path=str(target), content_type=file.content_type, size=len(data)); db.add(x); db.flush(); audit(db, user, "document", x.id, "upload"); db.commit(); return {"id": x.id, "filename": x.filename}

# Wiki、模板、字典、问题、变更
@router.get("/wiki")
def list_wiki(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id); return [{"id": x.id, "project_id": x.project_id, "title": x.title, "content": x.content, "version": x.version} for x in db.query(models.WikiPage).filter_by(project_id=project_id).all()]

@router.post("/wiki")
def create_wiki(body: WikiIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    check_project_access(user, db, body.project_id); x = models.WikiPage(**body.model_dump()); db.add(x); db.flush(); audit(db, user, "wiki", x.id, "create"); db.commit(); return {"id": x.id}

@router.get("/templates")
def list_templates(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": x.id, "name": x.name, "description": x.description} for x in db.query(models.ProjectTemplate).all()]

@router.post("/templates")
def create_template(body: TemplateIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    x = models.ProjectTemplate(**body.model_dump()); db.add(x); db.flush(); audit(db, user, "template", x.id, "create"); db.commit(); return {"id": x.id}

@router.post("/templates/{template_id}/items")
def add_template_item(template_id: int, body: TemplateItemIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    if not db.get(models.ProjectTemplate, template_id): raise HTTPException(404, "模板不存在")
    x = models.ProjectTemplateItem(template_id=template_id, **body.model_dump()); db.add(x); db.flush(); db.commit(); return {"id": x.id}

@router.get("/dicts/{dict_type}")
def list_dicts(dict_type: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": x.id, "code": x.code, "label": x.label, "sort_order": x.sort_order} for x in db.query(models.DictItem).filter_by(dict_type=dict_type, active=True).order_by(models.DictItem.sort_order).all()]

@router.post("/dicts")
def create_dict(body: DictIn, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    if db.query(models.DictItem).filter_by(dict_type=body.dict_type, code=body.code).first(): raise HTTPException(409, "字典编码已存在")
    x = models.DictItem(**body.model_dump()); db.add(x); db.flush(); audit(db, user, "dict", x.id, "create"); db.commit(); return {"id": x.id}

def _issue(x): return {"id": x.id, "project_id": x.project_id, "title": x.title, "description": x.description, "status": x.status, "priority": x.priority, "owner_id": x.owner_id}
def _change(x): return {"id": x.id, "project_id": x.project_id, "title": x.title, "description": x.description, "impact": x.impact, "status": x.status, "requester_id": x.requester_id}

@router.get("/issues")
def list_issues(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id); return [_issue(x) for x in db.query(models.Issue).filter_by(project_id=project_id).all()]

@router.post("/issues")
def create_issue(body: IssueIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    check_project_access(user, db, body.project_id); x = models.Issue(**body.model_dump()); db.add(x); db.flush(); audit(db, user, "issue", x.id, "create"); db.commit(); return _issue(x)

@router.get("/changes")
def list_changes(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id); return [_change(x) for x in db.query(models.ChangeRequest).filter_by(project_id=project_id).all()]

@router.post("/changes")
def create_change(body: ChangeIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    check_project_access(user, db, body.project_id); x = models.ChangeRequest(requester_id=user.id, **body.model_dump()); db.add(x); db.flush(); audit(db, user, "change", x.id, "create"); db.commit(); return _change(x)
