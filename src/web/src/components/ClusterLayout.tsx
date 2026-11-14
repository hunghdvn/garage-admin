import { useState, type ReactNode } from 'react'
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, NumberInput, Select, SelectItem, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from 'h2d-glass-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ClusterLayoutData, type LayoutHistory, type LayoutPreview, type LayoutStatistics } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from '../pages/BucketsPage'
import { toast } from 'h2d-glass-ui'
import { useTranslation } from 'react-i18next'

function LayoutStats({ s }: { s: LayoutStatistics }) {
  const { t } = useTranslation()
  const rows: [string, ReactNode][] = [
    [t('clusterLayout.replicationFactor'), s.replicationFactor],
    [t('clusterLayout.effectiveZoneRedundancy'), s.effectiveZoneRedundancy],
    [t('clusterLayout.partitionSize'), s.previousPartitionSize != null && s.previousPartitionSize !== s.partitionSize ? `${fmtBytes(s.partitionSize)} (${t('clusterLayout.previous')}: ${fmtBytes(s.previousPartitionSize)})` : fmtBytes(s.partitionSize)],
    [t('clusterLayout.rawCapacity'), fmtBytes(s.totalCapacity)],
    [t('clusterLayout.usableCapacity'), fmtBytes(s.usableCapacity)],
    [t('clusterLayout.effectiveCapacity'), fmtBytes(s.effectiveCapacity)],
    [t('clusterLayout.partitionsMoved'), s.totalMovedPartitions ?? '—'],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {s.lowPartitionSize && <Alert status="warning">{t('clusterLayout.lowPartitionSize')}</Alert>}
      {s.lowUsableCapacity && <Alert status="warning">{t('clusterLayout.lowUsableCapacity')}</Alert>}
      <Table>
        <TableBody>
          {rows.map(([k, v]) => (
            <TableRow key={k}><TableCell style={{ opacity: 0.7 }}>{k}</TableCell><TableCell>{v}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
      <div style={{ overflowX: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('clusterLayout.zoneNode')}</TableHead>
              <TableHead>{t('clusterLayout.partitions')}</TableHead>
              <TableHead>{t('clusterLayout.new')}</TableHead>
              <TableHead>{t('clusterLayout.usableRaw')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.zones.flatMap((z) => [
              <TableRow key={`z-${z.name}`}>
                <TableCell style={{ fontWeight: 600 }}>{z.name}</TableCell>
                <TableCell>{z.uniquePartitions} {t('clusterLayout.unique')} · {z.totalReplicatedPartitions} {t('clusterLayout.replicas')}</TableCell>
                <TableCell />
                <TableCell>{fmtBytes(z.usableCapacity)} / {fmtBytes(z.totalCapacity)}</TableCell>
              </TableRow>,
              ...z.nodes.map((n) => (
                <TableRow key={`n-${n.id}`}>
                  <TableCell style={{ paddingLeft: 16 }}><code>{n.id.slice(0, 16)}…</code>{n.tags.length > 0 && <span style={{ fontSize: 11, opacity: 0.6 }}> [{n.tags.join(', ')}]</span>}</TableCell>
                  <TableCell>{n.storedPartitions}</TableCell>
                  <TableCell>{n.newPartitions}</TableCell>
                  <TableCell>{fmtBytes(n.usableCapacity)} / {fmtBytes(n.totalCapacity)}</TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function ClusterLayout() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const layout = useQuery({ queryKey: ['cluster-layout'], queryFn: async () => (await api.get<ClusterLayoutData>('/cluster/layout')).data })
  const history = useQuery({ queryKey: ['cluster-layout-history'], queryFn: async () => (await api.get<LayoutHistory>('/cluster/layout/history')).data })

  const [preview, setPreview] = useState<{ title: string; data: LayoutPreview } | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [connectText, setConnectText] = useState('')
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
    mutationFn: async () => (await api.post('/cluster/layout/stage', { changes: [{ node_id: nodeId, zone, capacity: capacity === '' ? null : Number(capacity), tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [], remove: false }] })).data,
    onSuccess: () => { refresh(); toast.success(t('clusterLayout.staged')); setNodeId(''); setZone(''); setCapacity(''); setTags('') },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('clusterLayout.stageFailed')),
  })
  const previewMut = useMutation({
    mutationFn: async () => (await api.post<LayoutPreview>('/cluster/layout/preview', {})).data,
    onSuccess: (data) => setPreview({ title: t('clusterLayout.previewTitle'), data }),
    onError: (e: any) => toast.error(e?.response?.data?.error || t('clusterLayout.previewFailed')),
  })
  const applyMut = useMutation({
    mutationFn: async (version: number) => (await api.post<LayoutPreview>('/cluster/layout/apply', { version })).data,
    onSuccess: (data, version) => {
      refresh(); setApplyOpen(false)
      setPreview(data?.statistics || data?.message?.length ? { title: t('clusterLayout.appliedTitle', { version }), data } : null)
      toast.success(t('clusterLayout.applied'))
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('clusterLayout.applyFailed')),
  })
  const revertMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/layout/revert', {})).data,
    onSuccess: () => { refresh(); toast.success(t('clusterLayout.reverted')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('clusterLayout.revertFailed')),
  })
  const connectMut = useMutation({
    mutationFn: async () => (await api.post('/cluster/connect', { nodes: connectText.split('\n').map((l) => l.trim()).filter(Boolean) })).data,
    onSuccess: () => { refresh(); setConnectText(''); toast.success(t('clusterLayout.connectSent')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('clusterLayout.connectFailed')),
  })

  if (layout.isLoading || !layout.data) return <Spinner />
  const l = layout.data
  const hasStaged = l.stagedRoleChanges.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ padding: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h5 style={{ margin: 0 }}>{t('clusterLayout.layoutVersion', { version: l.version })}</h5>
            <span style={{ fontSize: 13, opacity: 0.6 }}>{t('clusterLayout.partitionSize')}: {fmtBytes(l.partitionSize)}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('nodeMaintenance.node')}</TableHead>
                  <TableHead>{t('clusterOverview.zone')}</TableHead>
                  <TableHead>{t('clusterLayout.capacity')}</TableHead>
                  <TableHead>{t('clusterLayout.partitions')}</TableHead>
                  <TableHead>{t('clusterLayout.tags')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {l.roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell><code>{role.id.slice(0, 16)}…</code></TableCell>
                    <TableCell>{role.zone}</TableCell>
                    <TableCell>{role.capacity != null ? fmtBytes(role.capacity) : t('nodeMaintenance.gateway')}</TableCell>
                    <TableCell>{role.storedPartitions}</TableCell>
                    <TableCell>{role.tags.join(', ') || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>

      {hasStaged && (
        <Alert status="warning" title={t('clusterLayout.stagedChanges')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {l.stagedRoleChanges.map((c) => (
              <span key={c.id} style={{ fontSize: 13 }}>
                <code>{c.id.slice(0, 12)}…</code> — {c.remove ? 'REMOVE' : `zone=${c.zone}, capacity=${c.capacity != null ? fmtBytes(c.capacity) : t('nodeMaintenance.gateway')}, tags=[${c.tags.join(', ')}]`}
              </span>
            ))}
            {isAdmin && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button variant="secondary" onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>{t('clusterLayout.preview')}</Button>
                <Button onClick={() => setApplyOpen(true)}>{t('clusterLayout.apply', { version: l.version + 1 })}</Button>
                <Button variant="danger" onClick={() => revertMut.mutate()} disabled={revertMut.isPending}>{t('clusterLayout.revert')}</Button>
              </div>
            )}
          </div>
        </Alert>
      )}

      {isAdmin && (
        <Card>
          <div style={{ padding: 8 }}>
            <h5 style={{ margin: '0 0 8px' }}>{t('clusterLayout.stageRoleChange')}</h5>
            <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>{t('clusterLayout.stageRoleHint')}</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={t('clusterLayout.nodeId')}><Input value={nodeId} onChange={(e) => setNodeId(e.currentTarget.value)} style={{ width: 260 }} /></Field>
              <Field label={t('clusterOverview.zone')}><Input value={zone} onChange={(e) => setZone(e.currentTarget.value)} style={{ width: 120 }} /></Field>
              <Field label={t('clusterLayout.capacityBytes')}><NumberInput value={capacity === '' ? null : capacity} onValueChange={(v) => setCapacity(v ?? '')} style={{ width: 180 }} min={0} /></Field>
              <Field label={t('clusterLayout.tagsComma')}><Input value={tags} onChange={(e) => setTags(e.currentTarget.value)} style={{ width: 160 }} /></Field>
              <Button onClick={() => stageMut.mutate()} disabled={stageMut.isPending || !nodeId || !zone}>{t('clusterLayout.stage')}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('clusterLayout.layoutHistory')}</h5>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('clusterLayout.version')}</TableHead>
                  <TableHead>{t('clusterLayout.status')}</TableHead>
                  <TableHead>{t('clusterLayout.storageNodes')}</TableHead>
                  <TableHead>{t('clusterLayout.gatewayNodes')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data?.versions.map((v) => (
                  <TableRow key={v.version}>
                    <TableCell>{v.version}</TableCell>
                    <TableCell>{v.version === history.data!.currentVersion ? <Badge variant="accent">{v.status}</Badge> : v.status}</TableCell>
                    <TableCell>{v.storageNodes}</TableCell>
                    <TableCell>{v.gatewayNodes}</TableCell>
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
            <h5 style={{ margin: '0 0 8px' }}>{t('clusterLayout.connectNode')}</h5>
            <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>{t('clusterLayout.connectNodeHint')}</p>
            <Textarea value={connectText} onChange={(e) => setConnectText(e.currentTarget.value)} rows={2} />
            <Button variant="secondary" style={{ marginTop: 8 }} onClick={() => connectMut.mutate()} disabled={connectMut.isPending || !connectText.trim()}>{t('clusterLayout.connect')}</Button>
          </div>
        </Card>
      )}

      <Dialog open={preview != null} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{preview?.title}</DialogTitle></DialogHeader>
          {preview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {preview.data.statistics && <LayoutStats s={preview.data.statistics} />}
              {preview.data.message?.length > 0 && <code style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{preview.data.message.join('\n')}</code>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('clusterLayout.confirmApply')}</DialogTitle></DialogHeader>
          <Alert status="warning">{t('clusterLayout.applyWarning', { version: l.version + 1 })}</Alert>
          <Button color="green" onClick={() => applyMut.mutate(l.version + 1)} disabled={applyMut.isPending}>
            {t('clusterLayout.applyVersion', { version: l.version + 1 })}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}