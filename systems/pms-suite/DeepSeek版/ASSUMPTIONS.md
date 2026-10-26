# Assumptions

## Assumptions

1. **Git Bash unavailable**: pi bash tool hardcodes Git Bash paths; settings.json shellPath ignored. 1717。验收.vbs
2. **Python & Node installed**: Python 3.10+ and Node.js 18+ required on the host.
3. **SQLite for dev**: Default is SQLite (`backend/pms.db`). PostgreSQL supported via `DATABASE_URL`.
4. **Default credentials**: admin/admin123, finance/finance123, pm_wang/pm123, dev_li/dev123, exec_zhao/exec123.
5. **CORS open in dev**: All origins allowed. Restrict via `CORS_ORIGINS` in production.
6. **Seed data**: Auto-populated on first run when DB empty.
7. **CAPTCHA visual only**: Login page has CAPTCHA UI placeholder, no backend validation.
8. **verify_goal.py / self_check.py are canonical**: Since bash is unavailable, these are the primary verification methods.
9. **68 deliverables**: Including test_integration.py (full lifecycle integration test).
10. **Empty DB on first run**: The first `tests/` run populates the SQLite DB with seed data; subsequent runs work against existing data.
