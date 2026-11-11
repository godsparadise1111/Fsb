# قالب گزارش پذیرش عملیاتی Staging

> این فایل قالب ثبت نتیجه است، نه گزارش اجرای واقعی. تا زمانی که شواهد محیط Staging پیوست نشده‌اند، وضعیت هر آزمون باید `NOT RUN` باقی بماند.

## مشخصات اجرا

| فیلد | مقدار |
|---|---|
| نسخه / commit | `<commit-sha>` |
| محیط | `<staging-id>` |
| تاریخ و ساعت شروع/پایان (UTC) | `<timestamps>` |
| نسخه PostgreSQL | `<version>` |
| نسخه Docker / Compose | `<versions>` |
| اجراکننده | `<operator>` |
| شناسه Backup قبل از آزمون | `<backup-id>` |
| نتیجه کلی | `NOT RUN` |

**ممنوع:** توکن، رمز، کلید خصوصی، محتوای داده واقعی مشتری یا رشته اتصال حاوی رمز را در این گزارش ثبت نکنید.

## ماتریس پذیرش

برای هر ردیف فقط یکی از وضعیت‌های `PASS`، `FAIL`، `BLOCKED` یا `NOT RUN` ثبت شود. هر PASS باید به شواهد قابل بازبینی ارجاع دهد.

| آزمون | معیار پذیرش | وضعیت | شواهد / شناسه اجرا | نقص یا اقدام اصلاحی |
|---|---|---|---|---|
| CI و Build | نصب lockfile، Build، Unit tests، Compose و imageها موفق | NOT RUN | | |
| Migration تازه | اجرای تمام Migrationها روی DB خالی و تطبیق checksum ledger | NOT RUN | | |
| Migration تکراری | اجرای دوباره بدون DDL تکراری و بدون تغییر checksum | NOT RUN | | |
| Tenant Isolation | هیچ read/write/export/download بین دو Tenant مجاز نباشد | NOT RUN | | |
| Tenant spoofing | header یا ورودی tenantId نتواند Tenant احراز‌شده را تغییر دهد | NOT RUN | | |
| RBAC | Tenant Admin، عضو عادی و Platform Admin فقط مجوزهای خود را داشته باشند | NOT RUN | | |
| مرز سازمانی | دسترسی به واحد، سمت، فرایند، فرم و وظیفه خارج از سازمان رد شود | NOT RUN | | |
| Workflow | تأیید، رد، بازگشت، ارجاع، تفویض، جانشینی و ALL/ANY مطابق سیاست عمل کنند | NOT RUN | | |
| Concurrency | اقدام‌های هم‌زمان با کلید یکسان فقط یک اثر ثبت کنند؛ payload متفاوت با 409 رد شود | NOT RUN | | |
| Worker recovery | توقف/راه‌اندازی مجدد، lease منقضی، retry و Dead-letter بدون گم‌شدن/ارسال تکراری کنترل شود | NOT RUN | | |
| Backup integrity | فایل رمزگذاری‌شده و sidecar checksum معتبر و قابل انتقال باشند | NOT RUN | | |
| Restore drill | DB و فایل خصوصی به مقصد ایزوله بازگردند؛ تعداد رکوردها و فایل‌ها تطبیق یابد | NOT RUN | | |
| Load | خطا کمتر از ۱٪، p95 زیر آستانه توافق‌شده و بدون رشد صف/Restart غیرمنتظره | NOT RUN | | |
| Security | کنترل دسترسی، IDOR، ورودی‌ها، secrets، dependency scan و پیکربندی TLS بررسی شود | NOT RUN | | |
| SMTP | Outbox رمزگذاری‌شده، retry و تحویل ایمیل واقعی آزمایشی تأیید شود | NOT RUN | | |
| PDF فارسی / XLSX | خروجی واقعی از نظر فونت، RTL، اعداد و بازشدن فایل تأیید شود | NOT RUN | | |
| سناریوی سازمانی | یک سناریوی کامل از ثبت فرم تا تأیید چندمرحله‌ای و گزارش نهایی اجرا شود | NOT RUN | | |

## جزئیات بار

| معیار | مقدار |
|---|---|
| سناریو / endpoint | |
| تعداد VU | |
| مدت اجرا | |
| تعداد درخواست | |
| نرخ خطا | |
| p50 / p95 / p99 | |
| CPU / RAM / DB connections | |
| Worker restart count | |
| صف قبل و بعد از آزمون | |

## جزئیات بازیابی

- Backup archive ID:
- Checksum:
- Database restored to:
- Private-file restore directory:
- Restore duration:
- Row-count comparison:
- File-count / checksum comparison:
- Migration ledger comparison:
- API smoke test:
- Workflow read/write smoke test:
- نتیجه: `NOT RUN`

## ثبت نقص‌ها

| شناسه | شدت | شرح | گام بازتولید | مالک | اصلاح در commit | آزمون بازگشت | وضعیت |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## تأیید نهایی

- [ ] تمام آزمون‌های اجباری PASS هستند.
- [ ] هیچ نقص بحرانی/بالا باز نمانده است.
- [ ] Backup و Restore واقعی در محیط ایزوله موفق بوده‌اند.
- [ ] شواهد و لاگ‌ها بدون secrets نگهداری شده‌اند.
- [ ] مالک فنی و مالک کسب‌وکار نتیجه را تأیید کرده‌اند.

| نقش | نام / شناسه | تاریخ | تأیید |
|---|---|---|---|
| مسئول فنی | | | |
| مسئول امنیت | | | |
| مالک فرایند کسب‌وکار | | | |

**وضعیت انتشار:** `NOT APPROVED` تا تکمیل تمام شروط بالا.
