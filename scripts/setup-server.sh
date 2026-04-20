#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# AvtoHisob — VPS Server Setup Script
# Ubuntu 22.04 LTS da bir marta ishlatiladi
# Ishlatish: bash setup-server.sh
# ──────────────────────────────────────────────────────────────────────────────

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo "╔══════════════════════════════════════════╗"
echo "║     AvtoHisob — Server Setup v1.0       ║"
echo "╚══════════════════════════════════════════╝"

# ─── 1. System update ────────────────────────────────────────────────────────
log "Tizim yangilanmoqda..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── 2. Docker ───────────────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  log "Docker o'rnatilmoqda..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  log "Docker o'rnatildi: $(docker --version)"
else
  log "Docker allaqachon o'rnatilgan: $(docker --version)"
fi

# Docker Compose v2
if ! docker compose version &> /dev/null; then
  log "Docker Compose o'rnatilmoqda..."
  apt-get install -y docker-compose-plugin
fi
log "Docker Compose: $(docker compose version)"

# ─── 3. Certbot (SSL) ────────────────────────────────────────────────────────
if ! command -v certbot &> /dev/null; then
  log "Certbot o'rnatilmoqda..."
  apt-get install -y certbot
fi

# ─── 4. Git ──────────────────────────────────────────────────────────────────
if ! command -v git &> /dev/null; then
  apt-get install -y git
fi

# ─── 5. Clone repo ───────────────────────────────────────────────────────────
APP_DIR="/var/www/Avtohisob"
REPO_URL="https://github.com/alisherallayorov98-code/Avtohisob.git"

if [ ! -d "$APP_DIR" ]; then
  log "Loyiha yuklanmoqda..."
  git clone "$REPO_URL" "$APP_DIR"
else
  log "Loyiha yangilanmoqda..."
  cd "$APP_DIR" && git pull origin main
fi

cd "$APP_DIR"

# ─── 6. .env.production ──────────────────────────────────────────────────────
if [ ! -f ".env.production" ]; then
  warn ".env.production fayli yo'q — namuna asosida yaratilmoqda..."
  cp .env.production.example .env.production

  # Auto-generate secrets
  JWT_SECRET=$(openssl rand -hex 64)
  JWT_REFRESH=$(openssl rand -hex 64)
  DB_PASS=$(openssl rand -base64 24 | tr -d '=/+')

  sed -i "s/STRONG_PASSWORD_HERE/$DB_PASS/" .env.production
  sed -i "s/CHANGE_THIS_TO_64_CHAR_RANDOM_STRING/$JWT_SECRET/" .env.production
  sed -i "s/CHANGE_THIS_TO_ANOTHER_64_CHAR_RANDOM_STRING/$JWT_REFRESH/" .env.production

  warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  warn ".env.production yaratildi. Quyidagilarni to'ldiring:"
  warn "  1. OPENAI_API_KEY (vedomost import uchun)"
  warn "  2. CORS_ORIGIN va APP_URL (domeningiz)"
  warn "  3. SMTP_* (email uchun, ixtiyoriy)"
  warn "Fayl joyi: $APP_DIR/.env.production"
  warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  read -p "To'ldirganingizdan keyin Enter bosing..."
fi

# .env sifatida ulash (docker-compose .env o'qiydi)
ln -sf .env.production .env

# ─── 7. SSL sertifikat ───────────────────────────────────────────────────────
DOMAIN=$(grep "APP_URL" .env.production | sed 's/.*https:\/\///' | tr -d '"')

warn "SSL sertifikat olish uchun domen ($DOMAIN) ushbu server IP'ga yo'naltirilgan bo'lishi kerak."
read -p "SSL sertifikat olishni boshlashni xohlaysizmi? [y/N]: " GET_SSL

if [ "$GET_SSL" = "y" ] || [ "$GET_SSL" = "Y" ]; then
  # Vaqtinchalik nginx 80 portni ochishi uchun
  docker run -d --name certbot-nginx -p 80:80 \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/www/certbot:/var/www/certbot \
    nginx:alpine 2>/dev/null || true

  certbot certonly --webroot \
    -w /var/www/certbot \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos \
    -m "admin@$DOMAIN" || warn "SSL olishda xato — keyinroq qayta urinib ko'ring"

  docker stop certbot-nginx && docker rm certbot-nginx 2>/dev/null || true
  log "SSL sertifikat olindi!"
fi

# ─── 8. Build va ishga tushirish ─────────────────────────────────────────────
log "Docker image'lar build qilinmoqda (5-10 daqiqa)..."
docker compose -f docker-compose.yml build --no-cache

log "Xizmatlar ishga tushirilmoqda..."
docker compose -f docker-compose.yml up -d

# ─── 9. Tekshirish ───────────────────────────────────────────────────────────
sleep 10
log "Xizmatlar holati:"
docker compose ps

# Health check
if curl -sf http://localhost:3001/api/health > /dev/null; then
  log "Backend ishlayapti ✓"
else
  warn "Backend hali ishga tushmadi — loglarni tekshiring: docker compose logs backend"
fi

# ─── 10. SSL yangilash cron ──────────────────────────────────────────────────
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && docker compose -f $APP_DIR/docker-compose.yml restart nginx") | crontab -

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅ O'rnatish tugadi!                                    ║"
echo "║                                                          ║"
echo "║  Sayt: https://$DOMAIN"
echo "║  Admin: admin@avtohisob.uz / Admin@123                  ║"
echo "║                                                          ║"
echo "║  Muhim: Admin parolini darhol o'zgartiring!             ║"
echo "╚══════════════════════════════════════════════════════════╝"
