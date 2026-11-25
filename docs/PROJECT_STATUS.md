# وضعیت اجرای نقشه راه F-S نسبت به کد مخزن

مبنا: commit `bf77e62` (۱۱ نوامبر ۲۰۲۶) و سند «نقشه راه جامع تکمیل و عملیاتی‌سازی F-S».
علامت‌ها: ✅ در کد/CI موجود · 🟡 در کد هست ولی روی سرور اثبات نشده · ❌ موجود نیست.

| فاز | وضعیت | شواهد در مخزن | کار باقی‌مانده |
|---|---|---|---|
| ۱ تثبیت نسخه | 🟡 | ۴۵ فایل migration با ledger/checksum؛ `restart: unless-stopped`؛ `package-lock.json` commit شده | `git status` و diff روی سرور؛ tag نسخه؛ تست Restart سرور؛ دسترسی از مرورگر |
| ۲ تفکیک Production/Staging | 🟡 | preflight تولید، backup/restore غیرمخرب Staging | ساختار `/srv/fsb-data/{production,staging}` (این بسته)، env جدا، اجرای واقعی Staging |
| ۳ Workerها | 🟡 | چهار سرویس در Compose، lease/SKIP LOCKED/retry/DLQ | healthcheck واقعی (این بسته)، SMTP برای Notification، سناریوی Job واقعی |
| ۴ امنیت | 🟡 | Tenant guard، JWT، idempotency، سقف فایل، CSV injection | refresh/logout/ابطال توکن، MFA و rate limit ورود، تست نفوذ IDOR |
| ۵ دیتابیس و بکاپ | ✅/🟡 | CI روی PostgreSQL تمیز: اجرای دوبار، رد checksum drift، pg_dump/restore | تطبیق Entity با ستون‌های واقعی، restore واقعی روی Staging، RPO/RTO |
| ۶ فرم‌ساز | 🟡 | تعریف/نسخه/انتشار، پیوست خصوصی، `test:forms` | اعتبارسنجی Backend کامل، طراح و رندرر عمومی حرفه‌ای، اسکن بدافزار |
| ۷ موتور گردش‌کار | ✅/🟡 | گراف انتقال، ALL/ANY، SLA، تفویض، جانشینی، recovery، idempotency | فرم مرحله‌ای، امضا، تأیید چندسطحی، اجرای End-to-End |
| ۸ سازمان و کاربران | ✅/🟡 | سازمان/واحد/سمت، Tenant، دعوت، غیبت | گروه‌های کاری (در نقشه راه مخزن نیست) |
| ۹ گزارش‌ساز | 🟡 | allowlist، XLSX/PDF فارسی، cache، Job، زمان‌بندی | پذیرش واقعی PDF/Excel/SMTP در Staging |
| ۱۰ سایر ماژول‌ها | 🟡 | Outbox رمزگذاری‌شده، DLQ، Audit، API کلیددار v1 | پیامک/اعلان درون‌برنامه‌ای، وب‌هوک، ماژول پشتیبانی |
| ۱۱ تست جامع | ❌/🟡 | تست‌های workflow و forms، k6 idempotency، اسکریپت‌های پذیرش | تست مرورگر/موبایل، هم‌زمانی گسترده، تست نفوذ |
| ۱۲ بهره‌برداری | 🟡 | متریک Prometheus، runbookها | هشدار بیرونی، tracing، سیاست نگهداری بکاپ |

## یافته‌های مهم

1. `compose.production.yaml` پورت‌ها را فقط روی `127.0.0.1` باز می‌کند. دسترسی از کامپیوتر دیگر به `192.168.95.130:3000` فقط با reverse proxy (Nginx/Caddy) ممکن است. به همین دلیل مورد «دسترسی از کامپیوتر کاربر» هنوز آزمایش‌نشده است.
2. Notification Worker بدون `FSB_SMTP_HOST`، `FSB_EMAIL_FROM`، `FSB_PUBLIC_APP_URL` و `FSB_OUTBOX_ENCRYPTION_KEY` هنگام شروع خطا می‌دهد و با `restart: unless-stopped` در حلقه Crash می‌افتد. در Staging باید SMTP آزمایشی (Mailpit) داده شود.
3. چهار Worker پیش‌تر healthcheck نداشتند و «Running» بودن کانتینر هیچ چیز را ثابت نمی‌کرد. این بسته heartbeat وابسته به اتصال PostgreSQL اضافه می‌کند.
4. CI هیچ تستی برای خود Workerها اجرا نمی‌کند؛ فقط Build و تست‌های workflow/forms.
5. README قدیمی بود و می‌گفت کد اجرایی وجود ندارد.

## ترتیب پیشنهادی ادامه

1. روی سرور: `git status`، `git diff`، commit تغییرات محلی و ساخت tag.
2. اعمال این بسته، `prepare-data-disk.sh staging` و بالا آوردن Staging با پروژه `fsb-staging`.
3. `scripts/ops/worker-stability-check.sh` پس از یک اجرای واقعی.
4. فاز ۴: refresh token، logout، rate limit، سپس تست IDOR.
