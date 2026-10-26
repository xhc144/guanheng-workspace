import io
import os
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..security import require_perm
from ..services import audit

router = APIRouter(tags=["备份"])


def build_backup(db_path: str) -> bytes:
    """打包 SQLite 数据库 + storage 附件目录为 zip 字节"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if os.path.exists(db_path):
            zf.write(db_path, arcname="app.db")
        if os.path.isdir(settings.storage_dir):
            for root, _dirs, files in os.walk(settings.storage_dir):
                for fn in files:
                    full = os.path.join(root, fn)
                    zf.write(full, arcname=os.path.relpath(full, settings.storage_dir))
    buf.seek(0)
    return buf.read()


@router.get("/admin/backup")
def download_backup(db=Depends(get_db), user=Depends(require_perm("*"))):
    """下载完整备份（数据库+附件），仅管理员"""
    db_url = settings.database_url
    db_path = db_url.replace("sqlite:///", "") if db_url.startswith("sqlite") else "app.db"
    data = build_backup(db_path)
    audit(db, user, "下载备份", "backup", 0)
    db.commit()
    name = f"pms_backup_{datetime.now():%Y%m%d_%H%M%S}.zip"
    return StreamingResponse(io.BytesIO(data), media_type="application/zip",
                             headers={"Content-Disposition": f"attachment; filename={name}"})
