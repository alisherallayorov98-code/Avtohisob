/**
 * Bakdagi yoqilg'i anomaliyalarini aniqlash.
 *
 * Har bir yangi FuelReading saqlanganda chaqiriladi. Avvalgi qiymat bilan
 * solishtirib, sliv/zapravka/qayd etilmagan zapravka holatini topadi.
 *
 * Anti-spam:
 *   - Bir mashina + bir tur anomaliya 30 daqiqada bir marta xabar yuboradi
 *     (TelegramAlertDedupe jadvali sendToOrgAdminsFiltered ichida ham ishlaydi)
 *   - Anomaliya FuelReading.anomaly maydoniga yoziladi (UI/grafikda ko'rinishi uchun)
 *
 * Dizayn: pure function, Telegram side-effect optional. Test qilish oson.
 */
import { prisma } from './prisma'
import { sendToOrgAdminsFiltered } from '../services/telegramBot'

// Anomaliya turlari (FuelReading.anomaly maydoniga yoziladi)
export type FuelAnomalyType = 'theft' | 'refuel' | 'unrecorded_refuel'

// Detektor parametrlari — keyinchalik OrgSettings'ga ko'chirish mumkin
const THRESHOLDS = {
  // Sliv: yoqilg'i pasayish darajasi (litr/daqiqa). Oddiy diesel sarfi
  // <0.5 L/min bo'ladi (30 L/soat 60 km/soat tezlikda). 1+ L/min — shubhali.
  THEFT_RATE_L_PER_MIN: 1.0,
  // Sliv minimal pasayish (litr) — kichik o'zgarishlar shovqin bo'lishi mumkin
  THEFT_MIN_DROP_L: 5,
  // Sliv maksimal vaqt oraligi (daqiqa) — keyingi snapshot kechiksa shovqin
  THEFT_MAX_GAP_MIN: 60,

  // Zapravka: yoqilg'i ko'tarilishi (litr). 5 litr — kichik kanistra ham hisobga.
  REFUEL_MIN_RISE_L: 5,
  REFUEL_MAX_GAP_MIN: 60,

  // FuelRecord cross-check vaqti (zapravka chegi bilan ±N daqiqada)
  FUEL_RECORD_WINDOW_MIN: 30,
}

interface DetectInput {
  vehicleId: string
  newLevel: number       // hozirgi qiymat (litr)
  newCapturedAt: Date    // hozirgi snapshot vaqti
}

interface DetectResult {
  anomaly: FuelAnomalyType | null
  // Telegram alert uchun matn (anomaliya bo'lsa)
  alertText?: string
  // Anomaliyaning miqdoriy tafsilotlari (logging/UI uchun)
  details?: {
    deltaL: number       // miqdor o'zgarishi
    deltaMin: number     // vaqt o'zgarishi (daqiqa)
    rate?: number        // litr/daqiqa (sliv uchun)
    matchedFuelRecordId?: string // zapravka qayd etilgan bo'lsa
  }
}

/**
 * Bitta mashina uchun yangi snapshot bilan oldingi snapshotni solishtirib
 * anomaliyani aniqlaydi. DB ga hech narsa yozmaydi — natijani qaytaradi.
 */
export async function detectFuelAnomaly(input: DetectInput): Promise<DetectResult> {
  const { vehicleId, newLevel, newCapturedAt } = input

  // Oldingi yozuv (eng yangi)
  const prev = await (prisma as any).fuelReading.findFirst({
    where: { vehicleId },
    orderBy: { capturedAt: 'desc' },
    select: { level: true, capturedAt: true },
  })

  if (!prev) return { anomaly: null }  // birinchi yozuv

  const prevLevel = Number(prev.level)
  const prevAt = new Date(prev.capturedAt).getTime()
  const newAt = newCapturedAt.getTime()
  const deltaMin = (newAt - prevAt) / 60000
  const deltaL = newLevel - prevLevel

  // Vaqt teskari yoki juda yaqin (1 daqiqadan kam) — atomik
  if (deltaMin < 1) return { anomaly: null }

  // ─── SLIV (THEFT) ──────────────────────────────────────────────────────────
  // Yoqilg'i tezlik bilan pasaygan, va vaqt oralig'i mantiqli (≤60 min)
  if (deltaL <= -THRESHOLDS.THEFT_MIN_DROP_L && deltaMin <= THRESHOLDS.THEFT_MAX_GAP_MIN) {
    const rate = Math.abs(deltaL) / deltaMin  // L/min
    if (rate >= THRESHOLDS.THEFT_RATE_L_PER_MIN) {
      const drop = Math.abs(deltaL).toFixed(1)
      const minutes = Math.round(deltaMin)
      return {
        anomaly: 'theft',
        alertText:
          `🚨 <b>Yoqilg'i SLIV ehtimoli</b>\n` +
          `Bakdan ${drop} L ${minutes} daqiqada pasaydi (${rate.toFixed(1)} L/daq)\n` +
          `Bu oddiy sarfdan yuqori — mashinani tekshiring.`,
        details: { deltaL, deltaMin, rate },
      }
    }
  }

  // ─── ZAPRAVKA (REFUEL) ─────────────────────────────────────────────────────
  if (deltaL >= THRESHOLDS.REFUEL_MIN_RISE_L && deltaMin <= THRESHOLDS.REFUEL_MAX_GAP_MIN) {
    // Zapravka chegi bormi tekshirish (cross-check)
    const windowMs = THRESHOLDS.FUEL_RECORD_WINDOW_MIN * 60_000
    const fuelRecord = await prisma.fuelRecord.findFirst({
      where: {
        vehicleId,
        refuelDate: {
          gte: new Date(newAt - windowMs),
          lte: new Date(newAt + windowMs),
        },
      },
      select: { id: true, amountLiters: true },
    })

    const liters = deltaL.toFixed(1)
    if (fuelRecord) {
      // Chek bor — qonuniy zapravka
      return {
        anomaly: 'refuel',
        // Telegram alertsiz — qonuniy zapravka, alert kerak emas
        details: { deltaL, deltaMin, matchedFuelRecordId: fuelRecord.id },
      }
    } else {
      // Chek yo'q — shubhali zapravka
      return {
        anomaly: 'unrecorded_refuel',
        alertText:
          `⚠️ <b>Qayd etilmagan zapravka</b>\n` +
          `Bakka ${liters} L qo'shildi, lekin shu davrda chek topilmadi.\n` +
          `Haydovchi cheksiz yoqilg'i quygan bo'lishi mumkin.`,
        details: { deltaL, deltaMin },
      }
    }
  }

  return { anomaly: null }
}

/**
 * Anomaliya aniqlangan bo'lsa Telegram alert yuboradi.
 * Anti-spam: sendToOrgAdminsFiltered ichida 24 soatlik dedupe qo'llaniladi
 * (TelegramAlertDedupe jadvali). Lekin biz fuel uchun 30 daqiqaga qisqartiramiz.
 *
 * @param driverInfo — anomaliya vaqtidagi haydovchi (Waybill cross-check)
 */
export async function sendFuelAlertIfNeeded(
  vehicleId: string,
  result: DetectResult,
  driverInfo?: { fullName: string } | null,
): Promise<void> {
  if (!result.anomaly || !result.alertText) return

  // Vehicle va branch ma'lumotini olamiz
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true, registrationNumber: true, brand: true, model: true,
      branch: { select: { id: true, organizationId: true } },
    },
  })
  if (!vehicle?.branch) return

  // OrgId — branch.organizationId yoki branch.id (root tashkilot bo'lsa)
  const orgId = vehicle.branch.organizationId || vehicle.branch.id

  // Telegram xabari: alert + mashina + (agar bor bo'lsa) haydovchi
  let headerText =
    `${result.alertText}\n` +
    `\n🚛 <b>${vehicle.registrationNumber}</b> · ${vehicle.brand} ${vehicle.model}`
  if (driverInfo?.fullName) {
    headerText += `\n👤 <b>Haydovchi:</b> ${driverInfo.fullName} (yo'l varaqasida)`
  }

  await sendToOrgAdminsFiltered(
    orgId,
    'fuelAnomaly',                                  // TelegramNotificationPref maydoni
    vehicleId,
    vehicle.branch.id,
    headerText,
    `/fuel-monitoring`,
  ).catch(err => {
    console.warn('[fuelAnomaly] Telegram yuborib bo\'lmadi:', err.message)
  })
}

/**
 * Mashina uchun berilgan vaqtda faol bo'lgan haydovchini topadi.
 * Waybill jadvalidan: status='active' va actualDeparture <= time
 * va (actualReturn IS NULL OR actualReturn >= time).
 *
 * Topilmagan holat normal: ba'zi mashinalar har vaqt yo'l varaqasi
 * ostida ishlamaydi (filial ichida).
 */
export async function lookupActiveDriver(
  vehicleId: string,
  time: Date,
): Promise<{ id: string; fullName: string } | null> {
  try {
    const waybill = await prisma.waybill.findFirst({
      where: {
        vehicleId,
        status: 'active',
        actualDeparture: { lte: time },
        OR: [
          { actualReturn: null },
          { actualReturn: { gte: time } },
        ],
      },
      orderBy: { actualDeparture: 'desc' },
      select: {
        driver: { select: { id: true, fullName: true } },
      },
    })
    return waybill?.driver ?? null
  } catch {
    return null
  }
}

/**
 * Eski FuelReading yozuvlarini tozalash (30 kundan eski).
 * Scheduler'da kuniga 1 marta chaqiriladi.
 */
export async function cleanupOldFuelReadings(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const result = await (prisma as any).fuelReading.deleteMany({
    where: { capturedAt: { lt: cutoff } },
  })
  return { deleted: result.count }
}
