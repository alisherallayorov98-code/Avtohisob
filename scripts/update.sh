#!/bin/bash
# AvtoHisob — Yangilash skripti
# Ishlatish: bash /opt/avtohisob/scripts/update.sh

set -e
GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[✓]${NC} $1"; }

cd /var/www/Avtohisob

log "Yangi kod yuklanmoqda..."
git pull origin main

log "Docker image'lar rebuild qilinmoqda..."
docker compose build --no-cache backend frontend

log "Xizmatlar qayta ishga tushirilmoqda..."
docker compose up -d --no-deps backend frontend

log "Sog'liq tekshiruvi..."
sleep 8
docker compose ps

log "Yangilash tugadi!"
