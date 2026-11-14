import { useEffect, useState } from 'react'
import { Badge, Button, Card, Checkbox, Field, Input, NumberInput, Select, SelectItem, Spinner, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from 'h2d-glass-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api, type BucketInfo, type KeyListItem } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { fmtBytes } from './BucketsPage'
import { UsageChart } from '../components/UsageChart'
import { toast } from 'h2d-glass-ui'
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
    onSuccess: () => { refresh(); toast.success(t('common.updated')) },
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
    updateMut.mutate({ website: { enabled: websiteEnabled, index_document: indexDoc, error_document: errorDoc } })
  }
  function saveQuotas() {
    updateMut.mutate({ quotas: { max_size: maxSize === '' ? null : Number(maxSize), max_objects: maxObjects === '' ? null : Number(maxObjects) } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <Link to="/buckets">{t('nav.buckets')}</Link>
        <span>/</span>
        <span>{bucket.globalAliases[0] ?? bucket.id.slice(0, 12)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{bucket.globalAliases.join(', ') || bucket.id.slice(0, 16)}</h3>
        <Button variant="secondary" onClick={() => window.location.href = `/files?bucket=${encodeURIComponent(bucket.globalAliases[0] ?? bucket.id)}`}>{t('bucketDetail.browseFiles')}</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('bucketDetail.objects')}</div><div style={{ fontWeight: 700 }}>{bucket.objects}</div></div></Card>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('bucketDetail.size')}</div><div style={{ fontWeight: 700 }}>{fmtBytes(bucket.bytes)}</div></div></Card>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('bucketDetail.unfinishedMultipart')}</div><div style={{ fontWeight: 700 }}>{bucket.unfinishedMultipartUploads}</div></div></Card>
        <Card><div style={{ padding: 8 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{t('bucketDetail.website')}</div><div style={{ fontWeight: 700 }}>{bucket.websiteAccess ? t('common.on') : t('common.off')}</div></div></Card>
      </div>

      <UsageChart kind="bucket" bucketId={bucket.id} />

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('bucketDetail.globalAliases')}</h5>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {bucket.globalAliases.map((a) => (
              <Badge key={a} variant="neutral">{a}</Badge>
            ))}
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Input placeholder={t('bucketDetail.newAlias')} value={newAlias} onChange={(e) => setNewAlias(e.currentTarget.value)} />
              <Button variant="secondary" onClick={() => aliasMut.mutate(newAlias)} disabled={!newAlias}>{t('bucketDetail.addAlias')}</Button>
            </div>
          )}
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Input placeholder={t('bucketDetail.localAlias')} value={localAlias} onChange={(e) => setLocalAlias(e.currentTarget.value)} />
              <Select placeholder={t('bucketDetail.key')} value={localKey} onValueChange={setLocalKey}>
                {bucket.keys.map((k) => (<SelectItem key={k.accessKeyId} value={k.accessKeyId}>{k.name || k.accessKeyId}</SelectItem>))}
              </Select>
              <Button variant="secondary" onClick={() => localAliasMut.mutate()} disabled={!localAlias || !localKey}>{t('bucketDetail.addLocalAlias')}</Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('bucketDetail.quota')}</h5>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('bucketDetail.maxSize')}><NumberInput value={maxSize === '' ? null : maxSize} onValueChange={(v) => setMaxSize(v ?? '')} disabled={!isAdmin} min={0} /></Field>
            <Field label={t('bucketDetail.maxObjects')}><NumberInput value={maxObjects === '' ? null : maxObjects} onValueChange={(v) => setMaxObjects(v ?? '')} disabled={!isAdmin} min={0} /></Field>
            {isAdmin && <Button onClick={() => saveQuotas()} disabled={updateMut.isPending}>{t('bucketDetail.saveQuota')}</Button>}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('bucketDetail.websiteHosting')}</h5>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Switch checked={websiteEnabled} onChange={(e) => setWebsiteEnabled(e.currentTarget.checked)} disabled={!isAdmin} />
              {t('bucketDetail.enableStaticWebsite')}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('bucketDetail.indexDocument')}><Input value={indexDoc} onChange={(e) => setIndexDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} /></Field>
              <Field label={t('bucketDetail.errorDocument')}><Input value={errorDoc} onChange={(e) => setErrorDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} /></Field>
            </div>
            {isAdmin && <Button onClick={saveWebsite} disabled={updateMut.isPending}>{t('bucketDetail.saveWebsite')}</Button>}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('bucketDetail.corsRules')}</h5>
          <Textarea value={corsText} onChange={(e) => setCorsText(e.currentTarget.value)} disabled={!isAdmin} rows={4} />
          {isAdmin && <Button style={{ marginTop: 8 }} onClick={() => corsMut.mutate()} disabled={corsMut.isPending}>{t('bucketDetail.saveCors')}</Button>}
        </div>
      </Card>

      {isAdmin && (
        <Button variant="secondary" onClick={() => cleanupMut.mutate()} disabled={cleanupMut.isPending}>{t('bucketDetail.cleanupMultipart')}</Button>
      )}

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('bucketDetail.keyPermissions')}</h5>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('keys.keyName')}</TableHead>
                  <TableHead>{t('bucketDetail.read')}</TableHead>
                  <TableHead>{t('bucketDetail.write')}</TableHead>
                  <TableHead>{t('bucketDetail.owner')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bucket.keys.map((k) => (
                  <TableRow key={k.accessKeyId}>
                    <TableCell>{k.name || k.accessKeyId}</TableCell>
                    {(['read', 'write', 'owner'] as const).map((perm) => (
                      <TableCell key={perm}>
                        <Checkbox checked={k.permissions[perm]} disabled={!isAdmin} onChange={() => {
                          const grant = !k.permissions[perm]
                          permMut.mutate({ access_key_id: k.accessKeyId, read: perm === 'read' ? grant : false, write: perm === 'write' ? grant : false, owner: perm === 'owner' ? grant : false, deny: !grant })
                        }} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{t('bucketDetail.permissionHint')}</p>
          {isAdmin && (() => {
            const granted = new Set(bucket.keys.map((k) => k.accessKeyId))
            const candidates = (allKeys ?? []).filter((k) => !granted.has(k.id))
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
                <Select placeholder={t('bucketDetail.chooseAccessKey')} value={grantKey} onValueChange={setGrantKey}>
                  {candidates.map((k) => (<SelectItem key={k.id} value={k.id}>{k.name || t('keys.noName')} — {k.id}</SelectItem>))}
                </Select>
                <Button variant="secondary" disabled={!grantKey} onClick={() => { permMut.mutate({ access_key_id: grantKey!, read: true, write: true, owner: false, deny: false }); setGrantKey(null) }}>
                  {t('bucketDetail.grantReadWrite')}
                </Button>
              </div>
            )
          })()}
        </div>
      </Card>
    </div>
  )
}
