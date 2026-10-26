"""项目进度计算：Σ(权重×完成度)/Σ权重，任务与里程碑均计入；支持人工覆盖。"""
from decimal import Decimal
from sqlalchemy.orm import Session
from . import models


def calc_progress(db: Session, project: models.Project) -> Decimal:
    if project.progress_override is not None:
        return Decimal(project.progress_override).quantize(Decimal("0.01"))
    items: list[tuple[Decimal, Decimal]] = []  # (weight, progress%)
    for t in db.query(models.Task).filter_by(project_id=project.id).all():
        w = Decimal(t.weight)
        items.append((w, Decimal(t.progress)))
    for m in db.query(models.Milestone).filter_by(project_id=project.id).all():
        w = Decimal(m.weight)
        items.append((w, Decimal(100) if m.done else Decimal(0)))
    total_w = sum(w for w, _ in items)
    if total_w == 0:
        return Decimal("0.00")
    return (sum(w * p for w, p in items) / total_w).quantize(Decimal("0.01"))
