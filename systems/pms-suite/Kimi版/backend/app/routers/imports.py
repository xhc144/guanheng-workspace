import io
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user, require_perm
from ..services import audit
from .projects import can_access_project

router = APIRouter(tags=["导入导出"])

HEADER_ALIASES = {
    "code": ["项目编号", "编号", "项目代码"],
    "name": ["项目名称"],
    "customer": ["客户", "客户名称"],
    "owner": ["负责人", "项目经理"],
    "contract": ["合同金额", "合同额", "金额"],
    "received": ["已收", "已收款", "回款", "已回款"],
    "receivable": ["应收", "应收回款", "应收款"],
    "period": ["月份", "期间", "应收月份"],
    "due": ["应收日期", "计划日期", "到期日"],
}


def _norm_period(v: str) -> str | None:
    """2024.06 / 2024-06 / 2024年6月 → 2024-06"""
    m = re.match(r"^\s*(\d{4})[.\-/年](\d{1,2})", str(v or ""))
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    return None


def _dec(v) -> Decimal | None:
    if v is None or str(v).strip() == "":
        return None
    s = re.sub(r"[,\s¥￥]", "", str(v))
    try:
        value = Decimal(s)
    except InvalidOperation:
        raise ValueError("金额必须是有效数字") from None
    if not value.is_finite() or value < 0:
        raise ValueError("金额必须是非负有限数字")
    return value


def _find_headers(rows) -> tuple[int, dict[str, int]] | None:
    for idx, row in enumerate(rows[:10]):
        mapping: dict[str, int] = {}
        for ci, cell in enumerate(row):
            text = str(cell or "").strip()
            for key, aliases in HEADER_ALIASES.items():
                if key not in mapping and any(a in text for a in aliases):
                    mapping[key] = ci
        if "code" in mapping and "customer" in mapping:
            return idx, mapping
    return None


@router.post("/imports/projects")
async def import_projects(file: UploadFile, db: Session = Depends(get_db),
                          user=Depends(get_current_user)):
    """导入项目/应收 Excel：识别明细行、排除无编号合计行、逐行错误报告、幂等更新"""
    import openpyxl

    raw = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
    except Exception:
        raise HTTPException(422, "无法解析文件，请上传 .xlsx")
    report = {"created": 0, "updated": 0, "skipped": 0, "errors": []}
    # sqlite3's legacy transaction mode does not BEGIN for SELECT. Ensure the
    # row SAVEPOINTs belong to the request transaction, rather than committing
    # on RELEASE before the final audit/commit succeeds.
    connection = db.connection()
    if connection.dialect.name == "sqlite" and not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN")
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        found = _find_headers(rows)
        if not found:
            continue
        hi, mapping = found
        for ri, row in enumerate(rows[hi + 1:], start=hi + 2):
            try:
                get = lambda key: row[mapping[key]] if key in mapping and mapping[key] < len(row) else None  # noqa: E731
                code = str(get("code") or "").strip()
                customer_name = str(get("customer") or "").strip()
                name = str(get("name") or "").strip()
                if not code or code.lower() in ("none", ""):
                    if name and ("合计" in name or "总计" in name or "小计" in name):
                        report["skipped"] += 1
                        continue
                    if not name:
                        continue
                    report["errors"].append({"row": ri, "message": "缺少项目编号"})
                    continue
                if "合计" in code or "总计" in code:
                    report["skipped"] += 1
                    continue
                if not name:
                    report["errors"].append({"row": ri, "message": f"编号 {code} 缺少项目名称"})
                    continue

                project = db.query(models.Project).filter(models.Project.code == code).first()
                existed = project is not None
                if project and not can_access_project(user, project):
                    raise HTTPException(403, "无权修改该项目")
                require_perm("project:update" if existed else "project:create")(user=user)

                # A rejected row must leave no customer/project/financial fragments.
                # SAVEPOINT also restores the Session after a constraint failure so
                # later valid rows can still be imported in the same request.
                with db.begin_nested():
                    contract_amt = _dec(get("contract"))
                    received = _dec(get("received"))
                    receivable = _dec(get("receivable"))
                    customer = None
                    if customer_name:
                        customer = db.query(models.Customer).filter(
                            models.Customer.name == customer_name).first()
                        if not customer:
                            customer = models.Customer(code=f"C{db.query(models.Customer).count()+1:04d}",
                                                       name=customer_name)
                            db.add(customer); db.flush()

                    if not project:
                        project = models.Project(code=code, name=name, owner_id=user.id)
                        db.add(project); db.flush()
                        db.add(models.ProjectMember(project_id=project.id, user_id=user.id,
                                                    role_in_project="负责人"))
                    project.name = name
                    if customer:
                        project.customer_id = customer.id

                    if contract_amt is not None:
                        existing = db.query(models.Contract).filter(
                            models.Contract.project_id == project.id).first()
                        if not existing and contract_amt > 0:
                            require_perm("contract:create")(user=user)
                            db.add(models.Contract(code=f"HT-{code}", project_id=project.id,
                                                   customer_id=project.customer_id,
                                                   amount=contract_amt, status="生效"))
                            db.flush()

                    if received and received > 0:
                        dup = db.query(models.Payment).filter(
                            models.Payment.idempotency_key == f"import-{code}").first()
                        if not dup:
                            require_perm("payment:create")(user=user)
                            require_perm("payment:confirm")(user=user)
                            db.add(models.Payment(project_id=project.id,
                                                  customer_id=project.customer_id,
                                                  amount=received, pay_date=date.today(),
                                                  status="已确认", confirmed_by=user.id,
                                                  idempotency_key=f"import-{code}",
                                                  remark="Excel 导入"))

                    if receivable and receivable > 0:
                        contract = db.query(models.Contract).filter(
                            models.Contract.project_id == project.id).first()
                        period = _norm_period(get("period")) or date.today().strftime("%Y-%m")
                        due = date.today()
                        try:
                            y, m = period.split("-")
                            due = date(int(y), int(m), 28)
                        except Exception:
                            pass
                        dup_plan = db.query(models.PaymentPlan).filter(
                            models.PaymentPlan.project_id == project.id,
                            models.PaymentPlan.period == period).first()
                        if contract and not dup_plan:
                            require_perm("contract:update")(user=user)
                            db.add(models.PaymentPlan(contract_id=contract.id, project_id=project.id,
                                                      period=period, due_date=due, amount=receivable,
                                                      note="Excel 导入应收"))

                    db.flush()
                report["updated" if existed else "created"] += 1
            except IntegrityError:
                report["errors"].append({"row": ri, "message": "数据冲突或关联约束无效，该行已回滚"})
            except ValueError as e:
                report["errors"].append({"row": ri, "message": str(e)[:200]})
    wb.close()
    audit(db, user, "Excel导入", "project", None, after=report)
    db.commit()
    return report


@router.get("/exports/projects")
def export_projects(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """导出项目 CSV（遵守数据范围）"""
    import csv
    import io as sio

    from fastapi.responses import StreamingResponse
    from .projects import project_out

    buf = sio.StringIO()
    w = csv.writer(buf)
    w.writerow(["项目编号", "项目名称", "客户", "状态", "阶段", "进度%",
                "合同金额", "已收", "应收", "回款率%"])
    for p in db.query(models.Project).filter(models.Project.is_archived == False).all():  # noqa: E712
        if not can_access_project(user, p):
            continue
        o = project_out(db, p)
        w.writerow([o["code"], o["name"], o["customer_name"] or "", o["status"], o["stage"],
                    o["progress"], o["contract_amount"], o["received_amount"],
                    o["receivable_amount"], o["collection_rate"]])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=projects.csv"})
