#!/usr/bin/env bash
# AutoHisob Database Backup Script
# Usage: ./scripts/backup.sh
# Schedule: Add to crontab: 0 2 * * * /opt/avtohisob/scripts/backup.sh

set -euo pipefail

# Config
DB_NAME="${POSTGRES_DB:-avtohisob}"
DB_USER="${POSTGRES_USER:-avtohisob}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/opt/avtohisob/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Starting backup: $DB_NAME"

# Dump and compress
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -Fc \
  "$DB_NAME" | gzip > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Backup created: $BACKUP_FILE ($SIZE)"

# Also backup uploads directory
if [ -d "/opt/avtohisob/backend/uploads" ]; then
  UPLOADS_BACKUP="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
  tar -czf "$UPLOADS_BACKUP" -C /opt/avtohisob/backend uploads
  log "Uploads backup: $UPLOADS_BACKUP"
fi

# Remove old backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete
log "Cleaned backups older than $RETENTION_DAYS days"

log "Backup complete ✅"
