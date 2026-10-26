"""本地演示播种入口；与应用启动共用种子，不覆盖既有账号。"""
from app.config import settings


def seed_demo_database() -> None:
    # 必须在导入数据库/路由或创建表之前拒绝生产调用。
    if settings.is_production:
        raise RuntimeError("生产模式禁止播种演示数据或创建演示账号")
    from app.main import on_startup

    on_startup()


if __name__ == "__main__":
    seed_demo_database()
    print("本地演示数据初始化完成；既有账号及密码保持不变")
