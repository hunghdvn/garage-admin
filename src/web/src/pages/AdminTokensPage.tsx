import { toast , Input } from 'h2d-glass-ui'
import { useState } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Card, Code, CopyButton, Group, Modal, Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { IconPlus, IconTrash, IconCopy, IconCheck, IconEdit } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AdminToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { confirmDelete } from '../lib/confirmDelete'
import { useTranslation } from 'react-i18next'

export function AdminTokensPage() {
  const { t } = useTranslation()
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
    onError: (e: any) => toast.error(e?.response?.data?.error || t('adminTokens.createFailed')),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin-tokens/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); toast.success(t('adminTokens.deleted')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('common.deleteFailed')),
  })

  const editMut = useMutation({
    mutationFn: async () => (await api.post(`/admin-tokens/${editFor!.id}`, { name: editName, scope: editScope.split(',').map((s) => s.trim()).filter(Boolean) })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tokens'] }); setEditFor(null); toast.success(t('adminTokens.updated')) },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('common.updateFailed')),
  })
  function openEdit(tkn: AdminToken) { setEditFor(tkn); setEditName(tkn.name); setEditScope(tkn.scope.join(', ')) }

  return (
    <Stack>
      <Group justify="space-between">
        <h3>{t('adminTokens.title')}</h3>
        {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={open}>{t('adminTokens.createToken')}</Button>}
      </Group>

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>{t('adminTokens.name')}</Table.Th><Table.Th>{t('adminTokens.scope')}</Table.Th><Table.Th>{t('adminTokens.expiration')}</Table.Th><Table.Th>{t('adminTokens.status')}</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tokens?.map((tkn, i) => (
              <Table.Tr key={tkn.id ?? `cfg-${i}`}>
                <Table.Td>{tkn.name}</Table.Td>
                <Table.Td>{tkn.scope.map((s) => <Badge key={s} variant="light" mr={4}>{s}</Badge>)}</Table.Td>
                <Table.Td>{tkn.expiration ? new Date(tkn.expiration).toLocaleString() : '∞'}</Table.Td>
                <Table.Td>
                  {tkn.id === null ? <Badge color="gray">{t('adminTokens.configFile')}</Badge>
                    : tkn.expired ? <Badge color="red">{t('keys.expired')}</Badge> : <Badge color="green">{t('keys.active')}</Badge>}
                </Table.Td>
                <Table.Td>
                  {isAdmin && tkn.id !== null && (
                    <Group gap={4}>
                      <button aria-label="edit" onClick={() => openEdit(tkn)}><IconEdit size={16} /></button>
                      <button aria-label="delete" onClick={() => confirmDelete(tkn.name, () => deleteMut.mutate(tkn.id!))}>
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

      <Modal opened={opened} onClose={close} title={t('adminTokens.createToken')}>
        <Stack>
          <Input value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <Input value={scope} onChange={(e) => setScope(e.currentTarget.value)} />
          <Input type="datetime-local" value={expiration} onChange={(e) => setExpiration(e.currentTarget.value)} />
          <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!name}>{t('common.create')}</Button>
        </Stack>
      </Modal>

      <Modal opened={created != null} onClose={() => setCreated(null)} title={t('adminTokens.createdSaveNow')} size="lg">
        {created && (
          <Stack>
            <Alert color="yellow">{t('adminTokens.secretShownOnce')}</Alert>
            <span>{t('adminTokens.token')}</span>
            <Group>
              <code>{created.secretToken}</code>
              <CopyButton value={created.secretToken ?? ''}>
                {({ copied, copy }) => (
                  <button onClick={copy} aria-label="copy">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </button>
                )}
              </CopyButton>
            </Group>
            <Button onClick={() => setCreated(null)}>{t('adminTokens.savedClose')}</Button>
          </Stack>
        )}
      </Modal>

      <Modal opened={editFor != null} onClose={() => setEditFor(null)} title={t('adminTokens.editToken')}>
        <Stack>
          <Input value={editName} onChange={(e) => setEditName(e.currentTarget.value)} />
          <Input value={editScope} onChange={(e) => setEditScope(e.currentTarget.value)} />
          <Button onClick={() => editMut.mutate()} loading={editMut.isPending}>{t('common.save')}</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
