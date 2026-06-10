import { useState } from 'react'
import {
  ActionIcon, Badge, Button, Card, Code, CopyButton, Group, Modal, Stack, Table, Text, TextInput, Title, Alert,
} from '@mantine/core'
import { IconPlus, IconTrash, IconDownload, IconCopy, IconCheck } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type KeyListItem, type KeyInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'

export function KeysPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [createOpened, createCtl] = useDisclosure(false)
  const [importOpened, importCtl] = useDisclosure(false)
  const [name, setName] = useState('')
  const [expiration, setExpiration] = useState('')
  const [impId, setImpId] = useState('')
  const [impSecret, setImpSecret] = useState('')
  const [impName, setImpName] = useState('')
  const [createdSecret, setCreatedSecret] = useState<KeyInfo | null>(null)

  const { data: keys } = useQuery({
    queryKey: ['keys'],
    queryFn: async () => (await api.get<KeyListItem[]>('/keys')).data,
  })

  const createMut = useMutation({
    mutationFn: async (n: string) => (await api.post<KeyInfo>('/keys', { name: n, expiration: expiration ? new Date(expiration).toISOString() : null })).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['keys'] })
      createCtl.close()
      setName('')
      setExpiration('')
      setCreatedSecret(data) // show the secret once
    },
    onError: () => notifications.show({ color: 'red', message: 'Tạo key thất bại' }),
  })

  const importMut = useMutation({
    mutationFn: async () => (await api.post('/keys/import', { access_key_id: impId, secret_access_key: impSecret, name: impName })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keys'] })
      importCtl.close()
      setImpId(''); setImpSecret(''); setImpName('')
      notifications.show({ color: 'green', message: 'Đã import key' })
    },
    onError: () => notifications.show({ color: 'red', message: 'Import thất bại' }),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Access Keys</Title>
        {isAdmin && (
          <Group>
            <Button variant="light" leftSection={<IconDownload size={16} />} onClick={importCtl.open}>Import</Button>
            <Button leftSection={<IconPlus size={16} />} onClick={createCtl.open}>Tạo key</Button>
          </Group>
        )}
      </Group>

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Tên</Table.Th><Table.Th>Access Key ID</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {keys?.map((k) => (
              <Table.Tr key={k.id}>
                <Table.Td><Link to={`/keys/${k.id}`}>{k.name || '(no name)'}</Link></Table.Td>
                <Table.Td><code>{k.id}</code></Table.Td>
                <Table.Td>{k.expired ? <Badge color="red">expired</Badge> : <Badge color="green">active</Badge>}</Table.Td>
                <Table.Td>
                  {isAdmin && (
                    <ActionIcon color="red" variant="subtle" aria-label="delete" onClick={() => confirmDelete(k.name || k.id, () => deleteMut.mutate(k.id))}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={createOpened} onClose={createCtl.close} title="Tạo access key">
        <Stack>
          <TextInput label="Tên key" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <TextInput label="Hết hạn (trống = không hết hạn)" type="datetime-local" value={expiration} onChange={(e) => setExpiration(e.currentTarget.value)} />
          <Button onClick={() => createMut.mutate(name)} loading={createMut.isPending} disabled={!name}>Tạo</Button>
        </Stack>
      </Modal>

      <Modal opened={importOpened} onClose={importCtl.close} title="Import access key">
        <Stack>
          <TextInput label="Access Key ID" value={impId} onChange={(e) => setImpId(e.currentTarget.value)} required />
          <TextInput label="Secret Access Key" value={impSecret} onChange={(e) => setImpSecret(e.currentTarget.value)} required />
          <TextInput label="Tên" value={impName} onChange={(e) => setImpName(e.currentTarget.value)} />
          <Button onClick={() => importMut.mutate()} loading={importMut.isPending} disabled={!impId || !impSecret}>Import</Button>
        </Stack>
      </Modal>

      <Modal opened={createdSecret != null} onClose={() => setCreatedSecret(null)} title="Key đã tạo — lưu secret ngay!" size="lg">
        {createdSecret && (
          <Stack>
            <Alert color="yellow">Secret chỉ hiển thị MỘT LẦN. Hãy sao chép và lưu lại an toàn.</Alert>
            <Text size="sm">Access Key ID</Text>
            <Group><Code>{createdSecret.accessKeyId}</Code></Group>
            <Text size="sm">Secret Access Key</Text>
            <Group>
              <Code>{createdSecret.secretAccessKey}</Code>
              <CopyButton value={createdSecret.secretAccessKey ?? ''}>
                {({ copied, copy }) => (
                  <ActionIcon variant="light" onClick={copy} aria-label="copy">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
            <Button onClick={() => setCreatedSecret(null)}>Đã lưu, đóng</Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
