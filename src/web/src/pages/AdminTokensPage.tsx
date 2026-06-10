import { useState } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Card, Code, CopyButton, Group, Modal, Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { IconPlus, IconTrash, IconCopy, IconCheck, IconEdit } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AdminToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function AdminTokensPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
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
      name,
      scope: scope.split(',').map((s) => s.trim()).filter(Boolean),
      expiration: expiration ? new Date(expiration).toISOString() : null,
    })).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-tokens'] })
      close(); setName(''); setScope('*'); setExpiration('')
      setCreated(data)
    },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Tạo token thất bại' }),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin-tokens/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); notifications.show({ color: 'green', message: 'Đã xóa token' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Xóa thất bại' }),
  })

  const editMut = useMutation({
    mutationFn: async () => (await api.post(`/admin-tokens/${editFor!.id}`, { name: editName, scope: editScope.split(',').map((s) => s.trim()).filter(Boolean) })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); setEditFor(null); notifications.show({ color: 'green', message: 'Đã cập nhật token' }) },
    onError: (e: any) => notifications.show({ color: 'red', message: e?.response?.data?.error || 'Cập nhật thất bại' }),
  })
  function openEdit(t: AdminToken) { setEditFor(t); setEditName(t.name); setEditScope(t.scope.join(', ')) }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Admin Tokens</Title>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>Tạo token</Button>}
      </Group>

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Tên</Table.Th><Table.Th>Scope</Table.Th><Table.Th>Hết hạn</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tokens?.map((t, i) => (
              <Table.Tr key={t.id ?? `cfg-${i}`}>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td>{t.scope.map((s) => <Badge key={s} variant="light" mr={4}>{s}</Badge>)}</Table.Td>
                <Table.Td>{t.expiration ? new Date(t.expiration).toLocaleString() : '∞'}</Table.Td>
                <Table.Td>
                  {t.id === null ? <Badge color="gray">config file</Badge>
                    : t.expired ? <Badge color="red">expired</Badge> : <Badge color="green">active</Badge>}
                </Table.Td>
                <Table.Td>
                  {isAdmin && t.id !== null && (
                    <Group gap={4}>
                      <ActionIcon variant="subtle" aria-label="edit" onClick={() => openEdit(t)}><IconEdit size={16} /></ActionIcon>
                      <ActionIcon color="red" variant="subtle" aria-label="delete" onClick={() => deleteMut.mutate(t.id!)}>
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

      <Modal opened={opened} onClose={close} title="Tạo admin token">
        <Stack>
          <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <TextInput label="Scope (phẩy)" value={scope} onChange={(e) => setScope(e.currentTarget.value)}
            description={'"*" = toàn quyền; hoặc liệt kê nhóm endpoint, vd: Metrics'} />
          <TextInput label="Hết hạn (trống = không hết hạn)" type="datetime-local" value={expiration} onChange={(e) => setExpiration(e.currentTarget.value)} />
          <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!name}>Tạo</Button>
        </Stack>
      </Modal>

      <Modal opened={created != null} onClose={() => setCreated(null)} title="Token đã tạo — lưu ngay!" size="lg">
        {created && (
          <Stack>
            <Alert color="yellow">Secret token chỉ hiển thị MỘT LẦN. Sao chép và lưu lại an toàn.</Alert>
            <Text size="sm">Token</Text>
            <Group>
              <Code>{created.secretToken}</Code>
              <CopyButton value={created.secretToken ?? ''}>
                {({ copied, copy }) => (
                  <ActionIcon variant="light" onClick={copy} aria-label="copy">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
            <Button onClick={() => setCreated(null)}>Đã lưu, đóng</Button>
          </Stack>
        )}
      </Modal>

      <Modal opened={editFor != null} onClose={() => setEditFor(null)} title="Sửa token">
        <Stack>
          <TextInput label="Tên" value={editName} onChange={(e) => setEditName(e.currentTarget.value)} />
          <TextInput label="Scope (phẩy)" value={editScope} onChange={(e) => setEditScope(e.currentTarget.value)} />
          <Button onClick={() => editMut.mutate()} loading={editMut.isPending}>Lưu</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
