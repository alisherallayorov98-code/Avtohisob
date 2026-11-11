import { useState } from 'react'
import { ShieldCheck, ShieldAlert, Truck, MapPin, Clock } from 'lucide-react'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { Banner, Button, DateInput, Field, Modal, f } from '../ui'

interface PassingVehicle {
  vehicleId: string
  registrationNumber: string
  closestMeters: number
  passedAt: string
  nearbyCount: number
}

interface ProofData {
  available: boolean
  reason?: string
  radiusM?: number
  served?: boolean
  entity?: { id: string; name: string; lat: number; lon: number; address?: string }
  passingVehicles?: PassingVehicle[]
}

interface Props {
  entityId: string
  entityName: string
  hasLocation: boolean
  onClose: () => void
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Xizmat isboti (GPS): tanlangan kuni chiqindi mashinasi tashkilot yonidan o'tganmi. */
export default function ServiceProofModal({ entityId, entityName, hasLocation, onClose }: Props) {
  const [date, setDate] = useState(today())
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ProofData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    setLoading(true)
    setData(null)
    setError(null)
    try {
      const res = await ekoApi.get(`/entities/${entityId}/service-proof`, { params: { date } })
      setData(res.data.data ?? res.data)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setLoading(false)
    }
  }

  const entity = data?.entity
  const osmSrc = entity
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${entity.lon - 0.004}%2C${entity.lat - 0.003}%2C${entity.lon + 0.004}%2C${entity.lat + 0.003}&layer=mapnik&marker=${entity.lat}%2C${entity.lon}`
    : ''

  return (
    <Modal onClose={onClose} size="md" title={entityName} hint="Xizmat isboti (GPS)">
      <div className="p-5 space-y-4">
        {!hasLocation ? (
          <Banner tone="warn">
            Bu tashkilotning koordinatasi belgilanmagan. Avval xaritada joyini belgilang
            yoki dala-bot orqali geolokatsiya yuboring.
          </Banner>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <Field label="Sana" className="flex-1">
                {id => <DateInput id={id} value={date} max={today()} onChange={setDate} />}
              </Field>
              <Button variant="primary" loading={loading} icon={<ShieldCheck className="w-4 h-4" aria-hidden />} onClick={check}>
                Tekshirish
              </Button>
            </div>

            {error && <Banner tone="danger" action={<Button size="sm" onClick={check}>Qayta urinish</Button>}>{error}</Banner>}

            {data && !loading && (
              !data.available ? (
                <Banner tone="info">{data.reason || "Ma'lumot yo'q"}</Banner>
              ) : data.served ? (
                <div className="space-y-3">
                  <Banner tone="success" icon={<ShieldCheck className="w-4 h-4" />}>
                    <b>Xizmat ko'rsatilgan.</b> Chiqindi mashinasi {data.radiusM} m radius ichidan o'tgan — isbot mavjud.
                  </Banner>
                  <ul className="space-y-2">
                    {(data.passingVehicles ?? []).map(v => (
                      <li key={v.vehicleId} className="border border-eko-line rounded-eko-lg p-3">
                        <p className="flex items-center gap-2 eko-text-base font-medium text-eko-text">
                          <Truck className="w-4 h-4 text-eko-muted" aria-hidden />
                          {v.registrationNumber || 'Mashina'}
                        </p>
                        <p className="flex items-center gap-4 mt-1.5 eko-text-sm text-eko-muted">
                          <span className="flex items-center gap-1"><Clock className="w-4 h-4" aria-hidden />{f.dateTime(v.passedAt)}</span>
                          <span className="flex items-center gap-1"><MapPin className="w-4 h-4" aria-hidden />{v.closestMeters} m</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Banner tone="danger" icon={<ShieldAlert className="w-4 h-4" />}>
                  <b>Xizmat tasdiqlanmadi.</b> Shu kuni hech bir mashina {data.radiusM} m radius ichidan o'tmagan.
                </Banner>
              )
            )}

            {entity && osmSrc && (
              <div className="rounded-eko-lg overflow-hidden border border-eko-line">
                <iframe title="Tashkilot joylashuvi" src={osmSrc} className="w-full h-48" loading="lazy" />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
