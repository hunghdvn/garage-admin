import { toast , Input , Spinner } from 'h2d-glass-ui'
import { useEffect, useState } from 'react'
import {
  Anchor, Badge, Button, Card, Checkbox, Grid, Group, NumberInput, Select, Stack,
  Switch, Table, Text, Textarea, TextInput, Title, Breadcrumbs, Loader,
} from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api, type BucketInfo, type KeyListItem } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { fmtBytes } from './BucketsPage'
import { UsageChart } from '../components/UsageChart'
import { useTranslation } from 'react-i18next'

export function BucketDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const { data: bucket, isLoading } = useQuery({
    queryKey: ['bucket', id],
    queryFn: async () => (await api.get<BucketInfo>(`/buckets/${id}`)).data,
  })

  // All access keys, used to grant a key that has no permission on this bucket yet.
  const { data: allKeys } = useQuery({
    queryKey: ['keys'],
    queryFn: async () => (await api.get<KeyListItem[]>('/keys')).data,
  })
  const [grantKey, setGrantKey] = useState<string | null>(null)

  const [websiteEnabled, setWebsiteEnabled] = useState(false)
  const [indexDoc, setIndexDoc] = useState('index.html')
  const [errorDoc, setErrorDoc] = useState('error.html')
  const [maxSize, setMaxSize] = useState<number | ''>('')
  const [maxObjects, setMaxObjects] = useState<number | ''>('')
  const [newAlias, setNewAlias] = useState('')
  const [localAlias, setLocalAlias] = useState('')
  const [localKey, setLocalKey] = useState<string | null>(null)
  const [corsText, setCorsText] = useState('')

  useEffect(() => {
    if (bucket) {
      setWebsiteEnabled(bucket.websiteAccess)
      setIndexDoc(bucket.websiteConfig?.indexDocument || 'index.html')
      setErrorDoc(bucket.websiteConfig?.errorDocument || 'error.html')
      setMaxSize(bucket.quotas.maxSize ?? '')
      setMaxObjects(bucket.quotas.maxObjects ?? '')
    }
  }, [bucket])

  useEffect(() => {
    if (bucket) setCorsText(JSON.stringify((bucket as any).corsRules ?? [], null, 2))
  }, [bucket])

  const refresh = () => qc.invalidateQueries({ queryKey: ['bucket', id] })

  const updateMut = useMutation({
    mutationFn: async (body: unknown) => (await api.post(`/buckets/${id}`, body)).data,
    onSuccess: () => {
      refresh()
      toast.success(t('common.updated'))
    },
    onError: () => toast.error(t('common.updateFailed')),
  })

  const aliasMut = useMutation({
    mutationFn: async (alias: string) => (await api.post(`/buckets/${id}/aliases`, { alias })).data,
    onSuccess: () => { refresh(); setNewAlias('') },
    onError: () => toast.error(t('bucketDetail.addAliasFailed')),
  })
  const removeAliasMut = useMutation({
    mutationFn: async (alias: string) => api.delete(`/buckets/${id}/aliases/${encodeURIComponent(alias)}`),
    onSuccess: refresh,
  })

  const permMut = useMutation({
    mutationFn: async (p: { access_key_id: string; read: boolean; write: boolean; owner: boolean; deny: boolean }) =>
      (await api.post(`/buckets/${id}/permissions`, p)).data,
    onSuccess: () => { refresh(); toast.success(t('bucketDetail.permissionChanged')) },
    onError: () => toast.error(t('bucketDetail.permissionChangeFailed')),
  })

  const localAliasMut = useMutation({
    mutationFn: async () => (await api.post(`/buckets/${id}/aliases`, { alias: localAlias, local: true, access_key_id: localKey })).data,
    onSuccess: () => { refresh(); setLocalAlias(''); setLocalKey(null); toast.success(t('bucketDetail.localAliasAdded')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('bucketDetail.addLocalAliasFailed')),
  })
  const corsMut = useMutation({
    mutationFn: async () => {
      const rules = JSON.parse(corsText || '[]')
      return (await api.post(`/buckets/${id}`, { cors_rules: rules })).data
    },
    onSuccess: () => { refresh(); toast.success(t('bucketDetail.corsSaved')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('bucketDetail.corsSaveFailed')),
  })
  const cleanupMut = useMutation({
    mutationFn: async () => (await api.post(`/buckets/${id}/cleanup-uploads`, { older_than_secs: 86400 })).data,
    onSuccess: () => { refresh(); toast.success(t('bucketDetail.cleanupDone')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('bucketDetail.cleanupFailed')),
  })

  if (isLoading || !bucket) return <Spinner />

  function saveWebsite() {
    updateMut.mutate({
      website: { enabled: websiteEnabled, index_document: indexDoc, error_document: errorDoc },
    })
  }
  function saveQuotas() {
    updateMut.mutate({
      quotas: {
        max_size: maxSize === '' ? null : Number(maxSize),
        max_objects: maxObjects === '' ? null : Number(maxObjects),
      },
    })
  }

  return (
    <Stack>
      <Breadcrumbs>
        <Link to="/buckets">{t('nav.buckets')}</Link>
        <span>{bucket.globalAliases[0] ?? bucket.id.slice(0, 12)}</span>
      </Breadcrumbs>
      <Group justify="space-between">
        <h3>{bucket.globalAliases.join(', ') || bucket.id.slice(0, 16)}</h3>
        <Button variant="light" onClick={() => window.location.href = `/files?bucket=${encodeURIComponent(bucket.globalAliases[0] ?? bucket.id)}`}>{t('bucketDetail.browseFiles')}</Button>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><span>{t('bucketDetail.objects')}</span><span>{bucket.objects}</span></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><span>{t('bucketDetail.size')}</span><span>{fmtBytes(bucket.bytes)}</span></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><span>{t('bucketDetail.unfinishedMultipart')}</span><span>{bucket.unfinishedMultipartUploads}</span></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><span>{t('bucketDetail.website')}</span><span>{bucket.websiteAccess ? t('common.on') : t('common.off')}</span></Card></Grid.Col>
      </Grid>

      <UsageChart kind="bucket" bucketId={bucket.id} />

      <Card withBorder>
        <h5>{t('bucketDetail.globalAliases')}</h5>
        <Group>
          {bucket.globalAliases.map((a) => (
            <Badge key={a} rightSection={isAdmin && bucket.globalAliases.length > 1 ?
              <span style={{ cursor: 'pointer' }} onClick={() => confirmDelete(t('bucketDetail.aliasLabel', { name: a }), () => removeAliasMut.mutate(a))}>×</span> : null}>{a}</Badge>
          ))}
        </Group>
        {isAdmin && (
          <Group mt="sm">
            <Input placeholder={t('bucketDetail.newAlias')} value={newAlias} onChange={(e) => setNewAlias(e.currentTarget.value)} />
            <Button variant="light" onClick={() => aliasMut.mutate(newAlias)} disabled={!newAlias}>{t('bucketDetail.addAlias')}</Button>
          </Group>
        )}
        {isAdmin && (
          <Group mt="sm">
            <Input placeholder={t('bucketDetail.localAlias')} value={localAlias} onChange={(e) => setLocalAlias(e.currentTarget.value)} />
            <Select placeholder={t('bucketDetail.key')} data={bucket.keys.map((k) => ({ value: k.accessKeyId, label: k.name || k.accessKeyId }))} value={localKey} onChange={setLocalKey} />
            <Button variant="light" onClick={() => localAliasMut.mutate()} disabled={!localAlias || !localKey}>{t('bucketDetail.addLocalAlias')}</Button>
          </Group>
        )}
      </Card>

      <Card withBorder>
        <h5>{t('bucketDetail.quota')}</h5>
        <Group align="end">
          <NumberInput label={t('bucketDetail.maxSize')} value={maxSize}
            onChange={(v) => setMaxSize(typeof v === 'number' ? v : '')} disabled={!isAdmin} min={0} />
          <NumberInput label={t('bucketDetail.maxObjects')} value={maxObjects}
            onChange={(v) => setMaxObjects(typeof v === 'number' ? v : '')} disabled={!isAdmin} min={0} />
          {isAdmin && <Button onClick={saveQuotas} loading={updateMut.isPending}>{t('bucketDetail.saveQuota')}</Button>}
        </Group>
      </Card>

      <Card withBorder>
        <h5>{t('bucketDetail.websiteHosting')}</h5>
        <Stack>
          <Switch label={t('bucketDetail.enableStaticWebsite')} checked={websiteEnabled}
            onChange={(e) => setWebsiteEnabled(e.currentTarget.checked)} disabled={!isAdmin} />
          <Group>
            <Input value={indexDoc} onChange={(e) => setIndexDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} />
            <Input value={errorDoc} onChange={(e) => setErrorDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} />
          </Group>
          {isAdmin && <Button onClick={saveWebsite} loading={updateMut.isPending}>{t('bucketDetail.saveWebsite')}</Button>}
        </Stack>
      </Card>

      <Card withBorder>
        <h5>{t('bucketDetail.corsRules')}</h5>
        <Textarea value={corsText} onChange={(e) => setCorsText(e.currentTarget.value)} minRows={4} autosize disabled={!isAdmin} styles={{ input: { fontFamily: 'monospace' } }} />
        {isAdmin && <Button mt="sm" onClick={() => corsMut.mutate()} loading={corsMut.isPending}>{t('bucketDetail.saveCors')}</Button>}
      </Card>

      {isAdmin && (
        <Group>
          <Button variant="light" color="orange" onClick={() => cleanupMut.mutate()} loading={cleanupMut.isPending}>{t('bucketDetail.cleanupMultipart')}</Button>
        </Group>
      )}

      <Card withBorder>
        <h5>{t('bucketDetail.keyPermissions')}</h5>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>{t('keys.keyName')}</Table.Th><Table.Th>{t('bucketDetail.read')}</Table.Th><Table.Th>{t('bucketDetail.write')}</Table.Th><Table.Th>{t('bucketDetail.owner')}</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {bucket.keys.map((k) => (
              <Table.Tr key={k.accessKeyId}>
                <Table.Td>{k.name || k.accessKeyId}</Table.Td>
                {(['read', 'write', 'owner'] as const).map((perm) => (
                  <Table.Td key={perm}>
                    <Checkbox
                      checked={k.permissions[perm]}
                      disabled={!isAdmin}
                      onChange={(e) => {
                        const grant = e.currentTarget.checked
                        permMut.mutate({
                          access_key_id: k.accessKeyId,
                          read: perm === 'read' ? grant : false,
                          write: perm === 'write' ? grant : false,
                          owner: perm === 'owner' ? grant : false,
                          deny: !grant,
                        })
                      }}
                    />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <span>{t('bucketDetail.permissionHint')}</span>
        {isAdmin && (() => {
          const granted = new Set(bucket.keys.map((k) => k.accessKeyId))
          const candidates = (allKeys ?? []).filter((k) => !granted.has(k.id))
          return (
            <Group mt="md" align="end">
              <Select
                label={t('bucketDetail.grantToOtherKey')}
                placeholder={t('bucketDetail.chooseAccessKey')}
                searchable
                data={candidates.map((k) => ({ value: k.id, label: `${k.name || t('keys.noName')} — ${k.id}` }))}
                value={grantKey}
                onChange={setGrantKey}
                nothingFoundMessage={t('bucketDetail.allKeysGranted')}
              />
              <Button
                variant="light"
                disabled={!grantKey}
                onClick={() => {
                  permMut.mutate({ access_key_id: grantKey!, read: true, write: true, owner: false, deny: false })
                  setGrantKey(null)
                }}
              >
                {t('bucketDetail.grantReadWrite')}
              </Button>
            </Group>
          )
        })()}
      </Card>
    </Stack>
  )
}
