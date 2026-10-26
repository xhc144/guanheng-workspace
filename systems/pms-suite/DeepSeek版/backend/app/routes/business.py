"""客户、项目、任务路由"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models import Customer, Project, ProjectMember, Task, Milestone, ActivityLog, User, Risk, RiskFollowUp, Issue, Receipt
from app.schemas import CustomerCreate, CustomerOut, ProjectCreate, ProjectOut, TaskCreate, TaskOut, MilestoneCreate, IssueCreate, IssueUpdate, RiskFollowUpCreate, ProjectSummary, PaginatedResponse
from app.auth import get_current_user

router = APIRouter(prefix="/api/customers", tags=["客户"])


@router.get("")
def list_customers(
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Customer).filter(Customer.is_active == True)
    if search:
        q = q.filter(Customer.name.contains(search))
    total = q.count()
    items = q.order_by(Customer.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("", response_model=CustomerOut)
def create_customer(req: CustomerCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = Customer(**req.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(Customer).filter(Customer.id == customer_id, Customer.is_active == True).first()
    if not c:
        raise HTTPException(status_code=404, detail="客户不存在")
    return c


proj_router = APIRouter(prefix="/api/projects", tags=["项目"])


@proj_router.get("")
def list_projects(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Project).filter(Project.is_archived == False)
    if search:
        q = q.filter(Project.name.contains(search) | Project.code.contains(search))
    if status:
        q = q.filter(Project.status == status)
    total = q.count()
    items = q.order_by(Project.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(items=[ProjectOut.model_validate(p) for p in items], total=total, page=page, page_size=page_size)


@proj_router.post("", response_model=ProjectOut)
def create_project(req: ProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if db.query(Project).filter(Project.code == req.code).first():
        raise HTTPException(status_code=400, detail="项目编号已存在")
    data = req.model_dump()
    data["manager_id"] = data.get("manager_id") or current_user.id
    p = Project(**data)
    db.add(p)
    db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=p.manager_id, role_in_project="manager"))
    db.add(ActivityLog(project_id=p.id, user_id=current_user.id, action="创建项目", detail=p.name))
    db.commit()
    db.refresh(p)
    return p


@proj_router.get("/summary", response_model=ProjectSummary)
def project_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """项目汇总统计。

    The current schema has no ``Project.actual_cost`` column.  Use confirmed
    receipts as the available, persisted financial aggregate instead of adding
    a risky runtime schema migration.
    """
    all_proj = db.query(Project).filter(Project.is_archived == False).all()
    total = len(all_proj)
    active = sum(1 for p in all_proj if p.status == "active")
    at_risk = sum(1 for p in all_proj if p.health in ("yellow", "red"))
    tasks = db.query(Task).all()
    done = sum(1 for t in tasks if t.status == "done")
    completion_rate = round(done / len(tasks) * 100, 1) if tasks else 0
    confirmed_receipts = {
        project_id: amount
        for project_id, amount in db.query(Receipt.project_id, func.coalesce(func.sum(Receipt.amount), 0))
        .filter(Receipt.status == "confirmed")
        .group_by(Receipt.project_id)
        .all()
    }
    budget_used = round(
        sum(
            float(confirmed_receipts.get(project.id, 0) or 0) / max(float(project.budget or 0), 1)
            for project in all_proj
        ) / max(total, 1) * 100,
        1,
    )
    return {"total": total, "active": active, "at_risk": at_risk, "completion_rate": completion_rate, "budget_used_pct": budget_used}


@proj_router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    return p


@proj_router.put("/{project_id}")
def update_project(project_id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    for k, v in req.items():
        if hasattr(p, k) and k not in ("id", "code", "created_at"):
            setattr(p, k, v)
    db.commit()
    return {"ok": True}


task_router = APIRouter(prefix="/api/tasks", tags=["任务"])


@task_router.get("")
def list_tasks(
    project_id: Optional[str] = Query(None),
    assignee_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Task)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    if assignee_id:
        q = q.filter(Task.assignee_id == assignee_id)
    if status:
        q = q.filter(Task.status == status)
    return q.order_by(Task.sort_order, Task.created_at.desc()).all()


@task_router.post("", response_model=TaskOut)
def create_task(req: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = Task(**req.model_dump())
    db.add(t)
    db.add(ActivityLog(project_id=t.project_id, user_id=current_user.id, action="创建任务", detail=t.title))
    db.commit()
    db.refresh(t)
    return t


@task_router.put("/batch-complete")
def batch_complete_tasks(req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Complete several tasks before the dynamic ``/{task_id}`` route matches."""
    ids = req.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="任务ID列表不能为空")
    tasks = db.query(Task).filter(Task.id.in_(ids)).all()
    for task in tasks:
        task.status = "done"
    for project_id in {task.project_id for task in tasks}:
        _recalc_project_progress(db, project_id)
    db.commit()
    return {"ok": True}


@task_router.put("/{task_id}")
def update_task(task_id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    old_status = t.status
    for k, v in req.items():
        if hasattr(t, k) and k not in ("id", "project_id", "created_at"):
            setattr(t, k, v)
    if old_status != t.status:
        db.add(ActivityLog(project_id=t.project_id, user_id=current_user.id, action=f"任务状态变更: {old_status} → {t.status}", detail=t.title))
    # 重新计算项目进度（在同一事务内）
    _recalc_project_progress(db, t.project_id)
    db.commit()
    return {"ok": True}


@task_router.delete("/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    pid = t.project_id
    db.delete(t)
    _recalc_project_progress(db, pid)
    db.commit()
    return {"ok": True}


milestone_router = APIRouter(prefix="/api/milestones", tags=["里程碑"])


@milestone_router.get("")
def list_milestones(project_id: str = Query(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Milestone).filter(Milestone.project_id == project_id).order_by(Milestone.sort_order).all()


@milestone_router.post("")
def create_milestone(req: MilestoneCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = Milestone(**req.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@milestone_router.put("/{milestone_id}")
def update_milestone(milestone_id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = db.query(Milestone).filter(Milestone.id == milestone_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="里程碑不存在")
    for k, v in req.items():
        if hasattr(m, k) and k not in ("id", "project_id", "created_at"):
            setattr(m, k, v)
    db.commit()
    return {"ok": True}


@milestone_router.delete("/{milestone_id}")
def delete_milestone(milestone_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = db.query(Milestone).filter(Milestone.id == milestone_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="里程碑不存在")
    db.delete(m)
    db.commit()
    return {"ok": True}


def _recalc_project_progress(db: Session, project_id: str):
    """基于任务权重计算项目进度"""
    tasks = db.query(Task).filter(Task.project_id == project_id, Task.parent_id == None).all()
    if not tasks:
        return
    total_weight = sum(t.weight for t in tasks)
    if total_weight == 0:
        return
    completed_weight = sum(t.weight for t in tasks if t.status == "done")
    progress = int(completed_weight / total_weight * 100)
    db.query(Project).filter(Project.id == project_id).update({"progress": progress})


risk_followup_router = APIRouter(prefix="/api/risks", tags=["风险跟进"])


@risk_followup_router.post("/{risk_id}/follow-ups")
def create_risk_followup(risk_id: str, req: RiskFollowUpCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(status_code=404, detail="风险不存在")
    f = RiskFollowUp(risk_id=risk_id, content=req.content, created_by=current_user.id)
    db.add(f)
    db.add(ActivityLog(project_id=risk.project_id, user_id=current_user.id, action="风险跟进", detail=req.content[:100]))
    db.commit()
    db.refresh(f)
    return f


@risk_followup_router.get("/{risk_id}/follow-ups")
def list_risk_followups(risk_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(RiskFollowUp).filter(RiskFollowUp.risk_id == risk_id).order_by(RiskFollowUp.created_at.desc()).all()


issue_router = APIRouter(prefix="/api/issues", tags=["问题"])

@issue_router.get("")
def list_issues(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Issue)
    if project_id:
        q = q.filter(Issue.project_id == project_id)
    return q.order_by(Issue.created_at.desc()).all()

@issue_router.post("")
def create_issue(req: IssueCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    issue = Issue(**req.model_dump())
    db.add(issue)
    db.add(ActivityLog(project_id=issue.project_id, user_id=current_user.id, action="记录问题", detail=issue.title))
    db.commit()
    db.refresh(issue)
    return issue

@issue_router.put("/{issue_id}")
def update_issue(issue_id: str, req: IssueUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="问题不存在")
    for k, v in req.model_dump(exclude_unset=True).items():
        if hasattr(issue, k):
            setattr(issue, k, v)
    db.commit()
    return issue


@issue_router.delete("/{issue_id}")
def delete_issue(issue_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="问题不存在")
    db.delete(issue)
    db.commit()
    return {"ok": True}
