# OmniMind nightly backup worker (Railway cron service).
#
# One image, two entrypoints:
#   backup.sh         pg_dump -Fc → gzip → (openssl) → rclone copy to Cloudflare R2
#   restore-drill.sh  pull latest → pg_restore into a scratch DB → row-count + /health
#
# Pin the Postgres client major to the server (16) so pg_dump/pg_restore never
# produce an archive the server cannot read.
FROM alpine:3.20

RUN apk add --no-cache \
      bash \
      coreutils \
      curl \
      gzip \
      openssl \
      postgresql16-client \
      rclone \
      ca-certificates \
      tzdata

WORKDIR /app
COPY services/backup/backup.sh services/backup/restore-drill.sh /app/
RUN chmod +x /app/backup.sh /app/restore-drill.sh

ENV BACKUP_LOCAL_DIR=/tmp/backups \
    BACKUP_RETAIN_DAYS=30 \
    BACKUP_PREFIX=omnimind

# Railway's cron scheduler runs the container's start command on the schedule
# in railway.json and expects it to exit (restartPolicyType NEVER).
CMD ["bash", "/app/backup.sh"]
