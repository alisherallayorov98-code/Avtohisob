// Kvitansiyani chop etish (A5 HTML) va ochiq tekshirish (QR orqali).
//
// Nega PDF emas, HTML: pdfkit ning standart shriftlari o'zbek lotinidagi `ʻ`
// (soʻm, Oʻzbekiston) va kirillni qo'llab-quvvatlamaydi — shrift joylash kerak
// bo'lardi va natija mo'rt chiqardi. Chop etishga tayyor HTML brauzerda
// Ctrl+P → "PDF saqlash" bilan bir xil natija beradi, telefonda ham ishlaydi.

import { Request, Response, NextFunction } from 'express'
import { getOrgSettings } from '../services/orgSettings'
import QRCode from 'qrcode'
import rateLimit from 'express-rate-limit'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { uzDateTime, uzMonth, uzNum } from '../lib/dateFormat'
import { canAccessEntity } from '../lib/ekoScope'
import { isValidVerifyToken, parseReceiptNumber } from '../lib/receiptNumber'

/**
 * Ochiq tekshiruv endpointi uchun tezlik cheklovi: IP bo'yicha daqiqasiga 30 so'rov.
 * (Token 144 bit — taxmin qilib bo'lmaydi; limit raqam bo'yicha eski QR'larni
 * ommaviy aylanib chiqishni qiyinlashtiradi.) rateLimiter.ts da umumiy factory yo'q.
 */
export const receiptVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: "Juda ko'p so'rov. Bir daqiqadan so'ng qayta urinib ko'ring." },
  standardHeaders: true,
  legacyHeaders: false,
})

const fmtMonth = uzMonth
const fmt = uzNum

/** HTML ga qo'yiladigan matnni xavfsizlantiradi (tashkilot nomida < > bo'lishi mumkin) */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Summani so'z bilan — kvitansiyada rasmiy talab */
function amountInWords(n: number): string {
  const ones = ['', 'bir', 'ikki', 'uch', 'to\'rt', 'besh', 'olti', 'yetti', 'sakkiz', 'to\'qqiz']
  const tens = ['', 'o\'n', 'yigirma', 'o\'ttiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'to\'qson']
  function under1000(x: number): string {
    const parts: string[] = []
    const h = Math.floor(x / 100)
    if (h > 0) parts.push(`${ones[h]} yuz`)
    const t = Math.floor((x % 100) / 10)
    if (t > 0) parts.push(tens[t])
    const o = x % 10
    if (o > 0) parts.push(ones[o])
    return parts.join(' ')
  }
  let v = Math.round(n)
  if (v === 0) return 'nol'
  const groups: [number, string][] = [[1_000_000_000, 'milliard'], [1_000_000, 'million'], [1000, 'ming']]
  const out: string[] = []
  for (const [base, label] of groups) {
    const q = Math.floor(v / base)
    if (q > 0) { out.push(`${under1000(q)} ${label}`); v %= base }
  }
  if (v > 0) out.push(under1000(v))
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/** Ochiq tekshirish uchun tashkilot nomini maskalaydi: `"Oq Yo'l" MChJ` → `"Oq Y••• MChJ` */
export function maskName(name: string): string {
  return String(name ?? '').split(/\s+/).map(w => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, '')
    if (letters.length <= 3) return w
    const keep = Math.max(1, Math.ceil(letters.length / 3))
    return w.slice(0, keep + (w.length - letters.length > 0 ? 1 : 0)) + '•'.repeat(3)
  }).join(' ')
}

function publicBaseUrl(): string {
  return (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'https://avtohisob.uz')
    .replace(/\/$/, '')
}

/**
 * GET /receipts/:id/print — A5 chop etishga tayyor kvitansiya (HTML).
 * Foydalanuvchi Ctrl+P bilan PDF sifatida saqlaydi yoki bevosita chop etadi.
 */
export async function printReceipt(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params

    const receipt = await (prisma as any).ekoHisobReceipt.findUnique({
      where: { id },
      include: {
        entity: { select: { name: true, address: true, stir: true, contractNumber: true, orgId: true, districtId: true } },
        issuer: { select: { fullName: true } },
        payment: { select: { note: true, paidAt: true } },
      },
    })
    if (!receipt || receipt.orgId !== user.orgId) {
      res.status(404).send('Kvitansiya topilmadi')
      return
    }
    // Tuman nazorati: inspektor boshqa tuman tashkiloti kvitansiyasini chop eta olmaydi
    if (!canAccessEntity(user, receipt.entity)) {
      res.status(403).send('Ushbu tumanga kirish taqiqlangan')
      return
    }

    // QR yangi tasodifiy token havolasiga olib boradi (raqam ketma-ket — taxmin qilinadi).
    // Token yo'q eski kvitansiya (migratsiyadan oldin) — raqam havolasi (orqaga moslik).
    const verifyUrl = `${publicBaseUrl()}/ekohisob/kvitansiya/${encodeURIComponent(receipt.verifyToken || receipt.receiptNumber)}`
    const qr = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 220 })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(renderReceiptHtml({ receipt, qr, verifyUrl }))
  } catch (err) { next(err) }
}

function renderReceiptHtml({ receipt, qr, verifyUrl }: { receipt: any; qr: string; verifyUrl: string }): string {
  const paidAt = new Date(receipt.payment?.paidAt ?? receipt.issuedAt)
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(receipt.receiptNumber)}</title>
<style>
  @page { size: A5; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    margin: 0; padding: 12mm; color: #111; background: #f3f4f6;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet {
    max-width: 148mm; margin: 0 auto; background: #fff; padding: 10mm;
    border: 1px solid #e5e7eb; border-radius: 6px;
  }
  h1 { font-size: 15pt; margin: 0 0 2mm; text-align: center; letter-spacing: .3px; }
  .sub { text-align: center; color: #6b7280; font-size: 9pt; margin-bottom: 5mm; }
  .num {
    text-align: center; font-size: 12pt; font-weight: 700; color: #15803d;
    border: 1.5px dashed #86efac; border-radius: 6px; padding: 2mm; margin-bottom: 5mm;
  }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  td { padding: 1.6mm 0; vertical-align: top; }
  td.k { color: #6b7280; width: 34%; }
  td.v { font-weight: 600; }
  .amount {
    margin: 5mm 0; padding: 3mm; background: #f0fdf4; border-radius: 6px; text-align: center;
  }
  .amount .big { font-size: 17pt; font-weight: 800; color: #15803d; }
  .amount .words { font-size: 8.5pt; color: #4b5563; margin-top: 1mm; font-style: italic; }
  .foot { display: flex; gap: 4mm; align-items: center; margin-top: 6mm;
          border-top: 1px solid #e5e7eb; padding-top: 4mm; }
  .foot img { width: 24mm; height: 24mm; }
  .foot .txt { font-size: 7.5pt; color: #6b7280; line-height: 1.4; }
  .sign { margin-top: 6mm; display: flex; justify-content: space-between; font-size: 9pt; }
  .sign div { width: 45%; }
  .line { border-bottom: 1px solid #9ca3af; height: 7mm; }
  .cap { font-size: 7.5pt; color: #6b7280; text-align: center; margin-top: 1mm; }
  .btn {
    display: block; width: 100%; margin: 0 auto 5mm; max-width: 148mm;
    padding: 3mm; font-size: 11pt; font-weight: 600; color: #fff; background: #16a34a;
    border: 0; border-radius: 6px; cursor: pointer;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; border-radius: 0; padding: 0; max-width: none; }
    .btn { display: none; }
  }
</style>
</head>
<body>
<button class="btn" onclick="window.print()">🖨 Chop etish / PDF saqlash</button>
<div class="sheet">
  <h1>TO'LOV KVITANSIYASI</h1>
  <div class="sub">Maishiy chiqindi olib chiqish xizmati</div>
  <div class="num">${esc(receipt.receiptNumber)}</div>
  ${receipt.voidedAt ? `<div style="text-align:center;color:#b91c1c;font-weight:800;border:2px solid #b91c1c;border-radius:6px;padding:2mm;margin-bottom:4mm">
    BEKOR QILINGAN — ${uzDateTime(receipt.voidedAt)}${receipt.voidReason ? `<div style="font-weight:500;font-size:9pt">${esc(receipt.voidReason)}</div>` : ''}
  </div>` : ''}

  <table>
    <tr><td class="k">Tashkilot</td><td class="v">${esc(receipt.entity?.name)}</td></tr>
    ${receipt.entity?.stir ? `<tr><td class="k">STIR</td><td class="v">${esc(receipt.entity.stir)}</td></tr>` : ''}
    ${receipt.entity?.address ? `<tr><td class="k">Manzil</td><td class="v">${esc(receipt.entity.address)}</td></tr>` : ''}
    ${receipt.entity?.contractNumber ? `<tr><td class="k">Shartnoma</td><td class="v">${esc(receipt.entity.contractNumber)}</td></tr>` : ''}
    <tr><td class="k">To'lov davri</td><td class="v">${esc(fmtMonth(receipt.month))}</td></tr>
    <tr><td class="k">To'lov sanasi</td><td class="v">${uzDateTime(paidAt)}</td></tr>
    <tr><td class="k">Qabul qildi</td><td class="v">${esc(receipt.issuer?.fullName ?? '—')}</td></tr>
    ${receipt.payment?.note ? `<tr><td class="k">Izoh</td><td class="v">${esc(receipt.payment.note)}</td></tr>` : ''}
  </table>

  <div class="amount">
    <div class="big">${fmt(receipt.amount)} so'm</div>
    <div class="words">${esc(amountInWords(receipt.amount))} so'm</div>
  </div>

  <div class="sign">
    <div><div class="line"></div><div class="cap">Qabul qildi (imzo)</div></div>
    <div><div class="line"></div><div class="cap">To'lovchi (imzo)</div></div>
  </div>

  <div class="foot">
    <img src="${qr}" alt="QR">
    <div class="txt">
      <b>Kvitansiyani tekshirish</b><br>
      QR kodni telefon kamerasi bilan skanerlang yoki manzilga kiring:<br>
      ${esc(verifyUrl)}
    </div>
  </div>
</div>
</body>
</html>`
}

/** Tekshirish javobini yig'adi (shaxsiy ma'lumotsiz): bekor qilingan → voided, aks holda haqiqiy. */
/**
 * Xizmat ko'rsatuvchi korxonaning OMMAVIY aloqa ma'lumoti (nomi + telefoni) — mijoz kvitansiyani
 * tekshirgach kimga murojaat qilishni bilishi uchun. Bu korxona rekvizitlari (hujjatda ham bosiladi),
 * mijoz (to'lovchi) ma'lumoti emas. Sozlama yo'q bo'lsa null.
 */
async function loadIssuerPublic(orgId: string | null | undefined): Promise<{ name: string | null; phone: string | null }> {
  if (!orgId) return { name: null, phone: null }
  try {
    const s = await getOrgSettings(orgId)
    return { name: s.orgOfficialName ?? null, phone: s.orgPhone ?? s.contactPhone ?? null }
  } catch {
    return { name: null, phone: null }
  }
}

function verifyPayload(receipt: any, issuer: { name: string | null; phone: string | null } = { name: null, phone: null }) {
  if (receipt.voidedAt) {
    return {
      valid: false, voided: true, voidedAt: receipt.voidedAt, receiptNumber: receipt.receiptNumber,
      issuerName: issuer.name, issuerPhone: issuer.phone,
    }
  }
  return {
    valid: true,
    voided: false,
    receiptNumber: receipt.receiptNumber,
    amount: receipt.amount,
    month: receipt.month,
    monthLabel: fmtMonth(receipt.month),
    issuedAt: receipt.issuedAt,
    entityMasked: maskName(receipt.entity?.name ?? ''),
    issuerName: issuer.name,
    issuerPhone: issuer.phone,
  }
}

const VERIFY_SELECT = {
  receiptNumber: true, amount: true, month: true, issuedAt: true, voidedAt: true, orgId: true,
  entity: { select: { name: true } },
}

/**
 * GET /receipts/verify-token/:token — OCHIQ endpoint (autentifikatsiyasiz, rate-limit).
 * Tasodifiy token (144 bit) bo'yicha — taxmin qilib bo'lmaydi, tashkilotlararo to'qnashuv yo'q.
 * Faqat haqiqiylikni tasdiqlaydi: summa, davr, sana; tashkilot nomi MASKALANADI.
 */
export async function verifyReceiptByToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = String(req.params.token ?? '').trim()
    if (!isValidVerifyToken(token)) {
      res.status(400).json({ success: false, error: "Token formati noto'g'ri" })
      return
    }
    const receipt = await (prisma as any).ekoHisobReceipt.findUnique({
      where: { verifyToken: token }, select: VERIFY_SELECT,
    })
    res.json({ success: true, data: receipt ? verifyPayload(receipt, await loadIssuerPublic(receipt.orgId)) : { valid: false } })
  } catch (err) { next(err) }
}

/**
 * GET /receipts/verify/:number — OCHIQ endpoint (autentifikatsiyasiz, rate-limit).
 *
 * `:number` — eski bosilgan kvitansiyalardagi QR (raqam) YOKI yangi token (ikkalasi ham
 * qo'llab-quvvatlanadi, frontend sahifasi o'zgarmaydi).
 * Raqam bo'yicha: raqam orgga xos (har korxonada EKO-2026-00001 bor), shuning uchun faqat
 * BUTUN bazada aynan bitta kvitansiyaga mos kelsa tasdiqlanadi; bir nechta bo'lsa
 * {valid:false, ambiguous:true} — boshqa tashkilot ma'lumoti ko'rsatilmaydi.
 */
export async function verifyReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const param = String(req.params.number ?? '').trim()
    const parsed = parseReceiptNumber(param)

    if (!parsed) {
      if (isValidVerifyToken(param)) {
        const byToken = await (prisma as any).ekoHisobReceipt.findUnique({
          where: { verifyToken: param }, select: VERIFY_SELECT,
        })
        res.json({ success: true, data: byToken ? verifyPayload(byToken, await loadIssuerPublic(byToken.orgId)) : { valid: false } })
        return
      }
      res.status(400).json({ success: false, error: "Kvitansiya raqami formati noto'g'ri" })
      return
    }

    const number = param.toUpperCase()
    const found = await (prisma as any).ekoHisobReceipt.findMany({
      where: { receiptNumber: number }, select: VERIFY_SELECT, take: 2,
    })
    if (found.length === 0) {
      res.json({ success: true, data: { valid: false } })
      return
    }
    if (found.length > 1) {
      res.json({ success: true, data: { valid: false, ambiguous: true } })
      return
    }
    res.json({ success: true, data: verifyPayload(found[0], await loadIssuerPublic(found[0].orgId)) })
  } catch (err) { next(err) }
}
