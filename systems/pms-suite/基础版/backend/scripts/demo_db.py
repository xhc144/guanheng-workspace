"""受控演示数据库命令：seed 或 reset。"""
import argparse

from app.demo import reset_demo_database, seed_demo_database


def main() -> None:
    parser = argparse.ArgumentParser(description="管理 backend/.demo/demo.db")
    parser.add_argument("command", choices=("seed", "reset"))
    args = parser.parse_args()

    database_path = reset_demo_database() if args.command == "reset" else seed_demo_database()
    print(f"演示数据库已就绪：{database_path}")


if __name__ == "__main__":
    main()
