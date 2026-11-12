import { useState, type ReactNode } from 'react'
import {
  Alert, Badge, Button, Card, Code, Group, Loader, Modal, NumberInput, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ClusterLayoutData, type LayoutHistory, type LayoutPreview, type LayoutStatistics } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from '../pages/BucketsPage'

// Structured layout computation statistics (Garage >= v2.4).
function LayoutStats({ s }: { s: LayoutStatistics }) {
  const rows: [string, ReactNode][] = [
    ['Replication factor', s.replicationFactor],
    ['Zone redundancy đạt được', s.effectiveZoneRedundancy],
    ['Partition size', s.previousPartitionSize != null && s.previousPartitionSize !== s.partitionSize
      ? `${fmtBytes(s.partitionSize)} (trước: ${fmtBytes(s.previousPartitionSize)})`
      : fmtBytes(s.partitionSize)],
    ['Dung lượng thô', fmtBytes(s.totalCapacity)],
    ['Dung lượng dùng được', fmtBytes(s.usableCapacity)],
    ['Dung lượng hiệu dụng (sau replication)', fmtBytes(s.effectiveCapacity)],
    ['Partition sẽ di chuyển', s.totalMovedPartitions ?? '—'],
  ]
  return (
    <Stack gap="sm">
      {s.lowPartitionSize && <Alert color="orange">Partition rất nhỏ — capacity các node có thể đang đặt quá thấp.</Alert>}
      {s.lowUsableCapacity && <Alert color="orange">Không tận dụng được hết dung lượng thô của các node (capacity giữa các zone/node chênh lệch).</Alert>}
      <Table>
        <Table.Tbody>
          {rows.map(([k, v]) => (
            <Table.Tr key={k}><Table.Td c="dimmed">{k}</Table.Td><Table.Td>{v}</Table.Td></Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Table.ScrollContainer minWidth={520}>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Zone / node</Table.Th><Table.Th>Partitions</Table.Th><Table.Th>Mới</Table.Th><Table.Th>Dùng được / thô</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {s.zones.flatMap((z) => [
              <Table.Tr key={`z-${z.name}`} fw={600}>
                <Table.Td>{z.name}</Table.Td>
                <Table.Td>{z.uniquePartitions} unique · {z.totalReplicatedPartitions} replicas</Table.Td>
                <Table.Td />
                <Table.Td>{fmtBytes(z.usableCapacity)} / {fmtBytes(z.totalCapacity)}</Table.Td>
              </Table.Tr>,
              ...z.nodes.map((n) => (
                <Table.Tr key={`n-${n.id}`}>
                  <Table.Td pl="lg"><code>{n.id.slice(0, 16)}…</code>{n.tags.length > 0 && <Text span size="xs" c="dimmed"> [{n.tags.join(', ')}]</Text>}</Table.Td>
                  <Table.Td>{n.storedPartitions}</Table.Td>
                  <Table.Td>{n.newPartitions}</Table.Td>
                  <Table.Td>{fmtBytes(n.usableCapacity)} / {fmtBytes(n.totalCapacity)}</Table.Td>
                </Table.Tr>
              )),
            ])}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  )
}

export function ClusterLayout() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const layout = useQuery({ queryKey: ['cluster-layout'], queryFn: async () => (await api.get<ClusterLayoutData>('/cluster/layout')).data })
  const history = useQuery({ queryKey: ['cluster-layout-history'], queryFn: async () => (await api.get<LayoutHistory>('/cluster/layout/history')).data })

  const [preview, setPreview] = useState<{ title: string; data: LayoutPreview } | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [connectText, setConnectText] = useState('')

  // staging form
  const [nodeId, setNodeId] = useState('')
  const [zone, setZone] = useState('')
  const [capacity, setCapacity] = useState<number | ''>('')
  const [tags, setTags] = useState('')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cluster-layout'] })
    qc.invalidateQueries({ queryKey: ['cluster-layout-history'] })
    qc.invalidateQueries({ queryKey: ['cluster-status'] })
  }

  const stageMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/layout/stage', {
      changes: [{
        node_id: nodeId, zone, capacity: capacity === '' ? null : Number(capacity),
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [], remove: false,
      }],
    })).data,
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã stage thay đổi' }); setNodeId(''); setZone(''); setCapacity(''); setTags('') },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Stage thất bại' }),
  })

  const previewMut = useMutation({
    mutationFn: async () => (await api.post<LayoutPreview>('/cluster/layout/preview', {})).data,
    onSuccess: (data) => setPreview({ title: 'Preview layout changes', data }),
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Preview thất bại' }),
  })

  const applyMut = useMutation({
    mutationFn: async (version: number) => (await api.post<LayoutPreview>('/cluster/layout/apply', { version })).data,
    onSuccess: (data, version) => {
      refresh()
      setApplyOpen(false)
      // Show what the new layout looks like (statistics: Garage >= v2.4).
      setPreview(data?.statistics || data?.message?.length ? { title: `Đã apply layout v${version}`, data } : null)
      notifications.show({ color: 'green', message: 'Đã apply layout' })
    },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Apply thất bại' }),
  })

  const revertMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/layout/revert', {})).data,
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã revert staged changes' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Revert thất bại' }),
  })

  const connectMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/connect', { nodes: connectText.split('\n').map((l) => l.trim()).filter(Boolean) })).data,
    onSuccess: () => { refresh(); setConnectText(''); notifications.show({ color: 'green', message: 'Đã gửi yêu cầu kết nối' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Kết nối thất bại' }),
  })

  if (layout.isLoading || !layout.data) return <Loader />
  const l = layout.data
  const hasStaged = l.stagedRoleChanges.length > 0

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between">
          <Title order={5}>Layout version {l.version}</Title>
          <Text size="sm" c="dimmed">Partition size: {fmtBytes(l.partitionSize)}</Text>
        </Group>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr><Table.Th>Node</Table.Th><Table.Th>Zone</Table.Th><Table.Th>Capacity</Table.Th><Table.Th>Partitions</Table.Th><Table.Th>Tags</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {l.roles.map((role) => (
              <Table.Tr key={role.id}>
                <Table.Td><code>{role.id.slice(0, 16)}…</code></Table.Td>
                <Table.Td>{role.zone}</Table.Td>
                <Table.Td>{role.capacity != null ? fmtBytes(role.capacity) : 'gateway'}</Table.Td>
                <Table.Td>{role.storedPartitions}</Table.Td>
                <Table.Td>{role.tags.join(', ') || '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {hasStaged && (
        <Alert color="yellow" title="Có thay đổi đang chờ (staged)">
          <Stack gap="xs">
            {l.stagedRoleChanges.map((c) => (
              <Text key={c.id} size="sm">
                <code>{c.id.slice(0, 12)}…</code> — {c.remove ? 'REMOVE' : `zone=${c.zone}, capacity=${c.capacity != null ? fmtBytes(c.capacity) : 'gateway'}, tags=[${c.tags.join(', ')}]`}
              </Text>
            ))}
            {isAdmin && (
              <Group mt="xs">
                <Button variant="light" onClick={() => previewMut.mutate()} loading={previewMut.isPending}>Preview</Button>
                <Button color="green" onClick={() => setApplyOpen(true)}>Apply (v{l.version + 1})</Button>
                <Button color="red" variant="light" onClick={() => revertMut.mutate()} loading={revertMut.isPending}>Revert</Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Stage thay đổi role cho node</Title>
          <Text size="xs" c="dimmed" mb="xs">Đặt capacity (bytes) cho node lưu trữ, để trống = gateway. ID node lấy từ tab Overview.</Text>
          <Group align="end">
            <TextInput label="Node ID" value={nodeId} onChange={(e) => setNodeId(e.currentTarget.value)} w={260} />
            <TextInput label="Zone" value={zone} onChange={(e) => setZone(e.currentTarget.value)} w={120} />
            <NumberInput label="Capacity (bytes)" value={capacity} onChange={(v) => setCapacity(typeof v === 'number' ? v : '')} w={180} min={0} />
            <TextInput label="Tags (phẩy)" value={tags} onChange={(e) => setTags(e.currentTarget.value)} w={160} />
            <Button onClick={() => stageMut.mutate()} loading={stageMut.isPending} disabled={!nodeId || !zone}>Stage</Button>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Title order={5} mb="sm">Lịch sử layout</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Version</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th>Storage nodes</Table.Th><Table.Th>Gateway nodes</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {history.data?.versions.map((v) => (
              <Table.Tr key={v.version}>
                <Table.Td>{v.version}</Table.Td>
                <Table.Td>{v.version === history.data!.currentVersion ? <Badge color="blue">{v.status}</Badge> : v.status}</Table.Td>
                <Table.Td>{v.storageNodes}</Table.Td>
                <Table.Td>{v.gatewayNodes}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Kết nối node</Title>
          <Text size="xs" c="dimmed" mb="xs">Mỗi dòng một node: <code>node_id@host:port</code></Text>
          <Textarea value={connectText} onChange={(e) => setConnectText(e.currentTarget.value)} minRows={2} autosize placeholder="abcdef123…@192.168.1.50:3901" />
          <Button mt="sm" variant="light" onClick={() => connectMut.mutate()} loading={connectMut.isPending} disabled={!connectText.trim()}>Kết nối</Button>
        </Card>
      )}

      <Modal opened={preview != null} onClose={() => setPreview(null)} title={preview?.title} size="lg">
        {preview && (
          <Stack>
            {preview.data.statistics && <LayoutStats s={preview.data.statistics} />}
            {preview.data.message?.length > 0 && <Code block>{preview.data.message.join('\n')}</Code>}
          </Stack>
        )}
      </Modal>

      <Modal opened={applyOpen} onClose={() => setApplyOpen(false)} title="Xác nhận apply layout">
        <Stack>
          <Alert color="orange">Apply sẽ ghi layout mới (version {l.version + 1}) và bắt đầu di chuyển dữ liệu. Hành động này khó hoàn tác.</Alert>
          <Button color="green" onClick={() => applyMut.mutate(l.version + 1)} loading={applyMut.isPending}>
            Apply version {l.version + 1}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
