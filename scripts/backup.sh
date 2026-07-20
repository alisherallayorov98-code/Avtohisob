#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# AutoHisob — kunlik backup (PostgreSQL + uploads)
#
# O'rnatish (VPS'da, alisher foydalanuvchisi):
#   chmod +x /home/alisher/avtohisob/scripts/backup.sh
#   crontab -e  →  har kuni 02:30 da:
#   30 2 * * * /home/alisher/avtohisob/scripts/backup.sh >> /home/alisher/backups/backup.log 2>&1
#
# DIQQAT: 2026-04 migratsiyasidan keyin eski /var/www yo'llari o'zgargan —
# cron'dagi eski yo'lni ham yangilang!
#
# XAVFSIZLIK KAFOLATLARI:
#   - Faqat O'QIYDI: pg_dump va tar ma'lumotni o'zgartirmaydi
#   - Rotatsiya FAQAT yangi nusxa yaratilib, hajmi tekshirilgandan KEYIN —
#     dump xato/kichik bo'lsa eski nusxalar TEGILMAYDI
#   - Rotatsiya faqat backup papkasidagi o'z nomlangan fayllarini o'chiradi
#   - Ma'lumot O'zbekistondan chiqmaydi (lokal disk, qonun talabiga mos)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="${APP_DIR:-/home/alisher/avtohisob}"
BACKUP_DIR="${BACKUP_DIR:-/home/alisher/backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"      # kunlik nusxalar necha kun saqlanadi
KEEP_MONTHLY="${KEEP_MONTHLY:-6}"   # oyning 1-kuni nusxalari necha oy saqlanadi
STAMP="$(date +%F)"                 # 2026-07-20
MIN_DB_BYTES=100000                 # 100KB dan kichik dump = shubhali → rotatsiya to'xtaydi
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/uploads"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }

# .env ni source qilmaymiz (kod bajarilishi xavfi) — faqat kerakli qatorni o'qiymiz.
# pg_dump URL'ni to'g'ridan-to'g'ri qabul qiladi — parol/host parse qilish shart emas.
DB_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/backend/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "$DB_URL" ]; then
  log "XATO: DATABASE_URL topilmadi ($APP_DIR/backend/.env)"
  exit 1
fi

# ── 1) PostgreSQL dump (custom format — pg_restore bilan tanlab tiklash mumkin)
DB_FILE="$BACKUP_DIR/db/avtohisob-$STAMP.dump"
log "DB dump boshlandi → $DB_FILE"
pg_dump --format=custom --file="$DB_FILE.tmp" "$DB_URL"

# Hajm tekshiruvi — bo'sh/siniq dump eski nusxalarni o'chirishga yo'l qo'ymaydi
SIZE=$(stat -c%s "$DB_FILE.tmp")
if [ "$SIZE" -lt "$MIN_DB_BYTES" ]; then
  log "XATO: dump juda kichik ($SIZE bayt) — saqlanmadi, rotatsiya QILINMADI"
  rm -f "$DB_FILE.tmp"
  exit 1
fi
mv "$DB_FILE.tmp" "$DB_FILE"
log "DB dump tayyor: $(du -h "$DB_FILE" | cut -f1)"

# ── 2) Uploads papkasi (vedomost fayllari, dalil-rasmlar) ───────────────────
UP_FILE="$BACKUP_DIR/uploads/uploads-$STAMP.tar.gz"
if [ -d "$APP_DIR/backend/uploads" ]; then
  tar -czf "$UP_FILE.tmp" -C "$APP_DIR/backend" uploads
  mv "$UP_FILE.tmp" "$UP_FILE"
  log "Uploads arxivi tayyor: $(du -h "$UP_FILE" | cut -f1)"
fi

# ── 3) Rotatsiya — faqat muvaffaqiyatli backup'dan keyin ────────────────────
# Oyning 1-kuni nusxalari KEEP_MONTHLY oy saqlanadi; qolganlari KEEP_DAILY kun.
find "$BACKUP_DIR/db" -name 'avtohisob-*.dump' -not -name 'avtohisob-*-01.dump' -mtime "+$KEEP_DAILY" -delete
find "$BACKUP_DIR/db" -name 'avtohisob-*-01.dump' -mtime "+$((KEEP_MONTHLY * 31))" -delete
find "$BACKUP_DIR/uploads" -name 'uploads-*.tar.gz' -not -name 'uploads-*-01.tar.gz' -mtime "+$KEEP_DAILY" -delete
find "$BACKUP_DIR/uploads" -name 'uploads-*-01.tar.gz' -mtime "+$((KEEP_MONTHLY * 31))" -delete

log "Backup yakunlandi ✅"
ls -lh "$BACKUP_DIR/db" | tail -5

# ── Tiklash (kerak bo'lganda, qo'lda):
#   pg_restore --clean --if-exists -d "$DATABASE_URL" avtohisob-YYYY-MM-DD.dump
#   tar -xzf uploads-YYYY-MM-DD.tar.gz -C /home/alisher/avtohisob/backend
