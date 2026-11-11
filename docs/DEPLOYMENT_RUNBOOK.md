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
9. `FSB_PDF_FONT_PATH` در تصویر API به فونت TTF خانواده Noto Naskh Arabic تنظیم شده است؛ بسته `fonts-noto-core` در image نصب و وجود فایل فونت در زمان build کنترل می‌شود. برای استفاده از فونت سازمانی دیگر، یک TTF معتبر و دارای مجوز را در image قرار دهید و همین متغیر را به مسیر آن تغییر دهید.

فایل `.env` و کلیدهای واقعی نباید commit یا داخل image شوند.

## 3. Preflight و ساخت image

از ریشه مخزن اجرا کنید:

```sh
sh scripts/ops/preflight.sh
docker compose --env-file .env -f compose.production.yaml build
```

Lockfile ریشه در `package-lock.json` ثبت شده است. برای بازتولید و اعتبارسنجی نصب در clone محلی از ریشه مخزن اجرا کنید:

```sh
sh scripts/ops/prepare-lockfile.sh
git status --short
git diff -- package-lock.json
# فقط اگر lockfile نسبت به package manifests تغییر کرده است:
git add package-lock.json
git commit -m "build: refresh root npm workspace lockfile"
```

اسکریپت `prepare-lockfile.sh` فایل واحد را می‌سازد و `npm ci` را اعتبارسنجی می‌کند؛ GitHub Actions نیز در bootstrap اولیه lockfile را تولید و پس از Build و Docker build موفق در main ثبت کرده است. Dockerfileهای API و Web برای imageهای Production وجود lockfile را اجباری می‌کنند و فقط با `npm ci` نصب می‌کنند؛ Build بدون `package-lock.json` عمداً شکست می‌خورد. Preflight علاوه بر secrets، جداسازی پرچم Workerها و محدودبودن پورت API/Web به loopback را بررسی می‌کند.

در Windows PowerShell نیز می‌توانید همین دو دستور npm را مستقیم از ریشه اجرا کنید: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` و سپس `npm ci --no-audit --no-fund`.

## 4. Migration و Backup

- هیچ Migration را روی Production برای اولین بار اجرا نکنید.
- ابتدا یک Staging هم‌نسخه با Production بسازید و Backup دیتابیس و volume فایل خصوصی تهیه کنید.
- ابتدا تمام Migrationهای پایه و دامنه را با runner/ledger رسمی همان نسخه اعمال کنید؛ فایل‌های Migration را با اجرای دستی خارج از ledger دوباره اجرا نکنید.
- Migrationهای گزارش‌ساز `20261109_024_tenant_saved_reports.sql` و `20261109_025_report_jobs_cache_schedules.sql` و مجوز ارجاع مجدد گردش کار در `20261109_026_workflow_task_reassignment_permission.sql` پس از وجود جدول‌های پایه لازم اجرا می‌شوند.
- اسکریپت `scripts/ops/migrate.sh` تمام فایل‌های SQL را به ترتیب نام اجرا می‌کند؛ Migrationهای 024، 025 و 026 نیز در همین ledger/checksum ثبت می‌شوند. هر Migration و ثبت checksum آن در یک تراکنش با قفل advisory انجام می‌شود:

```sh
DATABASE_URL='postgresql://...' FSB_MIGRATION_BACKUP_FILE='/secure/backups/pre-migration.dump' sh scripts/ops/migrate.sh
```

- برای دیتابیس تازه، baseline تعیین نکنید تا همه Migrationها اجرا شوند. برای دیتابیس موجودی که Migrationهای قدیمی آن قبلاً اجرا شده‌اند اما ledger جدید ندارد، ابتدا آخرین Migration واقعاً اعمال‌شده را از روی شواهد دیتابیس مشخص کنید؛ سپس فقط با تأیید اپراتور آن را baseline کنید:

```sh
DATABASE_URL='postgresql://...' FSB_MIGRATION_BACKUP_FILE='/secure/backups/pre-migration.dump' FSB_MIGRATION_BASELINE='نام-فایل-آخرین-migration.sql' FSB_CONFIRM_BASELINE=YES sh scripts/ops/migrate.sh
```

- baseline فقط checksum فایل‌های قبل و شامل آن نقطه را ثبت می‌کند و آن‌ها را اجرا نمی‌کند؛ هرگز نام baseline را حدس نزنید. Migrationهای بعدی از جمله 024 و 025 اجرا خواهند شد. اگر اشیای گزارش‌ساز از قبل وجود دارند اما Migrationهای مربوطه در ledger ثبت نشده‌اند، اجرای مجدد را دور نزنید؛ وضعیت را دستی reconcile کنید.
- قبل و بعد از Migration، ledger/checksum، جدول‌ها، قیود FK و ایندکس‌ها را ثبت و بررسی کنید.
- اسکریپت Backup زیر به `age` و کلید عمومی گیرنده نیاز دارد و هم DB و هم فایل‌های خصوصی را رمزگذاری می‌کند:

ابتدا API و همه Workerها را متوقف کنید تا Snapshot دیتابیس و فایل‌های خصوصی با هم سازگار باشد؛ DB باید روشن بماند:

```sh
docker compose --env-file .env -f compose.production.yaml stop api report-worker notification-worker workflow-automation-worker workflow-recovery-worker
FSB_BACKUP_QUIESCE_CONFIRMED=YES AGE_RECIPIENT=age1... sh scripts/ops/backup-staging.sh
# پس از موفقیت Backup سرویس‌ها را دوباره بالا بیاورید.
docker compose --env-file .env -f compose.production.yaml up -d api report-worker notification-worker workflow-automation-worker workflow-recovery-worker
```

فایل‌های رمزگذاری‌شده و checksum را به مقصدی خارج از میزبان Docker منتقل کنید. اسکریپت Migration وجود sidecar با پسوند `.sha256` را اجباری می‌کند و checksum را پیش از هر تغییری بررسی می‌کند؛ sidecar به‌صورت relocatable نوشته می‌شود. Backup روی همان دیسک تنها نسخه پشتیبان محسوب نمی‌شود.

## 5. شروع و کنترل سرویس‌ها

پس از Migration موفق در Staging:

```sh
docker compose --env-file .env -f compose.production.yaml up -d db
docker compose --env-file .env -f compose.production.yaml up -d api web
docker compose --env-file .env -f compose.production.yaml up -d report-worker notification-worker
docker compose --env-file .env -f compose.production.yaml up -d workflow-automation-worker workflow-recovery-worker
docker compose --env-file .env -f compose.production.yaml ps
docker compose --env-file .env -f compose.production.yaml logs --tail=200 api
sh scripts/ops/deploy-smoke.sh
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

- پیش از Production، `npm run build` و `npm run test:workflow --workspace @fsb/api` اجرا شوند؛ GitHub Actions نیز Build، تست انتقال Workflow و اعتبارسنجی Compose را روی push/PR بررسی می‌کند.
- تست‌های یکپارچه PostgreSQL، مجوز Tenant/سازمان، SMTP، PDF/XLSX، مرورگر و بازیابی کامل همچنان باید در Staging اجرا شوند.

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
- Build و تست Docker/Compose در CI اجرا شده‌اند؛ آزمون runtime، SMTP، PDF بصری و Restore کامل روی Staging باقی است.
- Lockfile ریشه ثبت شده و Dockerfileهای Production با `npm ci` از آن استفاده می‌کنند.
- `scripts/ops/deploy-smoke.sh` پس از بالا آمدن سرویس‌ها API readiness، پاسخ HTTP وب، وضعیت هفت سرویس و ثبت Migrationهای 024/025/026 در ledger را کنترل می‌کند؛ اجرای آن روی Staging هنوز انجام نشده است.


## 8. BPMS سازمانی و پذیرش پیشرفته

برای مدیریت ساختار سازمانی و فرم‌های متصل، مسیرهای شرطی داده‌محور، تست‌های Tenant isolation، هم‌زمانی، پایداری Worker و Restore به سند `docs/ENTERPRISE_BPMS_ACCEPTANCE.md` مراجعه کنید. اسکریپت‌های `scripts/staging-enterprise-acceptance.sh` و `scripts/ops/verify-staging.sh` فقط در محیط Staging صریحاً opt-in شده اجرا می‌شوند. آزمون k6 مربوط به اقدام Workflow وضعیت Fixture را تغییر می‌دهد و فقط باید روی وظیفه دورریختنی اجرا شود.
