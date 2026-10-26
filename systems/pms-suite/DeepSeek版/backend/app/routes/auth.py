"""认证与用户管理路由"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Department
from app.schemas import LoginRequest, TokenResponse, UserCreate, UserOut
from app.auth import verify_password, hash_password, create_access_token, get_current_user, require_role

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username, User.is_active == True).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_access_token({"sub": user.id, "role": user.role})
    return JSONResponse(content=TokenResponse(
        access_token=token,
        user={"id": user.id, "username": user.username, "real_name": user.real_name, "role": user.role}
    ).model_dump(), headers={"Cache-Control": "no-store"})


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/register", response_model=UserOut)
def register(req: UserCreate, db: Session = Depends(get_db)):
    """Anonymous registration always creates a least-privileged member."""
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = User(
        username=req.username,
        hashed_password=hash_password(req.password),
        real_name=req.real_name,
        email=req.email,
        phone=req.phone,
        role="member",
        department_id=req.department_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user




@router.put("/me", response_model=UserOut)
def update_me(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """更新本人资料"""
    if "real_name" in data:
        current_user.real_name = data["real_name"]
    if "email" in data:
        current_user.email = data["email"]
    if "phone" in data:
        current_user.phone = data["phone"]
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(User).all()


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("enterprise_admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    user.is_active = False
    db.commit()
    return {"ok": True}


# 用户管理别名路由（/api/users），供前端与验收测试使用
users_router = APIRouter(prefix="/api/users", tags=["用户"])


@users_router.get("", response_model=list[UserOut])
def list_users_v1(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(User).filter(User.is_active == True).order_by(User.created_at).all()


router_deps = APIRouter(prefix="/api/departments", tags=["部门"])


@router_deps.get("")
def list_departments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Department).filter(Department.is_active == True).all()


@router_deps.post("")
def create_department(
    name: str,
    parent_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("enterprise_admin")),
):
    dept = Department(name=name, parent_id=parent_id)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.put("/change-password")
def change_password(req: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(req.get("old_password", ""), current_user.hashed_password):
        raise HTTPException(status_code=400, detail="旧密码不正确")
    current_user.hashed_password = hash_password(req["new_password"])
    db.commit()
    return {"ok": True}
