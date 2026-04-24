#!/bin/bash
# AvtoHisob — Nginx /uploads/ proxy fix
# Serverda bir marta ishlatish: bash scripts/fix-nginx-uploads.sh
# Maqsad: /uploads/ yo'lini nginx orqali backend'ga yo'naltirish

set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Nginx config faylni topish
NGINX_CONF=""
for f in /etc/nginx/sites-enabled/avtohisob \
          /etc/nginx/sites-enabled/default \
          /etc/nginx/conf.d/avtohisob.conf; do
  if [ -f "$f" ]; then
    NGINX_CONF="$f"
    break
  fi
done

if [ -z "$NGINX_CONF" ]; then
  # Barcha sites-enabled fayllarini ko'rish
  NGINX_CONF=$(ls /etc/nginx/sites-enabled/ 2>/dev/null | head -1)
  [ -n "$NGINX_CONF" ] && NGINX_CONF="/etc/nginx/sites-enabled/$NGINX_CONF"
fi

if [ -z "$NGINX_CONF" ]; then
  err "Nginx config fayli topilmadi. Qo'lda tekshiring: /etc/nginx/sites-enabled/"
fi

log "Nginx config: $NGINX_CONF"

# /uploads/ allaqachon borligini tekshirish
if grep -q 'location /uploads/' "$NGINX_CONF"; then
  log "/uploads/ proxy allaqachon sozlangan — hech narsa o'zgarmaydi"
  exit 0
fi

warn "Backup qilinmoqda: ${NGINX_CONF}.bak"
sudo cp "$NGINX_CONF" "${NGINX_CONF}.bak"

# /api/ location oldiga /uploads/ proxy qo'shish
# Agar /api/ location yo'q bo'lsa, server { blokining ichiga qo'shadi
if grep -q 'location /api/' "$NGINX_CONF"; then
  # /api/ location dan oldin qo'shish
  sudo sed -i '/location \/api\//i\    location \/uploads\/ {\n        proxy_pass http:\/\/localhost:3001;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        expires 7d;\n        add_header Cache-Control "public, immutable";\n    }\n' "$NGINX_CONF"
else
  # server { } blokiga qo'shish — closing brace oldidan
  sudo sed -i '/^}/i\    location \/uploads\/ {\n        proxy_pass http:\/\/localhost:3001;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        expires 7d;\n        add_header Cache-Control "public, immutable";\n    }' "$NGINX_CONF"
fi

log "Nginx config test qilinmoqda..."
if sudo nginx -t 2>&1; then
  log "Nginx qayta yuklanmoqda..."
  sudo nginx -s reload
  log "✅ /uploads/ proxy muvaffaqiyatli qo'shildi!"
  log "Endi rasmlar https://avtohisob.uz/uploads/... orqali ochiladi"
else
  warn "Nginx test xato — backup tiklanmoqda"
  sudo cp "${NGINX_CONF}.bak" "$NGINX_CONF"
  err "Nginx config xato. Qo'lda tekshiring: $NGINX_CONF"
fi
