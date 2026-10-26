"""审批流路由"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models import (
    ApprovalTemplate, ApprovalInstance, ApprovalStep,
    User, Notification, AuditLog
)
from app.auth import get_current_user, require_role
import json

router = APIRouter(prefix="/api/approvals", tags=["审批"])


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ApprovalTemplate).filter(ApprovalTemplate.is_active == True).all()


@router.post("/templates")
def create_template(
    name: str,
    applies_to: str,
    steps: str,  # JSON string
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("enterprise_admin")),
):
    t = ApprovalTemplate(name=name, applies_to=applies_to, steps=steps)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.post("/submit")
def submit_approval(
    template_id: str,
    target_type: str,
    target_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    template = db.query(ApprovalTemplate).filter(ApprovalTemplate.id == template_id, ApprovalTemplate.is_active == True).first()
    if not template:
        raise HTTPException(status_code=404, detail="审批模板不存在")

    instance = ApprovalInstance(
        template_id=template_id,
        target_type=target_type,
        target_id=target_id,
        status="in_progress",
        current_step=0,
        submitted_by=current_user.id,
    )
    db.add(instance)
    db.flush()

    # 从模板解析审批步骤并创建第一步
    try:
        steps = json.loads(template.steps)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="模板步骤格式错误")

    if steps:
        first_step = steps[0]
        approver_role = first_step.get("approver_role", "")
        # 找到该角色的第一个活跃用户作为审批人
        approver = db.query(User).filter(User.role == approver_role, User.is_active == True).first()
        if approver:
            step = ApprovalStep(
                instance_id=instance.id,
                approver_id=approver.id,
                step_order=0,
            )
            db.add(step)
            db.add(Notification(
                user_id=approver.id,
                title=f"新的审批: {template.name}",
                content=f"{current_user.real_name} 提交了 {template.name} 审批",
                ntype="approval",
                link=f"/approvals/{instance.id}",
            ))

    db.add(AuditLog(
        user_id=current_user.id,
        action="submit_approval",
        target_type="approval_instance",
        target_id=instance.id,
        new_value=f"template={template.name},target={target_type}/{target_id}",
    ))
    db.commit()
    db.refresh(instance)
    return instance


@router.get("/instances")
def list_instances(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ApprovalInstance)
    if status:
        q = q.filter(ApprovalInstance.status == status)
    return q.order_by(ApprovalInstance.submitted_at.desc()).all()


@router.put("/instances/{instance_id}/withdraw")
def withdraw_instance(instance_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inst = db.query(ApprovalInstance).filter(ApprovalInstance.id == instance_id, ApprovalInstance.submitted_by == current_user.id).first()
    if not inst:
        raise HTTPException(status_code=404, detail="审批实例不存在或无权撤回")
    if inst.status not in ("in_progress", "pending"):
        raise HTTPException(status_code=400, detail="只能撤回进行中或待处理状态的审批")
    inst.status = "withdrawn"
    inst.completed_at = datetime.utcnow()
    db.add(AuditLog(user_id=current_user.id, action="withdraw_approval", target_type="approval_instance", target_id=instance_id))
    db.commit()
    return {"ok": True}


@router.get("/instances/{instance_id}")
def get_instance(instance_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inst = db.query(ApprovalInstance).filter(ApprovalInstance.id == instance_id).first()
    if not inst:
        raise HTTPException(status_code=404, detail="审批实例不存在")
    steps = db.query(ApprovalStep).filter(ApprovalStep.instance_id == instance_id).order_by(ApprovalStep.step_order).all()
    return {"instance": inst, "steps": steps}


@router.put("/instances/{instance_id}/step/{step_id}")
def decide_step(
    instance_id: str,
    step_id: str,
    decision: str = Query(...),  # approved, rejected, transferred
    comment: str = "",
    transfer_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    step = db.query(ApprovalStep).filter(
        ApprovalStep.id == step_id,
        ApprovalStep.instance_id == instance_id,
        ApprovalStep.decision == "pending",
    ).first()
    if not step:
        raise HTTPException(status_code=404, detail="审批步骤不存在或已处理")

    instance = db.query(ApprovalInstance).filter(ApprovalInstance.id == instance_id).first()
    if not instance:
        raise HTTPException(status_code=404, detail="审批实例不存在")

    step.decision = decision
    step.comment = comment
    step.decided_at = datetime.utcnow()

    if decision == "approved":
        # 检查是否还有下一步
        template = db.query(ApprovalTemplate).filter(ApprovalTemplate.id == instance.template_id).first()
        steps_cfg = json.loads(template.steps) if template else []
        next_order = step.step_order + 1

        if next_order < len(steps_cfg):
            next_cfg = steps_cfg[next_order]
            next_approver = db.query(User).filter(User.role == next_cfg.get("approver_role", ""), User.is_active == True).first()
            if next_approver:
                instance.current_step = next_order
                new_step = ApprovalStep(
                    instance_id=instance_id,
                    approver_id=next_approver.id,
                    step_order=next_order,
                )
                db.add(new_step)
                db.add(Notification(
                    user_id=next_approver.id,
                    title="审批流转到您",
                    content=f"请处理审批: {template.name}",
                    ntype="approval",
                ))
        else:
            instance.status = "approved"
            instance.completed_at = datetime.utcnow()
    elif decision == "rejected":
        instance.status = "rejected"
        instance.completed_at = datetime.utcnow()
    elif decision == "transferred" and transfer_to:
        new_step = ApprovalStep(
            instance_id=instance_id,
            approver_id=transfer_to,
            step_order=step.step_order,
        )
        db.add(new_step)

    db.add(AuditLog(
        user_id=current_user.id,
        action=f"approval_{decision}",
        target_type="approval_step",
        target_id=step_id,
        new_value=f"decision={decision},comment={comment}",
    ))
    db.commit()
    return {"ok": True}


@router.get("/my-pending")
def my_pending(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """当前用户待审批的步骤"""
    steps = db.query(ApprovalStep).filter(
        ApprovalStep.approver_id == current_user.id,
        ApprovalStep.decision == "pending",
    ).join(ApprovalInstance).filter(
        ApprovalInstance.status == "in_progress"
    ).all()
    return steps
