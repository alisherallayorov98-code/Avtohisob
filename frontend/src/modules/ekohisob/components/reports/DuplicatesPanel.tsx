import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, ChevronDown, ChevronRight, CheckCircle2, RotateCcw } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import {
  Card, CardHeader, CardBody, Badge, Button, Banner, EmptyState, SkeletonList, f,
} from '../../ui'

interface DupEntity {
  id: string
  name: string
  stir: string | null
  status: string
  district: string | null
  mahalla: string | null
  createdAt: string
  creatorName: string | null
  paymentsCount: number
  debtAmount: number
}

interface DupGroup {
  reason: 'stir' | 'name'
  key: string
  entities: DupEntity[]
}

interface DupData {
  scanned: number
  groups: DupGroup[]
  totalGroups: number
}

/**
 * Takroriy tashkilotlar paneli.
 *
 * So what: bitta tashkilot ikki marta kiritilsa unga har oy IKKI MARTA hisob
 * yoziladi va SMS ikki marta boradi — mijoz bilan janjal kafolatlangan.
 *
 * BIRLASHTIRISH TUGMASI YO'Q (ataylab): to'lov/hisoblarni ko'chirish pul amali
 * va xato birlashtirishni ortga qaytarib bo'lmaydi. Qaysi yozuv asl ekanini
 * odam hal qiladi: to'lovlari ko'pini qoldirib, bo'shini deaktiv qilish tavsiya
 * etiladi (Tashkilotlar sahifasida).
 */
export default function DuplicatesPanel() {
  const navigate = useNavigate()
  const [data, setData] = useState<DupData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    ekoApi.get('/monitoring/duplicates')
      .then(res => setData(res.data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  return (
    <Card flush>
      <CardHeader
        title="Takroriy tashkilotlar"
        hint={
          loading ? 'Tekshirilmoqda...'
            : data
              ? data.totalGroups > 0
                ? `${data.totalGroups} ta shubhali guruh (${f.num(data.scanned)} ta tashkilot tekshirildi)`
                : `${f.num(data.scanned)} ta tashkilot tekshirildi`
              : undefined
        }
        icon={<Copy className="w-4 h-4" />}
        actions={
          <Button variant="ghost" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={load}>
            Yangilash
          </Button>
        }
      />

      {loading ? (
        <SkeletonList rows={2} />
      ) : !data ? (
        <CardBody><EmptyState title="Tekshiruvni yuklab bo'lmadi" /></CardBody>
      ) : data.groups.length === 0 ? (
        <CardBody>
          <EmptyState
            tone="success"
            icon={<CheckCircle2 className="w-6 h-6" />}
            title="Takror topilmadi"
            hint="STIR va nom bo'yicha shubhali juftlik yo'q."
          />
        </CardBody>
      ) : (
        <>
          <div className="px-4 sm:px-5 pt-4">
            <Banner tone="warn">
              Takror yozuvga har oy <b>ikki marta hisob yoziladi</b> va SMS ikki marta
              boradi. To'lovlari ko'p yozuvni qoldirib, bo'shini Tashkilotlar
              sahifasida deaktiv qiling — birlashtirish avtomatik qilinmaydi,
              qaysi yozuv asl ekanini siz hal qilasiz.
            </Banner>
          </div>

          <div className="divide-y divide-eko-line mt-3">
            {data.groups.map((g, i) => {
              const isOpen = open === i
              return (
                <div key={i}>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-eko-surface-2 text-left"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {isOpen
                        ? <ChevronDown className="w-4 h-4 text-eko-subtle shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-eko-subtle shrink-0" />}
                      <span className="text-sm font-medium text-eko-text truncate">
                        {g.entities[0]?.name ?? g.key}
                      </span>
                      <Badge tone={g.reason === 'stir' ? 'danger' : 'warn'}>
                        {g.reason === 'stir' ? `Bir xil STIR` : 'Bir xil nom'}
                      </Badge>
                    </span>
                    <span className="text-xs text-eko-muted shrink-0">{g.entities.length} ta yozuv</span>
                  </button>

                  {isOpen && (
                    <div className="px-4 sm:px-5 pb-3 ml-6 space-y-2">
                      {g.entities.map(e => (
                        <div key={e.id} className="border border-eko-line rounded-eko px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-eko-text truncate">{e.name}</span>
                            <span className="shrink-0 text-eko-muted eko-num">
                              {e.paymentsCount} to'lov
                              {e.debtAmount > 0 && (
                                <span className="text-eko-danger ml-2">{f.num(e.debtAmount)} qarz</span>
                              )}
                            </span>
                          </div>
                          <p className="text-eko-muted mt-0.5">
                            {[e.district, e.mahalla].filter(Boolean).join(' / ') || '—'}
                            {e.stir && <> · STIR {e.stir}</>}
                            {' · '}{f.date(e.createdAt)}
                            {e.creatorName && <> · {e.creatorName} kiritgan</>}
                          </p>
                        </div>
                      ))}
                      <Button
                        variant="secondary" size="sm"
                        onClick={() => navigate('/ekohisob/entities')}
                      >
                        Tashkilotlar sahifasida hal qilish
                      </Button>
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
