from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..services import audit

router = APIRouter(tags=["知识库"])


class WikiIn(BaseModel):
    title: str
    content: str = ""


def _out(w: models.WikiPage) -> dict:
    return {"id": w.id, "project_id": w.project_id, "title": w.title,
            "content": w.content, "editor_id": w.editor_id, "updated_at": str(w.updated_at)}


@router.get("/projects/{pid}/wiki")
def list_pages(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_out(w) for w in db.query(models.WikiPage).filter(
        models.WikiPage.project_id == pid).order_by(models.WikiPage.updated_at.desc()).all()]


@router.post("/projects/{pid}/wiki", status_code=201)
def create_page(pid: int, data: WikiIn, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    if not db.get(models.Project, pid):
        raise HTTPException(404, "项目不存在")
    w = models.WikiPage(project_id=pid, title=data.title, content=data.content, editor_id=user.id)
    db.add(w); db.flush()
    audit(db, user, "新建Wiki", "wiki", w.id, after={"title": w.title})
    db.commit()
    return _out(w)


@router.put("/wiki/{wid}")
def update_page(wid: int, data: WikiIn, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    w = db.get(models.WikiPage, wid)
    if not w:
        raise HTTPException(404, "页面不存在")
    db.add(models.WikiHistory(page_id=w.id, content=w.content, editor_id=w.editor_id))
    before = {"title": w.title}
    w.title, w.content, w.editor_id = data.title, data.content, user.id
    audit(db, user, "编辑Wiki", "wiki", w.id, before=before, after={"title": w.title})
    db.commit()
    return _out(w)


@router.get("/wiki/{wid}/history")
def page_history(wid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not db.get(models.WikiPage, wid):
        raise HTTPException(404, "页面不存在")
    return [{"id": h.id, "editor_id": h.editor_id, "edited_at": str(h.edited_at),
             "content": h.content} for h in db.query(models.WikiHistory).filter(
                 models.WikiHistory.page_id == wid).order_by(
                 models.WikiHistory.id.desc()).all()]


@router.delete("/wiki/{wid}")
def delete_page(wid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    w = db.get(models.WikiPage, wid)
    if not w:
        raise HTTPException(404, "页面不存在")
    audit(db, user, "删除Wiki", "wiki", w.id, before={"title": w.title})
    db.query(models.WikiHistory).filter(models.WikiHistory.page_id == wid).delete()
    db.delete(w); db.commit()
    return {"ok": True}
