import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import {
  Card, Modal, Button, IconButton, Badge, Banner, Field, Input, Textarea, EmptyState, DataTable, f, useConfirm,
} from '../../ui'
import { ScoreBar } from './ScoreBar'
import { MonthResults, UserResult, errMsg, errBody, adjustLimitMessage, fmtValue } from './types'

/** Natijalar jadvali. Tartib — alifbo bo'yicha (reyting emas: xodimlar o'rtasida o'rin talashmasin). */
export default function KpiResultsTab({ data, reload }: { data: MonthResults; reload: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = data.rows.find(r => r.userId === openId) ?? null
  const { scheme } = data

  if (data.indicators.filter(i => i.weight > 0).length === 0) {
    return (
      <Card>
        <EmptyState
          title="Ko'rsatkichlar sozlanmagan"
          hint="«Sozlash» bo'limida ko'rsatkichlar va bonus miqdorini belgilang."
        />
      </Card>
    )
  }
  if (data.rows.length === 0) {
    return (
      <Card>
        <EmptyState title="Faol inspektor yo'q" hint="KPI inspektor rolidagi xodimlar uchun hisoblanadi." />
      </Card>
    )
  }

  return (
    <>
      <Card flush>
        <DataTable
          aria-label="KPI natijalari"
          rows={data.rows}
          rowKey={(r) => r.userId}
          onRowClick={(r) => setOpenId(r.userId)}
          columns={[
            { key: 'fullName', title: 'Xodim', render: (r) => <span className="font-medium">{r.fullName}</span> },
            {
              key: 'score', title: 'Ball', width: 220,
              render: (r) => <ScoreBar score={r.score} minScore={scheme.minScore} max={scheme.capPercent} />,
            },
            { key: 'bonus', title: "Bonus, so'm", align: 'right', render: (r) => f.num(r.bonus) },
            {
              key: 'state', title: 'Holat', mobile: 'secondary',
              render: (r) => (
                <div className="flex gap-1.5 flex-wrap">
                  {r.missingCount > 0 && <Badge tone="warn">{r.missingCount} ta kiritilmagan</Badge>}
                  {r.adjustments.length > 0 && <Badge tone="info">Tuzatilgan</Badge>}
                  {r.score < scheme.minScore && <Badge tone="neutral">Bonus yo'q</Badge>}
                </div>
              ),
            },
          ]}
          footer={{ fullName: 'Jami bonus', bonus: f.num(data.totalBonus) }}
        />
      </Card>

      {open && <UserDetail row={open} data={data} onClose={() => setOpenId(null)} reload={reload} />}
    </>
  )
}

// ─── Xodim tafsiloti: ko'rsatkichlar, qo'lda kiritish, tuzatishlar ──────────────
function UserDetail({
  row, data, onClose, reload,
}: { row: UserResult; data: MonthResults; onClose: () => void; reload: () => void }) {
  const confirm = useConfirm()
  const closed = data.status === 'closed'
  const manualIds = new Set(data.indicators.filter(i => i.kind === 'manual').map(i => i.id))

  // Qo'lda kiritiladigan qiymatlar (matn sifatida — bo'sh = o'chirish)
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => {
    const d: Record<string, string> = {}
    for (const it of row.items) if (manualIds.has(it.id)) d[it.id] = it.value === null ? '' : String(it.value)
    setDraft(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.userId, data.month, row.items.length])

  async function saveEntry(indicatorId: string) {
    const current = row.items.find(i => i.id === indicatorId)?.value
    const next = draft[indicatorId]?.trim() ?? ''
    if ((current === null && next === '') || String(current) === next) return
    try {
      await ekoApi.put('/kpi/entries', {
        indicatorId, userId: row.userId, month: data.month, value: next === '' ? null : Number(next),
      })
      reload()
    } catch (e) { toast.error(errMsg(e)) }
  }

  // Tuzatish formasi
  const [points, setPoints] = useState('')
  const [bonusDelta, setBonusDelta] = useState('')
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)

  async function addAdjustment() {
    setAdding(true)
    try {
      await ekoApi.post('/kpi/adjustments', {
        userId: row.userId, month: data.month,
        points: Number(points) || 0, bonusDelta: Number(bonusDelta) || 0, reason,
      })
      setPoints(''); setBonusDelta(''); setReason('')
      toast.success('Tuzatish qo\'shildi')
      reload()
    } catch (e) {
      const body = errBody(e)
      toast.error(body.code === 'ADJUST_LIMIT' && body.limit != null ? adjustLimitMessage(body.limit) : errMsg(e))
    }
    finally { setAdding(false) }
  }

  async function removeAdjustment(id: string) {
    const ok = await confirm({ title: "Tuzatishni o'chirish", message: "Bu tuzatish ball va bonusdan olib tashlanadi.", confirmLabel: "O'chirish", danger: true })
    if (!ok) return
    try { await ekoApi.delete(`/kpi/adjustments/${id}`); reload() }
    catch (e) { toast.error(errMsg(e)) }
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={row.fullName}
      hint={`${f.monthLabel(data.month)} · ball ${row.score} · bonus ${f.money(row.bonus)}`}
    >
      <div className="p-5 space-y-5">
        {closed && <Banner tone="info">Oy yopilgan — o'zgartirish uchun avval qayta oching.</Banner>}

        <section>
          <h4 className="eko-text-base font-medium text-eko-text mb-2">Ko'rsatkichlar</h4>
          <ul className="divide-y divide-eko-line border border-eko-line rounded-eko-lg">
            {row.items.filter(i => i.weight > 0).map(it => {
              const ind = data.indicators.find(x => x.id === it.id)
              const unit = ind?.unit ?? ''
              const manual = manualIds.has(it.id)
              return (
                <li key={it.id} className="px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-medium text-eko-text">{it.name}</p>
                    <p className="eko-text-xs text-eko-muted">
                      Maqsad: {fmtValue(it.target, unit)} · vazn {it.weight}%{it.direction === 'lower' ? ' · kam — yaxshi' : ''}
                    </p>
                  </div>
                  {manual ? (
                    <div className="w-36">
                      <Input
                        inputMode="decimal" disabled={closed} placeholder="kiritilmagan"
                        value={draft[it.id] ?? ''}
                        onChange={e => setDraft(d => ({ ...d, [it.id]: e.target.value }))}
                        onBlur={() => saveEntry(it.id)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    </div>
                  ) : (
                    <p className="text-sm tabular-nums w-36">{fmtValue(it.value, unit)}</p>
                  )}
                  <div className="w-24 text-right">
                    {it.excluded
                      ? <Badge tone="warn">hisobda yo'q</Badge>
                      : <span className="text-sm font-semibold tabular-nums">{it.achievement}%</span>}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="eko-text-xs text-eko-muted mt-2">
            Asosiy ball {row.baseScore}{row.adjustmentPoints ? ` ${row.adjustmentPoints > 0 ? '+' : '−'} ${Math.abs(row.adjustmentPoints)} (tuzatish)` : ''} = <b>{row.score}</b>.
            Qiymati kiritilmagan ko'rsatkich hisobga olinmaydi.
          </p>
        </section>

        <section>
          <h4 className="eko-text-base font-medium text-eko-text mb-2">Admin tuzatishlari</h4>
          {row.adjustments.length === 0 ? (
            <p className="text-sm text-eko-muted mb-3">Tuzatish yo'q</p>
          ) : (
            <ul className="divide-y divide-eko-line border border-eko-line rounded-eko-lg mb-3">
              {row.adjustments.map(a => (
                <li key={a.id} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-eko-text">
                      {a.points !== 0 && <b>{a.points > 0 ? '+' : '−'}{Math.abs(a.points)} ball </b>}
                      {a.bonusDelta !== 0 && <b>{a.bonusDelta > 0 ? '+' : '−'}{f.money(Math.abs(a.bonusDelta))}</b>}
                    </p>
                    <p className="eko-text-xs text-eko-muted">{a.reason} · {a.createdByName ?? '—'} · {f.date(a.createdAt)}</p>
                  </div>
                  {!closed && (
                    <IconButton variant="ghost" size="sm" label="O'chirish" icon={<Trash2 className="w-4 h-4" />} onClick={() => removeAdjustment(a.id)} />
                  )}
                </li>
              ))}
            </ul>
          )}

          {!closed && (
            <div className="rounded-eko-lg border border-eko-line p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ball (±)" hint="Masalan −5 yoki +3">
                  {id => <Input id={id} inputMode="decimal" value={points} onChange={e => setPoints(e.target.value)} />}
                </Field>
                <Field label="Bonus (± so'm)">
                  {id => <Input id={id} inputMode="numeric" value={bonusDelta} onChange={e => setBonusDelta(e.target.value)} />}
                </Field>
              </div>
              <Field label="Sabab" required hint="Jurnalga yoziladi — keyin ko'rinadi">
                {id => <Textarea id={id} rows={2} value={reason} onChange={e => setReason(e.target.value)} />}
              </Field>
              <Button icon={<Plus className="w-4 h-4" />} loading={adding}
                disabled={(!Number(points) && !Number(bonusDelta)) || reason.trim().length < 3}
                onClick={addAdjustment}>
                Tuzatish qo'shish
              </Button>
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
