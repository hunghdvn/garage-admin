import { Card, Grid, Group, Loader, Text, Title, Badge, Stack } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { api, type ClusterHealth } from '../api/client'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card withBorder>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="xl">{value}</Text>
    </Card>
  )
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['cluster-health'],
    queryFn: async () => (await api.get<ClusterHealth>('/cluster/health')).data,
  })

  return (
    <Stack>
      <Title order={3}>Dashboard</Title>
      {isLoading && <Loader />}
      {error && <Text c="red">Chưa kết nối được cluster. Kiểm tra Settings.</Text>}
      {data && (
        <>
          <Group>
            <Text>Trạng thái:</Text>
            <Badge color={data.status === 'healthy' ? 'green' : 'red'}>{data.status}</Badge>
          </Group>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Node kết nối" value={`${data.connectedNodes}/${data.knownNodes}`} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Storage nodes OK" value={`${data.storageNodesOk}/${data.storageNodes}`} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Partitions OK" value={`${data.partitionsAllOk}/${data.partitions}`} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}><Stat label="Partitions quorum" value={`${data.partitionsQuorum}/${data.partitions}`} /></Grid.Col>
          </Grid>
        </>
      )}
    </Stack>
  )
}
