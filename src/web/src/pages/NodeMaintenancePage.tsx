import { useEffect, useState } from 'react'
import {
  Alert, Anchor, Badge, Button, Card, Code, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, firstNode, type ClusterStatus, type MultiNode, type NodeInfoData, type Worker } from '../api/client'
import { useAuth } from '../auth/AuthContext'

const REPAIR_TYPES = ['tables', 'blocks', 'versions', 'multipartUploads', 'blockRefs', 'blockRc', 'rebalance', 'aliases', 'clearResyncQueue']

export function NodeMaintenancePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [node, setNode] = useState<string>('')

  const status = useQuery({ queryKey: ['cluster-status'], queryFn: async () => (await api.get<ClusterStatus>('/cluster/status')).data })

  useEffect(() => {
    if (!node && status.data?.nodes?.length) setNode(status.data.nodes[0].id)
  }, [status.data, node])

  const info = useQuery({
    queryKey: ['node-info', node],
    queryFn: async () => (await api.get<MultiNode<NodeInfoData>>('/nodes/info', { params: { node } })).data,
    enabled: !!node,
  })
  const stats = useQuery({
    queryKey: ['node-stats', node],
    queryFn: async () => (await api.get<MultiNode<{ freeform: string }>>('/nodes/statistics', { params: { node } })).data,
    enabled: !!node,
  })
  const workers = useQuery({
    queryKey: ['node-workers', node],
    queryFn: async () => (await api.get<MultiNode<Worker[]>>('/nodes/workers', { params: { node } })).data,
    enabled: !!node,
  })
  const blockErrors = useQuery({
    queryKey: ['node-block-errors', node],
    queryFn: async () => (await api.get<MultiNode<unknown[]>>('/nodes/blocks/errors', { params: { node } })).data,
    enabled: !!node,
  })

  const [repairType, setRepairType] = useState<string | null>('blocks')
  const [wvar, setWvar] = useState('')
  const [wval, setWval] = useState('')
  const [purgeText, setPurgeText] = useState('')
  const [confirm, setConfirm] = useState<null | { title: string; run: () => void }>(null)
  const [workerDetail, setWorkerDetail] = useState<unknown>(null)
  const [blockHash, setBlockHash] = useState('')
  const [blockInfo, setBlockInfo] = useState<unknown>(null)

  async function showWorker(wid: number) {
    try {
      const data = (await api.post('/nodes/workers/info', { id: wid }, { params: { node } })).data
      setWorkerDetail(data)
    } catch (e: any) { notifications.show({ color: 'red', message: e?.response?.data?.error || 'Lỗi' }) }
  }
  async function lookupBlock() {
    try {
      const data = (await api.post('/nodes/blocks/info', { block_hash: blockHash }, { params: { node } })).data
      setBlockInfo(data)
    } catch (e: any) { notifications.show({ color: 'red', message: e?.response?.data?.error || 'Lỗi' }) }
  }

  const mutate = (fn: () => Promise<{ data?: { error?: Record<string, string> } }>, ok: string) =>
    fn().then((res) => {
      const errMap = res?.data?.error
      if (errMap && Object.keys(errMap).length > 0) {
        notifications.show({ color: 'red', message: String(Object.values(errMap)[0]) })
        return
      }
      notifications.show({ color: 'green', message: ok })
      qc.invalidateQueries({ queryKey: ['node-workers', node] })
      qc.invalidateQueries({ queryKey: ['node-block-errors', node] })
    }).catch((e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Thao tác thất bại' }))

  if (status.isLoading) return <Loader />
  const nodeOptions = (status.data?.nodes ?? []).map((n) => ({ value: n.id, label: `${n.hostname} (${n.id.slice(0, 12)}…)` }))
  const nodeInfo = firstNode(info.data, node)
  const nodeErr = info.data?.error?.[node]
  const workerList = firstNode(workers.data, node) ?? []
  const errList = firstNode(blockErrors.data, node) ?? []

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Node Maintenance</Title>
        <Select w={320} data={nodeOptions} value={node || null} onChange={(v) => v && setNode(v)} allowDeselect={false} />
      </Group>

      <Card withBorder>
        <Title order={5} mb="sm">Thông tin node</Title>
        {nodeInfo ? (
          <Stack gap={4}>
            <Group><Text w={160} c="dimmed">Hostname</Text><Text>{nodeInfo.hostname}</Text></Group>
            <Group><Text w={160} c="dimmed">Garage version</Text><Badge>{nodeInfo.garageVersion}</Badge></Group>
            <Group><Text w={160} c="dimmed">DB engine</Text><Text>{nodeInfo.dbEngine}</Text></Group>
            <Group><Text w={160} c="dimmed">Rust</Text><Text>{nodeInfo.rustVersion}</Text></Group>
            <Group align="start"><Text w={160} c="dimmed">Features</Text><Group gap={4}>{nodeInfo.garageFeatures.map((f) => <Badge key={f} variant="light" size="sm">{f}</Badge>)}</Group></Group>
          </Stack>
        ) : nodeErr ? <Alert color="red">{nodeErr}</Alert> : <Loader size="sm" />}
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Thống kê</Title>
        <Code block>{firstNode(stats.data, node)?.freeform ?? '…'}</Code>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Workers ({workerList.length})</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>ID</Table.Th><Table.Th>Tên</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th>Lỗi</Table.Th><Table.Th>Queue</Table.Th><Table.Th>Tranquility</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {workerList.map((wk) => (
              <Table.Tr key={wk.id}>
                <Table.Td>{wk.id}</Table.Td>
                <Table.Td><Anchor onClick={() => showWorker(wk.id)}>{wk.name}</Anchor></Table.Td>
                <Table.Td><Badge variant="light" color={wk.state === 'busy' ? 'blue' : wk.errors > 0 ? 'red' : 'gray'}>{wk.state}</Badge></Table.Td>
                <Table.Td>{wk.errors}</Table.Td>
                <Table.Td>{wk.queueLength}</Table.Td>
                <Table.Td>{wk.tranquility ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Tinh chỉnh worker</Title>
          <Text size="xs" c="dimmed" mb="xs">Ví dụ: <code>resync-tranquility</code> = <code>2</code>, <code>resync-worker-count</code> = <code>4</code></Text>
          <Group align="end">
            <TextInput label="Variable" value={wvar} onChange={(e) => setWvar(e.currentTarget.value)} w={240} />
            <TextInput label="Value" value={wval} onChange={(e) => setWval(e.currentTarget.value)} w={140} />
            <Button onClick={() => mutate(() => api.post('/nodes/workers/variable', { variable: wvar, value: wval }, { params: { node } }), 'Đã set worker variable')} disabled={!wvar}>Set</Button>
          </Group>
        </Card>
      )}

      {isAdmin && (
        <Card withBorder>
          <Title order={5} mb="sm">Bảo trì</Title>
          <Group align="end">
            <Button variant="light" onClick={() => setConfirm({ title: 'Tạo metadata snapshot trên node này?', run: () => mutate(() => api.post('/nodes/snapshot', {}, { params: { node } }), 'Đã tạo snapshot') })}>Metadata snapshot</Button>
            <Select label="Repair type" data={REPAIR_TYPES} value={repairType} onChange={setRepairType} w={200} />
            <Button color="orange" onClick={() => setConfirm({ title: `Chạy repair "${repairType}" trên node này?`, run: () => mutate(() => api.post('/nodes/repair', { repair_type: repairType }, { params: { node } }), 'Đã khởi chạy repair') })} disabled={!repairType}>Launch repair</Button>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={5}>Block errors ({errList.length})</Title>
          {isAdmin && errList.length > 0 && (
            <Button size="xs" variant="light" onClick={() => setConfirm({ title: 'Retry resync tất cả block lỗi?', run: () => mutate(() => api.post('/nodes/blocks/retry', { all: true }, { params: { node } }), 'Đã yêu cầu retry resync') })}>Retry tất cả</Button>
          )}
        </Group>
        {errList.length === 0 ? <Text size="sm" c="dimmed">Không có block lỗi.</Text> : <Code block>{JSON.stringify(errList, null, 2)}</Code>}
        {isAdmin && (
          <Stack mt="md">
            <Text size="sm" fw={600}>Purge blocks (nguy hiểm)</Text>
            <Text size="xs" c="dimmed">Mỗi dòng một block hash. Purge xóa vĩnh viễn mọi object tham chiếu các block này.</Text>
            <Textarea value={purgeText} onChange={(e) => setPurgeText(e.currentTarget.value)} minRows={2} autosize placeholder="hash..." />
            <Button color="red" w={160} disabled={!purgeText.trim()}
              onClick={() => setConfirm({
                title: 'XÓA VĨNH VIỄN các block đã nhập? Không thể hoàn tác.',
                run: () => mutate(() => api.post('/nodes/blocks/purge', { block_hashes: purgeText.split('\n').map((l) => l.trim()).filter(Boolean) }, { params: { node } }), 'Đã purge blocks'),
              })}>
              Purge
            </Button>
          </Stack>
        )}
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Tra cứu block</Title>
        <Group align="end">
          <TextInput label="Block hash" value={blockHash} onChange={(e) => setBlockHash(e.currentTarget.value)} w={360} />
          <Button variant="light" onClick={lookupBlock} disabled={!blockHash}>Tra cứu</Button>
        </Group>
        {blockInfo != null && <Code block mt="sm">{JSON.stringify(blockInfo, null, 2)}</Code>}
      </Card>

      <Modal opened={confirm != null} onClose={() => setConfirm(null)} title="Xác nhận">
        <Stack>
          <Alert color="orange">{confirm?.title}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>Hủy</Button>
            <Button color="red" onClick={() => { confirm?.run(); setConfirm(null) }}>Xác nhận</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={workerDetail != null} onClose={() => setWorkerDetail(null)} title="Chi tiết worker" size="lg">
        <Code block>{JSON.stringify(workerDetail, null, 2)}</Code>
      </Modal>
    </Stack>
  )
}
