import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Field, Input, Spinner, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'h2d-glass-ui'
import { IconCopy, IconCheck, IconAlertTriangle } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api, type KeyInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { toast } from 'h2d-glass-ui'
import { useTranslation } from 'react-i18next'

export function KeyDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const { data: key, isLoading } = useQuery({
    queryKey: ['key', id],
    queryFn: async () => (await api.get<KeyInfo>(`/keys/${id}`)).data,
  })

  const [name, setName] = useState('')
  const [createBucket, setCreateBucket] = useState(false)
  const [expiry, setExpiry] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revealLoading, setRevealLoading] = useState(false)

  useEffect(() => {
    if (key) {
      setName(key.name)
      setCreateBucket(key.permissions.createBucket)
      setExpiry(key.expiration ? key.expiration.slice(0, 16) : '')
    }
  }, [key])

  const updateMut = useMutation({
    mutationFn: async (body: unknown) => (await api.post(`/keys/${id}`, body)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['key', id] }); qc.invalidateQueries({ queryKey: ['keys'] }); toast.success(t('common.updated')) },
    onError: () => toast.error(t('common.updateFailed')),
  })

  async function handleRevealSecret() {
    setRevealLoading(true)
    try {
      const res = await api.get<KeyInfo>(`/keys/${id}`, { params: { reveal: 1 } })
      setSecret(res.data.secretAccessKey ?? null)
    } catch {
      toast.error(t('keyDetail.secretFetchFailed'))
    } finally {
      setRevealLoading(false)
    }
  }

  if (isLoading || !key) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <Link to="/keys">{t('nav.accessKeys')}</Link>
        <span>/</span>
        <span>{key.name || key.accessKeyId}</span>
      </div>
      <h3 style={{ margin: 0 }}>{key.name || key.accessKeyId}</h3>

      <Card>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 140, opacity: 0.7 }}>{t('keyDetail.accessKeyId')}</span><code>{key.accessKeyId}</code></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ width: 140, opacity: 0.7 }}>{t('keyDetail.status')}</span>{key.expired ? <Badge variant="danger">{t('keys.expired')}</Badge> : <Badge variant="success">{t('keys.active')}</Badge>}</div>
          {isAdmin && (
            secret ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Alert status="warning" icon={<IconAlertTriangle size={16} />} title={t('keyDetail.sensitiveInfo')}>{t('keyDetail.secretShareSecurely')}</Alert>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ width: 140, opacity: 0.7 }}>{t('keyDetail.secretKey')}</span>
                  <code>{secret}</code>
                  <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(secret)}><IconCopy size={16} /></Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 140, opacity: 0.7 }}>{t('keyDetail.secretKey')}</span>
                <Button variant="secondary" size="sm" onClick={handleRevealSecret} disabled={revealLoading}>{t('keyDetail.revealSecret')}</Button>
              </div>
            )
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Field label={t('keys.name')}><Input value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={!isAdmin} /></Field>
            {isAdmin && <Button variant="secondary" onClick={() => updateMut.mutate({ name })}>{t('keyDetail.rename')}</Button>}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Switch checked={createBucket} disabled={!isAdmin} onChange={(e) => { setCreateBucket(e.currentTarget.checked); updateMut.mutate({ create_bucket: e.currentTarget.checked }) }} />
            {t('keyDetail.allowCreateBucket')}
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Field label={t('keyDetail.expiration')}><Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.currentTarget.value)} disabled={!isAdmin} /></Field>
            {isAdmin && <Button variant="secondary" onClick={() => updateMut.mutate({ expiration: new Date(expiry).toISOString() })} disabled={!expiry}>{t('keyDetail.setExpiry')}</Button>}
            {isAdmin && <Button variant="ghost" onClick={() => updateMut.mutate({ never_expires: true })}>{t('keyDetail.removeExpiry')}</Button>}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ padding: 8 }}>
          <h5 style={{ margin: '0 0 8px' }}>{t('keyDetail.accessibleBuckets')}</h5>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('nav.buckets')}</TableHead>
                  <TableHead>{t('bucketDetail.read')}</TableHead>
                  <TableHead>{t('bucketDetail.write')}</TableHead>
                  <TableHead>{t('bucketDetail.owner')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {key.buckets.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><Link to={`/buckets/${b.id}`}>{b.globalAliases[0] ?? b.id.slice(0, 12)}</Link></TableCell>
                    <TableCell>{b.permissions.read ? '✓' : ''}</TableCell>
                    <TableCell>{b.permissions.write ? '✓' : ''}</TableCell>
                    <TableCell>{b.permissions.owner ? '✓' : ''}</TableCell>
                  </TableRow>
                ))}
                {key.buckets.length === 0 && (
                  <TableRow><TableCell colSpan={4}>{t('keyDetail.noBucketPermissions')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </div>
  )
}
