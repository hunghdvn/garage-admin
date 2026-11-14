import { toast , Input , Spinner } from 'h2d-glass-ui'
import { useEffect, useState } from 'react'
import {
  ActionIcon, Alert, Anchor, Badge, Breadcrumbs, Button, Card, Code, CopyButton, Group, Loader, Stack, Switch, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { IconCopy, IconCheck, IconAlertTriangle } from '@tabler/icons-react'
import { api, type KeyInfo } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useTranslation } from 'react-i18next'

export function KeyDetailPage() {
  const { t } = useTranslation()
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
      toast.success(t('common.updated'))
    },
    onError: () => toast.error(t('common.updateFailed')),
  })

  async function handleRevealSecret() {
    setRevealLoading(true)
    try {
      const res = await api.get<KeyInfo>(`/keys/${id}`, { params: { reveal: 1 } })
      setSecret(res.data.secretAccessKey ?? null)
    } catch {
      toast.error(t('keyDetail.secretFetchFailed'))
    } finally {
      setRevealLoading(false)
    }
  }

  if (isLoading || !key) return <Spinner />

  return (
    <Stack>
      <Breadcrumbs>
        <Link to="/keys">{t('nav.accessKeys')}</Link>
        <span>{key.name || key.accessKeyId}</span>
      </Breadcrumbs>
      <h3>{key.name || key.accessKeyId}</h3>

      <Card withBorder>
        <Stack>
          <Group><span>{t('keyDetail.accessKeyId')}</span><code>{key.accessKeyId}</code></Group>
          <Group><span>{t('keyDetail.status')}</span>{key.expired ? <Badge color="red">{t('keys.expired')}</Badge> : <Badge color="green">{t('keys.active')}</Badge>}</Group>
          {isAdmin && (
            secret ? (
              <Stack gap="xs">
                <Alert icon={<IconAlertTriangle size={16} />} color="yellow" title={t('keyDetail.sensitiveInfo')}>
                  {t('keyDetail.secretShareSecurely')}
                </Alert>
                <Group>
                  <span>{t('keyDetail.secretKey')}</span>
                  <code>{secret}</code>
                  <CopyButton value={secret} timeout={2000}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? t('common.copied') : t('common.copy')} withArrow position="right">
                        <button color={copied ? 'teal' : 'gray'} onClick={copy}>
                          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        </button>
                      </Tooltip>
                    )}
                  </CopyButton>
                </Group>
              </Stack>
            ) : (
              <Group>
                <span>{t('keyDetail.secretKey')}</span>
                <Button variant="light" size="xs" loading={revealLoading} onClick={handleRevealSecret}>
                  {t('keyDetail.revealSecret')}
                </Button>
              </Group>
            )
          )}
          <Group align="end">
            <Input value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={!isAdmin} />
            {isAdmin && <Button variant="light" onClick={() => updateMut.mutate({ name })}>{t('keyDetail.rename')}</Button>}
          </Group>
          <Switch label={t('keyDetail.allowCreateBucket')} checked={createBucket} disabled={!isAdmin}
            onChange={(e) => { setCreateBucket(e.currentTarget.checked); updateMut.mutate({ create_bucket: e.currentTarget.checked }) }} />
          <Group align="end">
            <Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.currentTarget.value)} disabled={!isAdmin} />
            {isAdmin && <Button variant="light" onClick={() => updateMut.mutate({ expiration: new Date(expiry).toISOString() })} disabled={!expiry}>{t('keyDetail.setExpiry')}</Button>}
            {isAdmin && <Button variant="subtle" onClick={() => updateMut.mutate({ never_expires: true })}>{t('keyDetail.removeExpiry')}</Button>}
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <h5>{t('keyDetail.accessibleBuckets')}</h5>
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th>{t('nav.buckets')}</Table.Th><Table.Th>{t('bucketDetail.read')}</Table.Th><Table.Th>{t('bucketDetail.write')}</Table.Th><Table.Th>{t('bucketDetail.owner')}</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {key.buckets.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>
                  <Link to={`/buckets/${b.id}`}>
                    {b.globalAliases[0] ?? b.id.slice(0, 12)}
                  </Link>
                </Table.Td>
                <Table.Td>{b.permissions.read ? '✓' : ''}</Table.Td>
                <Table.Td>{b.permissions.write ? '✓' : ''}</Table.Td>
                <Table.Td>{b.permissions.owner ? '✓' : ''}</Table.Td>
              </Table.Tr>
            ))}
            {key.buckets.length === 0 && (
              <Table.Tr><Table.Td colSpan={4}><span>{t('keyDetail.noBucketPermissions')}</span></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
