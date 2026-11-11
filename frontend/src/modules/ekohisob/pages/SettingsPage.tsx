import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ekoApi from '../lib/ekoApi'
import { ekoKeys } from '../lib/queries'
import { errMsg } from '../lib/ekoErrors'
import RequisitesSection from '../components/settings/RequisitesSection'
import SmsSection from '../components/settings/SmsSection'
import EscalationSection from '../components/settings/EscalationSection'
import PaymentSection from '../components/settings/PaymentSection'
import BotSection from '../components/settings/BotSection'
import type { SettingsData } from '../components/settings/types'
import { Page, PageHeader, Tabs, Card, ErrorState, SkeletonList } from '../ui'

type Section = 'requisites' | 'sms' | 'escalation' | 'payment' | 'bot'

/** Sozlamalar: bo'limlarga bo'lingan, har bo'limning O'Z "Saqlash" tugmasi bor. */
export default function SettingsPage() {
  const qc = useQueryClient()
  const [section, setSection] = useState<Section>('requisites')

  const q = useQuery<SettingsData>({
    queryKey: [...ekoKeys.settings, 'full'],
    queryFn: async () => (await ekoApi.get('/settings')).data.data,
    staleTime: 15_000,
  })
  const reload = () => { qc.invalidateQueries({ queryKey: ekoKeys.settings }) }

  return (
    <Page>
      <PageHeader title="Sozlamalar" subtitle="Rekvizitlar, SMS, eskalatsiya va to'lov muddati" />
      <Tabs
        ariaLabel="Sozlamalar bo'limlari"
        idPrefix="set"
        value={section}
        onChange={setSection}
        items={[
          { value: 'requisites', label: 'Rekvizitlar' },
          { value: 'sms', label: 'SMS' },
          { value: 'escalation', label: 'Eskalatsiya' },
          { value: 'payment', label: "To'lov" },
          { value: 'bot', label: 'Telegram' },
        ]}
      />
      <div role="tabpanel" aria-labelledby={`set-${section}`}>
        {q.isLoading ? (
          <Card flush><SkeletonList rows={5} /></Card>
        ) : q.isError || !q.data ? (
          <Card flush><ErrorState title={errMsg(q.error)} onRetry={() => q.refetch()} /></Card>
        ) : (
          <>
            {section === 'requisites' && <RequisitesSection data={q.data} onSaved={reload} />}
            {section === 'sms' && <SmsSection data={q.data} onSaved={reload} />}
            {section === 'escalation' && <EscalationSection data={q.data} onSaved={reload} />}
            {section === 'payment' && <PaymentSection data={q.data} onSaved={reload} />}
            {section === 'bot' && <BotSection />}
          </>
        )}
      </div>
    </Page>
  )
}
