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
تمام مسیرهای زیر زیر پیشوند `/api` هستند.

### سلامت
- `GET /api/health`

### ساختار سازمانی
- `POST /api/organizations` ایجاد سازمان؛ بدنه: `{ "name": "...", "code": "..." }`
- `GET /api/organizations` فهرست سازمان‌ها
- `POST /api/organizations/units` ایجاد واحد؛ بدنه شامل `organizationId`, `name`, `code` و اختیاری `parentId`
- `GET /api/organizations/:organizationId/units` فهرست واحدهای سازمان
- `POST /api/organizations/positions` ایجاد سمت؛ بدنه شامل `organizationUnitId`, `title`, `code`
- `GET /api/organizations/units/:unitId/positions` فهرست سمت‌های واحد

### کاربران، عضویت سازمانی و دسترسی
- `POST /api/users` ایجاد کاربر؛ `firstName`, `lastName`, `email`, `username` و اختیاری `phone`
- `GET /api/users` فهرست کاربران فعال
- `PATCH /api/users/:id/active` فعال/غیرفعال کردن؛ بدنه `{ "isActive": true }`
- `POST /api/user-positions` انتساب کاربر به سمت؛ `userId`, `positionId`, اختیاری `validFrom`, `validUntil`, `isPrimary`
- `GET /api/users/:id/positions` سمت‌های کاربر
- `POST /api/permissions` تعریف مجوز؛ `code`, `name`, اختیاری `description`
- `GET /api/permissions` فهرست مجوزها
- `POST /api/roles` ایجاد نقش با `code`, `name`, اختیاری `description`, `permissionIds`
- `GET /api/roles` فهرست نقش‌ها و مجوزهایشان
- `POST /api/user-roles` اعطای نقش؛ `userId`, `roleId` و اختیاری `organizationId`

### تعریف و نسخه‌بندی فرایند
- `POST /api/process-definitions` تعریف فرایند؛ `organizationId`, `code`, `name`, اختیاری `description`
- `GET /api/process-definitions?organizationId=...` فهرست فرایندها
- `POST /api/process-definitions/:id/versions` ساخت نسخه جدید پیش‌نویس؛ `schema` و اختیاری `changeNote`
- `GET /api/process-definitions/:id/versions` فهرست نسخه‌ها
- `POST /api/process-definitions/:id/versions/:versionId/publish` انتشار نسخه پیش‌نویس
- `PATCH /api/process-definitions/:id/archive` بایگانی تعریف فرایند

### اجرای گردش‌کار
- `POST /api/process-instances` شروع نمونه فرایند؛ شامل `processVersionId`, `organizationId`, `startedByUserId`, `title`, `initialAssigneeUserIds` و اختیاری `data`, `assignmentPolicy`, `firstTaskTitle`
- `GET /api/tasks/my?userId=...` کارهای باز کاربر
- `POST /api/tasks/:id/actions` اقدام کاربر؛ `userId`, `action` برابر `APPROVED` یا `REJECTED` و اختیاری `comment`
- `GET /api/tasks/:id/history` تاریخچه اقدامات کار

سیاست `ALL_ASSIGNEES` فقط پس از تأیید همه افراد منتسب، کار را کامل می‌کند. سیاست `ANY_ASSIGNEE` با اولین تأیید کامل می‌شود. رد هر یک از افراد در نسخه فعلی، کار و نمونه فرایند را لغو می‌کند.

### فرم‌ساز و ثبت اطلاعات
- `POST /api/forms` تعریف فرم؛ `organizationId`, `code`, `name` و اختیاری `description`
- `GET /api/forms?organizationId=...` فهرست فرم‌ها
- `POST /api/forms/:id/versions` ساخت نسخه فرم؛ `schema` و اختیاری `changeNote`
- `GET /api/forms/:id/versions` فهرست نسخه‌ها
- `POST /api/forms/:id/versions/:versionId/publish` انتشار نسخه فرم
- `POST /api/forms/versions/:versionId/submissions` ثبت داده فرم؛ `submittedByUserId`, `data` و اختیاری `processInstanceId`
- `GET /api/forms/versions/:versionId/submissions` مشاهده ثبت‌های یک نسخه فرم

ساختار schema فرم به‌صورت JSON نگهداری می‌شود و نسخه‌های منتشرشده مبنای ثبت داده قرار می‌گیرند. اعتبارسنجی معنایی فیلدها و رندرر فرم در لایه بعدی توسعه می‌یابد.

## هشدارهای فعلی
این API در این مرحله برای توسعه است و هنوز احراز هویت، کنترل دسترسی اجرایی و مدیریت نشست ندارد؛ شناسه کاربر در درخواست‌ها صرفاً ورودی است و هویت اثبات‌شده محسوب نمی‌شود. تا تکمیل لایه امنیتی، آن را در شبکه عمومی منتشر نکنید. تنظیم `DB_SYNCHRONIZE=true` فقط برای توسعه محلی است؛ برای محیط عملیاتی باید migrationهای TypeORM استفاده شوند. اجرای build و تست هنوز انجام نشده و عمداً به مرحله‌ای که درخواست کرده‌اید موکول است.
