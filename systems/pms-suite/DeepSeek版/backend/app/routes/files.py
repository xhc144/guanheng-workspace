"""文件上传与附件管理"""
import os, shutil, uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, ActivityLog
from app.auth import get_current_user
from app.routes.project_access import require_project
from pathlib import Path

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
router = APIRouter(prefix="/api/files", tags=["附件"])


def ensure_upload_dir():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload")
async def upload_file(
    project_id: str = Query(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project(db, current_user, project_id)
    # 文件大小限制 50MB
    contents = await file.read()
    if len(contents) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小不能超过 50MB")
    # 阻断危险扩展名
    blocked = {".exe", ".sh", ".bat", ".cmd", ".ps1", ".vbs", ".dll", ".so"}
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext in blocked:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")
    unique_name = f"{uuid.uuid4().hex}{ext}"
    project_dir = UPLOAD_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    file_path = project_dir / unique_name

    file_path.write_bytes(contents)

    db.add(ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="上传附件",
        detail=f"{file.filename} ({len(contents)} bytes)",
    ))
    db.commit()

    return {
        "id": unique_name,
        "filename": file.filename,
        "size": len(contents),
        "project_id": project_id,
        "uploaded_at": datetime.utcnow().isoformat(),
    }


@router.get("/list")
def list_files(
    project_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project(db, current_user, project_id)
    ensure_upload_dir()
    project_dir = UPLOAD_DIR / project_id
    if not project_dir.exists():
        return []
    files = []
    for f in project_dir.iterdir():
        if f.is_file():
            stat = f.stat()
            files.append({
                "id": f.name,
                "filename": f.name,
                "size": stat.st_size,
                "uploaded_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return files


@router.get("/download/{project_id}/{file_id}")
def download_file(
    project_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Check path traversal BEFORE any file access
    if ".." in file_id or ".." in project_id or "/" in file_id or "\\" in file_id:
        raise HTTPException(status_code=400, detail="非法路径")
    require_project(db, current_user, project_id)
    file_path = UPLOAD_DIR / project_id / file_id
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(file_path, filename=file_id)


@router.delete("/{project_id}/{file_id}")
def delete_file(
    project_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if ".." in file_id or ".." in project_id or "/" in file_id or "\\" in file_id:
        raise HTTPException(status_code=400, detail="非法路径")
    require_project(db, current_user, project_id)
    file_path = UPLOAD_DIR / project_id / file_id
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    os.remove(file_path)
    db.add(ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="删除附件",
        detail=file_id,
    ))
    db.commit()
    return {"ok": True}
