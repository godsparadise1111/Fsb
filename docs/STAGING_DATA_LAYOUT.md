# چیدمان داده Production و Staging روی یک سرور

```
/srv/fsb-data/            ← دیسک دوم (mount شده)
├── production/{postgres,private-files,backups}
└── staging/{postgres,private-files,backups}
```

دیتابیس مستقل `my-postgres` جزو F-S نیست و هیچ‌کدام از اسکریپت‌ها به آن دست نمی‌زنند.

## راه‌اندازی Staging

```bash
sudo bash scripts/ops/prepare-data-disk.sh staging
cp .env.staging.example .env.staging     # همه secretها را مقداردهی کنید
docker compose -p fsb-staging --env-file .env.staging \
  -f compose.production.yaml -f compose.datadisk.yaml config --quiet
docker compose -p fsb-staging --env-file .env.staging \
  -f compose.production.yaml -f compose.datadisk.yaml up -d --build
```

Production همان دستور با `-p fsb`، `.env` و `FSB_DATA_DIR=/srv/fsb-data/production` است.

## قواعد جداسازی

- نام پروژه (`-p`) متفاوت ← شبکه و کانتینر مجزا.
- پورت متفاوت (`API_PORT=3101`، `WEB_PORT=3100`).
- `POSTGRES_*`، `JWT_SECRET`، `BOOTSTRAP_TOKEN` و `FSB_OUTBOX_ENCRYPTION_KEY` یکتا برای هر محیط.
- هرگز بکاپ Production در Staging بازیابی نمی‌شود مگر با اسکریپت‌های ops و تأیید صریح.
- Staging نباید ایمیل واقعی بفرستد.

## بررسی Workerها

```bash
docker compose -p fsb-staging --env-file .env.staging -f compose.production.yaml -f compose.datadisk.yaml ps
FSB_STAGING_TESTS=true FSB_WORKER_STABILITY_CHECK=YES \
  COMPOSE_FILE=compose.production.yaml ENV_FILE=.env.staging bash scripts/ops/worker-stability-check.sh
```

نکته: اسکریپت stability فعلاً `-p` را نمی‌گیرد؛ در صورت اجرای Staging با پروژه جدا، باید `COMPOSE_PROJECT_NAME=fsb-staging` را هم export کنید.
