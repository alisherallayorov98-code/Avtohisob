# Avtohisob

Korxona avtomashinalari uchun ehtiyot qismlar sarfi, ombor kirimi va servis nazoratini yuritish uchun web ilova.

## Nimalar ishlaydi

- Login va rollar
- Avtomashinalar CRUD va arxivlash
- Ehtiyot qismlar CRUD, kategoriya va supplierlar
- Omborga kirim va mashinaga sarf yozish
- Kirim va sarf yozuvlarini tahrirlash
- Dashboard statistika, ogohlantirish va audit
- Servis tarixi va mashina kesimidagi xarajatlar
- Servis rejalari, km/kun intervali va muddat eslatmalari
- Ta'mirlash buyurtmalari, holat va xarajat nazorati
- Hisobotlar, CSV eksport va chop etish
- Foydalanuvchi boshqaruvi va parolni almashtirish

## Demo foydalanuvchilar

- `admin / admin123`
- `ombor / ombor123`
- `rahbar / rahbar123`

## Ishga tushirish

```bash
node server.js
```

Brauzerda `http://localhost:4000` ni oching.

Health tekshiruvi uchun `http://localhost:4000/api/health` endpoint mavjud.
Endpoint javobida `version` va `uptimeSeconds` ham qaytadi.

## Production eslatma

- `NODE_ENV=production` holatida session cookie `Secure` flag bilan yuboriladi.
- Server `SIGINT` va `SIGTERM` signalida graceful shutdown qiladi.

## Tekshiruv

```bash
npm run check:syntax
npm run smoke
```

`smoke` skripti serverni vaqtincha ishga tushirib, asosiy endpointlarni tekshiradi (`health`, `login`, `search`, `reports`).

Qo'shimcha UX:
- Global qidiruvga tez o'tish uchun klaviaturada `/` tugmasini bosing.

## Asosiy qulayliklar

- Ombor qoldig'i avtomatik hisoblanadi
- Kam qoldiqdagi qismlar dashboardda ko'rinadi
- Arxivlangan mashina va qismlar alohida nazorat qilinadi
- Har bir mashina uchun servis rejasi va keyingi servis sanasi/probegi hisoblanadi
- Muddati o'tgan yoki yaqinlashgan servislar homepage da eslatma bo'lib chiqadi
- Ta'mirlash buyurtmalarida ustuvorlik, holat, mas'ul va smeta yuritiladi
- Audit tarixida kim, qachon, nimani o'zgartirgani ko'rinadi

## Roadmap

Loyihaning ketma-ket rivojlantirish rejasi [ROADMAP.md](./ROADMAP.md) faylida yozilgan.

## Release Checklist

- `npm run check:syntax` xatosiz o'tdi
- `npm run smoke` muvaffaqiyatli o'tdi
- `api/health` status `ok` qaytaryapti
- Demo foydalanuvchi loginlari ishlayapti
- Hisobot eksport (`CSV`) va chop etish tekshirildi
- Mobil ko'rinishda asosiy bo'limlar ochilib-yopilishi tekshirildi
