import { useEffect, useState } from 'react'
import {
  Anchor, Badge, Breadcrumbs, Button, Card, Group, Loader, Stack, Switch, Table, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type KeyInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function KeyDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const { data: key, isLoading } = useQuery({
    queryKey: ['key', id],
    queryFn: async () => (await api.get<KeyInfo>(`/keys/${id}`)).data,
  })

  const [name, setName] = useState('')
  const [createBucket, setCreateBucket] = useState(false)
  useEffect(() => {
    if (key) {
      setName(key.name)
      setCreateBucket(key.permissions.createBucket)
    }
  }, [key])

  const updateMut = useMutation({
    mutationFn: async (body: unknown) => (await api.post(`/keys/${id}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['key', id] })
      qc.invalidateQueries({ queryKey: ['keys'] })
      notifications.show({ color: 'green', message: 'Đã cập nhật' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Cập nhật thất bại' }),
  })

  if (isLoading || !key) return <Loader />

  return (
    <Stack>
      <Breadcrumbs>
        <Anchor component={Link} to="/keys">Access Keys</Anchor>
        <Text>{key.name || key.accessKeyId}</Text>
      </Breadcrumbs>
      <Title order={3}>{key.name || key.accessKeyId}</Title>

      <Card withBorder>
        <Stack>
          <Group><Text w={140} c="dimmed">Access Key ID</Text><code>{key.accessKeyId}</code></Group>
          <Group><Text w={140} c="dimmed">Trạng thái</Text>{key.expired ? <Badge color="red">expired</Badge> : <Badge color="green">active</Badge>}</Group>
          <Group align="end">
            <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={!isAdmin} />
            {isAdmin && <Button variant="light" onClick={() => updateMut.mutate({ name })}>Đổi tên</Button>}
          </Group>
          <Switch label="Cho phép tạo bucket (createBucket)" checked={createBucket} disabled={!isAdmin}
            onChange={(e) => { setCreateBucket(e.currentTarget.checked); updateMut.mutate({ create_bucket: e.currentTarget.checked }) }} />
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Bucket có quyền truy cập</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Bucket</Table.Th><Table.Th>Read</Table.Th><Table.Th>Write</Table.Th><Table.Th>Owner</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {key.buckets.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/buckets/${b.id}`}>
                    {b.globalAliases[0] ?? b.id.slice(0, 12)}
                  </Anchor>
                </Table.Td>
                <Table.Td>{b.permissions.read ? '✓' : ''}</Table.Td>
                <Table.Td>{b.permissions.write ? '✓' : ''}</Table.Td>
                <Table.Td>{b.permissions.owner ? '✓' : ''}</Table.Td>
              </Table.Tr>
            ))}
            {key.buckets.length === 0 && (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm">Chưa có quyền trên bucket nào. Cấp quyền ở trang chi tiết bucket.</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
