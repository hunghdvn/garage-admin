import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectItem, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from 'h2d-glass-ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, firstNode, type ClusterStatus, type MultiNode, type NodeInfoData, type Worker } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'
import { toast } from 'h2d-glass-ui'
import { useTranslation } from 'react-i18next'

const REPAIR_TYPES = ['tables', 'blocks', 'versions', 'multipartUploads', 'blockRefs', 'blockRc', 'rebalance', 'aliases', 'clearResyncQueue']

export function NodeMaintenancePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [node, setNode] = useState<string>('')

  const status = useQuery({ queryKey: ['cluster-status'], queryFn: async () => (await api.get<ClusterStatus>('/cluster/status')).data })
  useEffect(() => { if (!node && status.data?.nodes?.length) setNode(status.data.nodes[0].id) }, [status.data, node])

  const info = useQuery({ queryKey: ['node-info', node], queryFn: async () => (await api.get<MultiNode<NodeInfoData>>('/nodes/info', { params: { node } })).data, enabled: !!node })
  const stats = useQuery({ queryKey: ['node-stats', node], queryFn: async () => (await api.get<MultiNode<{ freeform: string }>>('/nodes/statistics', { params: { node } })).data, enabled: !!node })
  const workers = useQuery({ queryKey: ['node-workers', node], queryFn: async () => (await api.get<MultiNode<Worker[]>>('/nodes/workers', { params: { node } })).data, enabled: !!node })
  const blockErrors = useQuery({ queryKey: ['node-block-errors', node], queryFn: async () => (await api.get<MultiNode<unknown[]>>('/nodes/blocks/errors', { params: { node } })).data, enabled: !!node })

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('nodeMaintenance.title')}</h3>
        <Select value={node || null} onValueChange={(v) => v && setNode(v)}>
          {nodeOptions.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
        </Select>
      </div>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('nodeMaintenance.nodeInfo')}</h5>
          {nodeInfo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.hostname')}</span><span>{nodeInfo.hostname}</span></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.garageVersion')}</span><Badge>{nodeInfo.garageVersion}</Badge></div>
              <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.dbEngine')}</span><span>{nodeInfo.dbEngine}</span></div>
              <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.rust')}</span><span>{nodeInfo.rustVersion}</span></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.features')}</span><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{nodeInfo.garageFeatures.map((f) => <Badge key={f} variant="neutral">{f}</Badge>)}</div></div>
              {nodeInfo.addr && <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.rpcAddress')}</span><code>{nodeInfo.addr}</code></div>}
              {nodeInfo.isUp !== undefined && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.status')}</span><div style={{ display: 'flex', gap: 4 }}>
                  {nodeInfo.isUp ? <Badge variant="success">{t('nodeMaintenance.up')}</Badge> : <Badge variant="danger">{t('nodeMaintenance.down')}</Badge>}
                  {nodeInfo.draining && <Badge variant="warning">{t('nodeMaintenance.draining')}</Badge>}
                </div></div>
              )}
              {nodeInfo.role !== undefined && (
                <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.role')}</span><span>{nodeInfo.role ? `zone ${nodeInfo.role.zone} · ${nodeInfo.role.capacity != null ? fmtBytes(nodeInfo.role.capacity) : t('nodeMaintenance.gateway')} · ${nodeInfo.role.tags.length ? `${t('nodeMaintenance.tags')}: ${nodeInfo.role.tags.join(', ')}` : ''}` : t('nodeMaintenance.noRole')}</span></div>
              )}
              {nodeInfo.dataPartition && <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.dataPartition')}</span><span>{fmtBytes(nodeInfo.dataPartition.available)} {t('nodeMaintenance.free')} / {fmtBytes(nodeInfo.dataPartition.total)}</span></div>}
              {nodeInfo.metadataPartition && <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.metadataPartition')}</span><span>{fmtBytes(nodeInfo.metadataPartition.available)} {t('nodeMaintenance.free')} / {fmtBytes(nodeInfo.metadataPartition.total)}</span></div>}
              {nodeInfo.connectionParameters && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ width: 160, opacity: 0.7 }}>{t('nodeMaintenance.clientConnection')}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13 }}>{t('nodeMaintenance.region')}: <code>{nodeInfo.connectionParameters.region}</code></span>
                    {nodeInfo.connectionParameters.s3Endpoint && <span style={{ fontSize: 13 }}>{t('nodeMaintenance.s3Endpoint')}: <code>{nodeInfo.connectionParameters.s3Endpoint}</code></span>}
                    {nodeInfo.connectionParameters.s3UsePathStyle != null && <span style={{ fontSize: 13 }}>{t('nodeMaintenance.pathStyle')}: <code>{nodeInfo.connectionParameters.s3UsePathStyle ? t('common.yes') : t('common.no')}</code></span>}
                    {nodeInfo.connectionParameters.k2vEndpoint && <span style={{ fontSize: 13 }}>{t('nodeMaintenance.k2vEndpoint')}: <code>{nodeInfo.connectionParameters.k2vEndpoint}</code></span>}
                  </div>
                </div>
              )}
            </div>
          ) : nodeErr ? <Alert status="error">{nodeErr}</Alert> : <Spinner />}
        </div>
      </Card>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('nodeMaintenance.statistics')}</h5>
          <code style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{firstNode(stats.data, node)?.freeform ?? '…'}</code>
        </div>
      </Card>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('nodeMaintenance.workers')} ({workerList.length})</h5>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t('nodeMaintenance.name')}</TableHead>
                  <TableHead>{t('nodeMaintenance.state')}</TableHead>
                  <TableHead>{t('nodeMaintenance.errors')}</TableHead>
                  <TableHead>{t('nodeMaintenance.queue')}</TableHead>
                  <TableHead>{t('nodeMaintenance.tranquility')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workerList.map((wk) => (
                  <TableRow key={wk.id}>
                    <TableCell>{wk.id}</TableCell>
                    <TableCell><a onClick={() => showWorker(wk.id)} style={{ cursor: 'pointer' }}>{wk.name}</a></TableCell>
                    <TableCell><Badge variant={wk.state === 'busy' ? 'accent' : wk.errors > 0 ? 'danger' : 'neutral'}>{wk.state}</Badge></TableCell>
                    <TableCell>{wk.errors}</TableCell>
                    <TableCell>{wk.queueLength}</TableCell>
                    <TableCell>{wk.tranquility ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>

      {isAdmin && (
        <Card>
          <div style={{ padding: 8 }}>
            <h5 style={{ margin: '0 0 8px' }}>{t('nodeMaintenance.tuneWorker')}</h5>
            <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>{t('nodeMaintenance.tuneWorkerExample')}</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={t('nodeMaintenance.variable')}><Input value={wvar} onChange={(e) => setWvar(e.currentTarget.value)} style={{ width: 240 }} /></Field>
              <Field label={t('nodeMaintenance.value')}><Input value={wval} onChange={(e) => setWval(e.currentTarget.value)} style={{ width: 140 }} /></Field>
              <Button onClick={() => mutate(() => api.post('/nodes/workers/variable', { variable: wvar, value: wval }, { params: { node } }), t('nodeMaintenance.workerVariableSet'))} disabled={!wvar}>{t('common.set')}</Button>
            </div>
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <div style={{ padding: 8 }}>
            <h5 style={{ margin: '0 0 8px' }}>{t('nodeMaintenance.maintenance')}</h5>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => setConfirm({ title: t('nodeMaintenance.metadataSnapshotConfirm'), run: () => mutate(() => api.post('/nodes/snapshot', {}, { params: { node } }), t('nodeMaintenance.snapshotCreated')) })}>{t('nodeMaintenance.metadataSnapshot')}</Button>
              <Field label={t('nodeMaintenance.repairType')}>
                <Select value={repairType} onValueChange={setRepairType}>
                  {REPAIR_TYPES.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
                </Select>
              </Field>
              <Button variant="secondary" color="orange" onClick={() => setConfirm({ title: t('nodeMaintenance.launchRepairConfirm', { type: repairType }), run: () => mutate(() => api.post('/nodes/repair', { repair_type: repairType }, { params: { node } }), t('nodeMaintenance.repairLaunched')) })} disabled={!repairType}>{t('nodeMaintenance.launchRepair')}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ padding: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h5 style={{ margin: 0 }}>{t('nodeMaintenance.blockErrors')} ({errList.length})</h5>
            {isAdmin && errList.length > 0 && (
              <Button variant="secondary" onClick={() => setConfirm({ title: t('nodeMaintenance.retryAllConfirm'), run: () => mutate(() => api.post('/nodes/blocks/retry', { all: true }, { params: { node } }), t('nodeMaintenance.retryRequested')) })}>{t('nodeMaintenance.retryAll')}</Button>
            )}
          </div>
          {errList.length === 0 ? <span style={{ fontSize: 13, opacity: 0.6 }}>{t('nodeMaintenance.noBlockErrors')}</span> : <code style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{JSON.stringify(errList, null, 2)}</code>}
          {isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t('nodeMaintenance.purgeBlocks')}</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>{t('nodeMaintenance.purgeBlocksDesc')}</span>
              <Textarea value={purgeText} onChange={(e) => setPurgeText(e.currentTarget.value)} rows={2} />
              <Button variant="danger" style={{ width: 160 }} disabled={!purgeText.trim()} onClick={() => setConfirm({ title: t('nodeMaintenance.purgeConfirm'), run: () => mutate(() => api.post('/nodes/blocks/purge', { block_hashes: purgeText.split('\n').map((l) => l.trim()).filter(Boolean) }, { params: { node } }), t('nodeMaintenance.purged')) })}>
                {t('nodeMaintenance.purge')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('nodeMaintenance.blockLookup')}</h5>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Field label={t('nodeMaintenance.blockHash')}><Input value={blockHash} onChange={(e) => setBlockHash(e.currentTarget.value)} style={{ width: 360 }} /></Field>
            <Button variant="secondary" onClick={lookupBlock} disabled={!blockHash}>{t('nodeMaintenance.lookup')}</Button>
          </div>
          {blockInfo != null && <code style={{ display: 'block', whiteSpace: 'pre-wrap', marginTop: 8 }}>{JSON.stringify(blockInfo, null, 2)}</code>}
        </div>
      </Card>

      <Dialog open={confirm != null} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('common.confirm')}</DialogTitle></DialogHeader>
          <Alert status="warning">{confirm?.title}</Alert>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => { confirm?.run(); setConfirm(null) }}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={workerDetail != null} onOpenChange={(o) => { if (!o) setWorkerDetail(null) }}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{t('nodeMaintenance.workerDetail')}</DialogTitle></DialogHeader>
          <code style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{JSON.stringify(workerDetail, null, 2)}</code>
        </DialogContent>
      </Dialog>
    </div>
  )
}
