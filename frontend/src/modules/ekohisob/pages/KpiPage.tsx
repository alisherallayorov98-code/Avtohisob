import KpiAdminView from './kpi/KpiAdminView'
import KpiMyView from './kpi/KpiMyView'

/** KPI: admin — sozlash va hamma natijalar; inspektor — faqat o'z natijasi. */
export default function KpiPage({ isAdmin }: { isAdmin: boolean }) {
  return isAdmin ? <KpiAdminView /> : <KpiMyView />
}
