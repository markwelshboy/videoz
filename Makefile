.PHONY: dev-backend dev-frontend test build docker

dev-backend:
	uvicorn app.main:app --app-dir backend --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

test:
	pytest backend/tests
	cd frontend && npm run build

build:
	cd frontend && npm run build

docker:
	docker build -t videoz:dev .
