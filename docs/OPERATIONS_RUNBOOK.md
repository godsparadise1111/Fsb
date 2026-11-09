# راهنمای عملیات و آمادگی تولید F-S

## وضعیت

این راهنما برای نسخه On-prem و محیط Staging است. بسته Docker Compose، migration ledger، backup رمزگذاری‌شده و restore script قبلاً ایجاد شده‌اند، اما روی سرور Ubuntu مشتری/سازمان اجرا و تأیید نشده‌اند. اجرای این راهنما روی Production بدون پذیرش Staging مجاز نیست.

## پیش‌نیازهای استقرار

- Docker Engine و Docker Compose v2
- PostgreSQL volume پایدار و فضای کافی برای backup
- فایل `.env` خارج از Git با permission محدود
- دامنه، TLS reverse proxy و originهای دقیق در `CORS_ORIGINS`
- `JWT_SECRET`، `BOOTSTRAP_TOKEN`، `FSB_OUTBOX_ENCRYPTION_KEY` و `FSB_METRICS_TOKEN` مستقل و قوی
- کلید خصوصی age خارج از میزبان برنامه و در مخزن امن آفلاین/مجزا
- SMTP معتبر برای worker اعلان‌ها

## نصب و ارتقا

1. ابتدا backup فعلی و تأیید قابل بازیابی بودن آن را ثبت کنید.
2. فایل `.env.onprem.example` را به `.env` کپی و همه مقادیر نمونه را جایگزین کنید.
3. `CORS_ORIGINS` را فقط با originهای واقعی وب وارد کنید؛ wildcard ممنوع است.
4. `FSB_METRICS_TOKEN` حداقل 32 کاراکتر تصادفی باشد.
5. `bash scripts/install-onprem.sh` را فقط برای دیتابیس تازه اجرا کنید.
6. برای نسخه موجود، `bash scripts/upgrade-onprem.sh` را پس از بررسی release notes و backup اجرا کنید.
7. migrationها فقط با ledger/checksum اجرا می‌شوند؛ فایل اعمال‌شده را ویرایش نکنید.
8. پس از استقرار `bash scripts/smoke-onprem.sh` را اجرا و خروجی کامل را نگهداری کنید.

`DB_SYNCHRONIZE=true` در Production ممنوع است و برنامه هنگام startup آن را رد می‌کند.

## Health و readiness

- `GET /api/health`: liveness ساده فرایند API.
- `GET /api/health/ready`: آمادگی API با بررسی اتصال PostgreSQL؛ در خطای دیتابیس HTTP 503.
- `GET /api/health/metrics`: خروجی Prometheus؛ فقط با `Authorization: Bearer <FSB_METRICS_TOKEN>`. بدون secret معتبر endpoint به‌صورت 404 پاسخ می‌دهد.

Metrics فعلی در حافظه همان process نگهداری می‌شوند و با restart پاک می‌شوند. برای محیط چند replica باید هر replica جداگانه scrape شود یا metrics به سامانه تجمیع بیرونی ارسال شود. این metrics جایگزین tracing توزیع‌شده یا مانیتورینگ PostgreSQL/Host نیستند.

## لاگ‌ها و امنیت

- هر درخواست یک `X-Request-ID` دارد؛ اگر شناسه ورودی معتبر نباشد، سرور شناسه جدید می‌سازد.
- لاگ درخواست JSON شامل method، route، status، duration و requestId است.
- body، query string، cookie، Authorization و اطلاعات شخصی عمداً در access log ثبت نمی‌شوند.
- Docker json-file log rotation با سقف اندازه و تعداد فایل برای سرویس‌های Compose تنظیم شده است.
- دسترسی به metrics فقط از شبکه مانیتورینگ مورد اعتماد و با secret انجام شود.
- TLS، rate limiting لبه، WAF، سیاست نگهداری log و ارسال log به سامانه مرکزی بر عهده reverse proxy/زیرساخت میزبان است.

## Backup و بازیابی

- قبل از هر upgrade و طبق برنامه روزانه/سازمانی backup دیتابیس و فایل‌های خصوصی تهیه کنید.
- خروجی backup باید رمزگذاری و checksum شود؛ کلید خصوصی age و کلید رمزگذاری Outbox روی همان میزبان backup نگهداری نشوند.
- restore فقط در محیط ایزوله و با نسخه سازگار برنامه و schema تمرین شود.
- پس از restore، migration ledger، health/readiness، تعداد فایل‌ها، دسترسی پیوست، صف اعلان و tenant isolation بررسی شوند.
- RPO و RTO تا زمانی که restore زمان‌سنجی‌شده و تکرارشونده ثبت نشده، مقدار تضمین‌شده ندارند. مالک سرویس باید اهداف را تعیین و نتایج واقعی را ثبت کند.

## پاسخ به رخداد

1. رخداد را با زمان UTC، requestId، tenantId (در سامانه incident؛ نه در log عمومی)، نسخه برنامه و اثر کسب‌وکار ثبت کنید.
2. در رخداد امنیتی، کلید API یا credential مربوط را فوراً revoke کنید؛ secret را در ticket یا log کپی نکنید.
3. در رخداد دیتابیس، workerهای نوشتنی را طبق runbook متوقف کنید، از وضعیت فعلی snapshot بگیرید و از اجرای migration دستی خودداری کنید.
4. برای وضعیت مبهم گردش‌کار، از recovery incident و history استفاده کنید؛ مرحله فرایند را حدس نزنید و replay انسانی انجام ندهید.
5. پس از رفع مشکل، integrity queryها و آزمون پذیرش tenant را اجرا و نتیجه را به incident متصل کنید.

## SLA و پشتیبانی

هیچ تعهد قراردادی uptime یا زمان پاسخ پشتیبانی در این نسخه تعریف نشده است. پیش از عرضه باید:
- ساعات پشتیبانی، منطقه زمانی، کانال ثبت درخواست و مالک escalation مشخص شود.
- شدت P1 تا P4 و زمان پاسخ/به‌روزرسانی/حل هدف‌گذاری شود.
- maintenance window، چرخه patch امنیتی و مدت نگهداری backup تعیین شود.
- مسئولیت مشتری برای شبکه، SMTP، storage، TLS و backup مشخص شود.
- SLA قراردادی فقط بر اساس اندازه‌گیری staging/production و ظرفیت تیم پشتیبانی منتشر شود.

## Gateهای اجباری قبل از Production

- تمام migrationها با checksum صحیح اعمال شوند.
- تست cross-tenant read/write و API key انجام شود.
- تست هم‌زمانی membership، subscription، invoice و tenant closure انجام شود.
- backup و restore کامل در محیط ایزوله انجام و زمان آن ثبت شود.
- تست بار روی سناریوهای واقعی و تست امنیتی مستقل انجام شود.
- هشدارهای DB، disk، worker، outbox، latency و error rate به گیرنده مسئول برسند.
- سیاست RPO/RTO و SLA توسط مالک کسب‌وکار تأیید شود.


## نمونه پایش بیرونی Prometheus

- پیکربندی scrape در `ops/prometheus/prometheus.yml` و ruleهای پایه در `ops/prometheus/fsb-alerts.yml` قرار دارند.
- target نمونه `bpms.example.com` و مسیر scrape باید با دامنه واقعی جایگزین شود.
- فایل secret توکن باید خارج از Git و فقط خواندنی برای Prometheus باشد؛ آن را داخل YAML یا Docker image قرار ندهید.
- ruleهای موجود unavailable شدن endpoint، نرخ 5xx، درخواست‌های کند و restart process را پوشش می‌دهند.
- برای ارسال هشدار به تیم عملیات، Alertmanager و receiver سازمانی را جداگانه پیکربندی کنید.
- این ruleها جایگزین هشدار PostgreSQL، فضای دیسک، Docker host، worker heartbeat، Outbox، recovery incident و backup age نیستند؛ exporter و alertهای آن‌ها باید در زیرساخت مانیتورینگ اضافه شوند.
