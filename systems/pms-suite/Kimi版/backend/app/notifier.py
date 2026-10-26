"""定时提醒：每日为逾期收款计划、到期风险生成站内通知（幂等，同同日同题不重复）"""
import threading
import time
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from . import models
from .services import plan_allocated


def _exists(db: Session, user_id: int, title: str) -> bool:
    day_start = datetime.combine(date.today(), datetime.min.time())
    return db.query(models.Notification).filter(
        models.Notification.user_id == user_id,
        models.Notification.title == title,
        models.Notification.created_at >= day_start).first() is not None


def _recipients(db: Session, project: models.Project) -> set[int]:
    ids = {m.user_id for m in project.members}
    if project.owner_id:
        ids.add(project.owner_id)
    return ids


def generate_daily_reminders(db: Session) -> dict:
    today = date.today()
    created = 0
    # 1. 逾期未收计划 → 项目成员与管理员提醒
    for plan in db.query(models.PaymentPlan).filter(models.PaymentPlan.due_date < today).all():
        if plan_allocated(db, plan.id) >= Decimal(str(plan.amount)):
            continue  # 已全额核销
        p = db.get(models.Project, plan.project_id)
        if not p or p.is_archived:
            continue
        title = f"逾期收款提醒: {p.name} {plan.due_date}"
        for uid in _recipients(db, p):
            if not _exists(db, uid, title):
                db.add(models.Notification(user_id=uid, type="逾期提醒", title=title,
                                           content=f"金额 {float(plan.amount)} 元"))
                created += 1
    # 2. 3 天内到期风险应对
    soon = today + timedelta(days=3)
    for r in db.query(models.Risk).filter(models.Risk.status != "已关闭",
                                          models.Risk.due_date != None,  # noqa: E711
                                          models.Risk.due_date <= soon).all():
        p = db.get(models.Project, r.project_id)
        if not p or p.is_archived:
            continue
        title = f"风险应对到期: {r.title}"
        for uid in _recipients(db, p):
            if not _exists(db, uid, title):
                db.add(models.Notification(user_id=uid, type="风险提醒", title=title,
                                           content=f"应对期限 {r.due_date}"))
                created += 1
    db.commit()
    return {"created": created}


def start_scheduler(app_db_session, interval_sec: int = 24 * 3600) -> None:
    """后台线程：启动即执行一次，之后每 interval_sec 执行"""
    def loop():
        while True:
            db = app_db_session()
            try:
                generate_daily_reminders(db)
            except Exception:
                db.rollback()
            finally:
                db.close()
            time.sleep(interval_sec)

    t = threading.Thread(target=loop, daemon=True)
    t.start()
