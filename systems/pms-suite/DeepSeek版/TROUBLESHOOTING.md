# 故障排查

## pi代理bash不可用
- 症状: `No bash shell found`
- 原因: pi硬编码Git Bash路径
- 解决: 主机手动执行命令

## 验证方式

### `ModuleNotFoundError`
```bash
cd backend && pip install -r requirements.txt
```

### 端口被占用
```bash
# 查找占用 8000 端口的进程
netstat -ano | findstr :8000
# 杀死进程
taskkill /PID <PID> /F
```

### 数据库文件损坏
```bash
del backend\pms.db  # 删除后重启自动重建
```

## 前端构建失败

### `npm install` 失败
```bash
# 清除缓存重试
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### TypeScript 类型错误
```bash
npx tsc --noEmit  # 查看具体错误
```

## 测试失败

### Pytest 连接被拒
确保后端在运行：`python -m uvicorn app.main:app --port 8000`

### Vitest 找不到组件
```bash
cd frontend && npm install --save-dev @testing-library/react jsdom
```

## Docker 问题

### 端口冲突
```bash
docker-compose down && docker-compose up -d
```

### 容器启动失败
```bash
docker-compose logs backend  # 查看具体错误
```
