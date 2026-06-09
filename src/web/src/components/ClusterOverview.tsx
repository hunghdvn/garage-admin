import { Badge, Card, Grid, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { api, type ClusterStatus, type ClusterStatistics, type ClusterHealth } from '../api/client'
import { fmtBytes } from '../pages/BucketsPage'

export function ClusterOverview() {
  const health = useQuery({ queryKey: ['cluster-health'], queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data })
  const stats = useQuery({ queryKey: ['cluster-stats'], queryFn: async () => (await api.get<ClusterStatistics>('/cluster/statistics')).data })
  const status = useQuery({ queryKey: ['cluster-status'], queryFn: async () => (await api.get<ClusterStatus>('/cluster/status')).data })

  if (health.isLoading || stats.isLoading || status.isLoading) return <Loader />
  if (health.error || stats.error || status.error) return <Text c="red">Không lấy được dữ liệu cluster. Kiểm tra Settings / kết nối.</Text>

  return (
    <Stack>
      <Group>
        <Text>Trạng thái:</Text>
        <Badge color={health.data!.status === 'healthy' ? 'green' : 'red'}>{health.data!.status}</Badge>
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Node kết nối</Text><Text fw={700} size="xl">{health.data!.connectedNodes}/{health.data!.knownNodes}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Dung lượng trống (data)</Text><Text fw={700} size="xl">{fmtBytes(stats.data!.dataAvail)}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Buckets</Text><Text fw={700} size="xl">{stats.data!.bucketCount}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Objects</Text><Text fw={700} size="xl">{stats.data!.totalObjectCount}</Text></Card></Grid.Col>
      </Grid>

      <Card withBorder>
        <Title order={5} mb="sm">Nodes</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>ID</Table.Th><Table.Th>Hostname</Table.Th><Table.Th>Zone</Table.Th><Table.Th>Capacity</Table.Th><Table.Th>Data avail</Table.Th><Table.Th>Trạng thái</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {status.data!.nodes.map((n) => (
              <Table.Tr key={n.id}>
                <Table.Td><code>{n.id.slice(0, 16)}…</code></Table.Td>
                <Table.Td>{n.hostname}</Table.Td>
                <Table.Td>{n.role?.zone ?? '—'}</Table.Td>
                <Table.Td>{n.role?.capacity != null ? fmtBytes(n.role.capacity) : 'gateway'}</Table.Td>
                <Table.Td>{n.dataPartition ? `${fmtBytes(n.dataPartition.available)} / ${fmtBytes(n.dataPartition.total)}` : '—'}</Table.Td>
                <Table.Td>{n.isUp ? <Badge color="green">up</Badge> : <Badge color="red">down</Badge>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
