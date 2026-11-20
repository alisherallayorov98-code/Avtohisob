// Tahlil → "Manba" qatoridagi yozuvni to'liq ko'rsatish: kim kiritgan, kim tasdiqlagan,
// qismlar, rasm/chek. Admin boshqa sahifaga o'tmasdan savolni tekshiradi.
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileVideo, ImageOff } from 'lucide-react'
import api, { getFileUrl } from '../../lib/api'
import Modal from '../ui/Modal'
import { MiniTable, type EvidenceRef } from './parts'

interface RecordDetail {
  kind: string
  title: string
  fields: Array<[string, string | number | null]>
  table?: { columns: string[]; rows: Array<Array<string | number | null>> }
  files?: Array<{ url: string; label: string }>
  link?: { label: string; path: string }
}

const isVideo = (url: string) => /\.(mp4|webm|mov)$/i.test(url)

export default function RecordModal({ target, highlight, onClose }: { target: EvidenceRef | null; highlight?: string[]; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<RecordDetail>({
    queryKey: ['insight-record', target?.kind, target?.id],
    queryFn: () => api.get(`/insights/record/${target!.kind}/${encodeURIComponent(target!.id)}`).then(r => r.data.data),
    enabled: !!target,
    staleTime: 60_000,
  })
  if (!target) return null
  return (
    <Modal open={!!target} onClose={onClose} title={data?.title || 'Yozuv'} size="lg">
      {isLoading ? <p className="text-sm text-gray-500 py-6 text-center">Yuklanmoqda...</p>
        : error || !data ? <p className="text-sm text-red-600 py-6 text-center">Yozuvni ochib bo'lmadi (o'chirilgan bo'lishi mumkin).</p>
          : (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {data.fields.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                  <div key={k} className="flex gap-2 border-b border-gray-100 dark:border-gray-800 py-1 min-w-0">
                    <dt className="text-gray-500 dark:text-gray-400 w-36 flex-shrink-0">{k}</dt>
                    <dd className="text-gray-900 dark:text-gray-100 break-words min-w-0">{v}</dd>
                  </div>
                ))}
              </dl>
              {data.table && data.table.rows.length > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                  <MiniTable columns={data.table.columns} rows={data.table.rows.map(r => r.map(c => (c == null ? '—' : c)))} highlight={highlight} />
                </div>
              )}
              {data.files && data.files.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Biriktirilgan fayllar</p>
                  <div className="flex flex-wrap gap-2">
                    {data.files.map(f => (
                      <a key={f.url} href={getFileUrl(f.url)} target="_blank" rel="noreferrer" title={f.label}
                        className="block w-28 h-28 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:ring-2 hover:ring-blue-400">
                        {isVideo(f.url)
                          ? <span className="w-full h-full flex flex-col items-center justify-center text-xs text-gray-500"><FileVideo className="w-6 h-6 mb-1" />{f.label}</span>
                          : <img src={getFileUrl(f.url)} alt={f.label} className="w-full h-full object-cover" loading="lazy" />}
                      </a>
                    ))}
                  </div>
                </div>
              ) : data.kind === 'maintenance' || data.kind === 'fuel' || data.kind === 'expense' ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-gray-500"><ImageOff className="w-3.5 h-3.5" /> Rasm yoki chek biriktirilmagan</p>
              ) : null}
              {data.link && (
                <Link to={data.link.path} onClick={onClose} className="inline-flex items-center gap-1 text-sm text-blue-700 dark:text-blue-400 hover:underline">
                  {data.link.label} <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
          )}
    </Modal>
  )
}
