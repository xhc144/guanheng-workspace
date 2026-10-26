from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..services import activity, audit, project_progress

router = APIRouter(tags=["任务与里程碑"])


class MilestoneIn(BaseModel):
    name: str
    due_date: date | None = None
    weight: int = 1


class TaskIn(BaseModel):
    title: str
    parent_id: int | None = None
    milestone_id: int | None = None
    assignee_id: int | None = None
    priority: str = "中"
    due_date: date | None = None
    weight: int = 1
    est_hours: float | None = None


@router.post("/projects/{pid}/milestones", status_code=201)
def create_milestone(pid: int, data: MilestoneIn, db: Session = Depends(get_db),
                     user=Depends(get_current_user)):
    if not db.get(models.Project, pid):
        raise HTTPException(404, "项目不存在")
    m = models.Milestone(project_id=pid, **data.model_dump())
    db.add(m); db.flush()
    audit(db, user, "创建", "milestone", m.id, after=data.model_dump())
    activity(db, pid, user, "创建里程碑", m.name)
    db.commit()
    return {"id": m.id}


@router.patch("/milestones/{mid}")
def update_milestone(mid: int, data: dict, db: Session = Depends(get_db),
                     user=Depends(get_current_user)):
    m = db.get(models.Milestone, mid)
    if not m:
        raise HTTPException(404, "里程碑不存在")
    before = {"name": m.name, "status": m.status}
    for k in ("name", "due_date", "weight", "status"):
        if k in data:
            setattr(m, k, data[k])
    if data.get("status") == "已完成" and not m.completed_at:
        m.completed_at = datetime.now()
    audit(db, user, "更新", "milestone", m.id, before=before, after=data)
    activity(db, m.project_id, user, "更新里程碑", m.name)
    db.commit()
    return {"id": m.id, "project_progress": project_progress(db, m.project_id)}


@router.get("/tasks")
def list_tasks(project_id: int | None = None, assignee_id: int | None = None,
               status: str = "", db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Task)
    if project_id:
        q = q.filter(models.Task.project_id == project_id)
    if assignee_id:
        q = q.filter(models.Task.assignee_id == assignee_id)
    if status:
        q = q.filter(models.Task.status == status)
    today = date.today()
    return [{"id": t.id, "project_id": t.project_id, "parent_id": t.parent_id,
             "milestone_id": t.milestone_id, "title": t.title, "assignee_id": t.assignee_id,
             "priority": t.priority, "status": t.status, "weight": t.weight,
             "due_date": str(t.due_date) if t.due_date else None,
             "created_at": str(t.created_at),
             "overdue": bool(t.due_date and t.due_date < today and t.status not in ("已完成", "已取消"))}
            for t in q.order_by(models.Task.id).all()]


@router.post("/projects/{pid}/tasks", status_code=201)
def create_task(pid: int, data: TaskIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not db.get(models.Project, pid):
        raise HTTPException(404, "项目不存在")
    if data.parent_id and not db.get(models.Task, data.parent_id):
        raise HTTPException(404, "父任务不存在")
    t = models.Task(project_id=pid, **data.model_dump())
    db.add(t); db.flush()
    if t.assignee_id:
        db.add(models.Notification(user_id=t.assignee_id, type="任务分配",
                                   title=f"新任务: {t.title}", content=f"项目 {pid}"))
    audit(db, user, "创建", "task", t.id, after=data.model_dump())
    activity(db, pid, user, "创建任务", t.title)
    db.commit()
    return {"id": t.id}


@router.patch("/tasks/{tid}")
def update_task(tid: int, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = db.get(models.Task, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    before = {"title": t.title, "status": t.status, "assignee_id": t.assignee_id}
    old_status = t.status
    for k in ("title", "parent_id", "milestone_id", "assignee_id", "priority",
              "status", "due_date", "weight", "est_hours", "act_hours"):
        if k in data:
            setattr(t, k, data[k])
    if data.get("status") == "已完成" and old_status != "已完成":
        t.completed_at = datetime.now()
    if data.get("status") and data["status"] != "已完成":
        t.completed_at = None
    t.version += 1
    audit(db, user, "更新", "task", t.id, before=before, after={k: str(v) for k, v in data.items()})
    activity(db, t.project_id, user, "更新任务", f"{t.title}: {old_status}→{t.status}")
    db.flush()
    progress = project_progress(db, t.project_id)
    db.commit()
    return {"id": t.id, "status": t.status, "project_progress": progress}
