import { useState } from 'react'
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'h2d-glass-ui'
import { IconPlus, IconTrash, IconCopy, IconCheck, IconEdit } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AdminToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { toast } from 'h2d-glass-ui'
import { useTranslation } from 'react-i18next'

export function AdminTokensPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, setOpened] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('*')
  const [expiration, setExpiration] = useState('')
  const [created, setCreated] = useState<AdminToken | null>(null)
  const [editFor, setEditFor] = useState<AdminToken | null>(null)
  const [editName, setEditName] = useState('')
  const [editScope, setEditScope] = useState('')

  const { data: tokens } = useQuery({
    queryKey: ['admin-tokens'],
    queryFn: async () => (await api.get<AdminToken[]>('/admin-tokens')).data,
  })

  const createMut = useMutation({
    mutationFn: async () => (await api.post<AdminToken>('/admin-tokens', {
      name, scope: scope.split(',').map((s) => s.trim()).filter(Boolean),
      expiration: expiration ? new Date(expiration).toISOString() : null,
    })).data,
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); setOpened(false); setName(''); setScope('*'); setExpiration(''); setCreated(data) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('adminTokens.createFailed')),
  })
  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin-tokens/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); toast.success(t('adminTokens.deleted')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('common.deleteFailed')),
  })
  const editMut = useMutation({
    mutationFn: async () => (await api.post(`/admin-tokens/${editFor!.id}`, { name: editName, scope: editScope.split(',').map((s) => s.trim()).filter(Boolean) })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); setEditFor(null); toast.success(t('adminTokens.updated')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('common.updateFailed')),
  })
  function openEdit(tkn: AdminToken) { setEditFor(tkn); setEditName(tkn.name); setEditScope(tkn.scope.join(', ')) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('adminTokens.title')}</h3>
        {isAdmin && <Button onClick={() => setOpened(true)}><IconPlus size={16} /> {t('adminTokens.createToken')}</Button>}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('adminTokens.name')}</TableHead>
                <TableHead>{t('adminTokens.scope')}</TableHead>
                <TableHead>{t('adminTokens.expiration')}</TableHead>
                <TableHead>{t('adminTokens.status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens?.map((tkn, i) => (
                <TableRow key={tkn.id ?? `cfg-${i}`}>
                  <TableCell>{tkn.name}</TableCell>
                  <TableCell>{tkn.scope.map((s) => <Badge key={s} variant="neutral" style={{ marginRight: 4 }}>{s}</Badge>)}</TableCell>
                  <TableCell>{tkn.expiration ? new Date(tkn.expiration).toLocaleString() : '∞'}</TableCell>
                  <TableCell>
                    {tkn.id === null ? <Badge variant="neutral">{t('adminTokens.configFile')}</Badge>
                      : tkn.expired ? <Badge variant="danger">{t('keys.expired')}</Badge> : <Badge variant="success">{t('keys.active')}</Badge>}
                  </TableCell>
                  <TableCell>
                    {isAdmin && tkn.id !== null && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(tkn)}><IconEdit size={16} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => confirmDelete(tkn.name, () => deleteMut.mutate(tkn.id!))}><IconTrash size={16} /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('adminTokens.createToken')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('adminTokens.name')} required><Input value={name} onChange={(e) => setName(e.currentTarget.value)} required /></Field>
            <Field label={t('adminTokens.scopeComma')} description={t('adminTokens.scopeDesc')}><Input value={scope} onChange={(e) => setScope(e.currentTarget.value)} /></Field>
            <Field label={t('adminTokens.expirationEmpty')}><Input type="datetime-local" value={expiration} onChange={(e) => setExpiration(e.currentTarget.value)} /></Field>
          </div>
          <DialogFooter>
            <Button onClick={() => createMut.mutate()} disabled={!name}>{t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={created != null} onOpenChange={(o) => { if (!o) setCreated(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('adminTokens.createdSaveNow')}</DialogTitle></DialogHeader>
          {created && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Alert status="warning">{t('adminTokens.secretShownOnce')}</Alert>
              <div><b>{t('adminTokens.token')}</b></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code>{created.secretToken}</code>
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(created.secretToken ?? '')}><IconCopy size={16} /></Button>
              </div>
              <Button onClick={() => setCreated(null)}>{t('adminTokens.savedClose')}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editFor != null} onOpenChange={(o) => { if (!o) setEditFor(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('adminTokens.editToken')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('adminTokens.name')}><Input value={editName} onChange={(e) => setEditName(e.currentTarget.value)} /></Field>
            <Field label={t('adminTokens.scopeComma')}><Input value={editScope} onChange={(e) => setEditScope(e.currentTarget.value)} /></Field>
          </div>
          <DialogFooter>
            <Button onClick={() => editMut.mutate()}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
