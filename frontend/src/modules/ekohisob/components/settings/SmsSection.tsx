import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { ekoKeys } from '../../lib/queries'
import {
  Card, CardHeader, CardBody, Field, Input, Select, Textarea, Toggle, Button, Banner, StatRow, StatTile, f,
} from '../../ui'
import type { SectionProps, SmsPreview } from './types'

interface SmsStatus { used: number; limit: number; remaining: number; usedSms?: number; dailyMax?: number; usedToday?: number; unit?: string }
interface Effectiveness { windowDays: number; evaluated: number; paid: number; ratePercent: number | null; paidAmount: number; days: number }

/**
 * SMS bo'limi: qo'lda/avtomatik rejim, shablon (jonli preview + segment hisobi),
 * limit SEGMENTLARDA va SMS samaradorligi.
 */
export default function SmsSection({ data, onSaved }: SectionProps) {
  const [auto, setAuto] = useState(data.smsAutoEnabled)
  const [day, setDay] = useState(String(data.smsAutoDay))
  const [level, setLevel] = useState(data.smsAutoMinLevel)
  const [dailyMax, setDailyMax] = useState(String(data.smsDailyMax))
  const [phone, setPhone] = useState(data.contactPhone ?? '')
  const [template, setTemplate] = useState<string | null>(data.smsTemplate)
  const [preview, setPreview] = useState<SmsPreview | null>(data.smsPreview ?? null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setAuto(data.smsAutoEnabled); setDay(String(data.smsAutoDay)); setLevel(data.smsAutoMinLevel)
    setDailyMax(String(data.smsDailyMax)); setPhone(data.contactPhone ?? ''); setTemplate(data.smsTemplate)
    setPreview(data.smsPreview ?? null)
  }, [data])

  // Shablon yozilganda jonli oldindan ko'rish (necha segment ketishi bilan)
  useEffect(() => {
    const t = window.setTimeout(() => {
      ekoApi.post('/settings/sms-preview', { smsTemplate: template, contactPhone: phone || null })
        .then(res => setPreview(res.data.data))
        .catch(() => { /* preview — qo'shimcha; asosiy forma ishlashda davom etadi */ })
    }, 400)
    return () => window.clearTimeout(t)
  }, [template, phone])

  const status = useQuery<SmsStatus>({
    queryKey: [...ekoKeys.settings, 'sms-status'],
    queryFn: async () => (await ekoApi.get('/reminders/status')).data.data,
    staleTime: 30_000,
  })
  const eff = useQuery<Effectiveness>({
    queryKey: [...ekoKeys.settings, 'sms-effectiveness'],
    queryFn: async () => (await ekoApi.get('/reminders/effectiveness?days=90')).data.data,
    staleTime: 60_000,
  })

  const dayN = Number(day)
  const dayOk = Number.isInteger(dayN) && dayN >= 1 && dayN <= 28
  const maxN = Number(dailyMax)
  const maxOk = Number.isInteger(maxN) && maxN >= 1 && maxN <= 5000
  const hasError = !!preview?.issues?.some(i => i.level === 'error')
  const dirty = auto !== data.smsAutoEnabled || day !== String(data.smsAutoDay) || level !== data.smsAutoMinLevel
    || dailyMax !== String(data.smsDailyMax) || (phone || null) !== (data.contactPhone ?? null) || template !== data.smsTemplate

  async function save() {
    setSaving(true)
    try {
      await ekoApi.put('/settings', {
        smsAutoEnabled: auto, smsAutoDay: dayN, smsAutoMinLevel: level, smsDailyMax: maxN,
        smsTemplate: template, contactPhone: phone.trim() || null,
      })
      toast.success('SMS sozlamalari saqlandi')
      status.refetch()
      onSaved()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  const s = status.data
  const pct = s && s.limit > 0 ? Math.min(100, Math.round(s.used * 100 / s.limit)) : 0

  return (
    <div className="space-y-4">
      {!data.smsConfigured && (
        <Banner tone="warn">
          SMS xizmati (Eskiz.uz) hali sozlanmagan — quyidagi sozlamalar saqlanadi, lekin SMS yuborilmaydi. Ulash uchun bog'laning.
        </Banner>
      )}

      <Card flush>
        <CardHeader
          title="Limit va samaradorlik"
          hint="Limit SMS soni bilan emas, SEGMENTLAR bilan hisoblanadi (uzun matn bir necha segment)"
        />
        <CardBody className="space-y-4">
          <StatRow cols={3}>
            <StatTile
              loading={status.isLoading}
              label="Bu oy ishlatilgan"
              value={f.num(s?.used ?? 0)}
              unit={`/ ${f.num(s?.limit ?? data.smsMonthlyLimit)} segment`}
              hint={s?.usedSms != null ? `${f.num(s.usedSms)} ta SMS` : undefined}
            />
            <StatTile
              loading={status.isLoading}
              label="Bugun yuborilgan"
              value={f.num(s?.usedToday ?? 0)}
              unit={`/ ${f.num(s?.dailyMax ?? data.smsDailyMax)} segment`}
            />
            <StatTile
              loading={eff.isLoading}
              label="SMSdan keyin to'laganlar"
              value={eff.data?.ratePercent == null ? '—' : `${eff.data.ratePercent}%`}
              hint={eff.data
                ? (eff.data.evaluated > 0
                  ? `${f.num(eff.data.paid)} / ${f.num(eff.data.evaluated)} tashkilot, ${eff.data.windowDays} kun ichida (oxirgi ${eff.data.days} kun)`
                  : "Baholash uchun hali yetarli SMS yo'q")
                : undefined}
            />
          </StatRow>
          {s && (
            <div className="h-1.5 rounded-full bg-eko-surface-2 overflow-hidden" role="img" aria-label={`Oylik limit ${pct}%`}>
              <div className={`h-full rounded-full ${pct >= 90 ? 'bg-eko-warn' : 'bg-eko-text-2'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {status.isError && <Banner tone="danger">Limitni yuklab bo'lmadi: {errMsg(status.error)}</Banner>}
          {eff.isError && <Banner tone="danger">Samaradorlikni yuklab bo'lmadi: {errMsg(eff.error)}</Banner>}
          <p className="eko-text-xs text-eko-muted">Oylik limitni korxona o'zgartira olmaydi.</p>
        </CardBody>
      </Card>

      <Card flush>
        <CardHeader
          title="Eslatma rejimi va matn"
          actions={<Button variant="primary" size="sm" loading={saving} disabled={!dirty || !dayOk || !maxOk || hasError} onClick={save}>Saqlash</Button>}
        />
        <CardBody className="space-y-5">
          <Toggle
            checked={auto}
            onChange={setAuto}
            label="Avtomatik eslatma"
            hint={auto
              ? `Har oy ${dayN || '…'}-kuni qarzdorlarga avtomatik yuboriladi${data.smsAutoLastMonth ? ` (oxirgi yuborilgan oy: ${f.monthLabel(data.smsAutoLastMonth)})` : ''}`
              : "O'chiq: SMS faqat tashkilot kartochkasidan qo'lda yuboriladi"}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Oyning qaysi kuni" hint="1–28 (fevralda ham ishlashi uchun)" error={dayOk ? null : '1 dan 28 gacha'}>
              <Input type="number" inputMode="numeric" min={1} max={28} value={day} disabled={!auto} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Kimga yuborilsin">
              <Select value={level} disabled={!auto} onChange={(e) => setLevel(e.target.value)}>
                <option value="warning">1 oy va undan ko'p qarzdorlarga</option>
                <option value="overdue">2 oy va undan ko'p qarzdorlarga</option>
                <option value="critical">Faqat 3+ oy qarzdorlarga</option>
              </Select>
            </Field>
            <Field label="Kuniga maksimal (segment)" error={maxOk ? null : '1 dan 5000 gacha'}>
              <Input type="number" inputMode="numeric" min={1} max={5000} value={dailyMax} onChange={(e) => setDailyMax(e.target.value)} />
            </Field>
          </div>

          <Field label="Aloqa raqami (SMS matnida)">
            <Input className="sm:max-w-xs" value={phone} placeholder="901234567" onChange={(e) => setPhone(e.target.value)} />
          </Field>

          <Field
            label="SMS matni"
            hint={`O'rin egallovchilar: ${data.smsPlaceholders.map(p => `{${p}}`).join(', ')}`}
          >
            <Textarea rows={3} value={template ?? data.smsTemplateDefault} onChange={(e) => setTemplate(e.target.value)} />
          </Field>
          <div>
            <Button variant="ghost" size="sm" disabled={template === null} onClick={() => setTemplate(null)}>Standart matnga qaytarish</Button>
          </div>

          {preview && (
            <div className="rounded-eko-lg border border-eko-line bg-eko-surface-2 p-3 space-y-2">
              <p className="eko-text-sm font-medium text-eko-text">Namuna (qarzdor shu matnni oladi)</p>
              <p className="eko-text-base text-eko-text bg-eko-surface rounded-eko p-2.5 border border-eko-line">{preview.text}</p>
              <p className="eko-text-sm text-eko-muted eko-num">
                {preview.chars} belgi · <b className="text-eko-text">{preview.segments} segment</b>
                {preview.unicode && " · kirill/maxsus belgi (70 belgi/segment)"}
              </p>
              {preview.issues?.map((i, idx) => (
                <p key={idx} className={`eko-text-sm ${i.level === 'error' ? 'text-eko-danger' : 'text-eko-warn'}`}>{i.message}</p>
              ))}
            </div>
          )}

          <Banner tone="info">
            Eskiz.uz real rejimida faqat <b>oldindan tasdiqlangan</b> matn yuboriladi. Shablonni o'zgartirsangiz, yangi matnni Eskiz.uz kabinetida qayta tasdiqlatish kerak — aks holda SMS yuborilmaydi.
          </Banner>
        </CardBody>
      </Card>
    </div>
  )
}
