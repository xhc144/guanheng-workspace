"""受权限与数据范围保护的数据导入、导出、备份和恢复 API。"""
import csv
import io
import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from ..core.config import DEMO_DB_PATH, BACKEND_DIR
from ..core.db import get_db
from ..deps import get_current_user, require_perm, project_query_for
from .. import models
from ..audit import audit

router = APIRouter(prefix="/api", tags=["data-operations"])
BACKUP_DIR = (BACKEND_DIR / ".demo" / "backups").resolve()

@router.get("/exports/projects.csv")
def export_projects(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = project_query_for(user, db).order_by(models.Project.id).all()
    output = io.StringIO(); writer = csv.writer(output); writer.writerow(["id", "code", "name", "status", "stage", "manager_id", "customer_id", "progress"])
    for p in rows: writer.writerow([p.id, p.code, p.name, p.status, p.stage or "", p.manager_id or "", p.customer_id or "", str(__import__('app.services', fromlist=['calc_progress']).calc_progress(db, p))])
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=projects.csv"})

@router.get("/exports/finance.csv")
def export_finance(db: Session = Depends(get_db), user=Depends(get_current_user)):
    allowed = {p.id for p in project_query_for(user, db).all()}
    rows = db.query(models.Contract).filter(models.Contract.project_id.in_(allowed)).order_by(models.Contract.id).all() if allowed else []
    output = io.StringIO(); writer = csv.writer(output); writer.writerow(["code", "name", "project_id", "amount", "status"])
    for c in rows: writer.writerow([c.code, c.name, c.project_id, str(c.amount), c.status])
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=finance.csv"})

@router.post("/imports/projects/preview")
def preview_projects(file: UploadFile = File(...), user=Depends(require_perm("project:manage"))):
    if not file.filename or Path(file.filename).suffix.lower() != ".csv": raise HTTPException(422, "仅支持CSV文件")
    raw = file.file.read()
    try: rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    except UnicodeDecodeError: raise HTTPException(422, "CSV必须使用UTF-8编码")
    errors = []; valid = []
    for index, row in enumerate(rows, 2):
        if not row.get("code") or not row.get("name"): errors.append({"row": index, "error": "code和name不能为空"})
        else: valid.append({"row": index, "code": row["code"], "name": row["name"]})
    return {"total": len(rows), "valid": len(valid), "errors": errors, "preview": valid[:100]}

@router.post("/imports/projects/commit")
def import_projects(file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(require_perm("project:manage"))):
    """将已预检的 UTF-8 CSV 写入可访问项目；重复编码跳过，返回逐行结果。"""
    if not file.filename or Path(file.filename).suffix.lower() != ".csv":
        raise HTTPException(422, "仅支持CSV文件")
    try:
        rows = list(csv.DictReader(io.StringIO(file.file.read().decode("utf-8-sig"))))
    except UnicodeDecodeError:
        raise HTTPException(422, "CSV必须使用UTF-8编码")
    created, skipped, errors = [], [], []
    for index, row in enumerate(rows, 2):
        code, name = (row.get("code") or "").strip(), (row.get("name") or "").strip()
        if not code or not name:
            errors.append({"row": index, "error": "code和name不能为空"}); continue
        if db.query(models.Project).filter_by(code=code).first():
            skipped.append({"row": index, "code": code, "reason": "项目编码已存在"}); continue
        project = models.Project(code=code, name=name, status=(row.get("status") or "active").strip(), stage=(row.get("stage") or None), manager_id=user.id, department_id=user.department_id)
        db.add(project); db.flush()
        db.add(models.ProjectMember(project_id=project.id, user_id=user.id, role="manager"))
        audit(db, user, "project", project.id, "import", after=json.dumps({"code": code, "name": name}, ensure_ascii=False))
        created.append({"row": index, "id": project.id, "code": code})
    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}

@router.get("/backups")
def list_backups(user=Depends(require_perm("org:manage"))):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return [{"name": p.name, "size": p.stat().st_size, "created_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat()} for p in sorted(BACKUP_DIR.glob("*.db"))]

@router.post("/backups")
def create_backup(db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    if not DEMO_DB_PATH.exists(): raise HTTPException(404, "演示数据库不存在")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True); target = BACKUP_DIR / f"demo-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    source = sqlite3.connect(str(DEMO_DB_PATH)); destination = sqlite3.connect(str(target))
    try: source.backup(destination)
    finally: destination.close(); source.close()
    audit(db, user, "backup", None, "create", after=json.dumps({"name": target.name})); db.commit()
    return {"name": target.name, "size": target.stat().st_size}

@router.get("/backups/{name}")
def download_backup(name: str, user=Depends(require_perm("org:manage"))):
    path = (BACKUP_DIR / name).resolve()
    if path.parent != BACKUP_DIR or path.suffix != ".db" or not path.exists(): raise HTTPException(404, "备份不存在")
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")

@router.post("/backups/{name}/restore")
def restore_backup(name: str, user=Depends(require_perm("org:manage"))):
    raise HTTPException(409, "恢复操作必须通过受控运维命令执行，避免在线覆盖当前连接数据库")
