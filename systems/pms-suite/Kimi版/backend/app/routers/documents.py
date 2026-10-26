import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..db import get_db
from ..security import get_current_user
from ..services import activity, audit

router = APIRouter(tags=["文档"])

DOC_DIR = os.path.join(settings.storage_dir, "documents")
os.makedirs(DOC_DIR, exist_ok=True)
ALLOWED_EXT = {".txt", ".md", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
               ".png", ".jpg", ".jpeg", ".zip", ".csv"}
MAX_SIZE = 20 * 1024 * 1024


def _out(d: models.Document) -> dict:
    return {"id": d.id, "project_id": d.project_id, "task_id": d.task_id,
            "filename": d.filename, "size": d.size, "content_type": d.content_type,
            "uploader_id": d.uploader_id, "created_at": str(d.created_at)}


@router.get("/documents")
def list_docs(project_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_out(d) for d in db.query(models.Document).filter(
        models.Document.project_id == project_id).order_by(models.Document.id.desc()).all()]


@router.post("/documents", status_code=201)
async def upload_doc(project_id: int, file: UploadFile, task_id: int | None = None,
                     db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not db.get(models.Project, project_id):
        raise HTTPException(404, "项目不存在")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(422, f"不支持的文件类型 {ext}")
    content = await file.read()
    if not content:
        raise HTTPException(422, "空文件")
    if len(content) > MAX_SIZE:
        raise HTTPException(422, "文件超过 20MB 限制")
    stored = f"{project_id}_{uuid.uuid4().hex}{ext}"
    with open(os.path.join(DOC_DIR, stored), "wb") as f:
        f.write(content)
    d = models.Document(project_id=project_id, task_id=task_id, filename=file.filename or stored,
                        stored_path=stored, size=len(content),
                        content_type=file.content_type, uploader_id=user.id)
    db.add(d); db.flush()
    audit(db, user, "上传文档", "document", d.id, after={"filename": d.filename, "size": d.size})
    activity(db, project_id, user, "上传文档", d.filename)
    db.commit()
    return _out(d)


@router.get("/documents/{did}/download")
def download_doc(did: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = db.get(models.Document, did)
    if not d:
        raise HTTPException(404, "文档不存在")
    path = os.path.join(DOC_DIR, d.stored_path)
    if not os.path.exists(path):
        raise HTTPException(404, "文件已丢失")
    return FileResponse(path, filename=d.filename,
                        media_type=d.content_type or "application/octet-stream")


@router.delete("/documents/{did}")
def delete_doc(did: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = db.get(models.Document, did)
    if not d:
        raise HTTPException(404, "文档不存在")
    perms = {p for r in user.roles for p in (r.permissions or "").split(",")}
    if d.uploader_id != user.id and "*" not in perms:
        raise HTTPException(403, "仅上传人或管理员可删除")
    path = os.path.join(DOC_DIR, d.stored_path)
    if os.path.exists(path):
        os.remove(path)
    audit(db, user, "删除文档", "document", d.id, before={"filename": d.filename})
    db.delete(d); db.commit()
    return {"ok": True}
