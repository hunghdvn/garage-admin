import { toast, Spinner , Input } from 'h2d-glass-ui'
import { useEffect, useState } from 'react'
import {
  Alert, Anchor, Badge, Button, Card, Code, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, firstNode, type ClusterStatus, type MultiNode, type NodeInfoData, type Worker } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'
import { useTranslation } from 'react-i18next'

const REPAIR_TYPES = ['tables', 'blocks', 'versions', 'multipartUploads', 'blockRefs', 'blockRc', 'rebalance', 'aliases', 'clearResyncQueue']

export function NodeMaintenancePage() {
  const { t } = useTranslation()
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
    } catch (e: any) { toast.error(e?.response?.data?.error || t('common.error')) }
  }
  async function lookupBlock() {
    try {
      const data = (await api.post('/nodes/blocks/info', { block_hash: blockHash }, { params: { node } })).data
      setBlockInfo(data)
    } catch (e: any) { toast.error(e?.response?.data?.error || t('common.error')) }
  }

  const mutate = (fn: () => Promise<{ data?: { error?: Record<string, string> } }>, ok: string) =>
    fn().then((res) => {
      const errMap = res?.data?.error
      if (errMap && Object.keys(errMap).length > 0) {
        toast.error(String(Object.values(errMap)[0]))
        return
      }
      toast.success(ok)
      qc.invalidateQueries({ queryKey: ['node-workers', node] })
      qc.invalidateQueries({ queryKey: ['node-block-errors', node] })
    }).catch((e: any) => toast.error(e?.response?.data?.error || t('nodeMaintenance.operationFailed')))

  if (status.isLoading) return <Spinner />
  const nodeOptions = (status.data?.nodes ?? []).map((n) => ({ value: n.id, label: `${n.hostname} (${n.id.slice(0, 12)}…)` }))
  const nodeInfo = firstNode(info.data, node)
  const nodeErr = info.data?.error?.[node]
  const workerList = firstNode(workers.data, node) ?? []
  const errList = firstNode(blockErrors.data, node) ?? []

  return (
    <Stack>
      <Group justify="space-between">
        <h3>{t('nodeMaintenance.title')}</h3>
        <Select data={nodeOptions} value={node || null} onChange={(v) => v && setNode(v)} allowDeselect={false} />
      </Group>

      <Card withBorder>
        <h5>{t('nodeMaintenance.nodeInfo')}</h5>
        {nodeInfo ? (
          <Stack gap={4}>
            <Group><span>{t('nodeMaintenance.hostname')}</span><span>{nodeInfo.hostname}</span></Group>
            <Group><span>{t('nodeMaintenance.garageVersion')}</span><Badge>{nodeInfo.garageVersion}</Badge></Group>
            <Group><span>{t('nodeMaintenance.dbEngine')}</span><span>{nodeInfo.dbEngine}</span></Group>
            <Group><span>{t('nodeMaintenance.rust')}</span><span>{nodeInfo.rustVersion}</span></Group>
            <Group align="start"><span>{t('nodeMaintenance.features')}</span><Group gap={4}>{nodeInfo.garageFeatures.map((f) => <Badge key={f} variant="light" size="sm">{f}</Badge>)}</Group></Group>
            {/* Garage >= v2.4 */}
            {nodeInfo.addr && <Group><span>{t('nodeMaintenance.rpcAddress')}</span><code>{nodeInfo.addr}</code></Group>}
            {nodeInfo.isUp !== undefined && (
              <Group><span>{t('nodeMaintenance.status')}</span><Group gap={4}>
                {nodeInfo.isUp ? <Badge color="green">{t('nodeMaintenance.up')}</Badge> : <Badge color="red">{t('nodeMaintenance.down')}</Badge>}
                {nodeInfo.draining && <Badge color="orange">{t('nodeMaintenance.draining')}</Badge>}
              </Group></Group>
            )}
            {nodeInfo.role !== undefined && (
              <Group><span>{t('nodeMaintenance.role')}</span><span>{nodeInfo.role
                ? `zone ${nodeInfo.role.zone} · ${nodeInfo.role.capacity != null ? fmtBytes(nodeInfo.role.capacity) : t('nodeMaintenance.gateway')} · ${nodeInfo.role.tags.length ? `${t('nodeMaintenance.tags')}: ${nodeInfo.role.tags.join(', ')}` : ''}`
                : t('nodeMaintenance.noRole')}</span></Group>
            )}
            {nodeInfo.dataPartition && <Group><span>{t('nodeMaintenance.dataPartition')}</span><span>{fmtBytes(nodeInfo.dataPartition.available)} {t('nodeMaintenance.free')} / {fmtBytes(nodeInfo.dataPartition.total)}</span></Group>}
            {nodeInfo.metadataPartition && <Group><span>{t('nodeMaintenance.metadataPartition')}</span><span>{fmtBytes(nodeInfo.metadataPartition.available)} {t('nodeMaintenance.free')} / {fmtBytes(nodeInfo.metadataPartition.total)}</span></Group>}
            {/* Garage >= v2.5: what S3/K2V clients should use to reach this node */}
            {nodeInfo.connectionParameters && (
              <Group align="start"><span>{t('nodeMaintenance.clientConnection')}</span>
                <Stack gap={2}>
                  <span>{t('nodeMaintenance.region')}: <code>{nodeInfo.connectionParameters.region}</code></span>
                  {nodeInfo.connectionParameters.s3Endpoint && <span>{t('nodeMaintenance.s3Endpoint')}: <code>{nodeInfo.connectionParameters.s3Endpoint}</code></span>}
                  {nodeInfo.connectionParameters.s3UsePathStyle != null && <span>{t('nodeMaintenance.pathStyle')}: <code>{nodeInfo.connectionParameters.s3UsePathStyle ? t('common.yes') : t('common.no')}</code></span>}
                  {nodeInfo.connectionParameters.k2vEndpoint && <span>{t('nodeMaintenance.k2vEndpoint')}: <code>{nodeInfo.connectionParameters.k2vEndpoint}</code></span>}
                </Stack>
              </Group>
            )}
          </Stack>
        ) : nodeErr ? <Alert color="red">{nodeErr}</Alert> : <Spinner size="sm" />}
      </Card>

      <Card withBorder>
        <h5>{t('nodeMaintenance.statistics')}</h5>
        <code>{firstNode(stats.data, node)?.freeform ?? '…'}</code>
      </Card>

      <Card withBorder>
        <h5>{t('nodeMaintenance.workers')} ({workerList.length})</h5>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>ID</Table.Th><Table.Th>{t('nodeMaintenance.name')}</Table.Th><Table.Th>{t('nodeMaintenance.state')}</Table.Th><Table.Th>{t('nodeMaintenance.errors')}</Table.Th><Table.Th>{t('nodeMaintenance.queue')}</Table.Th><Table.Th>{t('nodeMaintenance.tranquility')}</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {workerList.map((wk) => (
              <Table.Tr key={wk.id}>
                <Table.Td>{wk.id}</Table.Td>
                <Table.Td><a onClick={() => showWorker(wk.id)}>{wk.name}</a></Table.Td>
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
          <h5>{t('nodeMaintenance.tuneWorker')}</h5>
          <span>{t('nodeMaintenance.tuneWorkerExample')}</span>
          <Group align="end">
            <Input value={wvar} onChange={(e) => setWvar(e.currentTarget.value)} />
            <Input value={wval} onChange={(e) => setWval(e.currentTarget.value)} />
            <Button onClick={() => mutate(() => api.post('/nodes/workers/variable', { variable: wvar, value: wval }, { params: { node } }), t('nodeMaintenance.workerVariableSet'))} disabled={!wvar}>{t('common.set')}</Button>
          </Group>
        </Card>
      )}

      {isAdmin && (
        <Card withBorder>
          <h5>{t('nodeMaintenance.maintenance')}</h5>
          <Group align="end">
            <Button variant="light" onClick={() => setConfirm({ title: t('nodeMaintenance.metadataSnapshotConfirm'), run: () => mutate(() => api.post('/nodes/snapshot', {}, { params: { node } }), t('nodeMaintenance.snapshotCreated')) })}>{t('nodeMaintenance.metadataSnapshot')}</Button>
            <Select label={t('nodeMaintenance.repairType')} data={REPAIR_TYPES} value={repairType} onChange={setRepairType} />
            <Button color="orange" onClick={() => setConfirm({ title: t('nodeMaintenance.launchRepairConfirm', { type: repairType }), run: () => mutate(() => api.post('/nodes/repair', { repair_type: repairType }, { params: { node } }), t('nodeMaintenance.repairLaunched')) })} disabled={!repairType}>{t('nodeMaintenance.launchRepair')}</Button>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Group justify="space-between">
          <h5>{t('nodeMaintenance.blockErrors')} ({errList.length})</h5>
          {isAdmin && errList.length > 0 && (
            <Button size="xs" variant="light" onClick={() => setConfirm({ title: t('nodeMaintenance.retryAllConfirm'), run: () => mutate(() => api.post('/nodes/blocks/retry', { all: true }, { params: { node } }), t('nodeMaintenance.retryRequested')) })}>{t('nodeMaintenance.retryAll')}</Button>
          )}
        </Group>
        {errList.length === 0 ? <span>{t('nodeMaintenance.noBlockErrors')}</span> : <code>{JSON.stringify(errList, null, 2)}</code>}
        {isAdmin && (
          <Stack mt="md">
            <span>{t('nodeMaintenance.purgeBlocks')}</span>
            <span>{t('nodeMaintenance.purgeBlocksDesc')}</span>
            <Textarea value={purgeText} onChange={(e) => setPurgeText(e.currentTarget.value)} minRows={2} autosize placeholder="hash..." />
            <Button color="red" disabled={!purgeText.trim()}
              onClick={() => setConfirm({
                title: t('nodeMaintenance.purgeConfirm'),
                run: () => mutate(() => api.post('/nodes/blocks/purge', { block_hashes: purgeText.split('\n').map((l) => l.trim()).filter(Boolean) }, { params: { node } }), t('nodeMaintenance.purged')),
              })}>
              {t('nodeMaintenance.purge')}
            </Button>
          </Stack>
        )}
      </Card>

      <Card withBorder>
        <h5>{t('nodeMaintenance.blockLookup')}</h5>
        <Group align="end">
          <Input value={blockHash} onChange={(e) => setBlockHash(e.currentTarget.value)} />
          <Button variant="light" onClick={lookupBlock} disabled={!blockHash}>{t('nodeMaintenance.lookup')}</Button>
        </Group>
        {blockInfo != null && <code>{JSON.stringify(blockInfo, null, 2)}</code>}
      </Card>

      <Modal opened={confirm != null} onClose={() => setConfirm(null)} title={t('common.confirm')}>
        <Stack>
          <Alert color="orange">{confirm?.title}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button color="red" onClick={() => { confirm?.run(); setConfirm(null) }}>{t('common.confirm')}</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={workerDetail != null} onClose={() => setWorkerDetail(null)} title={t('nodeMaintenance.workerDetail')} size="lg">
        <code>{JSON.stringify(workerDetail, null, 2)}</code>
      </Modal>
    </Stack>
  )
}
