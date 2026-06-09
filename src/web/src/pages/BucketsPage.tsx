import { useState } from 'react'
import {
  ActionIcon, Badge, Button, Card, Group, Modal, Stack, Table, TextInput, Title,
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type BucketListItem } from '../api/client'
import { useAuth } from '../auth/AuthContext'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export function BucketsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [alias, setAlias] = useState('')

  const { data: buckets } = useQuery({
    queryKey: ['buckets'],
    queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data,
  })

  const createMut = useMutation({
    mutationFn: async (globalAlias: string) => (await api.post('/buckets', { global_alias: globalAlias })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buckets'] })
      notifications.show({ color: 'green', message: 'Đã tạo bucket' })
      close()
      setAlias('')
    },
    onError: (e: any) =>
      notifications.show({
        color: 'red',
        message: e?.response?.data?.error || 'Tạo bucket thất bại',
      }),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/buckets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buckets'] })
      notifications.show({ color: 'green', message: 'Đã xóa bucket' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Xóa thất bại (bucket phải rỗng)' }),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Buckets</Title>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>Tạo bucket</Button>}
      </Group>
      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Alias</Table.Th>
              <Table.Th>ID</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {buckets?.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>
                  <Link to={`/buckets/${b.id}`}>
                    {b.globalAliases.length > 0 ? b.globalAliases.join(', ') : <Badge color="gray">no alias</Badge>}
                  </Link>
                </Table.Td>
                <Table.Td><code>{b.id.slice(0, 16)}…</code></Table.Td>
                <Table.Td>
                  {isAdmin && (
                    <ActionIcon color="red" variant="subtle" aria-label="delete"
                      onClick={() => deleteMut.mutate(b.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title="Tạo bucket">
        <Stack>
          <TextInput label="Global alias (tên bucket)" value={alias}
            onChange={(e) => setAlias(e.currentTarget.value)} required
            description="Chỉ a-z, 0-9, dấu chấm, gạch ngang; 3–63 ký tự; không chữ hoa/khoảng trắng" />
          <Button onClick={() => createMut.mutate(alias)} loading={createMut.isPending} disabled={!alias}>
            Tạo
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}

export { fmtBytes }
