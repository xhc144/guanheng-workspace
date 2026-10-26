"""Pydantic 数据校验模型"""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime
from decimal import Decimal


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6)
    real_name: str
    email: str = ""
    phone: str = ""
    role: str = "member"
    department_id: Optional[str] = None


class UserOut(BaseModel):
    id: str
    username: str
    real_name: str
    email: str
    role: str
    department_id: Optional[str]
    is_active: bool
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class CustomerCreate(BaseModel):
    name: str
    short_name: str = ""
    credit_level: str = "B"
    contact_person: str = ""
    contact_phone: str = ""
    contact_email: str = ""
    address: str = ""


class CustomerOut(BaseModel):
    id: str
    name: str
    short_name: str
    credit_level: str
    contact_person: str
    created_at: Optional[datetime]
    model_config = {"from_attributes": True}


class ProjectCreate(BaseModel):
    code: str
    name: str
    customer_id: str
    department_id: Optional[str] = None
    manager_id: str
    stage: str = "initiation"
    priority: str = "medium"
    description: str = ""
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    budget: Decimal = Decimal("0")


class ProjectOut(BaseModel):
    id: str
    code: str
    name: str
    customer_id: str
    manager_id: str
    stage: str
    status: str
    priority: str
    health: str
    progress: int
    budget: Decimal
    planned_start: Optional[datetime]
    planned_end: Optional[datetime]
    created_at: Optional[datetime]
    model_config = {"from_attributes": True}


class TaskCreate(BaseModel):
    project_id: str
    parent_id: Optional[str] = None
    milestone_id: Optional[str] = None
    title: str
    description: str = ""
    assignee_id: Optional[str] = None
    priority: str = "medium"
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    estimated_hours: Optional[Decimal] = None
    weight: int = 1


class TaskOut(BaseModel):
    id: str
    project_id: str
    title: str
    status: str
    priority: str
    assignee_id: Optional[str]
    due_date: Optional[datetime]
    weight: int
    created_at: Optional[datetime]
    model_config = {"from_attributes": True}


class MilestoneCreate(BaseModel):
    project_id: str
    name: str
    due_date: Optional[datetime] = None
    weight: int = 1


class ContractCreate(BaseModel):
    project_id: str
    code: str
    name: str
    amount: Decimal
    signed_date: Optional[datetime] = None
    effective_date: Optional[datetime] = None
    payment_terms: str = ""


class PaymentPlanCreate(BaseModel):
    contract_id: str
    name: str
    planned_amount: Decimal
    planned_date: Optional[datetime] = None


class InvoiceCreate(BaseModel):
    contract_id: str
    code: str
    amount: Decimal
    issued_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    notes: str = ""


class ReceiptCreate(BaseModel):
    project_id: str
    amount: Decimal
    received_date: datetime
    payer: str = ""
    bank_ref: str = ""
    payment_method: str = ""
    notes: str = ""
    allocations: List[dict] = []  # [{"invoice_id":"...","allocated_amount":Decimal}]


class RiskCreate(BaseModel):
    project_id: str
    title: str
    description: str = ""
    probability: str = "medium"
    impact: str = "medium"
    responsible_id: Optional[str] = None
    response_plan: str = ""
    due_date: Optional[datetime] = None


class RiskFollowUpCreate(BaseModel):
    content: str
    commitment_date: Optional[datetime] = None


class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int
    page_size: int


class ProjectSummary(BaseModel):
    total: int = 0
    active: int = 0
    at_risk: int = 0
    completion_rate: float = 0.0
    budget_used_pct: float = 0.0


class DashboardData(BaseModel):
    total_projects: int = 0
    active_projects: int = 0
    total_contract_amount: Decimal = Decimal("0")
    total_received: Decimal = Decimal("0")
    total_receivable: Decimal = Decimal("0")
    total_budget: Decimal = Decimal("0")
    total_cost: Decimal = Decimal("0")
    overdue_projects: int = 0
    high_risk_projects: int = 0
    monthly_receipts: List[dict] = []
    project_health_dist: List[dict] = []
    top_risks: List[dict] = []
    top_overdue: List[dict] = []
    top_receivable: List[dict] = []


class ProjectSummary(BaseModel):
    """项目汇总统计"""
    total: int = 0
    active: int = 0
    at_risk: int = 0
    completion_rate: float = 0
    budget_used_pct: float = 0


class RiskFollowUpCreate(BaseModel):
    content: str
    commitment_date: Optional[str] = None


class IssueCreate(BaseModel):
    project_id: str
    title: str = Field(min_length=1)
    description: str = ""
    severity: str = "medium"
    status: str = "open"
    assignee_id: Optional[str] = None


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    resolution: Optional[str] = None
