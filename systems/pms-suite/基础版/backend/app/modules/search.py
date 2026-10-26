"""带项目数据范围过滤的全局搜索和报表 API。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import get_current_user, project_query_for
from .. import models
from ..finance_service import receivable_summary, aging_buckets

router = APIRouter(prefix="/api", tags=["search-reports"])

@router.get("/search")
def search(q: str = Query(min_length=1, max_length=100), db: Session = Depends(get_db), user=Depends(get_current_user)):
    projects = project_query_for(user, db).filter((models.Project.name.contains(q)) | (models.Project.code.contains(q))).limit(20).all()
    ids = [x.id for x in projects]
    tasks = db.query(models.Task).filter(models.Task.project_id.in_(ids), models.Task.title.contains(q)).limit(20).all() if ids else []
    risks = db.query(models.Risk).filter(models.Risk.project_id.in_(ids), models.Risk.title.contains(q)).limit(20).all() if ids else []
    return {"projects": [{"id": x.id, "code": x.code, "name": x.name} for x in projects], "tasks": [{"id": x.id, "project_id": x.project_id, "title": x.title} for x in tasks], "risks": [{"id": x.id, "project_id": x.project_id, "title": x.title, "level": x.level} for x in risks]}

@router.get("/reports/portfolio")
def portfolio_report(db: Session = Depends(get_db), user=Depends(get_current_user)):
    projects = project_query_for(user, db).all()
    return {"total": len(projects), "by_status": {status: sum(x.status == status for x in projects) for status in ("active", "paused", "done", "archived")}, "by_stage": {stage or "未设置": sum(x.stage == stage for x in projects) for stage in {x.stage for x in projects}}}

@router.get("/reports/receivables")
def receivables_report(db: Session = Depends(get_db), user=Depends(get_current_user)):
    project_ids = [x.id for x in project_query_for(user, db).all()]
    result = receivable_summary(db) if len(project_ids) == db.query(models.Project).count() else {"projects": project_ids}
    result["aging"] = aging_buckets(db)
    return {k: str(v) if hasattr(v, "as_tuple") else v for k, v in result.items()}
