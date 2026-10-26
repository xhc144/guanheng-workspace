"""项目、成员、进度和项目动态 API。"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import get_current_user, require_perm, check_project_access, project_query_for
from .. import models
from ..audit import audit, snapshot, log_activity
from ..services import calc_progress

router = APIRouter(prefix="/api/projects", tags=["projects"])

class ProjectIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    customer_id: int | None = None
    department_id: int | None = None
    manager_id: int | None = None
    stage: str | None = None
    status: str = "active"
    plan_start: date | None = None
    plan_end: date | None = None
    description: str | None = None
    progress_override: float | None = Field(default=None, ge=0, le=100)

class MemberIn(BaseModel):
    user_id: int
    role: str = "member"

PROJECT_FIELDS = ["code", "name", "status", "stage", "manager_id", "department_id", "customer_id", "plan_start", "plan_end", "actual_start", "actual_end", "progress_override", "description"]

def _out(project, db):
    return {"id": project.id, **{f: getattr(project, f) for f in PROJECT_FIELDS}, "progress": float(calc_progress(db, project)), "members": [{"user_id": m.user_id, "role": m.role} for m in project.members]}

@router.get("")
def list_projects(search: str | None = None, status: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), user=Depends(get_current_user)):
    query = project_query_for(user, db)
    if search:
        query = query.filter((models.Project.name.contains(search)) | (models.Project.code.contains(search)))
    if status:
        query = query.filter(models.Project.status == status)
    total = query.count()
    items = query.order_by(models.Project.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_out(p, db) for p in items], "total": total, "page": page, "page_size": page_size}

@router.post("")
def create_project(body: ProjectIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    if db.query(models.Project).filter_by(code=body.code).first():
        raise HTTPException(409, "项目编号已存在")
    manager_id = body.manager_id or user.id
    if not db.get(models.User, manager_id):
        raise HTTPException(422, "项目负责人不存在")
    data = body.model_dump()
    data["manager_id"] = manager_id
    project = models.Project(**data)
    db.add(project); db.flush()
    db.add(models.ProjectMember(project_id=project.id, user_id=manager_id, role="manager"))
    audit(db, user, "project", project.id, "create", after=snapshot(project, PROJECT_FIELDS))
    log_activity(db, project.id, user, "create", f"创建项目：{project.name}")
    db.commit(); db.refresh(project)
    return _out(project, db)

@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return _out(check_project_access(user, db, project_id), db)

@router.patch("/{project_id}")
def update_project(project_id: int, body: ProjectIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    project = check_project_access(user, db, project_id)
    before = snapshot(project, PROJECT_FIELDS)
    for key, value in body.model_dump(exclude_unset=True).items():
        if key != "code": setattr(project, key, value)
    audit(db, user, "project", project.id, "update", before=before, after=snapshot(project, PROJECT_FIELDS))
    log_activity(db, project.id, user, "update", f"更新项目：{project.name}")
    db.commit(); return _out(project, db)

@router.post("/{project_id}/members")
def add_member(project_id: int, body: MemberIn, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    project = check_project_access(user, db, project_id)
    if not db.get(models.User, body.user_id): raise HTTPException(422, "用户不存在")
    member = db.get(models.ProjectMember, {"project_id": project.id, "user_id": body.user_id})
    if member: member.role = body.role
    else: db.add(models.ProjectMember(project_id=project.id, user_id=body.user_id, role=body.role))
    audit(db, user, "project_member", project.id, "upsert", after=str(body.model_dump()))
    db.commit(); return {"ok": True}

@router.delete("/{project_id}/members/{user_id}")
def remove_member(project_id: int, user_id: int, db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    project = check_project_access(user, db, project_id)
    if user_id == project.manager_id: raise HTTPException(409, "不能移除项目负责人")
    member = db.get(models.ProjectMember, {"project_id": project.id, "user_id": user_id})
    if not member: raise HTTPException(404, "项目成员不存在")
    db.delete(member); audit(db, user, "project_member", project.id, "delete"); db.commit(); return {"ok": True}

@router.get("/{project_id}/activities")
def activities(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id)
    rows = db.query(models.Activity).filter_by(project_id=project_id).order_by(models.Activity.id.desc()).limit(200).all()
    return [{"id": x.id, "user_id": x.user_id, "action": x.action, "content": x.content, "created_at": x.created_at} for x in rows]

@router.get("/{project_id}/summary")
def project_summary(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    project = check_project_access(user, db, project_id)
    tasks = db.query(models.Task).filter_by(project_id=project_id).all()
    risks = db.query(models.Risk).filter_by(project_id=project_id).all()
    return {"project": _out(project, db), "task_total": len(tasks), "task_done": sum(t.status == "done" for t in tasks), "open_risks": sum(r.status != "closed" for r in risks)}
