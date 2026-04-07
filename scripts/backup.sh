#!/bin/bash
# Encrypted database backup
# Phase 0: local encrypted file
# Phase 2+: upload to S3

set -e
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR
pg_dump $DATABASE_URL | gpg --encrypt --recipient ${BACKUP_KEY:-dev} > \
  $BACKUP_DIR/$(date +%Y%m%d-%H%M%S).sql.gpg
echo "Backup created"
