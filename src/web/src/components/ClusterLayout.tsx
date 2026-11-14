import { toast, Spinner , Input } from 'h2d-glass-ui'
import { useState, type ReactNode } from 'react'
import {
  Alert, Badge, Button, Card, Code, Group, Loader, Modal, NumberInput, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ClusterLayoutData, type LayoutHistory, type LayoutPreview, type LayoutStatistics } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from '../pages/BucketsPage'
import { useTranslation } from 'react-i18next'

// Structured layout computation statistics (Garage >= v2.4).
function LayoutStats({ s }: { s: LayoutStatistics }) {
  const { t } = useTranslation()
  const rows: [string, ReactNode][] = [
    [t('clusterLayout.replicationFactor'), s.replicationFactor],
    [t('clusterLayout.effectiveZoneRedundancy'), s.effectiveZoneRedundancy],
    [t('clusterLayout.partitionSize'), s.previousPartitionSize != null && s.previousPartitionSize !== s.partitionSize
      ? `${fmtBytes(s.partitionSize)} (${t('clusterLayout.previous')}: ${fmtBytes(s.previousPartitionSize)})`
      : fmtBytes(s.partitionSize)],
    [t('clusterLayout.rawCapacity'), fmtBytes(s.totalCapacity)],
    [t('clusterLayout.usableCapacity'), fmtBytes(s.usableCapacity)],
    [t('clusterLayout.effectiveCapacity'), fmtBytes(s.effectiveCapacity)],
    [t('clusterLayout.partitionsMoved'), s.totalMovedPartitions ?? '—'],
  ]
  return (
    <Stack gap="sm">
      {s.lowPartitionSize && <Alert color="orange">{t('clusterLayout.lowPartitionSize')}</Alert>}
      {s.lowUsableCapacity && <Alert color="orange">{t('clusterLayout.lowUsableCapacity')}</Alert>}
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
            <Table.Tr><Table.Th>{t('clusterLayout.zoneNode')}</Table.Th><Table.Th>{t('clusterLayout.partitions')}</Table.Th><Table.Th>{t('clusterLayout.new')}</Table.Th><Table.Th>{t('clusterLayout.usableRaw')}</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {s.zones.flatMap((z) => [
              <Table.Tr key={`z-${z.name}`} fw={600}>
                <Table.Td>{z.name}</Table.Td>
                <Table.Td>{z.uniquePartitions} {t('clusterLayout.unique')} · {z.totalReplicatedPartitions} {t('clusterLayout.replicas')}</Table.Td>
                <Table.Td />
                <Table.Td>{fmtBytes(z.usableCapacity)} / {fmtBytes(z.totalCapacity)}</Table.Td>
              </Table.Tr>,
              ...z.nodes.map((n) => (
                <Table.Tr key={`n-${n.id}`}>
                  <Table.Td pl="lg"><code>{n.id.slice(0, 16)}…</code>{n.tags.length > 0 && <span> [{n.tags.join(', ')}]</span>}</Table.Td>
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
  const { t } = useTranslation()
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
      refresh()
      setApplyOpen(false)
      // Show what the new layout looks like (statistics: Garage >= v2.4).
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
    <Stack>
      <Card withBorder>
        <Group justify="space-between">
          <h5>{t('clusterLayout.layoutVersion', { version: l.version })}</h5>
          <span>{t('clusterLayout.partitionSize')}: {fmtBytes(l.partitionSize)}</span>
        </Group>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr><Table.Th>{t('nodeMaintenance.node')}</Table.Th><Table.Th>{t('clusterOverview.zone')}</Table.Th><Table.Th>{t('clusterLayout.capacity')}</Table.Th><Table.Th>{t('clusterLayout.partitions')}</Table.Th><Table.Th>{t('clusterLayout.tags')}</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {l.roles.map((role) => (
              <Table.Tr key={role.id}>
                <Table.Td><code>{role.id.slice(0, 16)}…</code></Table.Td>
                <Table.Td>{role.zone}</Table.Td>
                <Table.Td>{role.capacity != null ? fmtBytes(role.capacity) : t('nodeMaintenance.gateway')}</Table.Td>
                <Table.Td>{role.storedPartitions}</Table.Td>
                <Table.Td>{role.tags.join(', ') || '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {hasStaged && (
        <Alert color="yellow" title={t('clusterLayout.stagedChanges')}>
          <Stack gap="xs">
            {l.stagedRoleChanges.map((c) => (
              <span key={c.id}>
                <code>{c.id.slice(0, 12)}…</code> — {c.remove ? 'REMOVE' : `zone=${c.zone}, capacity=${c.capacity != null ? fmtBytes(c.capacity) : t('nodeMaintenance.gateway')}, tags=[${c.tags.join(', ')}]`}
              </span>
            ))}
            {isAdmin && (
              <Group mt="xs">
                <Button variant="light" onClick={() => previewMut.mutate()} loading={previewMut.isPending}>{t('clusterLayout.preview')}</Button>
                <Button color="green" onClick={() => setApplyOpen(true)}>{t('clusterLayout.apply', { version: l.version + 1 })}</Button>
                <Button color="red" variant="light" onClick={() => revertMut.mutate()} loading={revertMut.isPending}>{t('clusterLayout.revert')}</Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}

      {isAdmin && (
        <Card withBorder>
          <h5>{t('clusterLayout.stageRoleChange')}</h5>
          <span>{t('clusterLayout.stageRoleHint')}</span>
          <Group align="end">
            <Input value={nodeId} onChange={(e) => setNodeId(e.currentTarget.value)} />
            <Input value={zone} onChange={(e) => setZone(e.currentTarget.value)} />
            <NumberInput label={t('clusterLayout.capacityBytes')} value={capacity} onChange={(v) => setCapacity(typeof v === 'number' ? v : '')} min={0} />
            <Input value={tags} onChange={(e) => setTags(e.currentTarget.value)} />
            <Button onClick={() => stageMut.mutate()} loading={stageMut.isPending} disabled={!nodeId || !zone}>{t('clusterLayout.stage')}</Button>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <h5>{t('clusterLayout.layoutHistory')}</h5>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>{t('clusterLayout.version')}</Table.Th><Table.Th>{t('clusterLayout.status')}</Table.Th><Table.Th>{t('clusterLayout.storageNodes')}</Table.Th><Table.Th>{t('clusterLayout.gatewayNodes')}</Table.Th></Table.Tr>
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
          <h5>{t('clusterLayout.connectNode')}</h5>
          <span>{t('clusterLayout.connectNodeHint')}</span>
          <Textarea value={connectText} onChange={(e) => setConnectText(e.currentTarget.value)} minRows={2} autosize placeholder="abcdef123…@192.168.1.50:3901" />
          <Button mt="sm" variant="light" onClick={() => connectMut.mutate()} loading={connectMut.isPending} disabled={!connectText.trim()}>{t('clusterLayout.connect')}</Button>
        </Card>
      )}

      <Modal opened={preview != null} onClose={() => setPreview(null)} title={preview?.title} size="lg">
        {preview && (
          <Stack>
            {preview.data.statistics && <LayoutStats s={preview.data.statistics} />}
            {preview.data.message?.length > 0 && <code>{preview.data.message.join('\n')}</code>}
          </Stack>
        )}
      </Modal>

      <Modal opened={applyOpen} onClose={() => setApplyOpen(false)} title={t('clusterLayout.confirmApply')}>
        <Stack>
          <Alert color="orange">{t('clusterLayout.applyWarning', { version: l.version + 1 })}</Alert>
          <Button color="green" onClick={() => applyMut.mutate(l.version + 1)} loading={applyMut.isPending}>
            {t('clusterLayout.applyVersion', { version: l.version + 1 })}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
