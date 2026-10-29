from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user, require_perm
from ..services import activity, audit, finance_summary, project_progress

router = APIRouter(tags=["项目"])


def can_access_project(user, project) -> bool:
    perms = {p for r in user.roles for p in (r.permissions or "").split(",")}
    if "*" in perms or "project:*" in perms:
        return True
    if project.owner_id == user.id:
        return True
    return any(m.user_id == user.id for m in project.members)


def _require_member_management(user, project) -> None:
    """Granting project access requires management authority, not membership."""
    require_perm("project:update")(user=user)
    perms = {p for r in user.roles for p in (r.permissions or "").split(",")}
    if "*" not in perms and "project:*" not in perms and project.owner_id != user.id:
        raise HTTPException(403, "无权维护该项目成员")


class ProjectIn(BaseModel):
    code: str
    name: str
    customer_id: int | None = None
    department_id: int | None = None
    owner_id: int | None = None
    priority: str = "中"
    stage: str = "执行"
    plan_start: date | None = None
    plan_end: date | None = None
    budget: float = 0
    description: str | None = None


def project_out(db, p: models.Project) -> dict:
    fs = finance_summary(db, p.id)
    today = date.today()
    remaining = (p.plan_end - today).days if p.plan_end else None
    return {"id": p.id, "code": p.code, "name": p.name, "customer_id": p.customer_id,
            "customer_name": p.customer.name if p.customer else None,
            "owner_id": p.owner_id, "priority": p.priority, "stage": p.stage, "status": p.status,
            "plan_start": str(p.plan_start) if p.plan_start else None,
            "plan_end": str(p.plan_end) if p.plan_end else None,
            "budget": float(p.budget or 0), "progress": project_progress(db, p.id),
            "remaining_days": remaining, "is_archived": p.is_archived, **fs}


@router.get("/projects")
def list_projects(q: str = "", status: str = "", customer_id: int | None = None,
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    query = db.query(models.Project).filter(models.Project.is_archived == False)  # noqa: E712
    if q:
        like = f"%{q}%"
        query = query.filter(models.Project.name.like(like) | models.Project.code.like(like))
    if status:
        query = query.filter(models.Project.status == status)
    if customer_id:
        query = query.filter(models.Project.customer_id == customer_id)
    return [project_out(db, p) for p in query.order_by(models.Project.id.desc()).all()
            if can_access_project(user, p)]


@router.post("/projects", status_code=201)
def create_project(data: ProjectIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if db.query(models.Project).filter(models.Project.code == data.code).first():
        raise HTTPException(409, "项目编号已存在")
    p = models.Project(**data.model_dump())
    if p.owner_id is None:
        p.owner_id = user.id
    db.add(p); db.flush()
    db.add(models.ProjectMember(project_id=p.id, user_id=p.owner_id, role_in_project="负责人"))
    audit(db, user, "创建", "project", p.id, after=data.model_dump())
    activity(db, p.id, user, "创建项目", p.name)
    db.commit()
    return {"id": p.id, "code": p.code}


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.get(models.Project, pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    if not can_access_project(user, p):
        raise HTTPException(403, "无权访问该项目")
    out = project_out(db, p)
    out["members"] = [{"id": m.id, "user_id": m.user_id, "role": m.role_in_project} for m in p.members]
    out["milestones"] = [{"id": m.id, "name": m.name, "due_date": str(m.due_date) if m.due_date else None,
                          "status": m.status, "weight": m.weight} for m in p.milestones]
    out["task_stats"] = {
        "total": sum(1 for t in p.tasks if t.status != "已取消"),
        "done": sum(1 for t in p.tasks if t.status == "已完成"),
        "overdue": sum(1 for t in p.tasks if t.due_date and t.due_date < date.today() and t.status not in ("已完成", "已取消")),
    }
    out["recent_activities"] = [
        {"id": a.id, "action": a.action, "detail": a.detail, "created_at": str(a.created_at)}
        for a in db.query(models.Activity).filter(models.Activity.project_id == pid)
        .order_by(models.Activity.id.desc()).limit(20).all()]
    return out


@router.patch("/projects/{pid}")
def update_project(pid: int, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.get(models.Project, pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    if not can_access_project(user, p):
        raise HTTPException(403, "无权修改该项目")
    if "owner_id" in data and data["owner_id"] != p.owner_id:
        # Otherwise a member could take ownership and then grant project access.
        _require_member_management(user, p)
    before = {k: str(getattr(p, k, None)) for k in data.keys() if hasattr(p, k)}
    for k in ("name", "customer_id", "department_id", "owner_id", "priority", "stage",
              "status", "plan_start", "plan_end", "actual_start", "actual_end",
              "budget", "description", "is_archived"):
        if k in data:
            setattr(p, k, data[k])
    p.version += 1
    audit(db, user, "更新", "project", p.id, before=before, after={k: str(v) for k, v in data.items()})
    activity(db, p.id, user, "更新项目", ",".join(data.keys()))
    db.commit()
    return {"id": p.id, "progress": project_progress(db, p.id)}


@router.post("/projects/{pid}/members", status_code=201)
def add_member(pid: int, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.get(models.Project, pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    _require_member_management(user, p)
    uid = data.get("user_id")
    target = db.get(models.User, uid)
    if not target:
        raise HTTPException(404, "用户不存在")
    if not target.is_active:
        raise HTTPException(422, "用户已停用")
    if any(m.user_id == uid for m in p.members):
        raise HTTPException(409, "已是项目成员")
    m = models.ProjectMember(project_id=pid, user_id=uid, role_in_project=data.get("role", "成员"))
    db.add(m)
    audit(db, user, "添加成员", "project", pid, after={"user_id": uid})
    activity(db, pid, user, "添加成员", f"user_id={uid}")
    db.commit()
    return {"id": m.id}


@router.get("/projects/{pid}/finance")
def project_finance(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.get(models.Project, pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    if not can_access_project(user, p):
        raise HTTPException(403, "无权访问该项目")
    return {"project_id": pid, **finance_summary(db, pid)}
