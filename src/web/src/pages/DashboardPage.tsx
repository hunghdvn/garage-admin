import { Card, Group, Loader, Text, Title, Badge, Stack, SimpleGrid } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ClusterHealth, type ClusterStatistics, type BucketListItem, type KeyListItem } from '../api/client'
import { fmtBytes } from './BucketsPage'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card withBorder>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="xl">{value}</Text>
    </Card>
  )
}

export function DashboardPage() {
  const health = useQuery({ queryKey: ['cluster-health'], queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data })
  const stats = useQuery({ queryKey: ['cluster-stats'], queryFn: async () => (await api.get<ClusterStatistics>('/cluster/statistics')).data })
  const buckets = useQuery({ queryKey: ['buckets'], queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data })
  const keys = useQuery({ queryKey: ['keys'], queryFn: async () => (await api.get<KeyListItem[]>('/keys')).data })

  const loading = health.isLoading || stats.isLoading
  const errored = health.error || stats.error

  return (
    <Stack>
      <Title order={3}>Dashboard</Title>
      {loading && <Loader />}
      {errored && <Text c="red">Chưa kết nối được cluster. Kiểm tra Settings.</Text>}
      {health.data && (
        <Group>
          <Text>Trạng thái cluster:</Text>
          <Badge color={health.data.status === 'healthy' ? 'green' : 'red'}>{health.data.status}</Badge>
        </Group>
      )}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }}>
        {health.data && <Stat label="Node kết nối" value={`${health.data.connectedNodes}/${health.data.knownNodes}`} />}
        {health.data && <Stat label="Partitions OK" value={`${health.data.partitionsAllOk}/${health.data.partitions}`} />}
        {stats.data && <Stat label="Dung lượng trống" value={fmtBytes(stats.data.dataAvail)} />}
        {stats.data && <Stat label="Buckets" value={stats.data.bucketCount} />}
        {stats.data && <Stat label="Objects" value={stats.data.totalObjectCount} />}
        {stats.data && <Stat label="Tổng dung lượng" value={fmtBytes(stats.data.totalObjectBytes)} />}
      </SimpleGrid>

      <Title order={5} mt="md">Truy cập nhanh</Title>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Card withBorder component={Link} to="/buckets">
          <Text fw={600}>Buckets</Text>
          <Text size="sm" c="dimmed">{buckets.data?.length ?? '…'} bucket</Text>
        </Card>
        <Card withBorder component={Link} to="/keys">
          <Text fw={600}>Access Keys</Text>
          <Text size="sm" c="dimmed">{keys.data?.length ?? '…'} key</Text>
        </Card>
        <Card withBorder component={Link} to="/cluster">
          <Text fw={600}>Cluster</Text>
          <Text size="sm" c="dimmed">Layout & nodes</Text>
        </Card>
        <Card withBorder component={Link} to="/files">
          <Text fw={600}>Files</Text>
          <Text size="sm" c="dimmed">Duyệt object</Text>
        </Card>
      </SimpleGrid>
    </Stack>
  )
}
