import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Wand2, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import {
  Card, CardHeader, CardBody, Modal, Button, Badge, Banner, Field, Input, Select, Toggle,
  SkeletonList, EmptyState, f,
} from '../../ui'
import { Direction, Indicator, MetricDef, Scheme, errMsg, fmtValue } from './types'

/** KPI sozlash: bonus parametrlari + ko'rsatkichlar ro'yxati (avtomatik va qo'lda). */
export default function KpiSchemeTab({ onChanged }: { onChanged: () => void }) {
  const [scheme, setScheme] = useState<Scheme | null>(null)
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const [metrics, setMetrics] = useState<MetricDef[]>([])
  const [editing, setEditing] = useState<Indicator | 'new' | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await ekoApi.get('/kpi/scheme')
      setScheme(res.data.data.scheme)
      setIndicators(res.data.data.indicators)
      setMetrics(res.data.data.metrics)
      setError('')
    } catch (e) { setError(errMsg(e, "Sozlamalarni yuklab bo'lmadi")) }
  }, [])
  useEffect(() => { load() }, [load])

  const changed = () => { load(); onChanged() }

  if (error) return <Banner tone="danger">{error}</Banner>
  if (!scheme) return <SkeletonList rows={4} />

  const active = indicators.filter(i => i.isActive)
  const weightSum = active.reduce((s, i) => s + i.weight, 0)

  async function seed() {
    try {
      const res = await ekoApi.post('/kpi/indicators/seed-defaults')
      toast.success(res.data.data.added ? `${res.data.data.added} ta ko'rsatkich qo'shildi` : "Hammasi allaqachon qo'shilgan")
      changed()
    } catch (e) { toast.error(errMsg(e)) }
  }

  async function toggleActive(i: Indicator, v: boolean) {
    try { await ekoApi.put(`/kpi/indicators/${i.id}`, { isActive: v }); changed() }
    catch (e) { toast.error(errMsg(e)) }
  }

  return (
    <div className="space-y-4">
      <BonusForm scheme={scheme} onSaved={changed} />

      <Card flush>
        <CardHeader
          title="Ko'rsatkichlar"
          hint={`Faol vaznlar yig'indisi: ${weightSum}%`}
          actions={
            <>
              {active.length === 0 && (
                <Button size="sm" icon={<Wand2 className="w-4 h-4" />} onClick={seed}>Standart to'plam</Button>
              )}
              <Button size="sm" variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing('new')}>
                Ko'rsatkich
              </Button>
            </>
          }
        />
        {weightSum !== 100 && active.length > 0 && (
          <div className="px-4 pt-3">
            <Banner tone="info">
              Vaznlar yig'indisi {weightSum}% (100% emas). Hisob baribir to'g'ri ishlaydi — ball vaznlarga nisbatan
              normallashtiriladi, lekin 100% bo'lsa tushunish osonroq.
            </Banner>
          </div>
        )}
        {indicators.length === 0 ? (
          <EmptyState
            title="Ko'rsatkich yo'q"
            hint="«Standart to'plam» tugmasi yig'im, yangi tashkilotlar, plan va boshqa tayyor ko'rsatkichlarni qo'shadi. Keyin vazn va maqsadlarni o'zingiz o'zgartirasiz."
          />
        ) : (
          <ul className="divide-y divide-eko-line">
            {indicators.map(i => (
              <li key={i.id} className={`px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${i.isActive ? '' : 'opacity-50'}`}>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium text-eko-text flex items-center gap-2 flex-wrap">
                    {i.name}
                    <Badge tone={i.kind === 'auto' ? 'info' : 'neutral'}>{i.kind === 'auto' ? 'Avtomatik' : "Qo'lda"}</Badge>
                  </p>
                  <p className="text-xs text-eko-muted">
                    Maqsad: {fmtValue(i.target, i.unit)}{i.direction === 'lower' ? ' (ko\'pi bilan)' : ''} · vazn {i.weight}%
                  </p>
                </div>
                <Toggle checked={i.isActive} onChange={v => toggleActive(i, v)} label="Faol" />
                <Button size="sm" icon={<Pencil className="w-4 h-4" />} onClick={() => setEditing(i)}>Tahrirlash</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Banner tone="info">
        <span className="flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Sozlamalar faqat <b>ochiq</b> oylar natijasiga ta'sir qiladi. Yopilgan oy natijalari qotiriladi va keyin
            sxema o'zgarsa ham buzilmaydi.
          </span>
        </span>
      </Banner>

      {editing && (
        <IndicatorModal
          indicator={editing === 'new' ? null : editing}
          metrics={metrics}
          taken={new Set(indicators.filter(i => i.kind === 'auto' && i.isActive).map(i => i.metric as string))}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); changed() }}
        />
      )}
    </div>
  )
}

function BonusForm({ scheme, onSaved }: { scheme: Scheme; onSaved: () => void }) {
  const [bonusMax, setBonusMax] = useState(String(scheme.bonusMax))
  const [minScore, setMinScore] = useState(String(scheme.minScore))
  const [cap, setCap] = useState(String(scheme.capPercent))
  const [busy, setBusy] = useState(false)

  const dirty = bonusMax !== String(scheme.bonusMax) || minScore !== String(scheme.minScore) || cap !== String(scheme.capPercent)

  async function save() {
    setBusy(true)
    try {
      await ekoApi.put('/kpi/scheme', { bonusMax: Number(bonusMax), minScore: Number(minScore), capPercent: Number(cap) })
      toast.success('Saqlandi')
      onSaved()
    } catch (e) { toast.error(errMsg(e)) }
    finally { setBusy(false) }
  }

  const max = Number(bonusMax) || 0
  return (
    <Card flush>
      <CardHeader title="Bonus qoidasi" hint="Har bir inspektor uchun oylik bonus shu qoida bilan hisoblanadi" />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Eng yuqori bonus (so'm)" hint="100% bajarilganda beriladi">
            {id => <Input id={id} inputMode="numeric" value={bonusMax} onChange={e => setBonusMax(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="Minimal ball (%)" hint="Shundan past ballda bonus berilmaydi">
            {id => <Input id={id} inputMode="numeric" value={minScore} onChange={e => setMinScore(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="Ball chegarasi (%)" hint="100–200. Ortiqcha bajarish shu darajagacha hisoblanadi">
            {id => <Input id={id} inputMode="numeric" value={cap} onChange={e => setCap(e.target.value.replace(/\D/g, ''))} />}
          </Field>
        </div>
        <p className="text-xs text-eko-muted">
          Misol: 85 ball → {f.money(Math.round((max * 85) / 100))}
          {Number(minScore) > 85 ? ' (minimal balldan past — bonus yo\'q)' : ''}; 100 ball → {f.money(max)};
          {' '}{Math.min(Number(cap) || 120, 200)} ball → {f.money(Math.round((max * (Math.min(Number(cap) || 120, 200))) / 100))}.
        </p>
        <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Saqlash</Button>
      </CardBody>
    </Card>
  )
}

function IndicatorModal({
  indicator, metrics, taken, onClose, onSaved,
}: {
  indicator: Indicator | null
  metrics: MetricDef[]
  taken: Set<string>
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = indicator === null
  const available = metrics.filter(m => !taken.has(m.key))
  const [kind, setKind] = useState<'auto' | 'manual'>(indicator?.kind ?? (available.length ? 'auto' : 'manual'))
  const [metric, setMetric] = useState(indicator?.metric ?? available[0]?.key ?? '')
  const def = metrics.find(m => m.key === metric)

  const [name, setName] = useState(indicator?.name ?? '')
  const [unit, setUnit] = useState(indicator?.unit ?? '')
  const [direction, setDirection] = useState<Direction>(indicator?.direction ?? 'higher')
  const [target, setTarget] = useState(indicator ? String(indicator.target) : (def ? String(def.defaultTarget) : ''))
  const [weight, setWeight] = useState(indicator ? String(indicator.weight) : (def ? String(def.defaultWeight || 10) : '10'))
  const [busy, setBusy] = useState(false)

  const lockedAuto = (isNew && kind === 'auto') || indicator?.kind === 'auto'

  function pickMetric(key: string) {
    setMetric(key)
    const d = metrics.find(m => m.key === key)
    if (d) { setTarget(String(d.defaultTarget)); setWeight(String(d.defaultWeight || 10)) }
  }

  async function save() {
    setBusy(true)
    try {
      const body: any = { name: name.trim() || def?.label, target: Number(target), weight: Number(weight) }
      if (isNew) {
        await ekoApi.post('/kpi/indicators', { ...body, kind, metric: kind === 'auto' ? metric : undefined, unit, direction })
      } else {
        await ekoApi.put(`/kpi/indicators/${indicator!.id}`, { ...body, unit, direction })
      }
      toast.success('Saqlandi')
      onSaved()
    } catch (e) { toast.error(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal
      onClose={onClose}
      title={isNew ? "Yangi ko'rsatkich" : "Ko'rsatkichni tahrirlash"}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Bekor</Button>
          <Button variant="primary" loading={busy} onClick={save}
            disabled={!Number(weight) && weight !== '0' || !target || (kind === 'manual' && !name.trim())}>
            Saqlash
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {isNew && (
          <Field label="Turi">
            {id => (
              <Select id={id} value={kind} onChange={e => setKind(e.target.value as 'auto' | 'manual')}>
                <option value="auto" disabled={available.length === 0}>Avtomatik — tizim bazadan hisoblaydi</option>
                <option value="manual">Qo'lda — admin har oy qiymat kiritadi</option>
              </Select>
            )}
          </Field>
        )}

        {isNew && kind === 'auto' && (
          <Field label="Ko'rsatkich" hint={def?.hint}>
            {id => (
              <Select id={id} value={metric} onChange={e => pickMetric(e.target.value)}>
                {available.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </Select>
            )}
          </Field>
        )}

        <Field label="Nomi" required={kind === 'manual'}>
          {id => <Input id={id} value={name} placeholder={def?.label} onChange={e => setName(e.target.value)} />}
        </Field>

        {!lockedAuto && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Birlik" hint="Masalan: ball, ta, %">
              {id => <Input id={id} value={unit} onChange={e => setUnit(e.target.value)} />}
            </Field>
            <Field label="Yo'nalish">
              {id => (
                <Select id={id} value={direction} onChange={e => setDirection(e.target.value as Direction)}>
                  <option value="higher">Ko'p — yaxshi</option>
                  <option value="lower">Kam — yaxshi</option>
                </Select>
              )}
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Maqsad${(def?.unit ?? unit) ? ` (${def?.unit ?? unit})` : ''}`} required
            hint={direction === 'lower' || def?.direction === 'lower' ? "Ruxsat etilgan eng ko'p qiymat" : '100% shu qiymatda'}>
            {id => <Input id={id} inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} />}
          </Field>
          <Field label="Vazn (%)" required hint="0 — hisobga olinmaydi">
            {id => <Input id={id} inputMode="numeric" value={weight} onChange={e => setWeight(e.target.value.replace(/\D/g, ''))} />}
          </Field>
        </div>
      </div>
    </Modal>
  )
}
