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
- `POST /api/platform/tenants` ایجاد مشتری؛ بدنه: `name`, `slug`, `code` و اختیاری `plan`؛ وضعیت اولیه `PENDING` است.
- `GET /api/platform/tenants` فهرست مشتریان
- `GET /api/platform/tenants/:id` جزئیات مشتری و سازمان‌های آن
- `PATCH /api/platform/tenants/:id/status` تغییر وضعیت به `ACTIVE`, `SUSPENDED` یا `CLOSED`
- `POST /api/platform/tenants/:tenantId/members` افزودن عضو با `userId` و اختیاری `isTenantAdmin`
- `GET /api/platform/tenants/:tenantId/members` فهرست اعضای فعال
- `PATCH /api/platform/tenants/:tenantId/members/:userId/admin` تعیین/لغو مدیر مشتری با `isTenantAdmin`
- `DELETE /api/platform/tenants/:tenantId/members/:userId` غیرفعال‌کردن عضویت؛ حذف آخرین مدیر فعال ممنوع است
- برای کاربران عضو مشتری، هدر `X-Tenant-Id` زمینهٔ مشتری را انتخاب می‌کند؛ API عضویت کاربر و فعال‌بودن Tenant را از DB اعتبارسنجی می‌کند. اگر فقط یک عضویت وجود داشته باشد، زمینه خودکار انتخاب می‌شود.
- `GET /api/tenant/members` فهرست اعضای Tenant جاری (مدیر مشتری)
- `POST /api/tenant/members` افزودن کاربر موجود به Tenant جاری با `userId` و اختیاری `isTenantAdmin`
- `PATCH /api/tenant/members/:userId/admin` تغییر وضعیت مدیر مشتری با `isTenantAdmin`
- `DELETE /api/tenant/members/:userId` غیرفعال‌سازی عضویت؛ آخرین مدیر قابل حذف نیست
- `POST /api/tenant/invitations` ایجاد دعوت برای ایمیل با اختیاری `isTenantAdmin`؛ رویداد ارسال در Outbox رمزگذاری‌شده و در همان تراکنش ثبت می‌شود؛ پاسخ فقط `deliveryQueued` برمی‌گرداند و توکن خام افشا نمی‌شود.
- `GET /api/tenant/invitations` فهرست دعوت‌ها بدون نمایش هش یا توکن.
- `DELETE /api/tenant/invitations/:id` لغو دعوت پذیرفته‌نشده.
- `GET /api/tenant/audit-logs?limit=50` تاریخچهٔ اقدامات مدیریتی Tenant جاری؛ محدود به مدیران مشتری و حداکثر ۱۰۰ رکورد آخر. ایجاد/تغییر وضعیت مشتری، عضویت‌ها، تغییر مدیر، حذف عضو و چرخه دعوت ثبت می‌شوند؛ رکوردها در دیتابیس قابل ویرایش/حذف نیستند.
- `GET /api/tenant/usage` خلاصه مصرف مشتری شامل سازمان‌ها، واحدها، سمت‌ها، اعضای فعال، تعریف فرایند و فرم، نمونه‌های اجرا، وظایف، پاسخ‌ها، دعوت‌های باز، اعلان‌های در انتظار/ناموفق و تعداد رویدادهای ممیزی. Tenant باید فعال باشد.
- `GET /api/tenant/notifications/dead?limit=50` فهرست امن پیام‌های مرده مشتری؛ payload رمزگذاری‌شده و کلیدهای داخلی به API برگردانده نمی‌شوند.
- `POST /api/tenant/notifications/dead/:id/retry` تلاش مجدد پیام مرده توسط مدیر مشتری؛ وضعیت Tenant بررسی و اقدام در Audit Log ثبت می‌شود. دعوت منقضی/لغوشده/پذیرفته‌شده هنگام ارسال مجدد دوباره به صف مرده می‌رود.
- `GET /api/tenant/reports/overview.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&organizationId=<uuid>` دریافت CSV همان گزارش با BOM، escaping سلول‌ها و جلوگیری از Formula Injection.
- `GET /api/tenant/reports/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&organizationId=<uuid>` گزارش مدیریتی مشتری: تعداد فرایندهای در جریان/تکمیل/لغو، میانگین زمان تکمیل، کاربران آغازکننده یکتا، وضعیت وظایف، روند روزانه شروع و تکمیل، تفکیک سازمان‌ها، سن وظایف باز (بیش از ۳/۷/۱۴ روز)، تعداد وظایف مهلت‌گذشته و ۲۰ وظیفه قدیمی‌تر؛ همچنین عملکرد هر مرحله شامل میانگین/میانه/صدک ۹۰ زمان چرخه، تکمیل دیرهنگام و تعداد باز/مهلت‌گذشته برای شناسایی گلوگاه‌ها. مهلت هر مرحله با `dueInHours` در `processVersion.schema.steps[]` تعیین می‌شود؛ مقدار باید عدد مثبت و حداکثر ۸۷۶۰ ساعت باشد و زمان سررسید هنگام ایجاد وظیفه ثبت می‌شود. بازه پیش‌فرض ۳۰ روز و سقف بازه ۳۶۶ روز است؛ فیلتر سازمان فقط پس از تأیید تعلق به Tenant پذیرفته می‌شود. دسترسی فعلاً برای Tenant Admin است.
- `POST /api/tenant/invitations/accept` پذیرش با `{ "token": "..." }`؛ کاربر باید وارد حسابی شده باشد که ایمیل آن دقیقاً با ایمیل دعوت برابر است. پس از پذیرش، برای دریافت زمینه Tenant جدید درخواست بعدی را با `X-Tenant-Id` بفرستید.
- `POST /api/tenant/invitations/register` ثبت‌نام عمومی با `token`, `firstName`, `lastName`, `username`, `password` و اختیاری `phone`؛ ایمیل از خود دعوت استخراج می‌شود و قابل تغییر نیست. اگر حسابی با ایمیل دعوت وجود داشته باشد، ثبت‌نام جدید رد می‌شود و کاربر باید وارد حساب فعلی شود و مسیر accept را اجرا کند.
- در جدول دعوت فقط SHA-256 توکن نگهداری می‌شود؛ payload ایمیل در جدول `notification_outbox` با AES-256-GCM رمزگذاری می‌شود. برای تولید دعوت باید `FSB_OUTBOX_ENCRYPTION_KEY` دقیقاً ۳۲ بایت (ترجیحاً مقدار hex حاصل از `openssl rand -hex 32`) در محیط اجرا تنظیم شود.
- `NotificationOutboxService.claimBatch(workerId, limit)` پیام‌ها را با `FOR UPDATE SKIP LOCKED` و lease دو دقیقه‌ای claim می‌کند؛ worker پس از ارسال باید `markDelivered(id, workerId)` یا در خطا `scheduleRetry(id, workerId, error)` را صدا بزند. پس از ۱۰ تلاش، پیام به وضعیت `DEAD` می‌رود. worker مستقل SMTP پیاده‌سازی شده است. برای اجرا، متغیرهای `FSB_SMTP_*`, `FSB_EMAIL_FROM`, `FSB_PUBLIC_APP_URL` و `FSB_OUTBOX_ENCRYPTION_KEY` را تنظیم کنید و فقط در پردازه worker مقدار `FSB_NOTIFICATION_WORKER_ENABLED=true` قرار دهید. در Linux: `FSB_NOTIFICATION_WORKER_ENABLED=true npm run worker:notifications:dev --workspace @fsb/api`؛ در PowerShell: `$env:FSB_NOTIFICATION_WORKER_ENABLED="true"; npm run worker:notifications:dev --workspace @fsb/api`. در production ابتدا build و سپس `npm run worker:notifications --workspace @fsb/api` را در پردازه مستقل اجرا کنید؛ متغیر فعال‌سازی را به پردازه HTTP API ندهید. برای worker بازتخصیص SLA، SMTP لازم نیست: در Linux از `FSB_WORKFLOW_AUTOMATION_ENABLED=true npm run worker:automation:dev --workspace @fsb/api` و در production از `npm run worker:automation --workspace @fsb/api` با همین متغیر محیطی استفاده کنید. worker رویداد دعوت و هشدار SLA را ارسال می‌کند؛ پایش و داشبورد DLQ و اتصال سایر رویدادها باقی است. worker مستقل اتوماسیون گردش‌کار نیز با `FSB_WORKFLOW_AUTOMATION_ENABLED=true` و دستور `npm run worker:automation:dev --workspace @fsb/api` (یا در production پس از build، `npm run worker:automation --workspace @fsb/api`) اجرا می‌شود؛ این پردازه به SMTP وابسته نیست و migration 017 باید پیش از فعال‌سازی اعمال شده باشد. API مشاهده و retry دستی پیام‌های مرده برای مدیر Tenant پیاده‌سازی شده است.
- `POST /api/organizations` ایجاد سازمان در یک مشتری فعال؛ بدنه: `{ "tenantId": "...", "name": "...", "code": "..." }`
- `GET /api/organizations` فهرست سازمان‌ها
- `POST /api/organizations/units` ایجاد واحد؛ بدنه شامل `organizationId`, `name`, `code` و اختیاری `parentId`
- `GET /api/organizations/:organizationId/units` فهرست واحدهای سازمان
- `POST /api/organizations/positions` ایجاد سمت؛ بدنه شامل `organizationUnitId`, `title`, `code`
- `GET /api/organizations/units/:unitId/positions` فهرست سمت‌های واحد

### کاربران، عضویت سازمانی و دسترسی
- `POST /api/auth/bootstrap` ایجاد نخستین مدیر سامانه؛ هدر `x-bootstrap-token` و بدنه شامل `firstName`, `lastName`, `email`, `username`, `password` و اختیاری `phone`. فقط وقتی هیچ کاربری در سامانه وجود ندارد و توکن bootstrap معتبر است.
- `POST /api/auth/login` ورود با `username` (یا ایمیل) و `password`؛ خروجی شامل JWT.
- `GET /api/auth/me` دریافت مشخصات کاربر جاری؛ نیازمند `Authorization: Bearer <token>`.
- `POST /api/users` ایجاد کاربر توسط کاربر واردشده؛ شامل `firstName`, `lastName`, `email`, `username`, `password` و اختیاری `phone`
- `GET /api/users` فهرست کاربران فعال؛ برای اعضای Tenant فقط کاربران دارای عضویت فعال در همان Tenant برگردانده می‌شوند
- `PATCH /api/users/:id/active` فعال/غیرفعال کردن؛ بدنه `{ "isActive": true }`
- `POST /api/user-positions` انتساب کاربر به سمت؛ `userId`, `positionId`, اختیاری `validFrom`, `validUntil`, `isPrimary`
- `GET /api/users/:id/positions` سمت‌های کاربر؛ در زمینه Tenant فقط سمت‌های همان مشتری برگردانده می‌شوند
- `POST /api/permissions` تعریف مجوز؛ `code`, `name`, اختیاری `description`
- `GET /api/permissions` فهرست مجوزها
- `POST /api/roles` ایجاد نقش با `code`, `name`, اختیاری `description`, `permissionIds`
- `GET /api/roles` فهرست نقش‌ها و مجوزهایشان
- `POST /api/user-roles` اعطای نقش سازمانی؛ `userId`, `roleId` و `organizationId` الزامی. نقش‌های `PLATFORM` فقط توسط مدیر سطح سامانه و بدون `organizationId` قابل اعطا هستند.

### تعریف و نسخه‌بندی فرایند
- `POST /api/process-definitions` تعریف فرایند؛ `organizationId`, `code`, `name`, اختیاری `description`
- `GET /api/process-definitions?organizationId=...` فهرست فرایندها
- `POST /api/process-definitions/:id/versions` ساخت نسخه جدید پیش‌نویس؛ `schema` و اختیاری `changeNote`
- `GET /api/process-definitions/:id/versions` فهرست نسخه‌ها
- `POST /api/process-definitions/:id/versions/:versionId/publish` انتشار نسخه پیش‌نویس
- `PATCH /api/process-definitions/:id/archive` بایگانی تعریف فرایند

### اجرای گردش‌کار
- `POST /api/organization-substitutions` ایجاد جانشینی سازمانی با `organizationId`, `originalUserId`, `substituteUserId`, `startsAt`, `endsAt`, `reason`؛ جانشین و فرد اصلی باید عضو فعال Tenant و دارای سمت معتبر در همان سازمان باشند؛ بازه حداکثر ۹۰ روز است و بازه‌های هم‌پوشان برای فرد اصلی مجاز نیستند.
- `GET /api/organizations/:organizationId/substitutions?limit=50&offset=0` فهرست صفحه‌بندی‌شده تاریخچه جانشینی‌ها.
- `DELETE /api/organizations/:organizationId/substitutions/:substitutionId` لغو جانشینی فعال؛ جزئیات تاریخی تغییرناپذیر و اقدام در Audit ثبت می‌شود.
- جانشین در بازه معتبر، وظایف باز فرد اصلی را در کارتابل می‌بیند و می‌تواند اقدام کند؛ هویت واقعی جانشین در Action Log ثبت و انتساب اصلی تکمیل می‌شود. در زمان مشاهده و اقدام، عضویت و سمت فعال جانشین دوباره بررسی می‌شود؛ جانشینی به‌تنهایی وظایف را به فرد دیگر منتقل یا مسئولیت اصلی را حذف نمی‌کند.
- `POST /api/tasks/:id/delegations` تفویض زمان‌دار وظیفه توسط مسئول اصلی به کاربر دارای عضویت فعال Tenant و سمت فعال در همان سازمان؛ بدنه `{ "toUserId": "<uuid>", "endsAt": "<ISO-8601>" }`؛ حداکثر ۳۰ روز، بدون تغییر مسئول اصلی و همراه با ممیزی.
- `GET /api/tasks/:id/delegations` مشاهده تاریخچه تفویض برای مسئولان/آغازکننده/نماینده مجاز.
- `DELETE /api/tasks/:id/delegations/:delegationId` لغو تفویض توسط مسئول اصلی.
- `GET /api/tasks/deferrals/pending?organizationId=<uuid>&limit=50&offset=0` صف صفحه‌بندی‌شده درخواست‌های در انتظار بررسی برای سازمانی که مجوز بررسی آن را دارید؛ سقف هر صفحه ۱۰۰ مورد است.
- `POST /api/tasks/:id/deferrals` درخواست تعویق مهلت توسط مسئول باز یا نماینده معتبر؛ بدنه `{ "proposedDueAt": "<ISO-8601>", "reason": "..." }`. افزایش مهلت حداکثر ۳۰ روز و فقط با تأیید مجوز سازمانی `workflow.tasks.defer.approve` یا مدیر Tenant انجام می‌شود؛ در هر وظیفه فقط یک درخواست باز وجود دارد.
- `GET /api/tasks/:id/deferrals` مشاهده سوابق درخواست‌های تعویق توسط مسئولان، آغازکننده یا نماینده مجاز.
- `POST /api/tasks/:id/deferrals/:requestId/approve` و `/reject` بررسی درخواست توسط دارنده مجوز `workflow.tasks.defer.approve`؛ بدنه اختیاری `{ "comment": "..." }`. درخواست‌دهنده مجاز به تأیید درخواست خودش نیست؛ تغییر هم‌زمان مهلت باعث رد تأیید درخواست قدیمی می‌شود و مدیر می‌تواند آن را رد کند؛ تأیید، تغییر مهلت و ثبت Audit در یک تراکنش انجام می‌شوند.
- نماینده در بازه معتبر می‌تواند اقدام کند؛ اقدام به نام حساب نماینده ثبت می‌شود و وضعیت انتساب اصلی را تکمیل می‌کند. تفویض پس از اقدام خودکار باطل می‌شود؛ تفویض زنجیره‌ای و اقدام خارج از بازه مجاز نیست.
- `POST /api/process-instances` شروع نمونه فرایند؛ شامل `processVersionId`, `organizationId`, `title`, `initialAssigneeUserIds` و اختیاری `data`, `assignmentPolicy`, `firstTaskTitle`
- `GET /api/tasks/my` کارهای باز کاربر جاری (شناسه از JWT) با اولویت مهلت نزدیک‌تر و سپس قدیمی‌ترین وظیفه؛ `dueAt` در پاسخ مشخص است.
- `POST /api/tasks/:id/actions` اقدام کاربر؛ `action` برابر `APPROVED` یا `REJECTED` و اختیاری `comment` (شناسه کاربر از JWT)
- `GET /api/tasks/:id/reassignments` تاریخچه بازتخصیص خودکار شامل مسئولان قبلی/جدید و علت؛ فقط برای اشخاص مجاز به مشاهده تاریخچه وظیفه.
- `GET /api/tasks/:id/history` تاریخچه اقدامات کار

سیاست `ALL_ASSIGNEES` فقط پس از تأیید همه افراد منتسب، کار را کامل می‌کند. سیاست `ANY_ASSIGNEE` با اولین تأیید کامل می‌شود. رد هر یک از افراد در نسخه فعلی، کار و نمونه فرایند را لغو می‌کند. پس از تکمیل هر کار، اگر در `processVersion.schema.steps` مرحله بعدی تعریف شده باشد، کار بعدی به‌صورت خودکار ساخته می‌شود. هر مرحله می‌تواند `title`, `instructions`, `assigneeUserIds`, `assignmentPolicy`, `dueInHours`, `escalateAfterHours`, `escalationUserIds`, `reassignAfterHours` و `reassignUserIds` داشته باشد. `escalateAfterHours` تأخیر پس از سررسید (۰ تا ۸۷۶۰ ساعت) است؛ در صورت تنظیم، شناسه‌های `escalationUserIds` باید آرایه‌ای حداکثر ۵۰تایی از UUIDها باشند. worker مستقل، پس از عبور از آستانه، به مسئولان باز و مدیران ارجاع‌شده‌ای که هنوز عضو فعال Tenant و دارای سمت فعال در سازمان هستند ایمیل می‌زند. ارسال هر وظیفه به هر گیرنده با کلید یکتای پایدار deduplicate می‌شود؛ برای بازتخصیص خودکار، `reassignAfterHours` (۰ تا ۸۷۶۰ ساعت پس از `dueAt`) و `reassignUserIds` (۱ تا ۵۰ کاربر) را با هم تنظیم کنید؛ worker مستقل گردش‌کار پس از آستانه، اعضای دارای سمت فعال را اعتبارسنجی می‌کند، مسئولان قبلی را با وضعیت تاریخی `REASSIGNED` نگه می‌دارد و مسئولان جدید را به وظیفه اضافه می‌کند. فقط یک بازتخصیص خودکار SLA برای هر وظیفه ثبت می‌شود؛ در صورت نبود گیرنده معتبر، هیچ تغییری اعمال نمی‌شود.

### فرم‌ساز و ثبت اطلاعات
- `POST /api/forms` تعریف فرم؛ `organizationId`, `code`, `name` و اختیاری `description`
- `GET /api/forms?organizationId=...` فهرست فرم‌ها
- `POST /api/forms/:id/versions` ساخت نسخه فرم؛ `schema` و اختیاری `changeNote`
- `GET /api/forms/:id/versions` فهرست نسخه‌ها
- `POST /api/forms/:id/versions/:versionId/publish` انتشار نسخه فرم
- `POST /api/forms/versions/:versionId/submissions` ثبت داده فرم؛ `data` و اختیاری `processInstanceId` (ثبت‌کننده از JWT؛ نمونه فرایند باید متعلق به همان سازمان فرم باشد)
- `GET /api/forms/versions/:versionId/submissions` مشاهده صفحه‌بندی‌شده ثبت‌های یک نسخه فرم؛ Tenant از هویت احراز‌شده استخراج می‌شود؛ `limit` حداکثر ۱۰۰ و پیش‌فرض ۵۰، `offset` پیش‌فرض صفر است. اطلاعات حساس حساب کاربر در پاسخ گزارش برگردانده نمی‌شود.
- `GET /api/forms/versions/:versionId/submissions/export.csv?limit=1000&offset=0` خروجی CSV محدود به Tenant جاری؛ سقف هر درخواست ۵۰۰۰ ردیف، همراه با escaping سلول‌ها برای جلوگیری از CSV/Formula Injection و BOM سازگار با Excel.
- `POST /api/forms/versions/:versionId/submissions/:submissionId/attachments` بارگذاری پیوست با فیلد multipart به نام `file`؛ حداکثر ۱۰ مگابایت و فقط PDF/PNG/JPEG/WEBP با بررسی امضای واقعی فایل.
- `GET /api/forms/versions/:versionId/submissions/:submissionId/attachments` فهرست metadata پیوست‌های همان پاسخ بدون افشای مسیر ذخیره‌سازی.
- `GET /api/forms/versions/:versionId/submissions/:submissionId/attachments/:attachmentId/download` دریافت فایل پس از کنترل Tenant، نسخه فرم، ثبت پاسخ و یکپارچگی SHA-256.
- فایل‌ها با شناسه تصادفی در مسیر خصوصی `FSB_FILE_STORAGE_PATH` ذخیره می‌شوند؛ مسیر فایل از درخواست کاربر دریافت نمی‌شود. پوشه باید خارج از webroot باشد، دسترسی سیستم‌عامل به آن محدود شود و از آن backup امن گرفته شود. اسکن ضدبدافزار و سیاست نگهداری/حذف فایل هنوز به زیرساخت عملیاتی متصل نشده است.

سازمان‌های قدیمی که `tenantId` ندارند تا زمان مهاجرت و تخصیص صریح به مشتری، مجاز به ایجاد فرایند/فرم جدید یا شروع گردش‌کار نیستند. راهنمای اجرای امن و SQL نسخه‌بندی‌شده در `docs/TENANT_MIGRATION.md` و `apps/api/database/migrations/20261107_001_tenant_membership_and_safe_legacy_scope.sql` قرار دارد؛ SQL هیچ سازمان قدیمی را خودکار به مشتری وصل نمی‌کند. ایجاد سازمان جدید فقط برای Tenant با وضعیت `ACTIVE` ممکن است. درخواست‌های HTTP احراز هویت‌شده با زمینهٔ Tenant تعلیق‌شده/بسته در لایهٔ JWT رد می‌شوند؛ انتساب سمت و نقش سازمانی نیز باید به عضویت فعال همان Tenant تعلق داشته باشد؛ نقش سازمانی نیز بدون زمینهٔ Tenant معتبر پذیرفته نمی‌شود. با این حال فیلتر tenant-aware تمام مسیرهای منابع فرزند، فایل‌ها، صف‌ها، jobها و گزارش‌ها هنوز کامل نیست و عرضه SaaS مجاز نیست.

ساختار schema فرم به‌صورت JSON نگهداری می‌شود و نسخه‌های منتشرشده مبنای ثبت داده قرار می‌گیرند. اعتبارسنجی معنایی فیلدها و رندرر فرم در لایه بعدی توسعه می‌یابد.

## هشدارهای فعلی
تمام مسیرها به‌جز سلامت، ورود و bootstrap نیازمند JWT هستند. رمز عبور با bcrypt هش می‌شود و هویت شروع فرایند، اقدام کار و ثبت فرم از توکن استخراج می‌شود. وضعیت فعال‌بودن کاربر در هر درخواست JWT دوباره بررسی می‌شود؛ غیرفعال‌سازی حساب، توکن‌های صادرشدهٔ قبلی را از کار می‌اندازد و تمام عضویت‌های Tenant کاربر را نیز در همان تراکنش غیرفعال می‌کند. اگر کاربر آخرین مدیر فعال یک مشتری باشد، غیرفعال‌سازی حساب رد می‌شود. مجوزهای عملیاتی از طریق `RequirePermissions` و `PermissionsGuard` کنترل می‌شوند؛ مجوزهای اولیه شامل `organization.read/manage`، `users.read/manage`، `roles.manage`، `permissions.manage`، `assignments.manage`، `processes.read/manage/publish`، `forms.read/manage/publish/submit` و `workflow.start/tasks.read/tasks.act/history.read` و `workflow.tasks.defer.approve` و `workflow.substitutions.manage` هستند. مجوز جانشینی باید به مدیر/سرپرست مجاز در همان سازمان داده شود؛ مدیر Tenant نیز می‌تواند در سازمان‌های مشتری خود جانشینی تعریف و لغو کند. Migration شانزدهم این مجوز را ایجاد می‌کند. مجوز تأیید تعویق باید به نقش مدیر/سرپرست سازمان در همان سازمان داده شود؛ مدیر Tenant نیز در دامنه Tenant امکان بررسی دارد. حساب bootstrap نقش `SYSTEM_ADMIN` با دامنه `PLATFORM` و مجوز `*` می‌گیرد. wildcard فقط در نقش `PLATFORM` معتبر است؛ نقش سازمانی حتی اگر اشتباهاً مجوز `*` داشته باشد، دسترسی سراسری ایجاد نمی‌کند. اعطای نقش `PLATFORM` نیز فقط توسط دارندهٔ نقش پلتفرمی دارای `assignments.manage` ممکن است. نقش‌های عادی به‌صورت پیش‌فرض دامنه `ORGANIZATION` دارند و انتساب بدون سازمان، دیگر مجوز سراسری ایجاد نمی‌کند. اعطای نقش می‌تواند با `organizationId` محدود شود، اما کنترل دسترسی در سطح رکورد و جداسازی کامل tenant هنوز تکمیل نشده است؛ تا آن زمان API را در شبکه عمومی یا به‌صورت SaaS عرضه نکنید. در Production، `FSB_FILE_STORAGE_PATH` باید به volume خصوصی و پایدار خارج از webroot اشاره کند؛ فایل‌ها با مجوز محدود سیستم‌عامل ذخیره می‌شوند. `FSB_OUTBOX_ENCRYPTION_KEY` باید دقیقاً ۳۲ بایت و مستقل از `JWT_SECRET` باشد؛ گم‌شدن آن payloadهای تحویل‌نشده را غیرقابل رمزگشایی می‌کند. در Production، `JWT_SECRET` باید حداقل ۳۲ کاراکتر و تصادفی باشد. `BOOTSTRAP_TOKEN` نیز باید محرمانه و جدا از JWT_SECRET نگهداری شود. تنظیم `DB_SYNCHRONIZE=true` فقط برای توسعه محلی است؛ برای محیط عملیاتی باید migrationهای نسخه‌بندی‌شده استفاده شوند. migrationهای دستی tenant در `apps/api/database/migrations` به ترتیب شماره اجرا می‌شوند. برای فعال‌سازی پردازه مستقل بازتخصیص خودکار، پس از اجرای migrationهای 017 و 018 مقدار `FSB_WORKFLOW_AUTOMATION_ENABLED=true` و در صورت نیاز `FSB_WORKFLOW_POLL_MS` را فقط در پردازه worker تنظیم کنید؛ این worker به SMTP وابسته نیست. بازتخصیص SLA با `reassignAfterHours` و `reassignUserIds` پیکربندی می‌شود؛ برای انتقال وظایف از مسئول غیرفعال یا فاقد عضویت/سمت معتبر، در همان مرحله `reassignOnInactiveAssignee: true` و `reassignUserIds` را تعریف کنید. این مسیر مستقل از SLA است، فقط یک بار برای هر وظیفه و هر نوع محرک اجرا می‌شود و در صورت نامعتبر بودن حتی یکی از گیرندگان پیکربندی‌شده، هیچ انتسابی را تغییر نمی‌دهد. مدیریت غیبت سازمانی نیز از مسیرهای `POST /api/organization-absences`، `GET /api/organizations/:organizationId/absences` و `DELETE /api/organizations/:organizationId/absences/:absenceId` انجام می‌شود. ثبت غیبت و ایجاد جانشینی عملیاتی در یک تراکنش انجام می‌شود؛ بنابراین جانشین از همان موتور کارتابل و اقدام استفاده می‌کند. لغو غیبت، جانشینی متناظر را نیز لغو می‌کند و پایان بازه بدون حذف تاریخچه، دسترسی جانشین را خودکار خاتمه می‌دهد. Migration 019 جدول غیبت را با FK به جانشینی پشتیبان اضافه می‌کند. اجرای build و تست هنوز انجام نشده و عمداً به مرحله‌ای که درخواست کرده‌اید موکول است.
