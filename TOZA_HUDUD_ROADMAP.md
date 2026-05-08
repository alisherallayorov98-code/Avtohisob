# Toza-Hudud Moduli — Rivojlantirish Prompt'i (Kelajak Sessiyalar Uchun)

> **MUHIM QOIDALAR (o'qimay ishlamagin):**
> - Faqat `c:\Avtohisob\backend\src\modules\toza-hudud\` va `c:\Avtohisob\frontend\src\modules\toza-hudud\` ichida ishlash
> - `backend\lib\scheduler.ts` — faqat TH cron'larini o'zgartirish, boshqalariga tegmaslik
> - `backend\prisma\schema.prisma` — faqat `Th*` modellarini qo'shish/o'zgartirish
> - `frontend\src\App.tsx` — faqat `/th-*` routelarni qo'shish
> - Real foydalanuvchi ma'lumotlari (94 ta texnika, GPS treklarlar, MFY ma'lumotlari) — hech qanday DELETE/TRUNCATE yo'q
> - Har qanday migratsiyada `IF EXISTS` / `IF NOT EXISTS` himoya ishlatish
> - Prisma fieldlari `@map` yo'q bo'lsa camelCase column nomi saqlanadi — migration'da shu saqlansin

---

## HOZIRGI HOLAT (2026-may)

### Mavjud infratuzilma
```
Regions → Districts → MFYs (polygon) → Schedules (vehicle+MFY+dayOfWeek[])
Vehicles (GPS via Wialon/SmartGPS) → Daily GPS tracks → Grid coverage (35m×35m)
Landfills → LandfillTrips (kirish/chiqish)
Containers (GPS-sinx) → ContainerVisits
ThServiceTrip: vehicleId+mfyId+date → status(visited/not_visited/no_gps/no_polygon) + coveragePct
ThSettings: suspiciousSpeedKmh, autoMonitorEnabled, notifyOn*, driverAccessEnabled, driverPinHash
ThCoverageFingerprint: vehicleId+mfyId+month → cells[] (6 oylik GPS xotira)
```

### Avtomatik ishlar (scheduler.ts)
- `01:00-13:00 UTC` (06:00-18:00 UZT) — har 2 soatda monitoring yangilanadi
- `05:30 UTC` (10:30 UZT) — GPS yo'q mashinalar haqida Telegram
- `15:00 UTC` (20:00 UZT) — kunlik yakuniy monitoring + Telegram xulosa + haftalik qamrov tekshiruvi
- `21:00 UTC` (02:00 UZT) — konteyner GPS sinxi

### Haydovchi portali
- QR kod + PIN → `/th-driver` → bugungi jadval, tashriflar
- `/th-coverage?token=X` — ko'cha qamrovi xaritasi (yashil/sariq/qizil kataklar)
- "GPS yangilab tekshirish" tugmasi — haydovchi tasdiqlasa GPS yangi tortiladi

### AI (thCoverageAI.ts)
- `ThCoverageFingerprint` — 6 oylik katak xotirasi
- `annotateWithHistory()` → `covered | historically_missed | never_visited`
- Sozlamalar sahifasida "AI o'qitish" tugmasi

---

## KEYINGI BOSQICHLAR (Prioritet bo'yicha)

---

### BOSQICH 1 — Haydovchi samaradorligi va rag'batlantirish

**Maqsad:** Inson omilini kamaytirish — haydovchi o'zi nazorat qila olsin, javobgarlik hissi oshsin.

#### 1.1 Haydovchi haftalik hisobot (avtomatik Telegram)
**Fayl:** `thNotifications.ts` + `scheduler.ts`

Har dushanba 09:00 UZT (04:00 UTC) da har bir haydovchiga o'tgan haftaning shaxsiy hisobotini yuborish:

```
📊 Haftalik hisobotingiz (Du 5-may — Ya 11-may)

🚛 316-mashina

MFY natijalari:
✅ Yunusobod-3: 94% (Payshanba)
✅ Yunusobod-3: 87% (Shanba) → jami: 91%
⚠️ Mirzo Ulug'bek-1: 68% (Chorshanba) — sariq
❌ Chilonzor-7: 41% (Juma) — qizil

📈 Haftalik o'rtacha: 73% (o'tgan hafta: 69%)
🏆 Yaxshilanish: +4% ↑
```

**Texnik:** `thSchedule` dan haydovchi vehicleId → Telegram userini topish uchun yangi `ThDriverProfile` jadval kerak (vehicleId ↔ telegramUserId). Yoki mavjud `telegramBot.sendToUser(userId, msg)` orqali.

#### 1.2 Haydovchi reytingi
**Fayl:** yangi `thDriverStats.ts` servis

Har kuni 20:00 monitoring tugagach hisoblanadi:
- `weekCoveragePct` = joriy hafta o'rtacha qamrov
- `monthCoveragePct` = joriy oy o'rtacha qamrov  
- `streak` = ketma-ket necha kun 80%+ qamrov
- `rank` = ushbu org'dagi haydovchilar orasida necha-o'rinchi

**DB:** yangi `ThDriverStat` modeli:
```prisma
model ThDriverStat {
  id              String   @id @default(cuid())
  vehicleId       String   @unique
  weekCoveragePct Int      @default(0)
  monthCoveragePct Int     @default(0)
  streak          Int      @default(0)  // ketma-ket yaxshi kun
  rank            Int?
  updatedAt       DateTime @updatedAt
  @@map("th_driver_stats")
}
```

**Frontend:** `DashboardPage.tsx` da "Top haydovchilar" kichik jadvali qo'shish.

#### 1.3 Haydovchi Telegram bot orqali kunlik status
**Fayl:** `telegramCommands.ts` + `thNotifications.ts`

Haydovchi `/mening_status` yozsа bot bugungi holatini qaytaradi (auth: vehicleId + PIN):
```
🚛 316-mashina — Bugun (Chorshanba)
✅ Yunusobod-3: Borildi (94%)
⏳ Chilonzor-7: Kutmoqda
📍 Keyingi: Chilonzor-7 mahallasi
🗺 Xarita: [havola]
```

---

### BOSQICH 2 — Avtomatik marshut taklifi (Route Optimization)

**Maqsad:** Haydovchi qaysi tartibda MFYlarni aylanishini bilmasin — tizim eng optimal tartibni taklif qilsin.

#### 2.1 Marshut taklifi algoritmi
**Fayl:** yangi `thRouteOptimizer.ts`

```typescript
// Nearest-neighbor greedy + polygon centroid distances
export async function suggestDayRoute(
  vehicleId: string,
  date: Date,
): Promise<Array<{ mfyId: string; mfyName: string; centroid: [number, number]; order: number }>>
```

**Logika:**
1. Bugungi jadvaldagi MFYlar markazini (centroid) hisoblash
2. Garaj joylashuvi yoki birinchi GPS pozitsiyasidan boshlab
3. Eng yaqin MFY → keyingi eng yaqin → greedy TSP
4. Natija: tartiblangan MFYlar ro'yxati + xaritada poliliniya

**Endpoint:** `GET /th/routes/today?vehicleId=X&date=Y`

**Frontend:** `DriverPublicPage.tsx` da yangi "Marshut" tab:
- Leaflet xaritasida MFYlar 1,2,3... raqamlanib ko'rsatiladi
- Optimal yurish tartibi ro'yxati
- Har MFY uchun taxminiy masofa

#### 2.2 Marshut tarixi tahlili
Haydovchi har kuni qaysi tartibda borganligi saqlansa, vaqt o'tib optimal tartib o'rganiladi (AI fingerprint kabi).

---

### BOSQICH 3 — Real-vaqt monitoring (Live Dashboard)

**Maqsad:** Admin kun davomida qaysi mashinalar ishlamoqda, qaysilari orqada — bir qarashdanoq ko'rsin.

#### 3.1 Live xarita
**Fayl:** `frontend/src/modules/toza-hudud/pages/MapPage.tsx` kengaytirish

Hozir: bir vaqtdagi mashina pozitsiyalari statik holda ko'rsatilmoqda.

Kerak:
- **Auto-refresh** har 2 daqiqada
- Har mashina uchun rangli marker:
  - 🟢 Yashil: faol, GPS bor, bugun jadvalda
  - 🟡 Sariq: jadvalda bor, lekin hali birorta MFYga kirmagan
  - 🔴 Qizil: GPS yo'q yoki jadvalda yo'q
- Marker ustiga bosganда: mashina nomi, qamrov%, oxirgi signal vaqti

**Texnik:** `GET /th/gps/positions` endpointini qo'llash + `coveragePct` qo'shish.

#### 3.2 Kun davomida progress bar
`DashboardPage.tsx` da yangi widget:

```
Bugungi progress (14:30 UZT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Jami mashina: 12   Boshlagan: 8   Tugallagan: 3
▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  65% bajarildi
```

---

### BOSQICH 4 — Anomaliya va firibgarlik aniqlash

**Maqsad:** Haydovchi aslida kirmasdan "borildi" deyish imkonini yo'q qilish.

#### 4.1 Tezlik anomaliyasi (mavjud — kengaytirish)
Hozir: `suspicious = maxSpeed > suspiciousSpeedKmh`.

Kengaytirish:
- **Vaqt anomaliyasi:** MFY maydoni / o'rtacha tezlik bo'yicha minimal kutilgan vaqt hisoblanadi. Agar real vaqt 3x qisqa bo'lsa — shubhali.
- **GPS sichqonchasi:** GPS trek to'g'ri chiziq (GPS signal yo'qligi — qurilma manipulyatsiyasi). Alg.: ketma-ket N ta nuqta kam og'ish bilan to'g'ri chiziqda bo'lsa flag.
- **Polygon chekkasidan o'tish:** MFY ga to'liq kirmasdan chetidan o'tish. Markazga masofa vs polygon hajmiga nisbatan.

**DB:** `ThServiceTrip` ga `anomalyFlags Json?` field qo'shish.

#### 4.2 Avvalgi trek solishtirish
- Agar haydovchi doim bir xil marshrutni bosib o'tsa (GPS copy-paste) — statik trek aniqlash
- Har kuni trekni hash sifatida saqlash, dublikatlarni topish

#### 4.3 Admin bildirishnomasi
Shubhali holatlar aniqlansa darhol Telegram:
```
⚠️ Shubhali holat: 316-mashina
MFY: Yunusobod-3 (Chorshanba)
Sabab: MFY maydoni 2.1 km², o'rtacha tezlik 67 km/h
Kutilgan vaqt: ≥8 daq, haqiqiy: 2 daq
Xarita: [havola]
```

---

### BOSQICH 5 — Konteyner intellekti

**Maqsad:** Chiqindi qutilarini nazorat qilish avtomatlashtirilsin.

#### 5.1 Tashrif chastotasi tahlili
**Fayl:** yangi `thContainerAnalytics.ts`

Har konteyner uchun:
- O'rtacha necha kunda bir marta to'ldiriladi (visit frequency)
- Oxirgi tashrif qachon edi
- Forecast: keyingi tashrif qachon bo'lishi kerak

**Endpoint:** `GET /th/containers/analytics?orgId=X`

**Frontend:** konteyner jadvalida "Keyingi tashrif" ustuni qo'shish.

#### 5.2 Tashrif o'tkazib yuborish ogohlantirishi
Agar konteyner o'rtacha intervaldan 1.5x ko'proq vaqt o'tsa — Telegram:
```
🗑 Konteyner tashrif kechikdi!
Manzil: Yunusobod, 12-dom (kon-12)
Oxirgi tashrif: 3 kun oldin (o'rtacha: 2 kun)
Javobgar mashina: 316
```

#### 5.3 Marshrutga konteynerlarni qo'shish
Marshut taklifi algoritmiga konteynerlari ham kiritish — haydovchi MFYga borganda yaqin konteynerlarnham bosib o'tsin.

---

### BOSQICH 6 — Hisobot va analytics kengaytirish

#### 6.1 PDF hisobot generatsiyasi
**Fayl:** yangi `thReportPdf.ts` (puppeteer yoki pdfkit)

Oylik hisobot:
- Har mashina qamrov darajasi (bar chart)
- Har MFY uchun o'rtacha qamrov (heat map jadval)
- Anomaliya soni
- Top 3 va bottom 3 mashina

`GET /th/reports/monthly/pdf` → PDF buffer → download

#### 6.2 Trend tahlili
**Frontend:** yangi `TrendsPage.tsx`

- Haftalik qamrov o'zgarishi grafigi (last 12 weeks)
- Har MFY uchun qamrov trendi: yaxshilanyaptimi yoki yomonlashyaptimi?
- Konteynerlardagi tashriflar statistikasi

#### 6.3 Avtomatik oylik xulosa (Telegram)
Har oyning 1-kuni 09:00 UZT:
```
📅 Aprel 2026 — Oylik Xulosa

📊 Umumiy qamrov: 78% (mart: 71%)
✅ Yaxshilanish: +7%

Top mashinalar:
🥇 316: 94% o'rtacha
🥈 142: 89% o'rtacha
🥉 205: 85% o'rtacha

Muammoli MFYlar (60% dan past):
❌ Chilonzor-7: 43% (javobgar: 316)
⚠️ Mirzo Ulug'bek-5: 58% (javobgar: 142)
```

---

### BOSQICH 7 — Jadval intellekti

#### 7.1 Jadval optimallashtirish taklifi
**Fayl:** yangi `thScheduleOptimizer.ts`

Muammo: admin qaysi mashinaga qaysi MFYni berish kerakligini bilmaydi.

Algoritm:
1. Har mashina uchun oxirgi 3 oylik o'rtacha qamrov per MFY
2. Qaysi mashina qaysi MFYda yaxshi ishlagan? → o'sha juftlikni saqla
3. Yangi mashina qo'shilganda — geografik yaqinlik bo'yicha MFYlarni tarqatish taklif qil

**Endpoint:** `POST /th/schedules/suggest` → `[{vehicleId, mfyId, reason}]`
**Frontend:** Jadval sahifasida "AI taklif" tugmasi → modal oynada taklif ko'rsatish.

#### 7.2 Ta'til va dam olish kuni avtomatik o'zgartirish
**DB:** yangi `ThHoliday` modeli (sana + sabab)

Agar dam olish kunida monitoring ishlamasa — log'da belgi.
Bayram kunlari uchun `runDailyMonitoring` da `ThHoliday` tekshiruvi.

---

### BOSQICH 8 — Multi-tenant kengaytirish

#### 8.1 Obuna darajalariga qarab funksiyalar
Hozir: `tozahudud_module` feature flag.

Kengaytirish:
```
tozahudud_basic    → monitoring, jadval, haydovchi portal
tozahudud_advanced → AI fingerprint, anomaliya, trend tahlili
tozahudud_pro      → route optimization, PDF hisobotlar, driver rating
```

**Fayl:** `middleware/subscriptionGuard.ts` da `requireFeature('tozahudud_advanced')` qo'shish.

#### 8.2 Supervisor portal
Tashkilot rahbari uchun alohida ko'rinish:
- Faqat o'qish (read-only)
- Jami qamrov + muammoli joylar
- Haydovchilar reytingi
- Joriy kun real-vaqt holati

**Route:** `/toza-hudud/supervisor` — alohida layout, minimal UI.

---

## TEXNIK QARZLAR (Refaktorlar)

### T1. `thMonitor.ts` optimizatsiyasi
Hozir N*M murakkablik: N ta GPS nuqta × M ta katak, har birini haversine bilan tekshiradi.
> **Yechim:** Katakni bucket'larga ajratish (spatial grid index). GPS nuqtalar bucket'ga tushganda faqat qo'shni kataklar tekshiriladi. → 10-30x tezlashuv 100+ mashinada.

### T2. Wialon API rate limiting
Hozir: `scheduler.ts` da barcha mashinalar ketma-ket GPS so'rovlar.
> **Yechim:** `p-limit` library bilan parallel lekin cheklangan (masalan max 5 parallel so'rov). `thCoverageAI.ts` da 200ms timeout bor — bu yetarli emas katta fleetda.

### T3. GPS trek kesh
Bir kunda monitoring bir necha marta ishlaydi (har 2 soatda). Har safar Wialon'dan tortiladi.
> **Yechim:** Redis (yoki DB) da kunlik trek kesh. TTL: kun oxirigacha. Key: `track:{vehicleId}:{dateStr}`. Agar keshda bo'lsa — Wialon'ga so'rov yo'q.

### T4. `ThServiceTrip` katta ma'lumotlar
30 mashina × 20 MFY × 365 kun = 219,000 yozuv/yil.
> **Yechim:** Eski yozuvlar uchun partitioning yoki arxivlash. `cleanupService` 6 oydan eski yozuvlarni arxivga ko'chirsin (mavjud `Archive` model orqali).

---

## KERAKLI DB MIGRATSIYALAR

```sql
-- T3: GPS trek kesh (agar Redis yo'q bo'lsa)
CREATE TABLE th_gps_cache (
  vehicleId TEXT NOT NULL,
  date TEXT NOT NULL,  -- "2026-05-08"
  track JSONB NOT NULL,
  fetchedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vehicleId, date)
);

-- Bosqich 1.2: Haydovchi statistika
CREATE TABLE th_driver_stats (
  id TEXT PRIMARY KEY,
  vehicleId TEXT UNIQUE NOT NULL,
  weekCoveragePct INTEGER DEFAULT 0,
  monthCoveragePct INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  rank INTEGER,
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Bosqich 1.1: Haydovchi Telegram profili
ALTER TABLE th_settings ADD COLUMN IF NOT EXISTS "driverTelegramMap" JSONB;
-- {vehicleId: telegramUserId} mapping

-- Bosqich 4.1: Anomaliya flags
ALTER TABLE th_service_trips ADD COLUMN IF NOT EXISTS "anomalyFlags" JSONB;
-- {tooFast: bool, linearTrack: bool, edgeOnly: bool, timeTooShort: bool}
```

---

## SESSIYA BOSHLASH UCHUN TEKSHIRUVLAR

Har yangi sessiyada, ishlashdan oldin:

```bash
# 1. Schema bilan DB sinxronligi
cd backend && npx prisma migrate status

# 2. TypeScript tozaligi
npx tsc --noEmit

# 3. Mavjud cron'lar
grep -n "cron.schedule" src/lib/scheduler.ts

# 4. Yangi Prisma modellar DBda bormi?
# (psql orqali yoki Prisma studio)
```

---

## ARXITEKTURA QOIDALARI

```
backend/src/modules/toza-hudud/
├── controllers/      # HTTP handlers — faqat req/res, logic yo'q
├── services/         # Business logic — DB dan mustaqil bo'lishi kerak
│   ├── thMonitor.ts        # GPS → coverage (asosiy)
│   ├── thCoverageAI.ts     # Fingerprint + annotatsiya
│   ├── thNotifications.ts  # Telegram xabarlar
│   └── thRouteOptimizer.ts # (keyingi) Marshut taklifi
├── routes/
│   └── index.ts      # Public endpointlar auth middleware DAN OLDIN
└── prisma models:    # Hammasining nomi Th* bilan boshlanadi
```

**Frontend:**
```
frontend/src/modules/toza-hudud/
├── pages/            # Har page o'z state'ini boshqaradi
├── components/       # Qayta ishlatiladigan UI
└── TozaHududApp.tsx  # Internal router (nested routes)
```

**GPS koordinata konvensiyasi:**
- GeoJSON: `[longitude, latitude]` (lon, lat)
- Leaflet: `[latitude, longitude]` (lat, lon)
- Wialon: `{x: longitude, y: latitude}`
- Ikkala joyda ham ehtiyot bo'lish — bu xato eng ko'p uchraydigan joy!

---

## REAL FOYDALANUVCHI MUHOFAZASI

- Hech qanday `DELETE` yoki `TRUNCATE` yo'q migratsiyalarda
- Yangi ustun qo'shganda: `ADD COLUMN IF NOT EXISTS` + `DEFAULT` qiymati
- Monitoring xatosi butun cron'ni to'xtatmasin: `try/catch` har org uchun alohida
- GPS API muvaffaqiyatsiz bo'lsa: `[]` qaytarsin, trip `no_gps` bo'lsin
- Telegram xabar yuborilmasa: monitoring davom etsin (notification optional)
- Haydovchi portal xatosi: faqat o'sha haydovchi ta'sirlansin, admin portal ishlayversin
