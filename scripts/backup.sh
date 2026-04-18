#!/usr/bin/env bash
# AutoHisob Database Backup Script
# Schedule: 0 2 * * * /opt/avtohisob/scripts/backup.sh

set -euo pipefail

ENV_FILE="/var/www/Avtohisob/backend/.env"
source "$ENV_FILE"

# Parse DATABASE_URL: postgresql://user:pass@host:port/dbname
if [ -n "${DATABASE_URL:-}" ]; then
  DB_USER=$(echo "$DATABASE_URL" | sed -E 's|postgresql://([^:]+):.*|\1|')
  DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+)[:/].*|\1|')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
  DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
else
  DB_USER="${POSTGRES_USER:-avtohisob}"
  DB_PASS="${POSTGRES_PASSWORD:-}"
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${POSTGRES_DB:-avtohisob}"
fi

BACKUP_DIR="${BACKUP_DIR:-/opt/avtohisob/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Starting backup: $DB_NAME @ $DB_HOST"

PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -Fc \
  "$DB_NAME" | gzip > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Backup created: $BACKUP_FILE ($SIZE)"

# Backup uploads directory
if [ -d "/var/www/Avtohisob/backend/uploads" ]; then
  UPLOADS_BACKUP="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
  tar -czf "$UPLOADS_BACKUP" -C /var/www/Avtohisob/backend uploads
  log "Uploads backup: $UPLOADS_BACKUP"
fi

# Remove old backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete
log "Cleaned backups older than $RETENTION_DAYS days"

log "Backup complete ✅"
