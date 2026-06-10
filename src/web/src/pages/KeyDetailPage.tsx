import { useEffect, useState } from 'react'
import {
  ActionIcon, Alert, Anchor, Badge, Breadcrumbs, Button, Card, Code, CopyButton, Group, Loader, Stack, Switch, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { IconCopy, IconCheck, IconAlertTriangle } from '@tabler/icons-react'
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
  const [expiry, setExpiry] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revealLoading, setRevealLoading] = useState(false)

  useEffect(() => {
    if (key) {
      setName(key.name)
      setCreateBucket(key.permissions.createBucket)
      setExpiry(key.expiration ? key.expiration.slice(0, 16) : '')
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

  async function handleRevealSecret() {
    setRevealLoading(true)
    try {
      const res = await api.get<KeyInfo>(`/keys/${id}`, { params: { reveal: 1 } })
      setSecret(res.data.secretAccessKey ?? null)
    } catch {
      notifications.show({ color: 'red', message: 'Không thể lấy secret key' })
    } finally {
      setRevealLoading(false)
    }
  }

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
          {isAdmin && (
            secret ? (
              <Stack gap="xs">
                <Alert icon={<IconAlertTriangle size={16} />} color="yellow" title="Thông tin nhạy cảm">
                  Secret key chỉ nên được chia sẻ qua kênh bảo mật.
                </Alert>
                <Group>
                  <Text w={140} c="dimmed">Secret Key</Text>
                  <Code>{secret}</Code>
                  <CopyButton value={secret} timeout={2000}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? 'Đã sao chép' : 'Sao chép'} withArrow position="right">
                        <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy}>
                          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </CopyButton>
                </Group>
              </Stack>
            ) : (
              <Group>
                <Text w={140} c="dimmed">Secret Key</Text>
                <Button variant="light" size="xs" loading={revealLoading} onClick={handleRevealSecret}>
                  Hiện secret
                </Button>
              </Group>
            )
          )}
          <Group align="end">
            <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={!isAdmin} />
            {isAdmin && <Button variant="light" onClick={() => updateMut.mutate({ name })}>Đổi tên</Button>}
          </Group>
          <Switch label="Cho phép tạo bucket (createBucket)" checked={createBucket} disabled={!isAdmin}
            onChange={(e) => { setCreateBucket(e.currentTarget.checked); updateMut.mutate({ create_bucket: e.currentTarget.checked }) }} />
          <Group align="end">
            <TextInput label="Hết hạn" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.currentTarget.value)} disabled={!isAdmin} />
            {isAdmin && <Button variant="light" onClick={() => updateMut.mutate({ expiration: new Date(expiry).toISOString() })} disabled={!expiry}>Đặt hạn</Button>}
            {isAdmin && <Button variant="subtle" onClick={() => updateMut.mutate({ never_expires: true })}>Bỏ hạn</Button>}
          </Group>
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
