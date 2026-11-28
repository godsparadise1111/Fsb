# فاز ۴ — گزارش امنیت

این سند هر ده بند «فاز ۴: امنیت» نقشه راه را با وضعیت واقعی کد مقایسه می‌کند.
علامت‌ها: ✅ پیاده‌سازی و تست واحد · 🟡 پیاده‌سازی شده ولی روی PostgreSQL/مرورگر واقعی امتحان نشده · ❌ انجام نشده.

| # | بند نقشه راه | وضعیت | کار انجام‌شده | کار باقی‌مانده |
|---|---|---|---|---|
| ۱ | ورود، خروج و اعتبار توکن | 🟡 | refresh token چرخشی با تشخیص استفاده مجدد، خروج که توکن دسترسی را هم می‌کُشد، خروج از همه دستگاه‌ها، تغییر و بازیابی رمز، صفحه‌های ورود وب | امتحان در مرورگر؛ کاهش `JWT_EXPIRES_IN` به ۱۵ دقیقه بعد از آن |
| ۲ | کنترل دسترسی در Backend | ✅ (بازبینی) | `PermissionsGuard` خوانده شد؛ مدیریت کاربر/نقش/مجوز فقط سطح پلتفرم است | اجرای `staging-security-suite.sh` روی Staging |
| ۳ | جداسازی Tenant | 🟡 | استراتژی JWT عضویت فعال را هر درخواست می‌سنجد؛ پوشش دوطرفه در اسکریپت تست | اجرای اسکریپت با دو مشتری واقعی |
| ۴ | جلوگیری از دسترسی به داده سازمان دیگر | 🟡 | `listOrganizationUsers` و راهنمای مجوز سازمان بازبینی شد | همان اجرای Staging |
| ۵ | مجوز فایل‌های خصوصی و دانلود | ✅ (بازبینی) | سرویس پیوست tenant-محور است، magic-byte و hash می‌سنجد، `attachment` + `nosniff` + `no-store` می‌دهد | اسکن بدافزار (فاز ۶) |
| ۶ | محدودیت درخواست و سوءاستفاده از API | ✅/🟡 | سقف عمومی و سقف جدا برای `/api/auth/*`، قفل ورود پایگاه‌داده‌ای، سقف درخواست بازیابی رمز، `trust proxy` صریح | انبار مشترک (Redis) اگر چند نمونه API بالا بیاید |
| ۷ | حفاظت از Secretها و کلید رمزنگاری | ✅ | `preflight.sh`: جای‌نما، یکتایی، تنوع نویسه، مجوز فایل `.env`، ردیابی در Git، `FSB_TRUST_PROXY` | چرخش دوره‌ای کلیدها |
| ۸ | CORS و هدرهای امنیتی | ✅ | API: `nosniff`, `DENY`, CSP, `no-store`, HSTS روی HTTPS، حذف `X-Powered-By`؛ وب: CSP و هدرها؛ `Idempotency-Key` به CORS اضافه شد | CSP بدون `unsafe-inline` با nonce |
| ۹ | ثبت رویدادهای امنیتی و عملیات حساس | ✅/🟡 | جدول append-only؛ ورود/خروج/رمز/نشست؛ اعطای نقش، تخصیص سمت، فعال‌سازی کاربر | سیاست نگهداری (فاز ۱۲) |
| ۱۰ | آزمایش نقش‌ها (مدیر، مدیر سازمان، مدیر واحد، کاربر) | 🟡 | `scripts/staging-security-suite.sh` | اجرا با توکن‌های واقعی |

## یافته‌ها
1. وب هیچ صفحه ورودی نداشت و توکن باید دستی در `localStorage` گذاشته می‌شد.
2. وب هیچ هدر امنیتی نداشت و لینک صفحه اصلی به `localhost:3001` ثابت بود.
3. `Idempotency-Key` در `allowedHeaders` CORS نبود؛ در حالت cross-origin عملیات وظایف در مرورگر رد می‌شد.
4. bcrypt بعد از ۷۲ بایت را نادیده می‌گیرد؛ رمز فارسی بلندتر از ۳۶ حرف کوتاه‌شده ذخیره می‌شد. ساخت کاربر حالا چنین رمزی را رد می‌کند.
5. تایمر Worker اعلان‌ها `unref` است؛ با فاصله polling بلند پروسه می‌تواند خارج شود (heartbeat فاز ۳ آن را پوشش می‌دهد).
6. `PATCH /users/:id/active` بررسی tenant ندارد، ولی فقط نقش‌های پلتفرم به آن می‌رسند؛ اگر `users.manage` به مدیران مشتری داده شود باید همان لحظه بررسی tenant اضافه شود.
7. مسیرهایی که `:id` را بدون `ParseUUIDPipe` می‌گیرند برای شناسه نامعتبر ۵۰۰ می‌دهند؛ این تغییر فقط سه مسیر هویت را اصلاح کرد.
8. ایمیل دعوت به `/invite?token=...` اشاره می‌کند ولی وب صفحه‌ای به این نام ندارد.

## متغیرهای محیطی جدید
`FSB_TRUST_PROXY` (اجباری در Production)، `FSB_RATE_LIMIT_PER_MINUTE` (۶۰۰)، `FSB_AUTH_RATE_LIMIT_PER_MINUTE` (۱۲۰)، `FSB_RATE_LIMIT_ENABLED`، `FSB_HSTS`، `FSB_REFRESH_TOKEN_DAYS` (۱۴).

## تغییر لازم در CI (نیاز به مجوز Workflows)
1. بعد از `npm run test:forms --workspace @fsb/api` این خط را اضافه کنید: `npm run test:auth --workspace @fsb/api`
2. بررسی وجود جدول‌ها را به چهار جدول گسترش دهید: `auth_refresh_tokens`، `auth_failed_logins`، `auth_password_resets`، `auth_security_events`.
3. به بررسی نحو اسکریپت‌ها اضافه کنید: `bash -n scripts/staging-security-suite.sh`
4. مرحله‌ای برای اعتبارسنجی Compose استیجینگ: `docker compose -p fsb-staging --env-file .env.staging.example -f compose.production.yaml -f compose.datadisk.yaml config --quiet`

## اجرای اسکریپت تست امنیتی
```bash
FSB_STAGING_TESTS=true BASE_URL=https://staging.example.test \
TOKEN_TENANT_ADMIN=... TOKEN_ORG_ADMIN=... TOKEN_UNIT_MANAGER=... TOKEN_USER=... TOKEN_TENANT_B=... \
ORG_A_ID=... USER_A_ID=... FORM_VERSION_A_ID=... \
bash scripts/staging-security-suite.sh
```
بخش‌های مخرب (قفل ورود، سیل درخواست) فقط با `FSB_TEST_LOGIN_THROTTLE=true` و `FSB_TEST_RATE_LIMIT=true` اجرا می‌شوند.
