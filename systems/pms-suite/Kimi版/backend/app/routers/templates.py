from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user, require_perm
from ..services import activity, audit

router = APIRouter(tags=["项目模板"])

TEMPLATES = {
    "软件开发": {
        "stage": "需求",
        "tasks": [("需求分析", 2), ("概要设计", 2), ("开发实现", 4), ("测试验收", 2)],
        "milestones": ["需求确认", "开发完成", "上线"],
        "plan_ratios": [0.3, 0.4, 0.3],
    },
    "实施交付": {
        "stage": "调研",
        "tasks": [("现场调研", 1), ("方案配置", 2), ("数据迁移", 2), ("培训上线", 1)],
        "milestones": ["方案确认", "上线"],
        "plan_ratios": [0.5, 0.5],
    },
    "咨询服务": {
        "stage": "诊断",
        "tasks": [("诊断访谈", 1), ("报告撰写", 2), ("汇报评审", 1)],
        "milestones": ["中期汇报", "终稿交付"],
        "plan_ratios": [0.4, 0.6],
    },
}


class FromTemplateIn(BaseModel):
    template: str
    code: str
    name: str
    customer_id: int | None = None
    contract_amount: float = 0


@router.get("/project-templates")
def list_templates(user=Depends(get_current_user)):
    return [{"name": k, "tasks": [t for t, _ in v["tasks"]], "milestones": v["milestones"]}
            for k, v in TEMPLATES.items()]


@router.post("/projects/from-template", status_code=201)
def create_from_template(data: FromTemplateIn, db: Session = Depends(get_db),
                         user=Depends(require_perm("project:create"))):
    tpl = TEMPLATES.get(data.template)
    if not tpl:
        raise HTTPException(422, f"未知模板，可选: {list(TEMPLATES)}")
    if db.query(models.Project).filter(models.Project.code == data.code).first():
        raise HTTPException(409, "项目编码已存在")
    p = models.Project(code=data.code, name=data.name, customer_id=data.customer_id,
                       stage=tpl["stage"], owner_id=user.id,
                       budget=Decimal(str(data.contract_amount)),
                       plan_start=date.today(),
                       plan_end=date.today() + timedelta(days=90))
    db.add(p); db.flush()
    db.add(models.ProjectMember(project_id=p.id, user_id=user.id, role_in_project="负责人"))
    for i, (title, weight) in enumerate(tpl["tasks"]):
        db.add(models.Task(project_id=p.id, title=title, weight=weight, assignee_id=user.id,
                           due_date=date.today() + timedelta(days=14 + i * 21)))
    for i, name in enumerate(tpl["milestones"]):
        db.add(models.Milestone(project_id=p.id, name=name,
                                due_date=date.today() + timedelta(days=30 + i * 30)))
    if data.contract_amount > 0:
        ct = models.Contract(code=f"{data.code}-HT01", project_id=p.id,
                             customer_id=data.customer_id,
                             amount=Decimal(str(data.contract_amount)))
        db.add(ct); db.flush()
        for i, ratio in enumerate(tpl["plan_ratios"]):
            db.add(models.PaymentPlan(contract_id=ct.id, project_id=p.id,
                                      due_date=date.today() + timedelta(days=30 + i * 45),
                                      amount=Decimal(str(data.contract_amount)) * Decimal(str(ratio))))
    audit(db, user, "模板创建项目", "project", p.id, after={"template": data.template})
    activity(db, p.id, user, "创建项目", f"模板: {data.template}")
    db.commit()
    return {"id": p.id, "code": p.code, "template": data.template}
