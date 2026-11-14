import { Spinner } from 'h2d-glass-ui'
import { Badge, Card, Grid, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
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
  if (health.error || stats.error || status.error) return <span>{t('clusterOverview.loadFailed')}</span>

  return (
    <Stack>
      <Group>
        <span>{t('dashboard.clusterStatus')}:</span>
        <Badge color={health.data!.status === 'healthy' ? 'green' : 'red'}>{health.data!.status}</Badge>
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><span>{t('dashboard.connectedNodes')}</span><span>{health.data!.connectedNodes}/{health.data!.knownNodes}</span></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><span>{t('clusterOverview.freeDataSpace')}</span><span>{fmtBytes(stats.data!.dataAvail)}</span></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><span>{t('dashboard.buckets')}</span><span>{stats.data!.bucketCount}</span></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><span>{t('dashboard.objects')}</span><span>{stats.data!.totalObjectCount}</span></Card></Grid.Col>
      </Grid>

      <Card withBorder>
        <h5>{t('clusterOverview.nodes')}</h5>
        <Table.ScrollContainer minWidth={720}>
          <Table>
            <Table.Thead>
              <Table.Tr><Table.Th>ID</Table.Th><Table.Th>{t('nodeMaintenance.hostname')}</Table.Th><Table.Th>{t('clusterOverview.zone')}</Table.Th><Table.Th>{t('clusterOverview.capacity')}</Table.Th><Table.Th>{t('clusterOverview.dataAvail')}</Table.Th><Table.Th>{t('clusterOverview.resyncQueue')}</Table.Th><Table.Th>{t('nodeMaintenance.status')}</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {status.data!.nodes.map((n) => (
                <Table.Tr key={n.id}>
                  <Table.Td><code>{n.id.slice(0, 16)}…</code></Table.Td>
                  <Table.Td>{n.hostname}</Table.Td>
                  <Table.Td>{n.role?.zone ?? '—'}</Table.Td>
                  <Table.Td>{n.role?.capacity != null ? fmtBytes(n.role.capacity) : t('nodeMaintenance.gateway')}</Table.Td>
                  <Table.Td>{n.dataPartition ? `${fmtBytes(n.dataPartition.available)} / ${fmtBytes(n.dataPartition.total)}` : '—'}</Table.Td>
                  <Table.Td>{n.resyncQueueLen == null ? '—' : n.resyncQueueLen > 0 ? <Badge color="orange" variant="light">{n.resyncQueueLen.toLocaleString()} {t('clusterOverview.blocks')}</Badge> : 0}</Table.Td>
                  <Table.Td>{n.isUp ? <Badge color="green">{t('nodeMaintenance.up')}</Badge> : <Badge color="red">{t('nodeMaintenance.down')}</Badge>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  )
}
