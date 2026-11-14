import { Badge, Card, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'h2d-glass-ui'
import { useQuery } from '@tanstack/react-query'
import { api, type ClusterStatus, type ClusterStatistics, type ClusterHealth } from '../api/client'
import { fmtBytes } from '../pages/BucketsPage'
import { useTranslation } from 'react-i18next'

export function ClusterOverview() {
  const { t } = useTranslation()
  const health = useQuery({ queryKey: ['cluster-health'], queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data })
  const stats = useQuery({ queryKey: ['cluster-stats'], queryFn: async () => (await api.get<ClusterStatistics>('/cluster/statistics')).data })
  const status = useQuery({ queryKey: ['cluster-status'], queryFn: async () => (await api.get<ClusterStatus>('/cluster/status')).data })

  if (health.isLoading || stats.isLoading || status.isLoading) return <Spinner />
  if (health.error || stats.error || status.error) return <span style={{ color: 'red' }}>{t('clusterOverview.loadFailed')}</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>{t('dashboard.clusterStatus')}:</span>
        <Badge variant={health.data!.status === 'healthy' ? 'success' : 'danger'}>{health.data!.status}</Badge>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('dashboard.connectedNodes')}</div><div style={{ fontWeight: 700, fontSize: 20 }}>{health.data!.connectedNodes}/{health.data!.knownNodes}</div></div></Card>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('clusterOverview.freeDataSpace')}</div><div style={{ fontWeight: 700, fontSize: 20 }}>{fmtBytes(stats.data!.dataAvail)}</div></div></Card>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('dashboard.buckets')}</div><div style={{ fontWeight: 700, fontSize: 20 }}>{stats.data!.bucketCount}</div></div></Card>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('dashboard.objects')}</div><div style={{ fontWeight: 700, fontSize: 20 }}>{stats.data!.totalObjectCount}</div></div></Card>
      </div>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('clusterOverview.nodes')}</h5>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t('nodeMaintenance.hostname')}</TableHead>
                  <TableHead>{t('clusterOverview.zone')}</TableHead>
                  <TableHead>{t('clusterOverview.capacity')}</TableHead>
                  <TableHead>{t('clusterOverview.dataAvail')}</TableHead>
                  <TableHead>{t('clusterOverview.resyncQueue')}</TableHead>
                  <TableHead>{t('nodeMaintenance.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.data!.nodes.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell><code>{n.id.slice(0, 16)}…</code></TableCell>
                    <TableCell>{n.hostname}</TableCell>
                    <TableCell>{n.role?.zone ?? '—'}</TableCell>
                    <TableCell>{n.role?.capacity != null ? fmtBytes(n.role.capacity) : t('nodeMaintenance.gateway')}</TableCell>
                    <TableCell>{n.dataPartition ? `${fmtBytes(n.dataPartition.available)} / ${fmtBytes(n.dataPartition.total)}` : '—'}</TableCell>
                    <TableCell>{n.resyncQueueLen == null ? '—' : n.resyncQueueLen > 0 ? <Badge variant="warning">{n.resyncQueueLen.toLocaleString()} {t('clusterOverview.blocks')}</Badge> : 0}</TableCell>
                    <TableCell>{n.isUp ? <Badge variant="success">{t('nodeMaintenance.up')}</Badge> : <Badge variant="danger">{t('nodeMaintenance.down')}</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </div>
  )
}
