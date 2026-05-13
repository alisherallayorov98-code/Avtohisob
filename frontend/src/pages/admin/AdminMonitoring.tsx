import { useQuery, useMutation } from '@tanstack/react-query'
import { Activity, Server, Cpu, MemoryStick, Database, CheckCircle, AlertTriangle, RefreshCw, HardDrive, Trash2 } from 'lucide-react'
import { useState } from 'react'
import api from '../../lib/api'
import toast from 'react-hot-toast'

interface MonitoringData {
  server: { status: string; uptime: number; uptimeFormatted: string; platform: string; nodeVersion: string; pid: number }
  memory: { usedMB: number; totalMB: number; percent: number; heapUsedMB: number; heapTotalMB: number }
  cpu: { load1m: string; load5m: string; load15m: string; cores: number }
  database: { status: string; records: { users: number; vehicles: number } }
  activity: { apiCallsToday: number; errorCount: number; errorRate: string }
  timestamp: string
}

function ProgressBar({ value, max = 100, color = 'bg-green-500' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : color
  return (
    <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

interface DiskStats {
  uploadsDirMB: number
  bySubdir: Record<string, number>
  diskTotalGB: number
  diskUsedGB: number
  diskFreeGB: number
  diskUsedPct: number
}

export default function AdminMonitoring() {
  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<MonitoringData>({
    queryKey: ['admin-monitoring'],
    queryFn: () => api.get('/admin/monitoring').then(r => r.data.data),
    refetchInterval: 30000,
  })

  const { data: diskData, refetch: refetchDisk } = useQuery<DiskStats>({
    queryKey: ['admin-storage'],
    queryFn: () => api.get('/admin/storage').then(r => r.data.data),
    staleTime: 60_000,
  })

  const [retentionMonths, setRetentionMonths] = useState(6)

  const cleanupEvidence = useMutation({
    mutationFn: () => api.post('/admin/storage/cleanup-evidence', { retentionMonths }),
    onSuccess: (r) => {
      const { deletedFiles, freedMB } = r.data.data
      toast.success(`${deletedFiles} ta fayl o'chirildi, ${freedMB} MB bo'shadi`)
      refetchDisk()
    },
    onError: () => toast.error('Xato yuz berdi'),
  })

  const cleanupOrphans = useMutation({
    mutationFn: () => api.post('/admin/storage/cleanup-orphans'),
    onSuccess: (r) => {
      const { deletedFiles, freedMB } = r.data.data
      toast.success(deletedFiles > 0 ? `${deletedFiles} ta yetim fayl o'chirildi (${freedMB} MB)` : 'Yetim fayl topilmadi')
      refetchDisk()
    },
    onError: () => toast.error('Xato yuz berdi'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return null

  const memPct = data.memory.percent
  const memColor = memPct > 90 ? 'bg-red-500' : memPct > 70 ? 'bg-yellow-500' : 'bg-green-500'
  const isOperational = data.server.status === 'operational' && data.database.status === 'connected'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-red-500" /> System Monitoring
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Oxirgi yangilash: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('uz-UZ') : '—'}
          </p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {/* Overall status banner */}
      <div className={`flex items-center gap-3 px-5 py-4 rounded-xl border ${
        isOperational ? 'bg-green-900/20 border-green-800 text-green-400' : 'bg-red-900/20 border-red-800 text-red-400'
      }`}>
        {isOperational
          ? <CheckCircle className="w-5 h-5 flex-shrink-0" />
          : <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        }
        <span className="font-semibold">
          {isOperational ? '✓ Barcha tizimlar ishlamoqda' : '⚠ Ba\'zi tizimlar muammoli'}
        </span>
        <span className="ml-auto text-xs opacity-60">{new Date(data.timestamp).toLocaleString('uz-UZ')}</span>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Server */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Server</h3>
            <span className="ml-auto px-2 py-0.5 rounded-full text-xs bg-green-900/40 text-green-400">Online</span>
          </div>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Ishlash vaqti</span>
              <span className="text-white font-medium">{data.server.uptimeFormatted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Platform</span>
              <span className="text-gray-300">{data.server.platform}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Node.js</span>
              <span className="text-gray-300 font-mono text-xs">{data.server.nodeVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">PID</span>
              <span className="text-gray-500 font-mono text-xs">{data.server.pid}</span>
            </div>
          </div>
        </div>

        {/* Memory */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <MemoryStick className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Xotira (RAM)</h3>
            <span className={`ml-auto text-xs font-bold ${memPct > 90 ? 'text-red-400' : memPct > 70 ? 'text-yellow-400' : 'text-green-400'}`}>
              {memPct}%
            </span>
          </div>
          <div className="mb-3">
            <ProgressBar value={data.memory.usedMB} max={data.memory.totalMB} color={memColor} />
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Ishlatilgan</span>
              <span className="text-white">{data.memory.usedMB} MB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Jami</span>
              <span className="text-gray-300">{data.memory.totalMB} MB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Heap (Node)</span>
              <span className="text-gray-300">{data.memory.heapUsedMB}/{data.memory.heapTotalMB} MB</span>
            </div>
          </div>
        </div>

        {/* CPU */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-white">CPU / Yuklanish</h3>
            <span className="ml-auto text-xs text-gray-500">{data.cpu.cores} yadro</span>
          </div>
          <div className="space-y-3 text-sm">
            {[
              { label: '1 daqiqa', value: parseFloat(data.cpu.load1m) },
              { label: '5 daqiqa', value: parseFloat(data.cpu.load5m) },
              { label: '15 daqiqa', value: parseFloat(data.cpu.load15m) },
            ].map(item => (
              <div key={item.label}>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">{item.label}</span>
                  <span className="text-gray-300 font-mono text-xs">{item.value.toFixed(2)}</span>
                </div>
                <ProgressBar value={item.value} max={data.cpu.cores} />
              </div>
            ))}
          </div>
        </div>

        {/* Database */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Ma'lumotlar bazasi</h3>
            <span className={`ml-auto px-2 py-0.5 rounded-full text-xs ${
              data.database.status === 'connected' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
            }`}>
              {data.database.status === 'connected' ? 'Ulangan' : 'Ulanmagan'}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Foydalanuvchilar</span>
              <span className="text-white">{data.database.records.users.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Avtomobillar</span>
              <span className="text-white">{data.database.records.vehicles.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Bugungi faollik</h3>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">API so'rovlar (bugun)</span>
              <span className="text-white font-semibold">{data.activity.apiCallsToday.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Xatolar soni</span>
              <span className={data.activity.errorCount > 0 ? 'text-red-400 font-semibold' : 'text-green-400'}>
                {data.activity.errorCount}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Xato darajasi</span>
              <span className={parseFloat(data.activity.errorRate) > 5 ? 'text-red-400' : 'text-green-400'}>
                {data.activity.errorRate}%
              </span>
            </div>
          </div>
        </div>

        {/* Auto-refresh notice */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col justify-center items-center text-center">
          <RefreshCw className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-xs text-gray-500">Har 30 soniyada avtomatik yangilanadi</p>
          <button onClick={() => refetch()} className="mt-3 text-xs text-red-500 hover:text-red-400 transition-colors">
            Hozir yangilash →
          </button>
        </div>
      </div>

      {/* Storage section */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Disk / Saqlash xotirasi</h3>
          </div>
          <button onClick={() => refetchDisk()} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Yangilash
          </button>
        </div>

        {diskData ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Disk usage */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Disk ishlatilishi</span>
                <span className={`font-bold ${diskData.diskUsedPct >= 90 ? 'text-red-400' : diskData.diskUsedPct >= 75 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {diskData.diskUsedPct}%
                </span>
              </div>
              <ProgressBar value={diskData.diskUsedPct} max={100} color={
                diskData.diskUsedPct >= 90 ? 'bg-red-500' : diskData.diskUsedPct >= 75 ? 'bg-yellow-500' : 'bg-emerald-500'
              } />
              <div className="grid grid-cols-3 gap-2 text-xs text-center">
                {[
                  { label: 'Jami', value: `${diskData.diskTotalGB} GB`, color: 'text-gray-400' },
                  { label: 'Ishlatilgan', value: `${diskData.diskUsedGB} GB`, color: 'text-red-400' },
                  { label: 'Bo\'sh', value: `${diskData.diskFreeGB} GB`, color: 'text-green-400' },
                ].map(c => (
                  <div key={c.label} className="bg-gray-800 rounded-lg py-2 px-1">
                    <div className={`font-bold ${c.color}`}>{c.value}</div>
                    <div className="text-gray-600 mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Uploads papkasi: <span className="text-white font-medium">{diskData.uploadsDirMB} MB</span></p>
                <div className="space-y-1">
                  {Object.entries(diskData.bySubdir).sort(([, a], [, b]) => b - a).map(([dir, mb]) => (
                    <div key={dir} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500 w-36 truncate font-mono">{dir}/</span>
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${Math.min(100, (mb / (diskData.uploadsDirMB || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-400 w-16 text-right">{mb} MB</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Cleanup actions */}
            <div className="space-y-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Tozalash</p>

              <div className="space-y-2">
                <p className="text-xs text-gray-400">Eski evidence fayllar (tasdiqlangan/rad etilgan)</p>
                <div className="flex items-center gap-2">
                  <select
                    value={retentionMonths}
                    onChange={e => setRetentionMonths(Number(e.target.value))}
                    className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 flex-1"
                  >
                    {[3, 6, 9, 12].map(m => (
                      <option key={m} value={m}>{m} oydan eski</option>
                    ))}
                  </select>
                  <button
                    onClick={() => cleanupEvidence.mutate()}
                    disabled={cleanupEvidence.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-400 text-xs rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <Trash2 className="w-3 h-3" />
                    {cleanupEvidence.isPending ? 'Tozalanmoqda...' : "O'chirish"}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-400">Yetim fayllar (DB da yo'q, diskda bor)</p>
                <button
                  onClick={() => cleanupOrphans.mutate()}
                  disabled={cleanupOrphans.isPending}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 text-xs rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  {cleanupOrphans.isPending ? 'Tekshirilmoqda...' : 'Yetim fayllarni tozalash'}
                </button>
              </div>

              <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
                <p>🗓 Avtomatik tozalash: har oy 1-kuni</p>
                <p>📊 Disk tekshiruvi: har dushanba</p>
                <p>⚠ 75%+ → Telegram ogohlantirish</p>
                <p>🔴 90%+ → Kritik Telegram xabari</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-gray-600 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Yuklanmoqda...
          </div>
        )}
      </div>
    </div>
  )
}
