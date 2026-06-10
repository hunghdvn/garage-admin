import { useState } from 'react'
import {
  ActionIcon, Badge, Button, Card, Group, Modal, PasswordInput, Select, Stack, Table, TextInput, Title,
} from '@mantine/core'
import { IconPlus, IconTrash, IconKey } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AdminUser } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function UsersPage() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [createOpen, createCtl] = useDisclosure(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('readonly')
  const [resetFor, setResetFor] = useState<AdminUser | null>(null)
  const [newPw, setNewPw] = useState('')

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<AdminUser[]>('/users')).data,
  })

  const err = (e: any, fallback: string) => notifications.show({ color: 'red', message: e?.response?.data?.error || fallback })
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })

  const createMut = useMutation({
    mutationFn: async () => (await api.post('/users', { username, password, role })).data,
    onSuccess: () => { refresh(); createCtl.close(); setUsername(''); setPassword(''); setRole('readonly'); notifications.show({ color: 'green', message: 'Đã tạo user' }) },
    onError: (e) => err(e, 'Tạo user thất bại'),
  })
  const roleMut = useMutation({
    mutationFn: async (v: { id: number; role: string }) => (await api.post(`/users/${v.id}`, { role: v.role })).data,
    onSuccess: refresh,
    onError: (e) => err(e, 'Đổi quyền thất bại'),
  })
  const resetMut = useMutation({
    mutationFn: async () => (await api.post(`/users/${resetFor!.id}`, { password: newPw })).data,
    onSuccess: () => { setResetFor(null); setNewPw(''); notifications.show({ color: 'green', message: 'Đã đặt lại mật khẩu' }) },
    onError: (e) => err(e, 'Đặt lại mật khẩu thất bại'),
  })
  const deleteMut = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/${id}`),
    onSuccess: refresh,
    onError: (e) => err(e, 'Xóa thất bại'),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={createCtl.open}>Tạo user</Button>
      </Group>

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Tài khoản</Table.Th><Table.Th>Vai trò</Table.Th><Table.Th>Tạo lúc</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users?.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.username}{u.id === me?.id && <Badge ml={6} size="xs" variant="light">bạn</Badge>}</Table.Td>
                <Table.Td>
                  <Select size="xs" w={130} data={['admin', 'readonly']} value={u.role}
                    onChange={(v) => v && roleMut.mutate({ id: u.id, role: v })} allowDeselect={false} />
                </Table.Td>
                <Table.Td>{new Date(u.created_at).toLocaleString()}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <ActionIcon variant="subtle" aria-label="reset password" onClick={() => setResetFor(u)}><IconKey size={16} /></ActionIcon>
                    <ActionIcon color="red" variant="subtle" aria-label="delete" disabled={u.id === me?.id} onClick={() => deleteMut.mutate(u.id)}><IconTrash size={16} /></ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={createOpen} onClose={createCtl.close} title="Tạo user">
        <Stack>
          <TextInput label="Tài khoản" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
          <PasswordInput label="Mật khẩu" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
          <Select label="Vai trò" data={['admin', 'readonly']} value={role} onChange={(v) => setRole(v ?? 'readonly')} allowDeselect={false} />
          <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!username || !password}>Tạo</Button>
        </Stack>
      </Modal>

      <Modal opened={resetFor != null} onClose={() => setResetFor(null)} title={`Đặt lại mật khẩu: ${resetFor?.username ?? ''}`}>
        <Stack>
          <PasswordInput label="Mật khẩu mới" value={newPw} onChange={(e) => setNewPw(e.currentTarget.value)} required />
          <Button onClick={() => resetMut.mutate()} loading={resetMut.isPending} disabled={!newPw}>Lưu</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
