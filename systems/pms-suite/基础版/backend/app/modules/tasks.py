"""任务、里程碑、依赖和项目进度 API。"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import get_current_user, require_perm, check_project_access
from .. import models
from ..audit import audit, log_activity
from ..services import calc_progress

router = APIRouter(prefix="/api", tags=["tasks"])

class TaskIn(BaseModel):
    project_id: int
    parent_id: int | None = None
    title: str = Field(min_length=1, max_length=200)
    status: str = "todo"
    priority: str = "medium"
    weight: float = Field(default=1, gt=0)
    progress: float = Field(default=0, ge=0, le=100)
    assignee_id: int | None = None
    due_date: date | None = None
    sort_order: int = 0

class MilestoneIn(BaseModel):
    project_id: int
    name: str = Field(min_length=1, max_length=200)
    due_date: date | None = None
    done: bool = False
    weight: float = Field(default=1, gt=0)

class DependencyIn(BaseModel):
    depends_on_id: int

def _task(t):
    return {"id": t.id, "project_id": t.project_id, "parent_id": t.parent_id, "title": t.title, "status": t.status, "priority": t.priority, "weight": float(t.weight), "progress": float(t.progress), "assignee_id": t.assignee_id, "due_date": t.due_date, "sort_order": t.sort_order}

def _milestone(m):
    return {"id": m.id, "project_id": m.project_id, "name": m.name, "due_date": m.due_date, "done": m.done, "weight": float(m.weight)}

@router.get("/projects/{project_id}/tasks")
def list_tasks(project_id: int, status: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id)
    q = db.query(models.Task).filter_by(project_id=project_id)
    if status: q = q.filter_by(status=status)
    return [_task(t) for t in q.order_by(models.Task.sort_order, models.Task.id).all()]

@router.post("/tasks")
def create_task(body: TaskIn, db: Session = Depends(get_db), user=Depends(require_perm("task:manage"))):
    project = check_project_access(user, db, body.project_id)
    if body.parent_id:
        parent = db.get(models.Task, body.parent_id)
        if not parent or parent.project_id != project.id: raise HTTPException(422, "父任务必须属于同一项目")
    if body.assignee_id and not db.get(models.User, body.assignee_id): raise HTTPException(422, "负责人不存在")
    task = models.Task(**body.model_dump()); db.add(task); db.flush()
    audit(db, user, "task", task.id, "create"); log_activity(db, project.id, user, "create", f"创建任务：{task.title}")
    db.commit(); db.refresh(task); return _task(task)

@router.patch("/tasks/{task_id}")
def update_task(task_id: int, body: dict, db: Session = Depends(get_db), user=Depends(require_perm("task:manage"))):
    task = db.get(models.Task, task_id)
    if not task: raise HTTPException(404, "任务不存在")
    check_project_access(user, db, task.project_id)
    allowed = {"title", "status", "priority", "progress", "assignee_id", "due_date", "sort_order", "weight", "parent_id"}
    for key, value in body.items():
        if key in allowed: setattr(task, key, value)
    if task.status == "done": task.progress = 100
    audit(db, user, "task", task.id, "update"); log_activity(db, task.project_id, user, "update", f"更新任务：{task.title}")
    db.commit(); return _task(task)

@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), user=Depends(require_perm("task:manage"))):
    task = db.get(models.Task, task_id)
    if not task: raise HTTPException(404, "任务不存在")
    check_project_access(user, db, task.project_id)
    if db.query(models.Task).filter_by(parent_id=task.id).count(): raise HTTPException(409, "存在子任务，不能删除")
    db.delete(task); audit(db, user, "task", task.id, "delete"); db.commit(); return {"ok": True}

@router.get("/projects/{project_id}/milestones")
def list_milestones(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    check_project_access(user, db, project_id)
    return [_milestone(x) for x in db.query(models.Milestone).filter_by(project_id=project_id).order_by(models.Milestone.id).all()]

@router.post("/milestones")
def create_milestone(body: MilestoneIn, db: Session = Depends(get_db), user=Depends(require_perm("task:manage"))):
    project = check_project_access(user, db, body.project_id); m = models.Milestone(**body.model_dump()); db.add(m); db.flush(); audit(db, user, "milestone", m.id, "create"); log_activity(db, project.id, user, "create", f"创建里程碑：{m.name}"); db.commit(); return _milestone(m)

@router.patch("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, body: dict, db: Session = Depends(get_db), user=Depends(require_perm("task:manage"))):
    m = db.get(models.Milestone, milestone_id)
    if not m: raise HTTPException(404, "里程碑不存在")
    check_project_access(user, db, m.project_id)
    for key in ("name", "due_date", "done", "weight"):
        if key in body: setattr(m, key, body[key])
    audit(db, user, "milestone", m.id, "update"); db.commit(); return _milestone(m)

@router.post("/tasks/{task_id}/dependencies")
def add_dependency(task_id: int, body: DependencyIn, db: Session = Depends(get_db), user=Depends(require_perm("task:manage"))):
    task = db.get(models.Task, task_id); dependency = db.get(models.Task, body.depends_on_id)
    if not task or not dependency: raise HTTPException(404, "任务不存在")
    check_project_access(user, db, task.project_id)
    if task.project_id != dependency.project_id or task.id == dependency.id: raise HTTPException(422, "依赖必须是同一项目中的其他任务")
    if db.get(models.TaskDependency, {"task_id": task.id, "depends_on_id": dependency.id}): return {"ok": True}
    # 从依赖节点沿边遍历，禁止形成回路。
    pending = [dependency.id]; seen = set()
    while pending:
        current = pending.pop()
        if current in seen: continue
        seen.add(current)
        if current == task.id: raise HTTPException(409, "任务依赖会形成循环")
        pending.extend(x.depends_on_id for x in db.query(models.TaskDependency).filter_by(task_id=current).all())
    db.add(models.TaskDependency(task_id=task.id, depends_on_id=dependency.id)); audit(db, user, "task_dependency", task.id, "create"); db.commit(); return {"ok": True}

@router.delete("/tasks/{task_id}/dependencies/{depends_on_id}")
def remove_dependency(task_id: int, depends_on_id: int, db: Session = Depends(get_db), user=Depends(require_perm("task:manage"))):
    task = db.get(models.Task, task_id)
    if not task: raise HTTPException(404, "任务不存在")
    check_project_access(user, db, task.project_id)
    row = db.get(models.TaskDependency, {"task_id": task_id, "depends_on_id": depends_on_id})
    if not row: raise HTTPException(404, "依赖不存在")
    db.delete(row); db.commit(); return {"ok": True}

@router.get("/projects/{project_id}/progress")
def project_progress(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    project = check_project_access(user, db, project_id)
    return {"project_id": project.id, "progress": float(calc_progress(db, project))}
