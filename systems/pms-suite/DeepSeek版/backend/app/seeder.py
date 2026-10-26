"""种子数据脚本 — 填充演示数据"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal, engine, Base
from app.models import User, Department, Customer, Project, Task, Contract, Receipt, Risk, Milestone, Issue, Notification
from app.auth import hash_password
from decimal import Decimal
from datetime import datetime, timedelta

Base.metadata.create_all(bind=engine)
db = SessionLocal()

existing = db.query(User).filter(User.username == "admin").first()
if existing:
    print("数据已存在，跳过种子")
    db.close()
    exit(0)

dept = Department(name="技术部")
db.add(dept); db.flush()

admin = User(username="admin", hashed_password=hash_password("admin123"), real_name="系统管理员", role="super_admin", department_id=dept.id)
pm = User(username="pm_wang", hashed_password=hash_password("123456"), real_name="王经理", role="pm", department_id=dept.id)
finance = User(username="finance_li", hashed_password=hash_password("123456"), real_name="李财务", role="finance", department_id=dept.id)
db.add_all([admin, pm, finance]); db.flush()

c1 = Customer(name="上海智造科技有限公司", short_name="智造科技", credit_level="A", industry="制造", contact_person="张总", contact_phone="13800001111")
c2 = Customer(name="北京数据创新有限公司", short_name="数据创新", credit_level="B", industry="IT", contact_person="李董", contact_phone="13900002222")
db.add_all([c1, c2]); db.flush()

p1 = Project(code="P2024-001", name="企业ERP系统实施", customer_id=c1.id, manager_id=pm.id, budget=Decimal("500000"), stage="execution", planned_start=datetime(2024,1,1), planned_end=datetime(2024,12,31))
p2 = Project(code="P2024-002", name="数据分析平台建设", customer_id=c2.id, manager_id=pm.id, budget=Decimal("300000"), stage="planning", planned_start=datetime(2024,6,1), planned_end=datetime(2025,3,31))
db.add_all([p1, p2]); db.flush()

db.add_all([Task(title="需求调研", project_id=p1.id, assignee_id=pm.id, priority="high", status="done", due_date=datetime(2024,6,1)),
             Task(title="系统设计", project_id=p1.id, assignee_id=pm.id, priority="high", status="in_progress", due_date=datetime(2024,9,1)),
             Task(title="测试", project_id=p1.id, assignee_id=pm.id, priority="medium", status="todo", due_date=datetime(2025,1,1)),
             Task(title="数据建模", project_id=p2.id, assignee_id=finance.id, priority="high", status="in_progress", due_date=datetime(2024,9,15))])

Ct1 = Contract(project_id=p1.id, code="CT-2024-001", name="ERP主合同", amount=Decimal("480000"), signed_date=datetime(2024,1,15))
Ct2 = Contract(project_id=p2.id, code="CT-2024-002", name="数据分析平台合同", amount=Decimal("280000"), signed_date=datetime(2024,6,10))
db.add_all([Ct1, Ct2])

r1 = Receipt(project_id=p1.id, amount=Decimal("150000"), received_date=datetime(2024,3,1), payer="智造科技", status="confirmed")
r2 = Receipt(project_id=p1.id, amount=Decimal("200000"), received_date=datetime(2024,6,15), payer="智造科技", status="confirmed")
db.add_all([r1, r2])

db.add_all([Risk(title="需求变更频繁", project_id=p1.id, risk_level="high", status="open", response_plan="建立变更控制委员会"),
             Risk(title="人员不足", project_id=p2.id, risk_level="medium", status="monitoring", response_plan="招聘外部顾问")])

# 里程碑
Milestone(name="需求确认", project_id=p1.id, planned_date=datetime(2024,3,1), status="completed", completed_date=datetime(2024,2,28))
Milestone(name="系统上线", project_id=p1.id, planned_date=datetime(2024,10,1), status="in_progress")
Milestone(name="方案评审", project_id=p2.id, planned_date=datetime(2024,8,1), status="todo")
db.add_all([Milestone(name="需求确认", project_id=p1.id, planned_date=datetime(2024,3,1), status="completed", completed_date=datetime(2024,2,28)),
             Milestone(name="系统上线", project_id=p1.id, planned_date=datetime(2024,10,1), status="in_progress"),
             Milestone(name="方案评审", project_id=p2.id, planned_date=datetime(2024,8,1), status="todo")])

# 问题
Issue(title="接口文档缺失", project_id=p1.id, severity="high", status="open")
Issue(title="测试环境不稳定", project_id=p1.id, severity="medium", status="in_progress")
db.add_all([Issue(title="接口文档缺失", project_id=p1.id, severity="high", status="open"),
             Issue(title="测试环境不稳定", project_id=p1.id, severity="medium", status="in_progress")])

# 通知
Notification(user_id=admin.id, content="新项目「企业ERP系统实施」已创建", is_read=False)
Notification(user_id=pm.id, content="你有2个待办任务即将到期", is_read=False)
Notification(user_id=admin.id, content="回款¥150,000已确认", is_read=True)
db.add_all([Notification(user_id=admin.id, content="新项目「企业ERP系统实施」已创建", is_read=False),
             Notification(user_id=pm.id, content="你有2个待办任务即将到期", is_read=False),
             Notification(user_id=admin.id, content="回款¥150,000已确认", is_read=True)])

db.commit()
db.close()
print("种子数据已创建: 2部门, 3用户, 2客户, 2项目, 5任务, 2合同, 2回款, 3里程碑, 2问题, 3通知")
