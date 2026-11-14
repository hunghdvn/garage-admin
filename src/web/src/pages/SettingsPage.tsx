import { useState } from 'react'
import { Button, Card, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from 'h2d-glass-ui'
import { IconTrash, IconPlus, IconEdit } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Cluster } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n'
import i18n from '../i18n'
import { toast } from 'h2d-glass-ui'

interface FormState {
  name: string; admin_endpoint: string; admin_token: string
  s3_endpoint: string; s3_region: string; s3_access_key: string; s3_secret_key: string
  is_default: boolean
}

const empty: FormState = {
  name: '', admin_endpoint: 'http://192.168.101.8:3903', admin_token: '',
  s3_endpoint: 'http://192.168.101.8:3900', s3_region: 'garage',
  s3_access_key: '', s3_secret_key: '', is_default: true,
}

export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, setOpened] = useState(false)
  const [form, setForm] = useState<FormState>(empty)
  const [colorScheme, setColorScheme] = useState<'light' | 'dark' | 'auto'>(() => (localStorage.getItem('colorScheme') as any) || 'auto')
  const [editCluster, setEditCluster] = useState<Cluster | null>(null)
  const [editForm, setEditForm] = useState<FormState>(empty)

  function applyColorScheme(v: 'light' | 'dark' | 'auto') {
    setColorScheme(v)
    localStorage.setItem('colorScheme', v)
    const resolved = v === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v
    document.documentElement.setAttribute('data-flg-theme', resolved)
  }

  const { data: clusters } = useQuery({
    queryKey: ['clusters'],
    queryFn: async () => (await api.get<Cluster[]>('/clusters')).data,
  })

  const createMut = useMutation({
    mutationFn: async (f: FormState) => (await api.post('/clusters', f)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters'] }); toast.success(t('settings.clusterAdded')); setOpened(false); setForm(empty) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('settings.clusterAddFailed')),
  })
  const editMut = useMutation({
    mutationFn: async (f: FormState) => (await api.put(`/clusters/${editCluster!.id}`, f)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters'] }); toast.success(t('settings.clusterUpdated')); setEditCluster(null) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('settings.clusterUpdateFailed')),
  })
  const deleteMut = useMutation({
    mutationFn: async (id: number) => api.delete(`/clusters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clusters'] }),
  })

  function openEdit(c: Cluster) {
    setEditForm({
      name: c.name, admin_endpoint: c.admin_endpoint, admin_token: '',
      s3_endpoint: c.s3_endpoint, s3_region: c.s3_region,
      s3_access_key: c.s3_access_key, s3_secret_key: '', is_default: c.is_default,
    })
    setEditCluster(c)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>{t('settings.appearance')}</h3>
      <Card>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('settings.colorMode')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['light', 'dark', 'auto'] as const).map((v) => (
                <Button key={v} variant={colorScheme === v ? 'primary' : 'secondary'} size="sm" onClick={() => applyColorScheme(v)}>
                  {v === 'light' ? t('settings.light') : v === 'dark' ? t('settings.dark') : t('settings.auto')}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('settings.language')}</div>
            <Select value={i18n.language} onValueChange={(v) => { if (v) { i18n.changeLanguage(v); localStorage.setItem('lang', v) } }}>
              {SUPPORTED_LANGUAGES.map((l) => (<SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>))}
            </Select>
          </div>
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>{t('settings.clusterConnections')}</h3>
        {isAdmin && <Button onClick={() => setOpened(true)}><IconPlus size={16} /> {t('settings.addCluster')}</Button>}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.name')}</TableHead>
                <TableHead>{t('settings.adminEndpoint')}</TableHead>
                <TableHead>{t('settings.s3Endpoint')}</TableHead>
                <TableHead>{t('settings.default')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clusters?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.admin_endpoint}</TableCell>
                  <TableCell>{c.s3_endpoint}</TableCell>
                  <TableCell>{c.is_default && <Badge variant="success">{t('settings.defaultBadge')}</Badge>}</TableCell>
                  <TableCell>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><IconEdit size={16} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => confirmDelete(c.name, () => deleteMut.mutate(c.id))}><IconTrash size={16} /></Button>
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
          <DialogHeader><DialogTitle>{t('settings.addCluster')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('settings.name')} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required /></Field>
            <Field label={t('settings.adminEndpoint')} required><Input value={form.admin_endpoint} onChange={(e) => setForm({ ...form, admin_endpoint: e.currentTarget.value })} required /></Field>
            <Field label={t('settings.adminToken')} required><Input value={form.admin_token} onChange={(e) => setForm({ ...form, admin_token: e.currentTarget.value })} required /></Field>
            <Field label={t('settings.s3Endpoint')}><Input value={form.s3_endpoint} onChange={(e) => setForm({ ...form, s3_endpoint: e.currentTarget.value })} /></Field>
            <Field label={t('settings.s3Region')}><Input value={form.s3_region} onChange={(e) => setForm({ ...form, s3_region: e.currentTarget.value })} /></Field>
            <Field label={t('settings.s3AccessKey')}><Input value={form.s3_access_key} onChange={(e) => setForm({ ...form, s3_access_key: e.currentTarget.value })} /></Field>
            <Field label={t('settings.s3SecretKey')}><Input value={form.s3_secret_key} onChange={(e) => setForm({ ...form, s3_secret_key: e.currentTarget.value })} /></Field>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Checkbox checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.currentTarget.checked })} />
              {t('settings.setAsDefault')}
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => createMut.mutate(form)} disabled={!form.name}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editCluster !== null} onOpenChange={(o) => { if (!o) setEditCluster(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('settings.editCluster')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('settings.name')} required><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.currentTarget.value })} required /></Field>
            <Field label={t('settings.adminEndpoint')} required><Input value={editForm.admin_endpoint} onChange={(e) => setEditForm({ ...editForm, admin_endpoint: e.currentTarget.value })} required /></Field>
            <Field label={t('settings.adminToken')} description={t('settings.adminTokenHint')}><Input placeholder={t('settings.keepTokenPlaceholder')} value={editForm.admin_token} onChange={(e) => setEditForm({ ...editForm, admin_token: e.currentTarget.value })} /></Field>
            <Field label={t('settings.s3Endpoint')}><Input value={editForm.s3_endpoint} onChange={(e) => setEditForm({ ...editForm, s3_endpoint: e.currentTarget.value })} /></Field>
            <Field label={t('settings.s3Region')}><Input value={editForm.s3_region} onChange={(e) => setEditForm({ ...editForm, s3_region: e.currentTarget.value })} /></Field>
            <Field label={t('settings.s3AccessKey')}><Input value={editForm.s3_access_key} onChange={(e) => setEditForm({ ...editForm, s3_access_key: e.currentTarget.value })} /></Field>
            <Field label={t('settings.s3SecretKey')}><Input placeholder={t('settings.keepSecretPlaceholder')} value={editForm.s3_secret_key} onChange={(e) => setEditForm({ ...editForm, s3_secret_key: e.currentTarget.value })} /></Field>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Checkbox checked={editForm.is_default} onChange={(e) => setEditForm({ ...editForm, is_default: e.currentTarget.checked })} />
              {t('settings.setAsDefault')}
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => editMut.mutate(editForm)} disabled={!editForm.name}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
