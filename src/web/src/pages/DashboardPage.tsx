import { Card, Spinner } from 'h2d-glass-ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, type ClusterHealth, type ClusterStatistics, type BucketListItem, type KeyListItem } from '../api/client'
import { fmtBytes } from './BucketsPage'
import { UsageChart } from '../components/UsageChart'
import { useTranslation } from 'react-i18next'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <div style={{ padding: 8 }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
        <div style={{ fontWeight: 700, fontSize: 20 }}>{value}</div>
      </div>
    </Card>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const health = useQuery({ queryKey: ['cluster-health'], queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data })
  const stats = useQuery({ queryKey: ['cluster-stats'], queryFn: async () => (await api.get<ClusterStatistics>('/cluster/statistics')).data })
  const buckets = useQuery({ queryKey: ['buckets'], queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data })
  const keys = useQuery({ queryKey: ['keys'], queryFn: async () => (await api.get<KeyListItem[]>('/keys')).data })

  const loading = health.isLoading || stats.isLoading
  const errored = health.error || stats.error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3>{t('dashboard.title')}</h3>
      {loading && <Spinner />}
      {errored && <span style={{ color: 'red' }}>{t('dashboard.clusterNotConnected')}</span>}
      {health.data && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{t('dashboard.clusterStatus')}:</span>
          <span style={{ color: health.data.status === 'healthy' ? 'green' : 'red' }}>{health.data.status}</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {health.data && <Stat label={t('dashboard.connectedNodes')} value={`${health.data.connectedNodes}/${health.data.knownNodes}`} />}
        {health.data && <Stat label={t('dashboard.partitionsOk')} value={`${health.data.partitionsAllOk}/${health.data.partitions}`} />}
        {stats.data && <Stat label={t('dashboard.freeSpace')} value={fmtBytes(stats.data.dataAvail)} />}
        {stats.data && <Stat label={t('dashboard.buckets')} value={stats.data.bucketCount} />}
        {stats.data && <Stat label={t('dashboard.objects')} value={stats.data.totalObjectCount} />}
        {stats.data && <Stat label={t('dashboard.totalSize')} value={fmtBytes(stats.data.totalObjectBytes)} />}
      </div>

      {health.data && <UsageChart kind="cluster" />}

      <h5 style={{ margin: '8px 0 0' }}>{t('dashboard.quickAccess')}</h5>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Card><div style={{ padding: 8 }}><b>{t('nav.buckets')}</b><div style={{ fontSize: 12, opacity: 0.7 }}>{buckets.data?.length ?? '…'} {t('dashboard.bucketUnit')}</div></div></Card>
        <Card><div style={{ padding: 8 }}><b>{t('nav.accessKeys')}</b><div style={{ fontSize: 12, opacity: 0.7 }}>{keys.data?.length ?? '…'} {t('dashboard.keyUnit')}</div></div></Card>
        <Card><div style={{ padding: 8 }}><b>{t('nav.cluster')}</b><div style={{ fontSize: 12, opacity: 0.7 }}>{t('dashboard.layoutAndNodes')}</div></div></Card>
        <Card><div style={{ padding: 8 }}><b>{t('nav.files')}</b><div style={{ fontSize: 12, opacity: 0.7 }}>{t('dashboard.browseObjects')}</div></div></Card>
      </div>
    </div>
  )
}
