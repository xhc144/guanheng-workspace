# 快速开始 — 综合项目管理系统

## 前置要求
- Python 3.10+  （pip）
- Node.js 18+    （npm）

## 3 步启动

### 1. 安装依赖
```bash
cd backend && pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..
```

### 2. 启动后端 (端口 8000)
```bash
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. 启动前端 (端口 5173)
```bash
cd frontend
npm run dev
```

打开 http://localhost:5173 → 登录 `admin` / `admin123`

## 验收
```bash
python verify_goal.py     # 推荐
.\test_run.bat            # Windows 备选
```

## Docker 部署
```bash
docker compose up -d
```
