# Toza-Hudud Moduli — To'liq Texnik Spetsifikatsiya

## 1. Umumiy Maqsad

AutoHisob platformasi ichida **alohida modul** sifatida ishlaydigan kommunal chiqindi yig'ish tizimi.
Maqsadli mijoz: aholiga maishiy chiqindi yig'ish xizmatini ko'rsatuvchi tashkilotlar (50+ klient).

---

## 2. Arxitektura

### Izolyatsiya printsipi
- Modul `frontend/src/modules/toza-hudud/` va `backend/src/modules/toza-hudud/` papkalarida
- Foydalanuvchi modulga kirganda butunlay boshqa interfeys ko'radi — asosiy AutoHisob menyu/sarlavhasi ko'rinmaydi
- Modul ichidagi xatoliklar asosiy funksiyalarga ta'sir qilmaydi
- **Faqat o'qiydi** AutoHisob dan: `vehicles`, `branches`, `gps_records`
- Asosiy sahifaga hech qanday yozuv yo'q — bir tomonlama bog'liqlik

### Ma'lumotlar oqimi
```
AutoHisob (asosiy) ──────────────────→ Toza-Hudud moduli
  vehicles (mashinalar)                    ↓
  branches (filiallar)              o'z jadvallari
  gps_records (GPS trek)            o'z hisobotlari
                                    o'z interfeysi
```

---

## 3. Ma'lumotlar Ierarxiyasi

```
Viloyat
  └── Tuman
        └── MFY (Mahalla Fuqarolari Yig'ini)
              └── Ko'cha
```

- Bir tashkilot bir vaqtda bir necha viloyat, o'nlab tumanlarda xizmat ko'rsatishi mumkin
- Har bir daraja alohida kiritiladi (bir martalik sozlama)
- Ro'yxatlarda: limit, pagination, filial/tuman/viloyat bo'yicha filtrlash

---

## 4. Geozolalar (Xarita)

### Texnologiya
- Leaflet.js + OpenStreetMap (bepul, O'zbekistonda ishlaydi)
- Leaflet.draw — polygon va chiziq chizish uchun

### Geozoна turlari
1. **MFY polygoni** — mahalla chegarasi
2. **Ko'cha liniyasi** — har bir ko'cha alohida chiziq sifatida
3. **Chiqindi poligoni** — chiqindi tashlash joyi (polygon)

### Xaritada ko'rish
- Barcha MFY polygonlari rangli ko'rinadi:
  - Yashil = bugun xizmat ko'rsatildi
  - Qizil = ko'rsatilmadi (grafik bor edi)
  - Sariq = shubhali (tez o'tib ketdi)
  - Kulrang = bugun grafik yo'q
- Ko'chalar: yashil/qizil chiziq
- Chiqindi poligomlari: alohida belgi
- Real vaqt: mashinalar joriy pozitsiyasi
- Kunlik GPS trek: mashina bugun qayerda bo'lganini ko'rish

---

## 5. Haftalik Grafik Tizimi

### Jadval ko'rinishi
```
Filial filtri: [Kumushkent tumani ▾]

Mashina       | Dush      | Sesh      | Chor  | Pay       | Juma  | Shan | Yak
--------------|-----------|-----------|-------|-----------|-------|------|----
20 A 777 AA   | Kum. MFY  | Yakk. MFY |   —   | Kum. MFY  |   —   |   —  |  —
30 B 444 BB   |     —     | Kum. MFY  |   —   |     —     |   —   |   —  |  —
```

### Grafik qoidalari
- Bir MFY bir haftada **bir necha kun** xizmat olishi mumkin (aholi soni ko'p bo'lsa)
- Bir kunda bir mashina **bir necha MFY** ga borishi mumkin (ketma-ket)
- Jadval katakchasiga bosib MFY biriktiriladi yoki o'chiriladi
- Filial bo'yicha filtrlash majburiy

### Real tashrif turlari
1. **Asosiy** — grafik bo'yicha, belgilangan mashina
2. **O'rinbosar** — asosiy mashina buzildi, boshqa mashina yuborildi
   - Sabab kiritiladi: "mashina buzildi", "haydovchi yo'q" va h.k.
   - Hisobotda "almashtirildi" belgisi ko'rinadi
3. **Qo'shimcha** — o'z grafigini tugatgan mashina boshqa MFYga bordi
   - Reja tashqarisidagi tashrif sifatida yoziladi
   - Asosiy grafik buzilmaydi

---

## 6. GPS Nazorat Algoritmi

### Ko'cha bo'yicha tekshiruv
```
Har kuni kechqurun avtomatik ishga tushadi:

1. Bugun uchun grafik bormi? → Yo'q: skip
2. Biriktirilgan mashina MFY polygoniga kirganmi?
3. Har bir ko'cha liniyasidan o'tganmi?
4. Tezlik tekshiruvi: >25 km/s → "shubhali" (chiqindi yig'ib bo'lmaydi)
5. Vaqt tekshiruvi: ish vaqtida bo'lganmi? (06:00–18:00)

Natija har ko'cha uchun:
  ✓ Xizmat ko'rsatildi
  ✗ Ko'rilmadi
  ⚠ Shubhali (tez o'tdi)
```

### Chiqindi poligoni tekshiruvi
- Mashina chiqindi poligoni geozoнasiga kirdi → tashrif yoziladi
- Vaqt, davomiylik, kirish/chiqish vaqti saqlanadi
- Kunlik/oylik hisobot: mashina X → poligon Y ga N marta bordi
- Poligon tashrifiga haq to'lanadi → moliyaviy hisobot uchun muhim

---

## 7. Sahifalar Ro'yxati

### 7.1 Dashboard
- Bugungi umumiy qamrov foizi
- Poligon tashriflar soni (bugun/bu oy)
- Xizmat ko'rsatilmagan ko'chalar soni
- Shubhali tashriflar
- Filial bo'yicha mini-statistika

### 7.2 Xarita
- Asosiy interfeys: MFY polygonlari + ko'chalar + mashinalar
- Filtr: filial, tuman, sana
- Trek ko'rish: tanlangan mashina + tanlangan kun
- Real vaqt rejimi toggle
- Chiqindi poligonlari belgisi

### 7.3 Haftalik Grafik
- Jadval: mashina (qator) × kun (ustun)
- Filial filtri
- Katakka bosib MFY biriktirish/o'chirish
- O'rinbosar/qo'shimcha tayinlash modal

### 7.4 Tashriflar Tarixi
- Kunlik GPS asosida avtomatik yozilgan tashriflar
- Filtr: mashina, MFY, sana oralig'i, tur (asosiy/o'rinbosar/qo'shimcha)
- Har bir tashrif: vaqt, davomiylik, ko'chalar qamrovi %

### 7.5 Poligon Tashriflar
- Chiqindi poligoniga tashriflar ro'yxati
- Filtr: mashina, poligon, sana oralig'i
- Hisobot: oylik jadval — mashina × poligon × son

### 7.6 Hisobotlar
- Kunlik xizmat hisoboti (topshirish uchun)
- Oylik hisobot: har MFY uchun xizmat ko'rsatilgan kunlar
- Poligon tashrif hisoboti (moliyaviy)
- Haydovchi bo'yicha hisobot
- Excel eksport

### 7.7 Ma'lumotlar (Sozlama)
- Viloyat CRUD
- Tuman CRUD (viloyatga biriktirilgan)
- MFY CRUD (tumanga biriktirilgan) + polygon koordinatalari
- Ko'cha CRUD (MFYga biriktirilgan) + chiziq koordinatalari
- Chiqindi poligonlari CRUD + polygon koordinatalari
- Barcha ro'yxatlarda: pagination, limit, filtrlash

### 7.8 Sozlamalar
- Xizmat vaqti oralig'i (standart 06:00–18:00)
- Shubhali tezlik chegarasi (standart 25 km/s)
- Filiallarni modulga ulash

---

## 8. Ma'lumotlar Bazasi Jadvallari (Backend)

```
th_regions          — Viloyatlar
th_districts        — Tumanlar (region_id)
th_mfys             — MFYlar (district_id, polygon GeoJSON)
th_streets          — Ko'chalar (mfy_id, linestring GeoJSON)
th_landfills        — Chiqindi poligonlari (polygon GeoJSON)

th_schedules        — Grafik (vehicle_id, mfy_id, day_of_week[])
th_service_trips    — Real tashriflar (vehicle_id, mfy_id, date, type, reason)
th_street_coverage  — Ko'cha qamrovi (trip_id, street_id, status, max_speed)
th_landfill_trips   — Poligon tashriflar (vehicle_id, landfill_id, date, count)
```

Barcha jadvallar `th_` prefiksi bilan — asosiy jadvallardan ajralib turadi.

---

## 9. Texnologiyalar

| Qatlam | Texnologiya |
|--------|-------------|
| Xarita | Leaflet.js + OpenStreetMap |
| Polygon chizish | Leaflet.draw |
| GPS tahlil | PostGIS ST_Contains, ST_Distance |
| Ko'cha o'tish | Hausdorff distance algoritmi |
| Frontend | React + TypeScript (mavjud stack) |
| Backend | Node.js + Express + Prisma (mavjud stack) |

---

## 10. Rivojlantirish Tartibi

1. **Bosqich 1:** Ma'lumotlar kiritish (Viloyat/Tuman/MFY/Ko'cha/Poligon)
2. **Bosqich 2:** Xarita — polygon ko'rish + chizish
3. **Bosqich 3:** Haftalik grafik jadvali
4. **Bosqich 4:** GPS nazorat algoritmi + ko'cha qamrovi
5. **Bosqich 5:** Poligon tashrif hisobi
6. **Bosqich 6:** Hisobotlar + Excel eksport
7. **Bosqich 7:** Dashboard + real vaqt xarita
