import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeartPulse, ChevronDown, ChevronRight, CheckCircle2, RotateCcw } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import {
  Card, CardHeader, CardBody, Badge, Button, Banner, EmptyState, SkeletonList, cx, f,
} from '../../ui'

type Severity = 'high' | 'medium' | 'low'

interface HealthGroup {
  code: string
  label: string
  why: string
  severity: Severity
  count: number
  samples: { id: string; name: string; district: string | null }[]
}

interface HealthData {
  checked: number
  clean: number
  total: number
  truncated: boolean
  groups: HealthGroup[]
}

const SEVERITY_TONE: Record<Severity, 'danger' | 'warn' | 'neutral'> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'Avtomatlashtirishni buzadi',
  medium: 'Ishni qiyinlashtiradi',
  low: 'Hujjat to\'liqligi',
}

/**
 * Ma'lumot to'liqligi nazorati.
 *
 * Tizimda avtomatlashtirish bor (avto-SMS, oylik hisob, xarita, talon), lekin
 * ular JIMGINA ishlamay qolishi mumkin: telefoni yo'q tashkilotga SMS
 * bormaydi, oylik summasi 0 bo'lsa hisob yozilmaydi. Hech qanday xato
 * chiqmaydi — shunchaki ish bajarilmaydi. Bu panel shuni ko'rsatadi.
 */
export default function DataHealthPanel() {
  const navigate = useNavigate()
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    ekoApi.get('/monitoring/data-health')
      .then(res => setData(res.data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const highCount = data?.groups.filter(g => g.severity === 'high')
    .reduce((s, g) => s + g.count, 0) ?? 0

  return (
    <Card flush>
      <CardHeader
        title="Ma'lumot sog'ligi"
        hint={
          loading ? 'Tekshirilmoqda...'
            : data
              ? `${f.num(data.checked)} ta tashkilot tekshirildi · ${f.num(data.clean)} tasi to'liq`
              : undefined
        }
        icon={<HeartPulse className="w-4 h-4" />}
        actions={
          <Button variant="ghost" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={load}>
            Yangilash
          </Button>
        }
      />

      {loading ? (
        <SkeletonList rows={3} />
      ) : !data ? (
        <CardBody><EmptyState title="Tekshiruvni yuklab bo'lmadi" /></CardBody>
      ) : data.groups.length === 0 ? (
        <CardBody>
          <EmptyState
            tone="success"
            icon={<CheckCircle2 className="w-6 h-6" />}
            title="Barcha ma'lumotlar to'liq"
            hint="Avtomatlashtirishni bloklaydigan bo'sh maydon topilmadi."
          />
        </CardBody>
      ) : (
        <>
          {highCount > 0 && (
            <div className="px-4 sm:px-5 pt-4">
              <Banner tone="danger">
                <b>{f.num(highCount)} ta tashkilotda</b> avtomatlashtirishni buzadigan
                maydon to'ldirilmagan — ularga SMS bormaydi yoki hisob yozilmaydi.
              </Banner>
            </div>
          )}

          {data.truncated && (
            <div className="px-4 sm:px-5 pt-3">
              <Banner tone="info">
                {f.num(data.total)} tadan {f.num(data.checked)} tasi tekshirildi.
                Qolganini ko'rish uchun tuman bo'yicha filtrlab tekshiring.
              </Banner>
            </div>
          )}

          <div className="divide-y divide-eko-line mt-3">
            {data.groups.map(g => {
              const isOpen = open === g.code
              return (
                <div key={g.code}>
                  <button
                    onClick={() => setOpen(isOpen ? null : g.code)}
                    className="w-full flex items-start justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-eko-surface-2 text-left"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {isOpen
                        ? <ChevronDown className="w-4 h-4 text-eko-subtle shrink-0 mt-0.5" />
                        : <ChevronRight className="w-4 h-4 text-eko-subtle shrink-0 mt-0.5" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-eko-text">{g.label}</span>
                          <Badge tone={SEVERITY_TONE[g.severity]}>{SEVERITY_LABEL[g.severity]}</Badge>
                        </div>
                        <p className="text-xs text-eko-muted mt-0.5 leading-relaxed">{g.why}</p>
                      </div>
                    </div>
                    <span className={cx('text-sm font-semibold eko-num shrink-0',
                      g.severity === 'high' ? 'text-eko-danger'
                        : g.severity === 'medium' ? 'text-eko-warn' : 'text-eko-muted')}>
                      {f.num(g.count)}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 sm:px-5 pb-3 -mt-1">
                      {g.samples.length === 0 ? (
                        <p className="text-xs text-eko-muted">Namuna yo'q</p>
                      ) : (
                        <>
                          <div className="ml-6 pl-3 border-l border-eko-line space-y-1">
                            {g.samples.map(s => (
                              <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-eko-text-2 truncate">{s.name}</span>
                                <span className="text-eko-subtle shrink-0">{s.district ?? '—'}</span>
                              </div>
                            ))}
                          </div>
                          {g.count > g.samples.length && (
                            <p className="ml-9 text-[11px] text-eko-subtle mt-1.5">
                              ...va yana {f.num(g.count - g.samples.length)} ta
                            </p>
                          )}
                          <div className="ml-9 mt-2">
                            <Button
                              variant="secondary" size="sm"
                              onClick={() => navigate('/ekohisob/entities')}
                            >
                              Tashkilotlar sahifasida tuzatish
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}
