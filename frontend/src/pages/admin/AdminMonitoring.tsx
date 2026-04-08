import { useQuery } from '@tanstack/react-query'
import { Activity, Server, Cpu, MemoryStick, Database, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import api from '../../lib/api'

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

export default function AdminMonitoring() {
  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<MonitoringData>({
    queryKey: ['admin-monitoring'],
    queryFn: () => api.get('/admin/monitoring').then(r => r.data.data),
    refetchInterval: 30000,
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
    </div>
  )
}
