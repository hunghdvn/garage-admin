import { useEffect, useState } from 'react'
import {
  Anchor, Badge, Button, Card, Checkbox, Grid, Group, NumberInput, Stack,
  Switch, Table, Text, TextInput, Title, Breadcrumbs, Loader,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type BucketInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'

export function BucketDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const { data: bucket, isLoading } = useQuery({
    queryKey: ['bucket', id],
    queryFn: async () => (await api.get<BucketInfo>(`/buckets/${id}`)).data,
  })

  const [websiteEnabled, setWebsiteEnabled] = useState(false)
  const [indexDoc, setIndexDoc] = useState('index.html')
  const [errorDoc, setErrorDoc] = useState('error.html')
  const [maxSize, setMaxSize] = useState<number | ''>('')
  const [maxObjects, setMaxObjects] = useState<number | ''>('')
  const [newAlias, setNewAlias] = useState('')

  useEffect(() => {
    if (bucket) {
      setWebsiteEnabled(bucket.websiteAccess)
      setIndexDoc(bucket.websiteConfig?.indexDocument || 'index.html')
      setErrorDoc(bucket.websiteConfig?.errorDocument || 'error.html')
      setMaxSize(bucket.quotas.maxSize ?? '')
      setMaxObjects(bucket.quotas.maxObjects ?? '')
    }
  }, [bucket])

  const refresh = () => qc.invalidateQueries({ queryKey: ['bucket', id] })

  const updateMut = useMutation({
    mutationFn: async (body: unknown) => (await api.post(`/buckets/${id}`, body)).data,
    onSuccess: () => {
      refresh()
      notifications.show({ color: 'green', message: 'Đã cập nhật' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Cập nhật thất bại' }),
  })

  const aliasMut = useMutation({
    mutationFn: async (alias: string) => (await api.post(`/buckets/${id}/aliases`, { alias })).data,
    onSuccess: () => { refresh(); setNewAlias('') },
    onError: () => notifications.show({ color: 'red', message: 'Thêm alias thất bại' }),
  })
  const removeAliasMut = useMutation({
    mutationFn: async (alias: string) => api.delete(`/buckets/${id}/aliases/${encodeURIComponent(alias)}`),
    onSuccess: refresh,
  })

  const permMut = useMutation({
    mutationFn: async (p: { access_key_id: string; read: boolean; write: boolean; owner: boolean; deny: boolean }) =>
      (await api.post(`/buckets/${id}/permissions`, p)).data,
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Đã đổi quyền' }) },
    onError: () => notifications.show({ color: 'red', message: 'Đổi quyền thất bại' }),
  })

  if (isLoading || !bucket) return <Loader />

  function saveWebsite() {
    updateMut.mutate({
      website: { enabled: websiteEnabled, index_document: indexDoc, error_document: errorDoc },
    })
  }
  function saveQuotas() {
    updateMut.mutate({
      quotas: {
        max_size: maxSize === '' ? null : Number(maxSize),
        max_objects: maxObjects === '' ? null : Number(maxObjects),
      },
    })
  }

  return (
    <Stack>
      <Breadcrumbs>
        <Anchor component={Link} to="/buckets">Buckets</Anchor>
        <Text>{bucket.globalAliases[0] ?? bucket.id.slice(0, 12)}</Text>
      </Breadcrumbs>
      <Group justify="space-between">
        <Title order={3}>{bucket.globalAliases.join(', ') || bucket.id.slice(0, 16)}</Title>
        <Button component={Link} to={`/files?bucket=${encodeURIComponent(bucket.globalAliases[0] ?? bucket.id)}`} variant="light">Duyệt file</Button>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Objects</Text><Text fw={700}>{bucket.objects}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Dung lượng</Text><Text fw={700}>{fmtBytes(bucket.bytes)}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Multipart dở</Text><Text fw={700}>{bucket.unfinishedMultipartUploads}</Text></Card></Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}><Card withBorder><Text size="sm" c="dimmed">Website</Text><Text fw={700}>{bucket.websiteAccess ? 'Bật' : 'Tắt'}</Text></Card></Grid.Col>
      </Grid>

      <Card withBorder>
        <Title order={5} mb="sm">Global aliases</Title>
        <Group>
          {bucket.globalAliases.map((a) => (
            <Badge key={a} rightSection={isAdmin && bucket.globalAliases.length > 1 ?
              <Text style={{ cursor: 'pointer' }} onClick={() => removeAliasMut.mutate(a)}>×</Text> : null}>{a}</Badge>
          ))}
        </Group>
        {isAdmin && (
          <Group mt="sm">
            <TextInput placeholder="alias mới" value={newAlias} onChange={(e) => setNewAlias(e.currentTarget.value)} />
            <Button variant="light" onClick={() => aliasMut.mutate(newAlias)} disabled={!newAlias}>Thêm alias</Button>
          </Group>
        )}
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Quota</Title>
        <Group align="end">
          <NumberInput label="Max size (bytes, trống = không giới hạn)" value={maxSize}
            onChange={(v) => setMaxSize(typeof v === 'number' ? v : '')} disabled={!isAdmin} min={0} w={260} />
          <NumberInput label="Max objects" value={maxObjects}
            onChange={(v) => setMaxObjects(typeof v === 'number' ? v : '')} disabled={!isAdmin} min={0} w={200} />
          {isAdmin && <Button onClick={saveQuotas} loading={updateMut.isPending}>Lưu quota</Button>}
        </Group>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Website hosting</Title>
        <Stack>
          <Switch label="Bật static website" checked={websiteEnabled}
            onChange={(e) => setWebsiteEnabled(e.currentTarget.checked)} disabled={!isAdmin} />
          <Group>
            <TextInput label="Index document" value={indexDoc} onChange={(e) => setIndexDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} />
            <TextInput label="Error document" value={errorDoc} onChange={(e) => setErrorDoc(e.currentTarget.value)} disabled={!isAdmin || !websiteEnabled} />
          </Group>
          {isAdmin && <Button w={160} onClick={saveWebsite} loading={updateMut.isPending}>Lưu website</Button>}
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">Quyền key trên bucket</Title>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>Key</Table.Th><Table.Th>Read</Table.Th><Table.Th>Write</Table.Th><Table.Th>Owner</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {bucket.keys.map((k) => (
              <Table.Tr key={k.accessKeyId}>
                <Table.Td>{k.name || k.accessKeyId}</Table.Td>
                {(['read', 'write', 'owner'] as const).map((perm) => (
                  <Table.Td key={perm}>
                    <Checkbox
                      checked={k.permissions[perm]}
                      disabled={!isAdmin}
                      onChange={(e) => {
                        const grant = e.currentTarget.checked
                        permMut.mutate({
                          access_key_id: k.accessKeyId,
                          read: perm === 'read' ? grant : false,
                          write: perm === 'write' ? grant : false,
                          owner: perm === 'owner' ? grant : false,
                          deny: !grant,
                        })
                      }}
                    />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="xs">Tick để cấp, bỏ tick để thu hồi từng quyền.</Text>
      </Card>
    </Stack>
  )
}
