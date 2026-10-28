"""数据库模型 — 综合项目管理系统"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Numeric, Text, ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.database import Base


def gen_id():
    return uuid.uuid4().hex[:12]


class User(Base):
    __tablename__ = "users"
    id = Column(String(32), primary_key=True, default=gen_id)
    username = Column(String(64), unique=True, nullable=False, index=True)
    hashed_password = Column(String(256), nullable=False)
    real_name = Column(String(64), nullable=False)
    email = Column(String(128), default="")
    phone = Column(String(32), default="")
    role = Column(String(32), nullable=False, default="member")  # super_admin, enterprise_admin, executive, dept_head, pm, finance, member, client, guest
    department_id = Column(String(32), ForeignKey("departments.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    avatar_url = Column(String(512), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    department = relationship("Department", back_populates="users", foreign_keys=[department_id])
    notifications = relationship("Notification", back_populates="user")
    audit_logs = relationship("AuditLog", back_populates="user")


class Department(Base):
    __tablename__ = "departments"
    id = Column(String(32), primary_key=True, default=gen_id)
    name = Column(String(128), unique=True, nullable=False)
    parent_id = Column(String(32), ForeignKey("departments.id"), nullable=True)
    manager_id = Column(String(32), ForeignKey("users.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    users = relationship("User", back_populates="department", foreign_keys=[User.department_id])


class Customer(Base):
    __tablename__ = "customers"
    id = Column(String(32), primary_key=True, default=gen_id)
    name = Column(String(256), nullable=False)
    short_name = Column(String(128), default="")
    credit_level = Column(String(32), default="B")  # A, B, C, D
    industry = Column(String(128), default="")
    contact_person = Column(String(64), default="")
    contact_phone = Column(String(32), default="")
    contact_email = Column(String(128), default="")
    address = Column(Text, default="")
    notes = Column(Text, default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    projects = relationship("Project", back_populates="customer")


class Project(Base):
    __tablename__ = "projects"
    id = Column(String(32), primary_key=True, default=gen_id)
    code = Column(String(64), unique=True, nullable=False, index=True)
    name = Column(String(256), nullable=False)
    customer_id = Column(String(32), ForeignKey("customers.id"), nullable=False)
    department_id = Column(String(32), ForeignKey("departments.id"), nullable=True)
    manager_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    stage = Column(String(32), default="initiation")  # initiation, planning, execution, monitoring, closing, archived
    status = Column(String(32), default="active")  # active, paused, completed, cancelled
    priority = Column(String(32), default="medium")  # low, medium, high, urgent
    health = Column(String(32), default="green")  # green, yellow, red
    description = Column(Text, default="")
    objectives = Column(Text, default="")
    planned_start = Column(DateTime, nullable=True)
    planned_end = Column(DateTime, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    budget = Column(Numeric(18, 2), default=Decimal("0"))
    progress = Column(Integer, default=0)  # 0-100
    completion_rate = Column(Numeric(5, 2), default=Decimal("0"))
    tags = Column(String(512), default="")  # comma-separated
    is_archived = Column(Boolean, default=False)
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    customer = relationship("Customer", back_populates="projects")
    milestones = relationship("Milestone", back_populates="project")
    tasks = relationship("Task", back_populates="project")
    contracts = relationship("Contract", back_populates="project")
    risks = relationship("Risk", back_populates="project")
    issues = relationship("Issue", back_populates="project")
    changes = relationship("Change", back_populates="project")
    activities = relationship("ActivityLog", back_populates="project")
    receipts = relationship("Receipt", back_populates="project")
    members = relationship("ProjectMember", back_populates="project")


class ProjectMember(Base):
    __tablename__ = "project_members"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    role_in_project = Column(String(32), default="member")
    joined_at = Column(DateTime, default=datetime.utcnow)
    project = relationship("Project", back_populates="members")
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)


class Milestone(Base):
    __tablename__ = "milestones"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    name = Column(String(256), nullable=False)
    description = Column(Text, default="")
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String(32), default="pending")  # pending, in_progress, completed
    weight = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    project = relationship("Project", back_populates="milestones")


class Task(Base):
    __tablename__ = "tasks"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    parent_id = Column(String(32), ForeignKey("tasks.id"), nullable=True)
    milestone_id = Column(String(32), ForeignKey("milestones.id"), nullable=True)
    title = Column(String(512), nullable=False)
    description = Column(Text, default="")
    assignee_id = Column(String(32), ForeignKey("users.id"), nullable=True)
    collaborator_ids = Column(String(512), default="")  # comma-separated user ids
    priority = Column(String(32), default="medium")  # low, medium, high, urgent
    status = Column(String(32), default="todo")  # todo, in_progress, review, done, cancelled
    start_date = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    estimated_hours = Column(Numeric(8, 2), nullable=True)
    actual_hours = Column(Numeric(8, 2), nullable=True)
    weight = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    is_recurring = Column(Boolean, default=False)
    tags = Column(String(256), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project = relationship("Project", back_populates="tasks")
    assignee = relationship("User", foreign_keys=[assignee_id])
    children = relationship("Task", backref="parent", remote_side=[id])


class Contract(Base):
    __tablename__ = "contracts"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    code = Column(String(128), unique=True, nullable=False)
    name = Column(String(256), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    signed_date = Column(DateTime, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    payment_terms = Column(Text, default="")
    status = Column(String(32), default="active")  # draft, active, completed, terminated
    notes = Column(Text, default="")
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project = relationship("Project", back_populates="contracts")
    payment_plans = relationship("PaymentPlan", back_populates="contract")
    invoices = relationship("Invoice", back_populates="contract")


class PaymentPlan(Base):
    __tablename__ = "payment_plans"
    id = Column(String(32), primary_key=True, default=gen_id)
    contract_id = Column(String(32), ForeignKey("contracts.id"), nullable=False)
    name = Column(String(256), nullable=False)
    planned_amount = Column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    planned_date = Column(DateTime, nullable=True)
    status = Column(String(32), default="pending")  # pending, invoiced, received, overdue
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    contract = relationship("Contract", back_populates="payment_plans")


class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(String(32), primary_key=True, default=gen_id)
    contract_id = Column(String(32), ForeignKey("contracts.id"), nullable=False)
    code = Column(String(128), unique=True, nullable=False)
    amount = Column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    issued_date = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(32), default="draft")  # draft, issued, partial_paid, paid, cancelled
    notes = Column(Text, default="")
    is_red_invoice = Column(Boolean, default=False)  # 红冲
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    contract = relationship("Contract", back_populates="invoices")
    receipts = relationship("ReceiptAllocation", back_populates="invoice")


class Receipt(Base):
    __tablename__ = "receipts"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    received_date = Column(DateTime, nullable=False)
    payer = Column(String(256), default="")
    bank_ref = Column(String(128), default="", index=True)
    payment_method = Column(String(64), default="")
    status = Column(String(32), default="draft")  # draft, confirmed, reversed
    notes = Column(Text, default="")
    confirmed_by = Column(String(32), ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    reversal_id = Column(String(32), ForeignKey("receipts.id"), nullable=True)  # 冲销关联
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    allocations = relationship("ReceiptAllocation", back_populates="receipt")
    project = relationship("Project", back_populates="receipts")
    __table_args__ = (Index("ix_receipts_bank_ref_status", "bank_ref", "status"),)


class ReceiptRequest(Base):
    """持久幂等请求；与回款和审计在同一事务提交，不再解析业务备注。"""
    __tablename__ = "receipt_requests"
    key = Column(String(128), primary_key=True)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    signature = Column(Text, nullable=False)
    receipt_id = Column(String(32), ForeignKey("receipts.id"), nullable=False, unique=True)


class ReceiptAllocation(Base):
    """回款核销关联表：多对多"""
    __tablename__ = "receipt_allocations"
    id = Column(String(32), primary_key=True, default=gen_id)
    receipt_id = Column(String(32), ForeignKey("receipts.id"), nullable=False)
    invoice_id = Column(String(32), ForeignKey("invoices.id"), nullable=False)
    allocated_amount = Column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    created_at = Column(DateTime, default=datetime.utcnow)
    receipt = relationship("Receipt", back_populates="allocations")
    invoice = relationship("Invoice", back_populates="receipts")
    __table_args__ = (UniqueConstraint("receipt_id", "invoice_id"),)


class Risk(Base):
    __tablename__ = "risks"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    title = Column(String(512), nullable=False)
    description = Column(Text, default="")
    probability = Column(String(32), default="medium")  # low, medium, high
    impact = Column(String(32), default="medium")  # low, medium, high, critical
    risk_level = Column(String(32), default="medium")  # low, medium, high, critical
    responsible_id = Column(String(32), ForeignKey("users.id"), nullable=True)
    response_plan = Column(Text, default="")
    status = Column(String(32), default="open")  # open, monitoring, resolved, closed
    due_date = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    level_reason = Column(Text, default="")  # 判定原因
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project = relationship("Project", back_populates="risks")
    responsible = relationship("User", foreign_keys=[responsible_id])
    follow_ups = relationship("RiskFollowUp", back_populates="risk")


class RiskFollowUp(Base):
    __tablename__ = "risk_follow_ups"
    id = Column(String(32), primary_key=True, default=gen_id)
    risk_id = Column(String(32), ForeignKey("risks.id"), nullable=False)
    content = Column(Text, nullable=False)
    commitment_date = Column(DateTime, nullable=True)
    created_by = Column(String(32), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    risk = relationship("Risk", back_populates="follow_ups")


class Issue(Base):
    __tablename__ = "issues"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    title = Column(String(512), nullable=False)
    description = Column(Text, default="")
    severity = Column(String(32), default="medium")  # low, medium, high, critical
    status = Column(String(32), default="open")  # open, investigating, resolving, resolved, closed
    assignee_id = Column(String(32), ForeignKey("users.id"), nullable=True)
    resolution = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project = relationship("Project", back_populates="issues")
    assignee = relationship("User", foreign_keys=[assignee_id])


class Change(Base):
    __tablename__ = "changes"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    title = Column(String(512), nullable=False)
    description = Column(Text, default="")
    change_type = Column(String(64), default="scope")  # scope, time, budget, resource, other
    impact_analysis = Column(Text, default="")
    status = Column(String(32), default="draft")  # draft, submitted, approved, rejected, implemented
    proposed_by = Column(String(32), ForeignKey("users.id"), nullable=False)
    approved_by = Column(String(32), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project = relationship("Project", back_populates="changes")
    proposed_by_user = relationship("User", foreign_keys=[proposed_by])
    approved_by_user = relationship("User", foreign_keys=[approved_by])


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    action = Column(String(256), nullable=False)
    detail = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    project = relationship("Project", back_populates="activities")
    user = relationship("User")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    title = Column(String(256), nullable=False)
    content = Column(Text, default="")
    ntype = Column(String(32), default="info")  # task, risk, approval, info, at_mention
    is_read = Column(Boolean, default=False)
    link = Column(String(512), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="notifications")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    action = Column(String(64), nullable=False)  # create, update, delete, confirm, reverse
    target_type = Column(String(64), nullable=False)
    target_id = Column(String(32), nullable=False)
    old_value = Column(Text, default="")
    new_value = Column(Text, default="")
    ip_address = Column(String(64), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="audit_logs")


class ApprovalTemplate(Base):
    __tablename__ = "approval_templates"
    id = Column(String(32), primary_key=True, default=gen_id)
    name = Column(String(256), nullable=False)
    applies_to = Column(String(64), nullable=False)  # project_init, budget, contract, invoice, receipt_confirm, change, close
    steps = Column(Text, nullable=False)  # JSON: [{"order":1,"approver_role":"pm","type":"sequential"}]
    is_active = Column(Boolean, default=True)


class ApprovalInstance(Base):
    __tablename__ = "approval_instances"
    id = Column(String(32), primary_key=True, default=gen_id)
    template_id = Column(String(32), ForeignKey("approval_templates.id"), nullable=False)
    target_type = Column(String(64), nullable=False)
    target_id = Column(String(32), nullable=False)
    status = Column(String(32), default="pending")  # pending, in_progress, approved, rejected, withdrawn
    current_step = Column(Integer, default=0)
    submitted_by = Column(String(32), ForeignKey("users.id"), nullable=False)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class ApprovalStep(Base):
    __tablename__ = "approval_steps"
    id = Column(String(32), primary_key=True, default=gen_id)
    instance_id = Column(String(32), ForeignKey("approval_instances.id"), nullable=False)
    approver_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    step_order = Column(Integer, default=0)
    decision = Column(String(32), default="pending")  # pending, approved, rejected, transferred
    comment = Column(Text, default="")
    decided_at = Column(DateTime, nullable=True)


class TimesheetEntry(Base):
    """工时填报 — 员工按日/按项目登记工时，审批后计入成本"""
    __tablename__ = "timesheet_entries"
    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    task_id = Column(String(32), ForeignKey("tasks.id"), nullable=True)
    work_date = Column(DateTime, nullable=False)
    hours = Column(Numeric(6, 2), nullable=False, default=Decimal("0"))
    description = Column(Text, default="")
    status = Column(String(32), default="submitted")  # submitted, approved, rejected
    decided_by = Column(String(32), ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decided_comment = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user = relationship("User", foreign_keys=[user_id])
    project = relationship("Project")


class ExpenseEntry(Base):
    """成本归集 — 项目各类成本支出"""
    __tablename__ = "expense_entries"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    category = Column(String(32), default="other")  # labor, material, travel, outsourcing, other
    amount = Column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    expense_date = Column(DateTime, nullable=True)
    description = Column(Text, default="")
    created_by = Column(String(32), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


class Document(Base):
    """项目文档 — 支持多版本管理"""
    __tablename__ = "documents"
    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("projects.id"), nullable=False)
    name = Column(String(256), nullable=False)
    description = Column(Text, default="")
    created_by = Column(String(32), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project = relationship("Project")
    versions = relationship("DocumentVersion", back_populates="document", cascade="all, delete-orphan")


class DocumentVersion(Base):
    """文档版本"""
    __tablename__ = "document_versions"
    id = Column(String(32), primary_key=True, default=gen_id)
    document_id = Column(String(32), ForeignKey("documents.id"), nullable=False)
    version_no = Column(Integer, default=1)
    file_name = Column(String(512), nullable=False)
    file_path = Column(String(1024), default="")
    file_size = Column(Integer, default=0)
    uploaded_by = Column(String(32), ForeignKey("users.id"), nullable=False)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    document = relationship("Document", back_populates="versions")


class SavedView(Base):
    """保存列表视图 — 列表筛选条件持久化（按用户）"""
    __tablename__ = "saved_views"
    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    page = Column(String(64), nullable=False)  # projects, tasks, receipts...
    name = Column(String(128), nullable=False)
    filters = Column(Text, default="{}")  # JSON
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class CustomerPortalAccess(Base):
    """客户门户授权 — client 角色用户 ↔ 客户"""
    __tablename__ = "customer_portal_access"
    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    customer_id = Column(String(32), ForeignKey("customers.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user_id", "customer_id"),)


# 性能索引 (在所有模型之后定义以避免引用未定义的类)
Index("ix_projects_status_archived", Project.status, Project.is_archived)
Index("ix_tasks_assignee_status", Task.assignee_id, Task.status)
Index("ix_risks_status_level", Risk.status, Risk.risk_level)
Index("ix_timesheets_user_date", TimesheetEntry.user_id, TimesheetEntry.work_date)
Index("ix_expenses_project", ExpenseEntry.project_id)
Index("ix_documents_project", Document.project_id)
Index("ix_saved_views_user_page", SavedView.user_id, SavedView.page)
