import { useState } from 'react'
import { Button, Card, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Field, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Alert } from 'h2d-glass-ui'
import { IconPlus, IconTrash, IconDownload, IconCopy, IconCheck } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, type KeyListItem, type KeyInfo, type Permissions } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { toast } from 'h2d-glass-ui'
import { useTranslation } from 'react-i18next'

function permLetters(p: Permissions): string {
  return [p.read && 'R', p.write && 'W', p.owner && 'O'].filter(Boolean).join('') || '—'
}

export function KeysPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [createOpened, setCreateOpened] = useState(false)
  const [importOpened, setImportOpened] = useState(false)
  const [name, setName] = useState('')
  const [expiration, setExpiration] = useState('')
  const [impId, setImpId] = useState('')
  const [impSecret, setImpSecret] = useState('')
  const [impName, setImpName] = useState('')
  const [createdSecret, setCreatedSecret] = useState<KeyInfo | null>(null)

  const { data: keys } = useQuery({ queryKey: ['keys'], queryFn: async () => (await api.get<KeyListItem[]>('/keys')).data })

  const createMut = useMutation({
    mutationFn: async (n: string) => (await api.post<KeyInfo>('/keys', { name: n, expiration: expiration ? new Date(expiration).toISOString() : null })).data,
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['keys'] }); setCreateOpened(false); setName(''); setExpiration(''); setCreatedSecret(data) },
    onError: () => toast.error(t('keys.createFailed')),
  })
  const importMut = useMutation({
    mutationFn: async () => (await api.post('/keys/import', { access_key_id: impId, secret_access_key: impSecret, name: impName })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['keys'] }); setImportOpened(false); setImpId(''); setImpSecret(''); setImpName(''); toast.success(t('keys.imported')) },
    onError: () => toast.error(t('keys.importFailed')),
  })
  const deleteMut = useMutation({ mutationFn: async (id: string) => api.delete(`/keys/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }) })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('keys.title')}</h3>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setImportOpened(true)}>{t('common.import')}</Button>
            <Button onClick={() => setCreateOpened(true)}>{t('keys.createKey')}</Button>
          </div>
        )}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('keys.name')}</TableHead>
                <TableHead>{t('keys.accessKeyId')}</TableHead>
                <TableHead>{t('keys.buckets')}</TableHead>
                <TableHead>{t('keys.status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys?.map((k) => (
                <TableRow key={k.id}>
                  <TableCell><Link to={`/keys/${k.id}`}>{k.name || t('keys.noName')}</Link></TableCell>
                  <TableCell><code>{k.id}</code></TableCell>
                  <TableCell>
                    {k.permissions === undefined ? '—' : (k.buckets ?? []).length === 0 ? <span style={{ fontSize: 12, opacity: 0.6 }}>{t('keys.none')}</span> : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(k.buckets ?? []).map((b) => (
                          <Badge key={b.id} variant="neutral" style={{ textTransform: 'none' }}>{b.globalAliases[0] ?? b.localAliases[0] ?? `${b.id.slice(0, 8)}…`} · {permLetters(b.permissions)}</Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {k.expired ? <Badge variant="danger">{t('keys.expired')}</Badge> : <Badge variant="success">{t('keys.active')}</Badge>}
                    {k.permissions?.createBucket && <Badge variant="accent" style={{ marginLeft: 4 }}>{t('keys.createBucket')}</Badge>}
                  </TableCell>
                  <TableCell>
                    {isAdmin && <Button variant="ghost" size="sm" onClick={() => confirmDelete(k.name || k.id, () => deleteMut.mutate(k.id))}><IconTrash size={16} /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={createOpened} onOpenChange={setCreateOpened}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('keys.createKey')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('keys.keyName')} required>
              <Input value={name} onChange={(e) => setName(e.currentTarget.value)} required />
            </Field>
            <Field label={t('keys.expiration')}>
              <Input type="datetime-local" value={expiration} onChange={(e) => setExpiration(e.currentTarget.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => createMut.mutate(name)} disabled={!name}>{t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpened} onOpenChange={setImportOpened}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('common.import')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('keys.accessKeyId')} required>
              <Input value={impId} onChange={(e) => setImpId(e.currentTarget.value)} required />
            </Field>
            <Field label={t('keys.secretAccessKey')} required>
              <Input value={impSecret} onChange={(e) => setImpSecret(e.currentTarget.value)} required />
            </Field>
            <Field label={t('keys.name')}>
              <Input value={impName} onChange={(e) => setImpName(e.currentTarget.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => importMut.mutate()} disabled={!impId || !impSecret}>{t('common.import')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createdSecret != null} onOpenChange={(o) => { if (!o) setCreatedSecret(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('keys.createdSaveSecret')}</DialogTitle></DialogHeader>
          {createdSecret && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Alert status="warning">{t('keys.secretShownOnce')}</Alert>
              <div><b>{t('keys.accessKeyId')}</b></div>
              <code>{createdSecret.accessKeyId}</code>
              <div><b>{t('keys.secretAccessKey')}</b></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code>{createdSecret.secretAccessKey}</code>
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(createdSecret.secretAccessKey ?? '')}><IconCopy size={16} /></Button>
              </div>
              <Button onClick={() => setCreatedSecret(null)}>{t('keys.savedClose')}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
