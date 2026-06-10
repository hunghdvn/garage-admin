import { useState } from 'react'
import {
  Button, Card, Checkbox, Group, Modal, Stack, Table, TextInput, Title, Badge, ActionIcon,
  SegmentedControl, Text, useMantineColorScheme,
} from '@mantine/core'
import { IconTrash, IconPlus, IconEdit } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Cluster } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { themeNames, loadThemeName, saveThemeName } from '../theme/themes'

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
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const [opened, { open, close }] = useDisclosure(false)
  const [form, setForm] = useState<FormState>(empty)

  function changeTheme(name: string) {
    saveThemeName(name)
    window.location.reload() // re-create MantineProvider with the new preset
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
      notifications.show({ color: 'green', message: 'Đã thêm cluster' })
      close(); setForm(empty)
    },
    onError: () => notifications.show({ color: 'red', message: 'Thêm cluster thất bại' }),
  })

  const editMut = useMutation({
    mutationFn: async (f: FormState) => (await api.put(`/clusters/${editCluster!.id}`, f)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clusters'] })
      notifications.show({ color: 'green', message: 'Đã cập nhật cluster' })
      setEditCluster(null)
    },
    onError: () => notifications.show({ color: 'red', message: 'Cập nhật cluster thất bại' }),
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
      <Title order={3}>Giao diện</Title>
      <Card withBorder>
        <Stack>
          <div>
            <Text size="sm" fw={600} mb={6}>Theme</Text>
            <SegmentedControl data={themeNames} value={loadThemeName()} onChange={changeTheme} />
          </div>
          <div>
            <Text size="sm" fw={600} mb={6}>Chế độ màu</Text>
            <SegmentedControl
              value={colorScheme}
              onChange={(v) => setColorScheme(v as 'light' | 'dark' | 'auto')}
              data={[{ label: 'Sáng', value: 'light' }, { label: 'Tối', value: 'dark' }, { label: 'Tự động', value: 'auto' }]}
            />
          </div>
        </Stack>
      </Card>

      <Group justify="space-between" mt="md">
        <Title order={3}>Cluster connections</Title>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>Thêm cluster</Button>}
      </Group>

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tên</Table.Th><Table.Th>Admin endpoint</Table.Th>
              <Table.Th>S3 endpoint</Table.Th><Table.Th>Mặc định</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {clusters?.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.name}</Table.Td>
                <Table.Td>{c.admin_endpoint}</Table.Td>
                <Table.Td>{c.s3_endpoint}</Table.Td>
                <Table.Td>{c.is_default && <Badge color="green">default</Badge>}</Table.Td>
                <Table.Td>
                  {isAdmin && (
                    <Group gap={4}>
                      <ActionIcon color="blue" variant="subtle" onClick={() => openEdit(c)} aria-label="edit">
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon color="red" variant="subtle" onClick={() => confirmDelete(c.name, () => deleteMut.mutate(c.id))} aria-label="delete">
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title="Thêm cluster">
        <Stack>
          <TextInput label="Tên" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required />
          <TextInput label="Admin endpoint" value={form.admin_endpoint} onChange={(e) => setForm({ ...form, admin_endpoint: e.currentTarget.value })} required />
          <TextInput label="Admin token" value={form.admin_token} onChange={(e) => setForm({ ...form, admin_token: e.currentTarget.value })} required />
          <TextInput label="S3 endpoint" value={form.s3_endpoint} onChange={(e) => setForm({ ...form, s3_endpoint: e.currentTarget.value })} />
          <TextInput label="S3 region" value={form.s3_region} onChange={(e) => setForm({ ...form, s3_region: e.currentTarget.value })} />
          <TextInput label="S3 access key" value={form.s3_access_key} onChange={(e) => setForm({ ...form, s3_access_key: e.currentTarget.value })} />
          <TextInput label="S3 secret key" value={form.s3_secret_key} onChange={(e) => setForm({ ...form, s3_secret_key: e.currentTarget.value })} />
          <Checkbox label="Đặt làm mặc định" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.currentTarget.checked })} />
          <Button onClick={() => createMut.mutate(form)} loading={createMut.isPending}>Lưu</Button>
        </Stack>
      </Modal>

      <Modal opened={editCluster !== null} onClose={() => setEditCluster(null)} title="Sửa cluster">
        <Stack>
          <TextInput label="Tên" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.currentTarget.value })} required />
          <TextInput label="Admin endpoint" value={editForm.admin_endpoint} onChange={(e) => setEditForm({ ...editForm, admin_endpoint: e.currentTarget.value })} required />
          <TextInput label="Admin token" placeholder="để trống = giữ token cũ" value={editForm.admin_token} onChange={(e) => setEditForm({ ...editForm, admin_token: e.currentTarget.value })} />
          <TextInput label="S3 endpoint" value={editForm.s3_endpoint} onChange={(e) => setEditForm({ ...editForm, s3_endpoint: e.currentTarget.value })} />
          <TextInput label="S3 region" value={editForm.s3_region} onChange={(e) => setEditForm({ ...editForm, s3_region: e.currentTarget.value })} />
          <TextInput label="S3 access key" value={editForm.s3_access_key} onChange={(e) => setEditForm({ ...editForm, s3_access_key: e.currentTarget.value })} />
          <TextInput label="S3 secret key" placeholder="để trống = giữ nguyên" value={editForm.s3_secret_key} onChange={(e) => setEditForm({ ...editForm, s3_secret_key: e.currentTarget.value })} />
          <Checkbox label="Đặt làm mặc định" checked={editForm.is_default} onChange={(e) => setEditForm({ ...editForm, is_default: e.currentTarget.checked })} />
          <Button onClick={() => editMut.mutate(editForm)} loading={editMut.isPending}>Lưu</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
