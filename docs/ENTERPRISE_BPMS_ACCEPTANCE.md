# BPMS سازمانی و پذیرش Staging

این سند تکمیل رابط‌های مدیریتی سازمان و فرم و مجموعه کنترل‌های پذیرش را ثبت می‌کند. اجرای تست‌های عملیاتی فقط روی Staging ایزوله و با داده آزمایشی مجاز است.

## رابط‌های سازمانی

- /organization-structure: انتخاب سازمان‌های مجاز، ساخت واحد ریشه/زیرواحد، مشاهده درخت واحدها، ایجاد سمت در واحد و ثبت جانشینی زمان‌بندی‌شده.
- /absences: ثبت و مدیریت غیبت سازمانی.
- /organization-dashboard: شاخص‌های عملیاتی سازمان.
- /process-design: تعریف/نسخه‌بندی/انتشار فرایند و شروع نمونه با داده فرم.
- /form-design: تعریف فرم، ساختار فیلدها، قوانین نمایشی، نسخه‌بندی، انتشار و ثبت Submission.
- /process-analytics: تحلیل گلوگاه، زمان انتظار، چرخه و تأخیر.
- /notifications: پایش صف Outbox و خطاهای تحویل.

API فرم‌ها و ساختار سازمانی اکنون Tenant احراز‌شده را در سرویس کنترل می‌کند. ایجاد/خواندن واحدها و سمت‌ها، ایجاد/نسخه‌بندی/انتشار فرم و فهرست نسخه‌های فرم بدون Tenant فعال یا خارج از سازمان متعلق به Tenant رد می‌شود. ثبت Submission که به processInstanceId متصل شده باشد، تطابق Tenant و سازمان فرم و نمونه فرایند را کنترل می‌کند. Schema فرم در زمان انتشار و هر Submission در سمت سرور اعتبارسنجی می‌شود؛ فیلدهای اجباری، گزینه‌های select، نوع داده و قواعد required/visible/hidden شرطی کنترل می‌شوند. آخرین Submission متصل به نمونه فرایند هنگام اقدام Workflow با داده اولیه نمونه ادغام می‌شود تا مسیر شرطی بر مبنای اطلاعات واقعی فرم انتخاب شود.

## مسیرهای شرطی

یال‌های transitions می‌توانند با when روی داده نمونه فرایند شرط داشته باشند. عملگرها: exists, eq, neq, gt, gte, lt, lte, in, contains. گروه‌های all و any تا مجموع ۲۰ شرط پشتیبانی می‌شوند. مسیر فیلد حداکثر ۸ سطح دارد و نام‌های خطرناک constructor, prototype, __proto__ مجاز نیستند. هیچ کد، JavaScript یا expression دلخواهی اجرا نمی‌شود.

نمونه:

~~~json
{
  "transitions": [
    {
      "fromStepIndex": 0,
      "action": "APPROVED",
      "toStepIndex": 1,
      "when": { "field": "amount", "operator": "lte", "value": 1000000 }
    },
    {
      "fromStepIndex": 0,
      "action": "APPROVED",
      "toStepIndex": 2,
      "when": {
        "all": [
          { "field": "amount", "operator": "gt", "value": 1000000 },
          { "field": "department.code", "operator": "eq", "value": "FIN" }
        ]
      }
    }
  ]
}
~~~

داده اولیه را هنگام شروع فرایند در فیلد data بفرستید. در زمان اقدام، موتور شرط‌ها را روی process_instances.data ارزیابی می‌کند. اگر هیچ شرطی منطبق نشود یا چند شرط هم‌زمان منطبق باشند، اقدام رد می‌شود و مسیر پیش‌فرض ناخواسته اجرا نمی‌شود.

## پذیرش امنیت Tenant

در Staging دو Tenant مستقل بسازید. برای هر کدام کاربر، سازمان، فرایند منتشرشده، فرم منتشرشده و وظیفه فعال جداگانه بسازید. مقادیر UUID را به‌عنوان Fixture نگهداری کنید و دسترسی متقابل را آزمایش کنید.

~~~sh
FSB_STAGING_TESTS=true \
BASE_URL=https://staging.example.test \
TOKEN_TENANT_A='...' TOKEN_TENANT_A_MEMBER='...' TOKEN_TENANT_B='...' \
TOKEN_PLATFORM_ADMIN='...' TENANT_A_ID='...' TENANT_B_ID='...' \
ORG_B_ID='...' PROCESS_B_ID='...' FORM_B_ID='...' FORM_B_VERSION_ID='...' \
SUBMISSION_B_ID='...' ATTACHMENT_B_ID='...' TASK_B_ID='...' \
bash scripts/staging-enterprise-acceptance.sh
~~~

اسکریپت فقط درخواست‌های خواندنی اجرا می‌کند و آزمون جعل Tenant header، جداسازی سازمان/فرایند/فرم/Submission/پیوست/وظیفه، دسترسی دانلود فایل خصوصی، نقش Tenant Admin در برابر عضو عادی، منع دسترسی Tenant به endpoint پلتفرم و دسترسی مدیر پلتفرم را بررسی می‌کند. توکن Tenant A باید متعلق به مدیر Tenant، توکن Tenant A Member متعلق به عضو عادی همان Tenant بدون مجوزهای tenant.members.read و tenant.audit.read، توکن Tenant B متعلق به مدیر Tenant B و توکن Platform متعلق به مدیر پلتفرم دارای مجوز tenants.read باشد. Host خارج از allowlist رد می‌شود. شناسه‌های Fixture باید واقعی و متعلق به Tenant B باشند؛ فایل پیوست نیز باید فایل آزمایشی بی‌خطر باشد.

## بررسی قیود دیتابیس

پس از اعمال Migrationهای نسخه با Runner محافظت‌شده، ابتدا ledger و checksum تک‌تک فایل‌ها را بررسی و سپس کنترل‌های read-only را اجرا کنید. اسکریپت این کنترل را خودش انجام می‌دهد و در صورت نبود ledger، migration ثبت‌نشده، checksum متفاوت یا تعداد ردیف ناسازگار متوقف می‌شود:

~~~sh
FSB_STAGING_TESTS=true \
DATABASE_URL='postgresql://...' \
bash scripts/ops/verify-staging.sh
~~~

هر query در فایل‌های database/verification باید خروجی صفر ردیف داشته باشد، مگر Queryهای تشخیصی صریح که صف Incident یا lease منقضی را نمایش می‌دهند. خروجی‌ها را ذخیره و بازبینی کنید؛ اجرای اسکریپت به‌تنهایی به معنی تأیید سلامت نیست.

## بار و هم‌زمانی مسیرهای خواندن

k6 باید روی Staging و با کاربر محدودشده اجرا شود:

~~~sh
k6 run -e BASE_URL=https://staging.example.test \
  -e ACCESS_TOKEN='...' -e TENANT_ID='...' -e ORGANIZATION_ID='...' \
  tests/load/enterprise-read-paths.k6.js
~~~

آستانه پیش‌فرض: خطا کمتر از ۱٪ و p95 کمتر از ۱۵۰۰ms. مقادیر VUS و DURATION را متناسب با ظرفیت Staging تغییر دهید.

## هم‌زمانی اقدام و Idempotency

این آزمون یک وظیفه Fixture را یک‌بار تأیید می‌کند و همه VUها همان Idempotency-Key و payload را ارسال می‌کنند. وظیفه پس از آزمون تغییر وضعیت می‌دهد؛ بنابراین فقط از Fixture دورریختنی استفاده کنید:

~~~sh
FSB_STAGING_TESTS=true TEST_FIXTURE_CONFIRMED=true \
BASE_URL=https://staging.example.test ACCESS_TOKEN='...' \
TEST_TASK_ID='...' IDEMPOTENCY_KEY='acceptance-20261111-workflow-001' \
k6 run tests/load/workflow-idempotency.k6.js
~~~

پس از آزمون هم‌زمان k6، اسکریپت مکمل زیر را با همان Task و Idempotency-Key اجرا کنید. این اسکریپت پاسخ replay را با پاسخ ثبت‌شده مقایسه می‌کند و استفاده مجدد از همان کلید با payload متفاوت را باید با HTTP 409 رد کند: 

~~~sh
FSB_STAGING_TESTS=true TEST_FIXTURE_CONFIRMED=true \
BASE_URL=https://staging.example.test ACCESS_TOKEN='...' \
TEST_TASK_ID='...' IDEMPOTENCY_KEY='acceptance-20261111-workflow-001' \
bash scripts/staging-workflow-idempotency.sh
~~~

این عملیات وظیفه آزمایشی را تغییر وضعیت می‌دهد؛ فقط از Fixture دورریختنی استفاده کنید.

## پایداری Workerها

پس از اجرای بار، وضعیت کانتینرها و RestartCount را بررسی کنید:

~~~sh
FSB_STAGING_TESTS=true FSB_WORKER_STABILITY_CHECK=YES \
ENV_FILE=.env COMPOSE_FILE=compose.production.yaml \
FSB_MAX_WORKER_RESTARTS=0 bash scripts/ops/worker-stability-check.sh
~~~

این بررسی وضعیت کانتینر را می‌سنجد؛ برای تأیید پردازش واقعی صف، یک گزارش زمان‌بندی‌شده، اعلان ایمیلی و فرایند SLA آزمایشی ایجاد کنید و رسیدن آن‌ها به وضعیت نهایی را از UI و DB بررسی کنید.

## Backup و Restore واقعی

1. پیش از هر Migration یا آزمون بازیابی، API و همه Workerها را متوقف و Backup رمزگذاری‌شده دیتابیس و volume فایل خصوصی را با scripts/ops/backup-staging.sh بگیرید.
2. checksum و فایل sidecar را در مقصد جداگانه کنترل کنید.
3. scripts/ops/restore-staging.sh را فقط روی دیتابیس/volume تازه و ایزوله اجرا کنید؛ دیتابیس اصلی Staging را به‌عنوان مقصد Restore انتخاب نکنید.
4. پس از Restore، scripts/ops/verify-staging.sh، scripts/ops/deploy-smoke.sh، آزمون Tenant isolation و بازکردن فایل‌های پیوست را اجرا کنید.
5. زمان بازیابی، تعداد رکوردها، صحت فایل‌ها، ledger/checksum و نتیجه آزمون‌های خواندن/نوشتن را ثبت کنید.

این Repository از راه دور به سرور Staging دسترسی ندارد؛ هیچ Migration، Restore، ارسال SMTP یا تست بار واقعی در این تغییرات اجرا نمی‌شود. این‌ها گام‌های پذیرش اپراتور پس از آماده شدن سرور هستند.


## کنترل نسخه و Migration در مرحله تثبیت

- فقط از `scripts/ops/migrate.sh` به‌عنوان Runner رسمی استفاده کنید. این Runner به Backup رمزگذاری‌شده با checksum معتبر نیاز دارد، برای اجرای هم‌زمان Migrationها advisory lock می‌گیرد و ثبت filename/checksum را در همان تراکنش DDL انجام می‌دهد.
- اسکریپت قدیمی `scripts/migrate-onprem.sh` از ledger جداگانه استفاده می‌کرد و برای جلوگیری از دو تاریخچه مهاجرت، غیرفعال شده است؛ آن را اجرا نکنید.
- `scripts/ops/verify-staging.sh` پیش از SQLهای invariant، تمام فایل‌های Migration را با `fsb_schema_migration_ledger` تطبیق می‌دهد. هر اختلاف، فایل ثبت‌نشده یا تعداد ردیف متفاوت به معنی توقف پذیرش است.
- شماره‌گذاری فایل‌ها ممکن است بین تاریخ‌ها از نو آغاز شود؛ ترتیب واقعی اجرای Runner ترتیب lexical نام کامل فایل‌هاست. فایل‌های موجود را پس از اعمال تغییر ندهید؛ اصلاحات فقط با Migration جدید انجام شوند.
- Migrationها در این شاخه روی دیتابیس اجرا نشده‌اند. اعمال آن‌ها فقط پس از Backup قابل بازیابی، تعیین baseline معتبر و تأیید اپراتور Staging مجاز است.


## ثبت شواهد و گزارش نهایی

برای هر اجرای Staging، یک کپی از قالب `docs/STAGING_ACCEPTANCE_REPORT_TEMPLATE.md` تهیه کنید. هر آزمون تا زمان اجرای واقعی باید `NOT RUN` بماند؛ فقط با شواهد قابل بازبینی به `PASS` یا `FAIL` تغییر کند. نتیجه انتشار تا تأیید همه آزمون‌های اجباری و بسته‌شدن نقص‌های بحرانی/بالا `NOT APPROVED` است.
