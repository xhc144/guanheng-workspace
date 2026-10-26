from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..services import audit

router = APIRouter(tags=["工时"])


class TimesheetIn(BaseModel):
    project_id: int
    task_id: int | None = None
    work_date: date
    hours: float
    content: str | None = None


def _out(t: models.Timesheet) -> dict:
    return {"id": t.id, "user_id": t.user_id, "project_id": t.project_id,
            "task_id": t.task_id, "work_date": str(t.work_date),
            "hours": float(t.hours), "content": t.content, "status": t.status}


@router.get("/timesheets")
def list_ts(mine: bool = True, project_id: int | None = None, status: str = "",
            db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Timesheet)
    if mine:
        q = q.filter(models.Timesheet.user_id == user.id)
    if project_id:
        q = q.filter(models.Timesheet.project_id == project_id)
    if status:
        q = q.filter(models.Timesheet.status == status)
    return [_out(t) for t in q.order_by(models.Timesheet.work_date.desc()).limit(300).all()]


@router.post("/timesheets", status_code=201)
def create_ts(data: TimesheetIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not (0 < data.hours <= 24):
        raise HTTPException(422, "工时需在 0-24 小时之间")
    if data.work_date > date.today():
        raise HTTPException(422, "不能填报未来日期")
    if not db.get(models.Project, data.project_id):
        raise HTTPException(404, "项目不存在")
    t = models.Timesheet(user_id=user.id, hours=Decimal(str(data.hours)), **data.model_dump(exclude={"hours"}))
    db.add(t); db.flush()
    audit(db, user, "填报工时", "timesheet", t.id, after={"hours": str(t.hours)})
    db.commit()
    return _out(t)


@router.post("/timesheets/{tid}/submit")
def submit_ts(tid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = db.get(models.Timesheet, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "工时不存在")
    if t.status == "待审批":
        return {**_out(t), "idempotent": True}
    t.status = "待审批"
    audit(db, user, "提交工时", "timesheet", t.id)
    db.commit()
    return _out(t)


@router.post("/timesheets/{tid}/review")
def review_ts(tid: int, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """审批工时：approve / reject（需管理权限或项目负责人）"""
    t = db.get(models.Timesheet, tid)
    if not t:
        raise HTTPException(404, "工时不存在")
    perms = {p for r in user.roles for p in (r.permissions or "").split(",")}
    project = db.get(models.Project, t.project_id)
    if "*" not in perms and (not project or project.owner_id != user.id):
        raise HTTPException(403, "仅管理员或项目负责人可审批工时")
    action = data.get("action")
    if action not in ("approve", "reject"):
        raise HTTPException(422, "action 需为 approve/reject")
    before = {"status": t.status}
    t.status = "已通过" if action == "approve" else "已退回"
    db.add(models.Notification(user_id=t.user_id, type="工时审批",
                               title=f"工时{t.status}: {t.work_date} {t.hours}h",
                               content=data.get("comment", "")))
    audit(db, user, "审批工时", "timesheet", t.id, before=before, after={"status": t.status})
    db.commit()
    return _out(t)


@router.get("/reports/workload")
def workload(days: int = 30, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """成员负载：近 N 天已通过工时按 人×项目 聚合"""
    since = date.today() - timedelta(days=days)
    rows = db.query(
        models.Timesheet.user_id, models.Timesheet.project_id,
        func.sum(models.Timesheet.hours)).filter(
        models.Timesheet.work_date >= since,
        models.Timesheet.status == "已通过").group_by(
        models.Timesheet.user_id, models.Timesheet.project_id).all()
    result: dict[int, dict] = {}
    for uid, pid, hours in rows:
        u = db.get(models.User, uid)
        p = db.get(models.Project, pid)
        entry = result.setdefault(uid, {"user_id": uid, "user_name": u.name if u else str(uid),
                                        "total_hours": 0.0, "projects": []})
        h = float(hours)
        entry["total_hours"] += h
        entry["projects"].append({"project_id": pid, "project_name": p.name if p else str(pid),
                                  "hours": h})
    for e in result.values():
        e["load_flag"] = "过载" if e["total_hours"] > days * 8 * 0.9 else \
            "闲置" if e["total_hours"] < days * 8 * 0.3 else "正常"
    return {"days": days, "members": sorted(result.values(), key=lambda x: -x["total_hours"])}
