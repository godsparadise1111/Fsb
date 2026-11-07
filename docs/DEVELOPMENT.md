# راهنمای توسعه محلی

## پیش‌نیازها
- Node.js 20 یا جدیدتر و npm
- Docker Engine و Docker Compose

## راه‌اندازی
1. `cp .env.example .env` و رمز محلی PostgreSQL را تغییر دهید.
2. پایگاه داده را اجرا کنید: `docker compose up -d postgres`
3. از ریشه مخزن وابستگی‌ها را نصب کنید: `npm install`
4. API: `npm run dev:api` (پورت 3001)
5. وب: `npm run dev:web` (پورت 3000)

## API پایه
- `GET /api/health` وضعیت سلامت API
- `POST /api/organizations` ایجاد سازمان؛ بدنه: `{ "name": "...", "code": "..." }
- `GET /api/organizations` فهرست سازمان‌ها
- `POST /api/organizations/units` ایجاد واحد؛ بدنه شامل `organizationId`, `name`, `code` و اختیاری `parentId`
- `GET /api/organizations/:organizationId/units` فهرست واحدهای سازمان
- `POST /api/organizations/positions` ایجاد سمت؛ بدنه شامل `organizationUnitId`, `title`, `code`
- `GET /api/organizations/units/:unitId/positions` فهرست سمت‌های واحد

## هشدارهای فعلی
تنظیم `DB_SYNCHRONIZE=true` فقط برای توسعه محلی است؛ در محیط عملیاتی باید migrationهای TypeORM استفاده شوند. API فعلی هنوز احراز هویت و مجوزدهی ندارد و نباید بدون لایه امنیتی در شبکه عمومی منتشر شود. قبل از اجرای محلی، نصب وابستگی‌ها و تست build لازم است؛ این مخزن از راه دور و در این مرحله روی محیط کاربر اجرا نشده است.
