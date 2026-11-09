# استقرار On-prem و عملیات نسخه

این بسته مسیر تکرارپذیر نصب Docker Compose، اعمال migrationهای ثبت‌شده، ساخت backup رمزگذاری‌شده و ارتقا را فراهم می‌کند. هنوز روی میزبان واقعی یا محیط مشتری اجرا/اعتبارسنجی نشده است؛ پیش از تولید باید روی staging و با بازیابی آزمایشی تمرین شود.

## پیش‌نیاز
- Linux با Docker Engine و Docker Compose v2
- ابزار age برای رمزگذاری backup و کلید خصوصی بازیابی‌شده خارج از سرور
- دامنه و TLS termination در reverse proxy مورد اعتماد
- SMTP قابل دسترس برای worker اعلان‌ها
- فضای پایدار برای volumeهای PostgreSQL و فایل خصوصی

## نصب اولیه
1. فایل .env.onprem.example را به .env کپی کنید.
2. همه مقادیر REPLACE را عوض کنید. رمز JWT و رمز bootstrap مستقل باشند. کلید Outbox را با openssl rand -hex 32 تولید کنید.
3. NEXT_PUBLIC_API_URL باید URL عمومی API با پیشوند /api باشد و FSB_PUBLIC_APP_URL آدرس عمومی وب.
4. AGE_RECIPIENT را با کلید عمومی age تنظیم کنید؛ کلید خصوصی را روی همین سرور نگه ندارید.
5. دستور ./scripts/install-onprem.sh را اجرا کنید.

نصب‌کننده PostgreSQL را آماده می‌کند، migrationها را به ترتیب نام فایل اعمال و checksum آنها را در fsb_schema_migrations ثبت می‌کند، سپس API، وب و worker را بالا می‌آورد. DB_SYNCHRONIZE=false اجباری است. هیچ migration در زمان startup برنامه اجرا نمی‌شود.

## شبکه و TLS
PostgreSQL فقط در شبکه داخلی Compose قرار دارد و پورت آن منتشر نمی‌شود. API و وب به‌صورت پیش‌فرض فقط روی loopback میزبان bind می‌شوند؛ reverse proxy میزبان باید TLS، محدودیت اندازه درخواست، هدرهای امنیتی و rate limiting را اعمال کند. اگر reverse proxy در کانتینر دیگری است، bind آدرس API/وب را آگاهانه تغییر دهید. CORS فعلی API عمومی است و پیش از استقرار اینترنتی باید به originهای مجاز محدود شود.

## ارتقا
دستور ./scripts/upgrade-onprem.sh ابتدا از دیتابیس و فایل‌های خصوصی backup رمزگذاری‌شده می‌گیرد، سپس imageها را می‌سازد، migrationهای جدید را با checksum اعمال می‌کند و سرویس‌ها را به‌روز می‌کند. ارتقای نسخه با migration ناسازگار باید release note و برنامه rollback اختصاصی داشته باشد؛ rollback خودکار schema انجام نمی‌شود.

## Backup و بازیابی
- دستور ./scripts/backup-onprem.sh فایل custom-format دیتابیس و آرشیو فایل‌های خصوصی را جداگانه با age رمزگذاری می‌کند و SHA-256 خروجی‌ها را ثبت می‌کند.
- کلید خصوصی age، FSB_OUTBOX_ENCRYPTION_KEY و فایل .env باید در مخزن امن جداگانه نگهداری شوند. از دست‌رفتن کلید Outbox، payload اعلان‌های تحویل‌نشده را غیرقابل رمزگشایی می‌کند.
- بازیابی فقط روی محیط ایزوله و پس از تطبیق checksum انجام شود. بعد از restore دیتابیس و فایل‌ها، API/worker را بالا آورده و health، دسترسی فایل و ارسال اعلان را بررسی کنید. خودکارسازی کامل restore در این بسته انجام نشده است.

## Migration ledger
اسکریپت فقط فایل‌های SQL ثبت‌نشده را اجرا می‌کند. اگر checksum یک فایل قبلاً اعمال‌شده تغییر کرده باشد، اجرا متوقف می‌شود. فایل migration اعمال‌شده را ویرایش نکنید؛ اصلاحات بعدی باید migration جدید باشند. migrationهای قدیمی ممکن است به نگاشت دستی Tenantهای legacy نیاز داشته باشند؛ در صورت خطا، اجرای اجباری یا حذف ledger ممنوع است.

## محدودیت‌ها
- worker با profile به نام workers اجرا می‌شود و SMTP و کلید رمزگذاری Outbox لازم دارد.
- volumeهای postgres_data و private_files باید در سیاست backup میزبان لحاظ شوند.
- metrics، tracing، محدودیت منابع، rotation لاگ و آزمون restore کامل هنوز نیازمند تکمیل است.
- اسکریپت‌ها Bash/Linux هستند؛ Windows production host هدف این بسته نیست.