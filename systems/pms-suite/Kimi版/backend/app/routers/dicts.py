from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user, require_perm
from ..services import audit

router = APIRouter(tags=["数据字典"])


class DictIn(BaseModel):
    group: str
    code: str
    label: str
    sort: int = 0
    is_active: bool = True


def _out(d: models.DictItem) -> dict:
    return {"id": d.id, "group": d.group, "code": d.code, "label": d.label,
            "sort": d.sort, "is_active": d.is_active}


@router.get("/dicts")
def list_dicts(group: str | None = None, db: Session = Depends(get_db),
               user=Depends(get_current_user)):
    q = db.query(models.DictItem)
    if group:
        q = q.filter(models.DictItem.group == group)
    return [_out(d) for d in q.order_by(models.DictItem.group, models.DictItem.sort,
                                        models.DictItem.id).all()]


@router.post("/dicts", status_code=201)
def create_dict(data: DictIn, db: Session = Depends(get_db),
                user=Depends(require_perm("*"))):
    d = models.DictItem(**data.model_dump())
    db.add(d)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "同组编码已存在")
    audit(db, user, "新增字典", "dict", d.id, after=data.model_dump())
    db.commit()
    return _out(d)


@router.put("/dicts/{did}")
def update_dict(did: int, data: DictIn, db: Session = Depends(get_db),
                user=Depends(require_perm("*"))):
    d = db.get(models.DictItem, did)
    if not d:
        raise HTTPException(404, "字典项不存在")
    before = _out(d)
    for k, v in data.model_dump().items():
        setattr(d, k, v)
    audit(db, user, "更新字典", "dict", d.id, before=before, after=data.model_dump())
    db.commit()
    return _out(d)


@router.delete("/dicts/{did}")
def delete_dict(did: int, db: Session = Depends(get_db), user=Depends(require_perm("*"))):
    d = db.get(models.DictItem, did)
    if not d:
        raise HTTPException(404, "字典项不存在")
    audit(db, user, "删除字典", "dict", d.id, before=_out(d))
    db.delete(d); db.commit()
    return {"ok": True}


def seed_default_dicts(db: Session) -> None:
    """内置默认字典（幂等）"""
    defaults = {
        "项目阶段": ["立项", "规划", "执行", "监控", "收尾"],
        "任务优先级": ["低", "中", "高"],
        "成本分类": ["人力", "采购", "差旅", "外包", "其他"],
        "回款方式": ["银行转账", "票据", "现金", "其他"],
    }
    for group, labels in defaults.items():
        for i, label in enumerate(labels):
            if not db.query(models.DictItem).filter(
                    models.DictItem.group == group, models.DictItem.code == label).first():
                db.add(models.DictItem(group=group, code=label, label=label, sort=i))
    db.commit()
