import { useState } from 'react'
import { Button, Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Field, Input } from 'h2d-glass-ui'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, type BucketListItem } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { toast } from 'h2d-glass-ui'
import { useTranslation } from 'react-i18next'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export function BucketsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, setOpened] = useState(false)
  const [alias, setAlias] = useState('')

  const { data: buckets } = useQuery({ queryKey: ['buckets'], queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data })

  const createMut = useMutation({
    mutationFn: async (globalAlias: string) => (await api.post('/buckets', { global_alias: globalAlias })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['buckets'] }); toast.success(t('buckets.created')); setOpened(false); setAlias('') },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('buckets.createFailed')),
  })
  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/buckets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['buckets'] }); toast.success(t('buckets.deleted')) },
    onError: () => toast.error(t('buckets.deleteFailed')),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('buckets.title')}</h3>
        {isAdmin && <Button onClick={() => setOpened(true)}><IconPlus size={16} /> {t('buckets.createBucket')}</Button>}
      </div>
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('buckets.alias')}</TableHead>
                <TableHead>{t('buckets.objects')}</TableHead>
                <TableHead>{t('buckets.size')}</TableHead>
                <TableHead>{t('buckets.keys')}</TableHead>
                <TableHead>{t('buckets.id')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets?.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link to={`/buckets/${b.id}`}>{b.globalAliases.length > 0 ? b.globalAliases.join(', ') : <Badge variant="neutral">{t('buckets.noAlias')}</Badge>}</Link>
                  </TableCell>
                  <TableCell>{b.objects != null ? b.objects.toLocaleString() : '—'}{b.quotas?.maxObjects != null && <span style={{ fontSize: 11, opacity: 0.6 }}> / {b.quotas.maxObjects.toLocaleString()}</span>}</TableCell>
                  <TableCell>{b.bytes != null ? fmtBytes(b.bytes) : '—'}{b.quotas?.maxSize != null && <span style={{ fontSize: 11, opacity: 0.6 }}> / {fmtBytes(b.quotas.maxSize)}</span>}</TableCell>
                  <TableCell>{b.keys ? b.keys.length : '—'}</TableCell>
                  <TableCell><code>{b.id.slice(0, 16)}…</code></TableCell>
                  <TableCell>
                    {isAdmin && <Button variant="ghost" size="sm" onClick={() => confirmDelete(b.globalAliases[0] ?? b.id, () => deleteMut.mutate(b.id))}><IconTrash size={16} /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('buckets.createBucket')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('buckets.globalAlias')} description={t('buckets.aliasRules')} required>
              <Input value={alias} onChange={(e) => setAlias(e.currentTarget.value)} required />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => createMut.mutate(alias)} disabled={!alias}>{t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { fmtBytes }
