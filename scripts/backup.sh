#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# AutoHisob — kunlik backup (PostgreSQL + uploads)
#
# O'rnatish (VPS'da, alisher foydalanuvchisi):
#   chmod +x /home/alisher/Avtohisob/scripts/backup.sh
#   crontab -e  →  har kuni 02:30 da:
#   30 2 * * * /home/alisher/Avtohisob/scripts/backup.sh >> /home/alisher/backups/backup.log 2>&1
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

# DIQQAT: production yo'li BOSH HARF bilan — /home/alisher/Avtohisob (deploy.yml
# git pull shu papkaga qiladi). Linux katta-kichik harfga sezgir — kichik 'a' xato!
APP_DIR="${APP_DIR:-/home/alisher/Avtohisob}"
BACKUP_DIR="${BACKUP_DIR:-/home/alisher/backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"      # kunlik nusxalar necha kun saqlanadi
KEEP_MONTHLY="${KEEP_MONTHLY:-6}"   # oyning 1-kuni nusxalari necha oy saqlanadi
STAMP="$(date +%F)"                 # 2026-07-20
MIN_DB_BYTES=100000                 # 100KB dan kichik dump = shubhali → rotatsiya to'xtaydi
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/uploads"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }

# Egaga Telegram orqali xabar — backend protsessidan MUSTAQIL (server o'chgan
# bo'lsa ham ishlaydi, aynan shunday holatda backup holatini bilish muhim).
# Token/chat sozlanmagan bo'lsa jim o'tkazib yuboriladi (curl chaqirilmaydi).
NOTIFIED=0
notify() {
  local text="$1"
  NOTIFIED=1
  if [ -n "${OPS_TOKEN:-}" ] && [ -n "${OPS_CHAT:-}" ]; then
    curl -s -m 8 -X POST "https://api.telegram.org/bot${OPS_TOKEN}/sendMessage" \
      -d "chat_id=${OPS_CHAT}" -d "parse_mode=HTML" --data-urlencode "text=${text}" > /dev/null || true
  fi
}
# Kutilmagan xato (pg_dump/tar muvaffaqiyatsiz va h.k.) — aniq notify() chaqirilmagan
# bo'lsa ham egaga xabar boradi. Ikki marta yubormaslik uchun NOTIFIED bayrog'i.
on_error() {
  if [ "$NOTIFIED" -eq 0 ]; then
    notify "AutoHisob backup KUTILMAGAN XATO bilan to'xtadi (qator $1)"
  fi
}
trap 'on_error $LINENO' ERR

# .env ni source qilmaymiz (kod bajarilishi xavfi) — faqat kerakli qatorlarni o'qiymiz.
# pg_dump URL'ni to'g'ridan-to'g'ri qabul qiladi — parol/host parse qilish shart emas.
ENV_FILE="$APP_DIR/backend/.env"
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
OPS_TOKEN="$(grep -E '^OPS_ALERT_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
OPS_CHAT="$(grep -E '^OPS_ALERT_CHAT_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
if [ -z "$DB_URL" ]; then
  log "XATO: DATABASE_URL topilmadi ($ENV_FILE)"
  notify "🔴 AutoHisob backup: DATABASE_URL topilmadi, backup ISHLAMADI"
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
  notify "🔴 AutoHisob backup XATO: dump juda kichik (${SIZE} bayt) — saqlanmadi, eski nusxalar tegilmadi"
  rm -f "$DB_FILE.tmp"
  exit 1
fi
mv "$DB_FILE.tmp" "$DB_FILE"
log "DB dump tayyor: $(du -h "$DB_FILE" | cut -f1)"

# ── 2) Uploads papkasi (vedomost fayllari, dalil-rasmlar) ───────────────────
# Har kuni hard-link snapshot (rsync --link-dest): o'zgarmagan fayllar oldingi
# snapshot bilan bitta nusxani bo'lishadi, diskda faqat yangi fayllar joy oladi.
UP_SNAP_DIR="$BACKUP_DIR/uploads-snapshots"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-7}"
if [ -d "$APP_DIR/backend/uploads" ]; then
  mkdir -p "$UP_SNAP_DIR"
  FREE_GB="$(df --output=avail -BG "$BACKUP_DIR" | tail -1 | tr -dc '0-9')"
  if [ "${FREE_GB:-0}" -lt 3 ]; then
    log "OGOHLANTIRISH: diskda ${FREE_GB}GB bo'sh — uploads snapshot O'TKAZIB YUBORILDI"
    notify "🟠 AutoHisob backup: diskda atigi ${FREE_GB}GB qoldi, uploads snapshot o'tkazib yuborildi"
  else
    PREV="$(ls -1d "$UP_SNAP_DIR"/20* 2>/dev/null | grep -v "/$STAMP$" | tail -1 || true)"
    TMP_SNAP="$UP_SNAP_DIR/.tmp-$STAMP"
    rm -rf "$TMP_SNAP"
    rsync -a ${PREV:+--link-dest="$PREV"} "$APP_DIR/backend/uploads/" "$TMP_SNAP/"
    rm -rf "$UP_SNAP_DIR/$STAMP"
    mv "$TMP_SNAP" "$UP_SNAP_DIR/$STAMP"
    log "Uploads snapshot tayyor: $UP_SNAP_DIR/$STAMP ($(find "$UP_SNAP_DIR/$STAMP" -type f | wc -l) fayl)"
  fi
fi

# ── 3) Rotatsiya — faqat muvaffaqiyatli backup'dan keyin ────────────────────
# Oyning 1-kuni nusxalari KEEP_MONTHLY oy saqlanadi; qolganlari KEEP_DAILY kun.
find "$BACKUP_DIR/db" -name 'avtohisob-*.dump' -not -name 'avtohisob-*-01.dump' -mtime "+$KEEP_DAILY" -delete
find "$BACKUP_DIR/db" -name 'avtohisob-*-01.dump' -mtime "+$((KEEP_MONTHLY * 31))" -delete
ls -1d "$UP_SNAP_DIR"/20* 2>/dev/null | head -n "-$KEEP_SNAPSHOTS" | xargs -r rm -rf
# Eski formatdagi to'liq arxivlar (disk to'lmasligi uchun tezda tozalanadi)
find "$BACKUP_DIR/uploads" -name 'uploads-*.tar.gz' -mtime +2 -delete 2>/dev/null || true

log "Backup yakunlandi ✅"
ls -lh "$BACKUP_DIR/db" | tail -5
notify "✅ AutoHisob backup OK — DB $(du -h "$DB_FILE" | cut -f1)"

# ── Tiklash (kerak bo'lganda, qo'lda):
#   pg_restore --clean --if-exists -d "$DATABASE_URL" avtohisob-YYYY-MM-DD.dump
#   rsync -a /home/alisher/backups/uploads-snapshots/YYYY-MM-DD/ /home/alisher/Avtohisob/backend/uploads/
