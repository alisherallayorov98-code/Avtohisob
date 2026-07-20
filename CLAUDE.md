# AutoHisob — loyiha qo'llanmasi

Enterprise avtopark boshqaruvi SaaS. Bitta kod bazasida 3 biznes:
**AutoHisob** (asosiy, avtopark), **Toza Hudud** (`backend/src/modules/toza-hudud`, chiqindi tashish),
**EkoHisob** (`backend/src/modules/ekohisob`, kommunal to'lov/talon).

## Stack
- **Backend**: Node.js + Express + Prisma + PostgreSQL (`backend/`), PM2 bilan deploy
- **Frontend**: React 18 + Vite + TypeScript + Tailwind + react-query (`frontend/`)
- **Test**: jest + ts-jest, `cd backend && npm test` (CI deploy'dan oldin yuritadi)
- **Tekshiruv**: `npx tsc --noEmit` (backend va frontend alohida)
- 4 ta Telegram bot: asosiy, haydovchi, eko-dala, care (`backend/src/services/*Bot.ts`)

## Qat'iy qoidalar
1. **Modul izolatsiyasi** — bitta modulda ishlaganda boshqa modullarga TEGMA.
   Production'da real mijozlar bor (94+ texnika, tashqi mijozlar).
2. **Tenant izolatsiya** — `organizationId: null` OR pattern LEAK qiladi.
   Har doim `backend/src/lib/orgFilter.ts` helperlari: `getOrgFilter`, `applyBranchFilter`, `isBranchAllowed`.
3. **Migratsiyalar** — `ADD COLUMN IF NOT EXISTS`; siniq migratsiya CI'ni va BARCHA deploylarni bloklaydi.
4. **Ma'lumot xavfsizligi** — o'chiruvchi endpointlar faqat aniq scope bilan (id ro'yxati/FK bog'lanish),
   xavfli amallar admin-only + confirmPhrase (namuna: `POST /oil-change/reset`).
5. **Ish tartibi** — avval barcha fayllarni o'qi → o'zgarishlar ro'yxatini ayt → tasdiq ol → bir marta edit → compile+test+commit.
6. **Qonun** — foydalanuvchi ma'lumotlari O'zbekistonda saqlanadi; tashqi SaaS'ga ma'lumot chiqarilmaydi.

## Muhim domenlar
- **Yoqilg'i**: vedomost import (`fuelImports.ts`) — AI parse → qatorlar → confirm'da bulk `FuelRecord`
  (har qator `fuelRecordId` bilan bog'lanadi, `unconfirm` shu bog' orqali xavfsiz bekor qiladi).
  Sarf metodikasi fill-to-fill. Narx tarixi: `fuelPrices.resolvePriceForDate`.
- **GPS**: yagona kanonik yadro `computeDailyTrackKm` — tezlik filtri YO'Q (ataylab), kun chegarasi UTC+5.
  `VehicleDailyKm` kesh + backfill. Xizmat langari (`serviceOdometerKm`) Wialon-shkala farqini yechadi.
- **Moy/xizmat**: `ServiceInterval` (mashina+tur) + `ServiceRecord` tarix; oil uchun `Vehicle.oilIntervalKm` override.
- **Billing**: mashina soniga bog'liq tariflar, `seedDefaultPlans` idempotent.

## Katta fayllar (yangi kod QO'SHILMASIN, alohida faylga yozilsin)
`backend/src/controllers/exports.ts` (~1900), `frontend/src/pages/Settings.tsx` (~1600),
`frontend/src/modules/toza-hudud/pages/MapPage.tsx` (~2150).
Pure hisob mantiqi `backend/src/lib/`ga chiqariladi va test yoziladi. Testlangan yadrolar:
`serviceStatus.ts` (moy/xizmat holati), `vedomostMath.ts` (vedomost narx/sana), `gpsDistance.ts`
(haversine + jitter filtri + kunlik km — yagona kanonik GPS masofa yadrosi, wialonService import qiladi),
`billingMath.ts` (yillik/oylik davr), `opsAlert.ts` (xato hisoblagichi). Jami 48 test, `cd backend && npm test`.

## Server
- Production: VPS `vps04527`, foydalanuvchi `alisher`, `/home/alisher` (2026-04'da root:/var/www'dan ko'chirilgan — eski yo'llarni ishlatma).
- Backup: `scripts/backup.sh` — kunlik cron 02:30, `/home/alisher/backups` (14 kunlik + 6 oylik rotatsiya).
- Deploy: GitHub Actions (`.github/workflows/deploy.yml`), PM2 `wait_ready`.
- **Ops alert** (`backend/src/lib/opsAlert.ts` + `opsDigest.ts`) — mijozlarga ko'rinmaydigan,
  faqat egaga (siz) Telegram kanali: 5xx xatolar (15 daqiqa dedupe) + kunlik 08:00 xulosa
  (foydalanuvchi/mashina soni, xato hisobi, backup yoshi). `.env`da `OPS_ALERT_BOT_TOKEN`/
  `OPS_ALERT_CHAT_ID` sozlanmasa butunlay jim — mavjud botlardan mustaqil, alohida bot kerak.
  `scripts/backup.sh` ham shu tokenlardan xabar yuboradi (backend o'chgan bo'lsa ham ishlaydi).
