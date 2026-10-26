from datetime import date, datetime

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, Numeric,
                        String, Text, UniqueConstraint, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    version: Mapped[int] = mapped_column(Integer, default=1)


class Department(Base, TimestampMixin):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    users: Mapped[list["User"]] = relationship(back_populates="department")


class Role(Base, TimestampMixin):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    permissions: Mapped[str] = mapped_column(Text, default="")  # 逗号分隔, * 表示全部


class UserRole(Base):
    __tablename__ = "user_roles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    department: Mapped[Department | None] = relationship(back_populates="users")
    roles: Mapped[list[Role]] = relationship(secondary="user_roles")


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    credit_level: Mapped[str | None] = mapped_column(String(20))
    contact: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(50))
    projects: Mapped[list["Project"]] = relationship(back_populates="customer")


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    priority: Mapped[str] = mapped_column(String(20), default="中")
    stage: Mapped[str] = mapped_column(String(20), default="执行")  # 立项/执行/验收/结项/归档
    status: Mapped[str] = mapped_column(String(20), default="进行中")  # 进行中/暂停/已完成/已归档
    plan_start: Mapped[date | None] = mapped_column(Date)
    plan_end: Mapped[date | None] = mapped_column(Date)
    actual_start: Mapped[date | None] = mapped_column(Date)
    actual_end: Mapped[date | None] = mapped_column(Date)
    budget: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    description: Mapped[str | None] = mapped_column(Text)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    customer: Mapped[Customer | None] = relationship(back_populates="projects")
    members: Mapped[list["ProjectMember"]] = relationship(back_populates="project", cascade="all,delete-orphan")
    tasks: Mapped[list["Task"]] = relationship(back_populates="project", cascade="all,delete-orphan")
    milestones: Mapped[list["Milestone"]] = relationship(back_populates="project", cascade="all,delete-orphan")


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role_in_project: Mapped[str] = mapped_column(String(50), default="成员")
    project: Mapped[Project] = relationship(back_populates="members")


class Milestone(Base, TimestampMixin):
    __tablename__ = "milestones"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[date | None] = mapped_column(Date)
    weight: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="未开始")  # 未开始/进行中/已完成
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    project: Mapped[Project] = relationship(back_populates="milestones")


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    milestone_id: Mapped[int | None] = mapped_column(ForeignKey("milestones.id"))
    title: Mapped[str] = mapped_column(String(200))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    priority: Mapped[str] = mapped_column(String(20), default="中")
    status: Mapped[str] = mapped_column(String(20), default="待办")  # 待办/进行中/已完成/已取消
    due_date: Mapped[date | None] = mapped_column(Date)
    weight: Mapped[int] = mapped_column(Integer, default=1)
    est_hours: Mapped[float | None] = mapped_column(Numeric(10, 2))
    act_hours: Mapped[float | None] = mapped_column(Numeric(10, 2))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    version: Mapped[int] = mapped_column(Integer, default=0)  # 乐观锁版本号
    project: Mapped[Project] = relationship(back_populates="tasks")


class Contract(Base, TimestampMixin):
    __tablename__ = "contracts"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"))
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    sign_date: Mapped[date | None] = mapped_column(Date)
    effective_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="生效")
    terms: Mapped[str | None] = mapped_column(Text)
    plans: Mapped[list["PaymentPlan"]] = relationship(back_populates="contract", cascade="all,delete-orphan")


class PaymentPlan(Base, TimestampMixin):
    """收款计划/应收节点"""
    __tablename__ = "payment_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    period: Mapped[str | None] = mapped_column(String(20))  # 如 2024-06
    due_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    note: Mapped[str | None] = mapped_column(String(200))
    contract: Mapped[Contract] = relationship(back_populates="plans")
    allocations: Mapped[list["PaymentAllocation"]] = relationship(back_populates="plan")


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id"))
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    invoice_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="已开票")  # 已开票/已红冲


class Payment(Base, TimestampMixin):
    """回款（确认后生效；冲销生成负向记录）"""
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"))
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    pay_date: Mapped[date] = mapped_column(Date)
    bank_serial: Mapped[str | None] = mapped_column(String(100), unique=True)  # 防重复
    status: Mapped[str] = mapped_column(String(20), default="草稿")  # 草稿/已确认/已冲销
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    reversed_by: Mapped[int | None] = mapped_column(Integer)  # 冲销记录 id
    reverses_id: Mapped[int | None] = mapped_column(Integer)  # 本记录冲销的原回款 id
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    remark: Mapped[str | None] = mapped_column(String(300))
    allocations: Mapped[list["PaymentAllocation"]] = relationship(back_populates="payment", cascade="all,delete-orphan")


class PaymentAllocation(Base):
    """回款与应收核销（多对多）"""
    __tablename__ = "payment_allocations"
    __table_args__ = (UniqueConstraint("payment_id", "plan_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("payment_plans.id"), index=True)
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    payment: Mapped[Payment] = relationship(back_populates="allocations")
    plan: Mapped[PaymentPlan] = relationship(back_populates="allocations")


class Risk(Base, TimestampMixin):
    __tablename__ = "risks"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    probability: Mapped[str] = mapped_column(String(10), default="中")  # 低/中/高
    impact: Mapped[str] = mapped_column(String(10), default="中")
    level: Mapped[str] = mapped_column(String(10), default="中")  # 由判定逻辑写入
    level_reason: Mapped[str | None] = mapped_column(String(300))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="开放")  # 开放/跟进中/已关闭
    response: Mapped[str | None] = mapped_column(Text)
    followups: Mapped[list["RiskFollowup"]] = relationship(back_populates="risk", cascade="all,delete-orphan")


class RiskFollowup(Base, TimestampMixin):
    __tablename__ = "risk_followups"
    id: Mapped[int] = mapped_column(primary_key=True)
    risk_id: Mapped[int] = mapped_column(ForeignKey("risks.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    promise_date: Mapped[date | None] = mapped_column(Date)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    risk: Mapped[Risk] = relationship(back_populates="followups")


class Activity(Base):
    """项目动态时间线"""
    __tablename__ = "activities"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(50))
    detail: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str | None] = mapped_column(String(500))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Approval(Base, TimestampMixin):
    """审批流 MVP：顺序审批，支持通过/驳回/撤回/抄送"""
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(30), index=True)  # 立项/预算/合同/开票/回款确认/变更/结项
    object_type: Mapped[str | None] = mapped_column(String(50))
    object_id: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str | None] = mapped_column(Text)
    submitter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    approver_ids: Mapped[str] = mapped_column(String(200))  # 顺序审批人 id，逗号分隔
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="待审批")  # 待审批/已通过/已驳回/已撤回
    cc_ids: Mapped[str | None] = mapped_column(String(200))
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)


class Timesheet(Base, TimestampMixin):
    __tablename__ = "timesheets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    work_date: Mapped[date] = mapped_column(Date)
    hours: Mapped[float] = mapped_column(Numeric(5, 2))
    content: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="草稿")  # 草稿/待审批/已通过/已退回


class Budget(Base, TimestampMixin):
    __tablename__ = "budgets"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    category: Mapped[str] = mapped_column(String(50))  # 人力/采购/差旅/外包/其他
    amount: Mapped[float] = mapped_column(Numeric(18, 2))


class Cost(Base, TimestampMixin):
    __tablename__ = "costs"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    budget_id: Mapped[int | None] = mapped_column(ForeignKey("budgets.id"))
    category: Mapped[str] = mapped_column(String(50))
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    cost_date: Mapped[date] = mapped_column(Date)
    remark: Mapped[str | None] = mapped_column(String(300))
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)


class Document(Base, TimestampMixin):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(500))
    size: Mapped[int] = mapped_column(Integer, default=0)
    content_type: Mapped[str | None] = mapped_column(String(100))
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class DictItem(Base, TimestampMixin):
    """系统设置-数据字典：如 项目阶段/任务优先级/成本分类 等可维护枚举"""
    __tablename__ = "dict_items"
    __table_args__ = (UniqueConstraint("group", "code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    group: Mapped[str] = mapped_column(String(50), index=True)
    code: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(100))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WikiPage(Base, TimestampMixin):
    """项目知识库：Markdown 文档，保存编辑历史"""
    __tablename__ = "wiki_pages"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    editor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class WikiHistory(Base):
    __tablename__ = "wiki_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("wiki_pages.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    editor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    edited_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    username: Mapped[str | None] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(50), index=True)
    object_type: Mapped[str] = mapped_column(String(50), index=True)
    object_id: Mapped[str | None] = mapped_column(String(50))
    before: Mapped[str | None] = mapped_column(Text)
    after: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
