# راهنمای استقرار و عملیات F-S

این راهنما برای آماده‌سازی محیط Staging/On-prem است. ثبت فایل‌های استقرار به معنی اجرای موفق روی سرور یا تأیید Production نیست.

## 1. معماری سرویس‌ها

فایل `compose.production.yaml` سرویس‌ها را جدا نگه می‌دارد:

- `db`: PostgreSQL 16؛ فقط روی شبکه داخلی Compose و بدون انتشار پورت میزبان.
- `api`: NestJS API؛ پورت میزبان فقط روی loopback منتشر می‌شود.
- `web`: Next.js؛ پورت میزبان فقط روی loopback منتشر می‌شود.
- `report-worker`: صف گزارش، cache cleanup و زمان‌بندی گزارش.
- `notification-worker`: Outbox، SMTP و تحویل اعلان.
- `workflow-automation-worker`: بازتخصیص خودکار SLA و مسئول غیرفعال.
- `workflow-recovery-worker`: تشخیص و اصلاح محافظه‌کارانه وضعیت‌های ناسازگار گردش کار.

Workerها process مستقل‌اند. متغیر فعال‌سازی Workerها روی API خاموش است و هر سرویس Worker فقط قابلیت خودش را روشن می‌کند. Recovery Worker فقط موارد قطعی را اصلاح می‌کند و موارد مبهم را برای بررسی اپراتور ثبت می‌کند.

## 2. آماده‌سازی secrets و دامنه

1. فایل نمونه را کپی کنید: `cp .env.example .env`.
2. رمز PostgreSQL، JWT و Bootstrap را با مقادیر تصادفی مستقل جایگزین کنید.
3. `NODE_ENV=production` و `DB_SYNCHRONIZE=false` را تنظیم کنید.
4. `CORS_ORIGINS` را فقط با Originهای واقعی و مجاز Web تنظیم کنید؛ wildcard مجاز نیست.
5. `NEXT_PUBLIC_API_URL` را با URL عمومی HTTPS API و مسیر `/api` تنظیم کنید.
6. `FSB_PUBLIC_APP_URL` را با URL عمومی HTTPS وب تنظیم کنید.
7. کلید Outbox را با `openssl rand -hex 32` تولید کنید و در `FSB_OUTBOX_ENCRYPTION_KEY` بگذارید. این کلید را در Secret Manager نگهداری کنید؛ تغییر آن بدون برنامه مهاجرت payloadهای رمزگذاری‌شده باعث غیرقابل‌خواندن شدن پیام‌های قبلی می‌شود.
8. SMTP host/port/from و در صورت نیاز هر دو مقدار SMTP user/pass را تنظیم کنید. برای پورت 465 معمولاً `FSB_SMTP_SECURE=true` و برای 587 معمولاً false است؛ تنظیم قطعی را از سرویس‌دهنده SMTP بگیرید.
9. `FSB_PDF_FONT_PATH` در تصویر API به فونت DejaVu Sans تنظیم شده است. این فونت فارسی را در سطح پایه پشتیبانی می‌کند؛ برای کیفیت مطلوب‌تر فارسی، یک TTF فارسی مورد تأیید را در تصویر اضافه و مسیر آن را تنظیم کنید.

فایل `.env` و کلیدهای واقعی نباید commit یا داخل image شوند.

## 3. Preflight و ساخت image

از ریشه مخزن اجرا کنید:

```sh
sh scripts/ops/preflight.sh
docker compose --env-file .env -f compose.production.yaml build
```

Dockerfileها فعلاً برای نصب از `npm install` استفاده می‌کنند، زیرا در ریشه monorepo فایل lockfile ثبت‌شده وجود ندارد. پیش از عرضه Production باید یک `package-lock.json` واحد در ریشه تولید، بازبینی و commit شود؛ پس از آن Dockerfileها باید به `npm ci` تغییر کنند تا Build تکرارپذیر باشد.

## 4. Migration و Backup

- هیچ Migration را روی Production برای اولین بار اجرا نکنید.
- ابتدا یک Staging هم‌نسخه با Production بسازید و Backup دیتابیس و volume فایل خصوصی تهیه کنید.
- ابتدا تمام Migrationهای پایه و دامنه را با runner/ledger رسمی همان نسخه اعمال کنید؛ فایل‌های Migration را با اجرای دستی خارج از ledger دوباره اجرا نکنید.
- Migrationهای گزارش‌ساز `20261109_024_tenant_saved_reports.sql` و `20261109_025_report_jobs_cache_schedules.sql` پس از وجود Tenant، عضویت، نقش/مجوز و جدول‌های پایه لازم اجرا می‌شوند.
- برای این دو Migration، اسکریپت `scripts/ops/apply-report-migrations.sh` یک ledger مستقل checksumدار ایجاد می‌کند و هر Migration را به‌همراه ثبت checksum در یک تراکنش اجرا می‌کند. اجرا فقط در Staging و با Backup معتبر مجاز است:

```sh
DATABASE_URL='postgresql://...' FSB_MIGRATION_BACKUP_FILE='/secure/backups/pre-migration.dump' sh scripts/ops/apply-report-migrations.sh
```

- اگر اشیای Migration از قبل وجود داشته باشند اما در ledger این اسکریپت ثبت نشده باشند، اسکریپت عمداً متوقف می‌شود؛ وضعیت را دستی reconcile کنید و اسکریپت را دور نزنید.
- قبل و بعد از Migration، ledger/checksum، جدول‌ها، قیود FK و ایندکس‌ها را ثبت و بررسی کنید.
- اسکریپت Backup زیر به `age` و کلید عمومی گیرنده نیاز دارد و هم DB و هم فایل‌های خصوصی را رمزگذاری می‌کند:

```sh
AGE_RECIPIENT=age1... sh scripts/ops/backup-staging.sh
```

فایل‌های رمزگذاری‌شده و checksum را به مقصدی خارج از میزبان Docker منتقل کنید. Backup روی همان دیسک تنها نسخه پشتیبان محسوب نمی‌شود.

## 5. شروع و کنترل سرویس‌ها

پس از Migration موفق در Staging:

```sh
docker compose --env-file .env -f compose.production.yaml up -d db
docker compose --env-file .env -f compose.production.yaml up -d api web
docker compose --env-file .env -f compose.production.yaml up -d report-worker notification-worker
docker compose --env-file .env -f compose.production.yaml up -d workflow-automation-worker workflow-recovery-worker
docker compose --env-file .env -f compose.production.yaml ps
docker compose --env-file .env -f compose.production.yaml logs --tail=200 api
```

Reverse proxy باید TLS را خاتمه دهد و فقط به پورت‌های loopback وب و API متصل شود. PostgreSQL را مستقیم روی اینترنت منتشر نکنید.

## 6. آزمون پذیرش Staging

- `GET /api/health/ready` باید فقط وقتی DB قابل دسترس است پاسخ آماده بدهد.
- ارسال ایمیل آزمایشی و دریافت پیام از Outbox را بررسی کنید؛ SMTP صرفاً با وجود متغیرها تأیید نمی‌شود.
- یک PDF فارسی واقعی بسازید و اتصال حروف، راست‌به‌چپ، اعداد و فونت تعبیه‌شده را بصری بررسی کنید.
- خروجی XLSX را با Excel/LibreOffice باز کنید و RTL/اعداد را کنترل کنید.
- یک گزارش پس‌زمینه، retry، lease منقضی و زمان‌بندی timezone را آزمایش کنید.
- گردش کار را با هر دو سیاست `ALL_ASSIGNEES` و `ANY_ASSIGNEE`، رد، بازگشت، تفویض، جانشینی و لغو عضویت آزمایش کنید.
- با دو Tenant و دو سازمان مستقل، IDOR، دسترسی به کارتابل، گزارش، فایل، تاریخچه و Outbox را آزمایش کنید.
- Recovery را با وضعیت‌های آزمایشی ناسازگار بررسی کنید؛ هیچ Incident مبهمی نباید خودکار به مرحله بعد منتقل شود.

## 7. بازیابی

1. ترافیک ورودی را در Reverse Proxy متوقف کنید.
2. سرویس‌های Worker و API را متوقف کنید؛ DB را تا پایان Backup دست‌نخورده نگه دارید.
3. checksum فایل Backup رمزگذاری‌شده را بررسی و سپس با کلید خصوصی age بازگشایی کنید.
4. Restore را ابتدا در یک دیتابیس و زیرشاخه فایل ایزوله انجام دهید؛ روی دیتابیس اصلی آزمایش نکنید. اسکریپت زیر این جداسازی را اعمال می‌کند و دیتابیس موجود را overwrite نمی‌کند:

```sh
BACKUP_FILE='backups/fsb-<timestamp>.tar.gz.age' \
AGE_IDENTITY='/secure/keys/backup-identity.txt' \
RESTORE_DATABASE='fsb_restore_2026' \
ALLOW_STAGING_RESTORE=YES \
sh scripts/ops/restore-staging.sh
```

5. checksum فایل‌های خصوصی، تعداد رکوردهای کلیدی، Migration ledger و سلامت FKها را بررسی کنید.
6. API و Workerها را در محیط ایزوله با دیتابیس و مسیر فایل Restoreشده بالا بیاورید و smoke test انجام دهید.
7. فقط پس از تأیید مالک فنی، مقصد بازیابی را جایگزین کنید.

RPO/RTO تا زمان تمرین بازیابی واقعی و تصویب مالک کسب‌وکار مقدار تأییدشده‌ای ندارد. این راهنما ادعای Restore آزمایش‌شده نمی‌کند.

## 8. محدودیت‌های فعلی

- سرور/Staging در این کار راه‌اندازی نشده است.
- Migrationها اجرا نشده‌اند.
- SMTP واقعی، خروجی PDF/XLSX و نمایش فونت فارسی روی image ساخته‌شده آزمایش نشده‌اند.
- Build و تست Docker/Compose اجرا نشده‌اند.
- Lockfile ریشه هنوز موجود نیست.
