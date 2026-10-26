"""请求计时+安全中间件"""
import time
import uuid
from fastapi import Request
from app.logger import get_logger

logger = get_logger("middleware")


async def timing_middleware(request: Request, call_next):
    start = time.perf_counter()
    request.state.request_id = str(uuid.uuid4())[:8]
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    response.headers["X-Request-Id"] = request.state.request_id
    response.headers["X-Response-Time-Ms"] = f"{elapsed:.2f}"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.headers.get("x-forwarded-proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if elapsed > 1000:
        logger.warning(f"慢请求: {request.method} {request.url.path} ({elapsed:.0f}ms)")
    return response
