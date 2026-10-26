# 部署指南

## Docker 部署（推荐）

```bash
docker-compose up -d
```

- 后端: http://localhost:8000
- 前端: http://localhost:5173
- 默认管理员: admin / admin123

## 手动部署

详见 [DEVELOPMENT.md](./DEVELOPMENT.md) 快速开始部分。

## 生产环境注意事项

1. **数据库**: 修改 `backend/app/config.py` 中 `DATABASE_URL` 为 PostgreSQL 连接串
2. **密钥**: 修改 `SECRET_KEY` 为随机生成的安全密钥
3. **CORS**: 配置 `ALLOWED_ORIGINS` 为前端实际域名
4. **文件存储**: `uploads/` 目录挂载持久化卷
5. **日志**: 默认写入 `app.log`（轮转 10MB×3），生产建议接入 ELK/Sentry
6. **HTTPS**: 前端 Nginx 配置 SSL 证书
7. **防火墙**: 仅暴露前端 80/443 端口，后端 8000 仅内网访问

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DATABASE_URL | sqlite:///./test.db | 数据库连接串 |
| SECRET_KEY | dev-secret-key-... | JWT 签名密钥 |
| ACCESS_TOKEN_EXPIRE | 480 | Token 有效期（分钟） |
| ALLOWED_ORIGINS | * | CORS 允许源 |
