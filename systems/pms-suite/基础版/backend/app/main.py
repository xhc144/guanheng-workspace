from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .demo import seed_demo_database
from .modules import auth, customer, org, projects, tasks, risks, finance, dashboard, governance, search, data_ops, audit_center

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 仅创建受控演示库的缺失表；不删除或覆盖任何既有数据库。
    seed_demo_database()
    yield


app = FastAPI(title=settings.APP_NAME, version="0.1.0", lifespan=lifespan)

origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["health"])
def health_check():
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(org.router)
app.include_router(customer.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(risks.router)
app.include_router(finance.router)
app.include_router(dashboard.router)
app.include_router(governance.router)
app.include_router(search.router)
app.include_router(data_ops.router)
app.include_router(audit_center.router)
