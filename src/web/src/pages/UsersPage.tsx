import { useState } from 'react'
import { Button, Card, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Field, Input, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'h2d-glass-ui'
import { IconPlus, IconTrash, IconKey } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AdminUser } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { toast } from 'h2d-glass-ui'
import { useTranslation } from 'react-i18next'

export function UsersPage() {
  const { t } = useTranslation()
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('readonly')
  const [resetFor, setResetFor] = useState<AdminUser | null>(null)
  const [newPw, setNewPw] = useState('')

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<AdminUser[]>('/users')).data })

  const err = (e: any, fallback: string) => toast.error(e?.response?.data?.error || fallback)
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })

  const createMut = useMutation({
    mutationFn: async () => (await api.post('/users', { username, password, role })).data,
    onSuccess: () => { refresh(); setCreateOpen(false); setUsername(''); setPassword(''); setRole('readonly'); toast.success(t('users.created')) },
    onError: (e) => err(e, t('users.createFailed')),
  })
  const roleMut = useMutation({
    mutationFn: async (v: { id: number; role: string }) => (await api.post(`/users/${v.id}`, { role: v.role })).data,
    onSuccess: refresh,
    onError: (e) => err(e, t('users.changeRoleFailed')),
  })
  const resetMut = useMutation({
    mutationFn: async () => (await api.post(`/users/${resetFor!.id}`, { password: newPw })).data,
    onSuccess: () => { setResetFor(null); setNewPw(''); toast.success(t('users.passwordReset')) },
    onError: (e) => err(e, t('users.passwordResetFailed')),
  })
  const deleteMut = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/${id}`),
    onSuccess: refresh,
    onError: (e) => err(e, t('users.deleteFailed')),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('users.title')}</h3>
        <Button onClick={() => setCreateOpen(true)}><IconPlus size={16} /> {t('users.createUser')}</Button>
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.account')}</TableHead>
                <TableHead>{t('users.role')}</TableHead>
                <TableHead>{t('users.createdAt')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.username}{u.id === me?.id && <Badge variant="accent" style={{ marginLeft: 6, fontSize: 10 }}>{t('users.you')}</Badge>}</TableCell>
                  <TableCell>
                    <Select size="sm" value={u.role} onValueChange={(v) => v && roleMut.mutate({ id: u.id, role: v })}>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="readonly">readonly</SelectItem>
                    </Select>
                  </TableCell>
                  <TableCell>{new Date(u.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <Button variant="ghost" size="sm" onClick={() => setResetFor(u)}><IconKey size={16} /></Button>
                      <Button variant="ghost" size="sm" disabled={u.id === me?.id} onClick={() => confirmDelete(u.username, () => deleteMut.mutate(u.id))}><IconTrash size={16} /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('users.createUser')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('users.account')} required>
              <Input value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
            </Field>
            <Field label={t('common.password')} description={t('common.minChars')} required>
              <Input type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
            </Field>
            <Field label={t('users.role')}>
              <Select value={role} onValueChange={(v) => setRole(v ?? 'readonly')}>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="readonly">readonly</SelectItem>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => createMut.mutate()} disabled={!username || !password}>{t('users.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetFor != null} onOpenChange={(o) => { if (!o) setResetFor(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('users.resetPassword')}: {resetFor?.username ?? ''}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('common.newPassword')} description={t('common.minChars')} required>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.currentTarget.value)} required />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => resetMut.mutate()} disabled={!newPw}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
