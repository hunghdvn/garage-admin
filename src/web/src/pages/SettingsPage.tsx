import { toast , Input } from 'h2d-glass-ui'
import { useState } from 'react'
import {
  Button, Card, Checkbox, Group, Modal, Select, Stack, Table, TextInput, Title, Badge, ActionIcon,
  SegmentedControl, Text, useMantineColorScheme,
} from '@mantine/core'
import { IconTrash, IconPlus, IconEdit } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Cluster } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n'
import i18n from '../i18n'

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
  const [colorScheme, setColorScheme] = useState<'light' | 'dark' | 'auto'>(() => (localStorage.getItem('colorScheme') as any) || 'auto')
  const [opened, { open, close }] = useDisclosure(false)
  const [form, setForm] = useState<FormState>(empty)

  function applyColorScheme(v: 'light' | 'dark' | 'auto') {
    setColorScheme(v)
    localStorage.setItem('colorScheme', v)
    const resolved = v === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v
    document.documentElement.setAttribute('data-flg-theme', resolved)
  }

  const [editCluster, setEditCluster] = useState<Cluster | null>(null)
  const [editForm, setEditForm] = useState<FormState>(empty)

  const { data: clusters } = useQuery({
    queryKey: ['clusters'],
    queryFn: async () => (await api.get<Cluster[]>('/clusters')).data,
  })

  const createMut = useMutation({
    mutationFn: async (f: FormState) => (await api.post('/clusters', f)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clusters'] })
      toast.success(t('settings.clusterAdded'))
      close(); setForm(empty)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('settings.clusterAddFailed')),
  })

  const editMut = useMutation({
    mutationFn: async (f: FormState) => (await api.put(`/clusters/${editCluster!.id}`, f)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clusters'] })
      toast.success(t('settings.clusterUpdated'))
      setEditCluster(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('settings.clusterUpdateFailed')),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: number) => api.delete(`/clusters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clusters'] }),
  })

  function openEdit(c: Cluster) {
    setEditForm({
      name: c.name,
      admin_endpoint: c.admin_endpoint,
      admin_token: '',
      s3_endpoint: c.s3_endpoint,
      s3_region: c.s3_region,
      s3_access_key: c.s3_access_key,
      s3_secret_key: '',
      is_default: c.is_default,
    })
    setEditCluster(c)
  }

  return (
    <Stack>
      <h3>{t('settings.appearance')}</h3>
      <Card withBorder>
        <Stack>
          <div>
            <span>{t('settings.colorMode')}</span>
            <SegmentedControl
              value={colorScheme}
              onChange={(v) => applyColorScheme(v as 'light' | 'dark' | 'auto')}
              data={[{ label: t('settings.light'), value: 'light' }, { label: t('settings.dark'), value: 'dark' }, { label: t('settings.auto'), value: 'auto' }]}
            />
          </div>
          <div>
            <span>{t('settings.language')}</span>
            <Select
              value={i18n.language}
              onChange={(v) => { if (v) { i18n.changeLanguage(v); localStorage.setItem('lang', v) } }}
              data={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
              allowDeselect={false}
            />
          </div>
        </Stack>
      </Card>

      <Group justify="space-between" mt="md">
        <h3>{t('settings.clusterConnections')}</h3>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>{t('settings.addCluster')}</Button>}
      </Group>

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('settings.name')}</Table.Th><Table.Th>{t('settings.adminEndpoint')}</Table.Th>
              <Table.Th>{t('settings.s3Endpoint')}</Table.Th><Table.Th>{t('settings.default')}</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {clusters?.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.name}</Table.Td>
                <Table.Td>{c.admin_endpoint}</Table.Td>
                <Table.Td>{c.s3_endpoint}</Table.Td>
                <Table.Td>{c.is_default && <Badge color="green">{t('settings.defaultBadge')}</Badge>}</Table.Td>
                <Table.Td>
                  {isAdmin && (
                    <Group gap={4}>
                      <button onClick={() => openEdit(c)} aria-label="edit">
                        <IconEdit size={16} />
                      </button>
                      <button onClick={() => confirmDelete(c.name, () => deleteMut.mutate(c.id))} aria-label="delete">
                        <IconTrash size={16} />
                      </button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title={t('settings.addCluster')}>
        <Stack>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required />
          <Input value={form.admin_endpoint} onChange={(e) => setForm({ ...form, admin_endpoint: e.currentTarget.value })} required />
          <Input value={form.admin_token} onChange={(e) => setForm({ ...form, admin_token: e.currentTarget.value })} required />
          <Input value={form.s3_endpoint} onChange={(e) => setForm({ ...form, s3_endpoint: e.currentTarget.value })} />
          <Input value={form.s3_region} onChange={(e) => setForm({ ...form, s3_region: e.currentTarget.value })} />
          <Input value={form.s3_access_key} onChange={(e) => setForm({ ...form, s3_access_key: e.currentTarget.value })} />
          <Input value={form.s3_secret_key} onChange={(e) => setForm({ ...form, s3_secret_key: e.currentTarget.value })} />
          <Checkbox label={t('settings.setAsDefault')} checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.currentTarget.checked })} />
          <Button onClick={() => createMut.mutate(form)} loading={createMut.isPending}>{t('common.save')}</Button>
        </Stack>
      </Modal>

      <Modal opened={editCluster !== null} onClose={() => setEditCluster(null)} title={t('settings.editCluster')}>
        <Stack>
          <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.currentTarget.value })} required />
          <Input value={editForm.admin_endpoint} onChange={(e) => setEditForm({ ...editForm, admin_endpoint: e.currentTarget.value })} required />
          <Input placeholder={t('settings.keepTokenPlaceholder')} value={editForm.admin_token} onChange={(e) => setEditForm({ ...editForm, admin_token: e.currentTarget.value })} />
          <Input value={editForm.s3_endpoint} onChange={(e) => setEditForm({ ...editForm, s3_endpoint: e.currentTarget.value })} />
          <Input value={editForm.s3_region} onChange={(e) => setEditForm({ ...editForm, s3_region: e.currentTarget.value })} />
          <Input value={editForm.s3_access_key} onChange={(e) => setEditForm({ ...editForm, s3_access_key: e.currentTarget.value })} />
          <Input placeholder={t('settings.keepSecretPlaceholder')} value={editForm.s3_secret_key} onChange={(e) => setEditForm({ ...editForm, s3_secret_key: e.currentTarget.value })} />
          <Checkbox label={t('settings.setAsDefault')} checked={editForm.is_default} onChange={(e) => setEditForm({ ...editForm, is_default: e.currentTarget.checked })} />
          <Button onClick={() => editMut.mutate(editForm)} loading={editMut.isPending}>{t('common.save')}</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
