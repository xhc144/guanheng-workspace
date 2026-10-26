.PHONY: help install start test lint clean

help:
	@echo "make install     - Install dependencies"
	@echo "make start       - Start backend + frontend"
	@echo "make test        - Run all tests"
	@echo "make verify      - Run verify_goal.ps1 (PowerShell)"
	@echo "make lint        - Lint code"

install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

start:
	cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
	cd frontend && npm run dev

test:
	cd backend && pytest tests/ -v
	cd frontend && npx vitest run

verify:
	python verify_goal.py

lint:
	cd backend && ruff check .
	cd frontend && npx eslint src/
