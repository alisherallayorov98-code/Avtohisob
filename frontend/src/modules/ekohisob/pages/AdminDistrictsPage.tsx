import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { errMsg, parseEkoError } from '../lib/ekoErrors'
import { invalidateEko, useDistricts, useMahallas } from '../lib/queries'
import { Page, PageHeader, EmptyState, Card, useConfirm } from '../ui'
import RefColumn, { RefItem } from '../components/admin/RefColumn'

export default function AdminDistrictsPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>(null)

  const districtsQ = useDistricts()
  const mahallasQ = useMahallas(selectedDistrictId ?? '')
  const districts = districtsQ.data ?? []
  const mahallas = selectedDistrictId ? (mahallasQ.data ?? []) : []
  const selectedDistrict = districts.find(d => d.id === selectedDistrictId)

  const refresh = () => invalidateEko(qc, 'reference')

  /** Muvaffaqiyat -> true; xato toast ko'rsatiladi -> false (inline forma qiymatni saqlab qoladi) */
  async function run(fn: () => Promise<unknown>, okMsg: string): Promise<boolean> {
    try {
      await fn()
      toast.success(okMsg)
      refresh()
      return true
    } catch (e) {
      toast.error(errMsg(e))
      return false
    }
  }

  async function deleteDistrict(d: RefItem) {
    const ok = await confirm({
      title: "Tumanni o'chirish",
      message: `"${d.name}" tumani o'chirilsinmi?`,
      danger: true,
      consequences: ["Tumandagi BARCHA mahallalar ham o'chadi"],
      confirmLabel: "O'chirish",
    })
    if (!ok) return
    const done = await run(() => ekoApi.delete(`/districts/${d.id}`), "O'chirildi")
    if (done && selectedDistrictId === d.id) setSelectedDistrictId(null)
  }

  async function deleteMahalla(m: RefItem) {
    const ok = await confirm({
      title: "Mahallani o'chirish",
      message: `"${m.name}" mahallasi o'chirilsinmi?`,
      danger: true,
      confirmLabel: "O'chirish",
    })
    if (!ok) return
    try {
      await ekoApi.delete(`/mahallas/${m.id}`)
      toast.success("O'chirildi")
      refresh()
    } catch (e) {
      const info = parseEkoError(e)
      if (info.code === 'MAHALLA_HAS_ENTITIES') {
        const n = info.data?.entityCount
        toast.error(
          `"${m.name}" mahallasida ${n != null ? `${n} ta ` : ''}tashkilot bor. Avval ularni boshqa mahallaga ko'chiring, keyin o'chiring.`,
          { duration: 7000 },
        )
      } else {
        toast.error(info.message)
      }
    }
  }

  return (
    <Page>
      <PageHeader title="Tumanlar va mahallalar" subtitle="Tuman tanlang — uning mahallalari o'ngda ko'rinadi" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        <RefColumn
          title="Tumanlar"
          count={districts.length}
          items={districts}
          loading={districtsQ.isLoading}
          error={districtsQ.isError ? errMsg(districtsQ.error) : null}
          onRetry={() => districtsQ.refetch()}
          selectedId={selectedDistrictId}
          onSelect={d => setSelectedDistrictId(d.id === selectedDistrictId ? null : d.id)}
          addPlaceholder="Yangi tuman nomi"
          onAdd={name => run(() => ekoApi.post('/districts', { name }), "Tuman qo'shildi")}
          onRename={(d, name) => run(() => ekoApi.patch(`/districts/${d.id}`, { name }), 'Nomi yangilandi')}
          onDelete={deleteDistrict}
          emptyTitle="Tumanlar yo'q"
          emptyHint="Yuqoridagi maydonga nom yozib, birinchi tumanni qo'shing."
        />

        {selectedDistrictId ? (
          <RefColumn
            title={selectedDistrict ? `${selectedDistrict.name} mahallalari` : 'Mahallalar'}
            count={mahallas.length}
            items={mahallas}
            loading={mahallasQ.isLoading}
            error={mahallasQ.isError ? errMsg(mahallasQ.error) : null}
            onRetry={() => mahallasQ.refetch()}
            addPlaceholder="Yangi mahalla nomi"
            onAdd={name => run(() => ekoApi.post('/mahallas', { name, districtId: selectedDistrictId }), "Mahalla qo'shildi")}
            onRename={(m, name) => run(() => ekoApi.patch(`/mahallas/${m.id}`, { name }), 'Nomi yangilandi')}
            onDelete={deleteMahalla}
            emptyTitle="Bu tumanda mahalla yo'q"
            emptyHint="Yuqoridagi maydonga nom yozib qo'shing."
          />
        ) : (
          <Card flush className="min-h-[420px] flex items-center justify-center">
            <EmptyState title="Tuman tanlanmagan" hint="Mahallalarni ko'rish va qo'shish uchun chapdan tuman tanlang." />
          </Card>
        )}
      </div>
    </Page>
  )
}
