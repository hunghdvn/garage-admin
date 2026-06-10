import { useEffect, useRef, useState } from 'react'
import {
  ActionIcon, Anchor, Breadcrumbs, Button, Card, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { IconFolderPlus, IconUpload, IconTrash, IconDownload, IconFolder, IconFile } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, type BucketListItem, type FileEntry } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'
import { confirmDelete } from '../lib/confirmDelete'

export function FilesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const bucket = params.get('bucket') ?? ''
  const prefix = params.get('prefix') ?? ''
  const fileInput = useRef<HTMLInputElement>(null)
  const [folderOpen, folderCtl] = useDisclosure(false)
  const [folderName, setFolderName] = useState('')
  const [uploading, setUploading] = useState(false)

  const buckets = useQuery({ queryKey: ['buckets'], queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data })

  // default the bucket to the first one if none selected
  useEffect(() => {
    if (!bucket && buckets.data && buckets.data.length > 0) {
      const alias = buckets.data[0].globalAliases[0] ?? buckets.data[0].id
      setParams({ bucket: alias })
    }
  }, [buckets.data, bucket, setParams])

  const files = useQuery({
    queryKey: ['files', bucket, prefix],
    queryFn: async () => (await api.get<FileEntry[]>('/files', { params: { bucket, prefix } })).data,
    enabled: !!bucket,
  })

  function setPrefix(p: string) { setParams({ bucket, prefix: p }) }
  function setBucket(b: string) { setParams({ bucket: b }) }

  const segments = prefix ? prefix.replace(/\/$/, '').split('/') : []
  function crumbPrefix(i: number) { return segments.slice(0, i + 1).join('/') + '/' }

  const refresh = () => qc.invalidateQueries({ queryKey: ['files', bucket, prefix] })

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.post('/files/upload', file, {
        params: { bucket, key: prefix + file.name },
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
      notifications.show({ color: 'green', message: `Đã tải lên ${file.name}` })
      refresh()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Tải lên thất bại' })
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function createFolder() {
    try {
      await api.post('/files/folder', null, { params: { bucket, prefix: prefix + folderName } })
      folderCtl.close(); setFolderName(''); refresh()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Tạo thư mục thất bại' })
    }
  }

  async function remove(entry: FileEntry) {
    try {
      await api.delete('/files', { params: { bucket, key: entry.key } })
      refresh()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Xóa thất bại' })
    }
  }

  function download(entry: FileEntry) {
    const url = `/api/files/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(entry.key)}`
    window.open(url, '_blank')
  }

  const bucketOptions = (buckets.data ?? []).map((b) => {
    const v = b.globalAliases[0] ?? b.id
    return { value: v, label: v }
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Files</Title>
        <Select w={260} data={bucketOptions} value={bucket || null} onChange={(v) => v && setBucket(v)} placeholder="Chọn bucket" allowDeselect={false} />
      </Group>

      {!bucket ? (
        <Text c="dimmed">Chọn một bucket để duyệt file.</Text>
      ) : (
        <>
          <Group justify="space-between">
            <Breadcrumbs>
              <Anchor onClick={() => setPrefix('')}>{bucket}</Anchor>
              {segments.map((seg, i) => (
                <Anchor key={i} onClick={() => setPrefix(crumbPrefix(i))}>{seg}</Anchor>
              ))}
            </Breadcrumbs>
            {isAdmin && (
              <Group>
                <Button variant="light" leftSection={<IconFolderPlus size={16} />} onClick={folderCtl.open}>Thư mục mới</Button>
                <Button leftSection={<IconUpload size={16} />} loading={uploading} onClick={() => fileInput.current?.click()}>Tải lên</Button>
                <input ref={fileInput} type="file" hidden onChange={onUpload} />
              </Group>
            )}
          </Group>

          <Card withBorder>
            {files.isLoading ? <Loader /> : files.error ? (
              <Stack gap={4}>
                <Text c="red" fw={600}>Không duyệt được bucket.</Text>
                <Text c="red" size="sm">{(files.error as any)?.response?.data?.error || (files.error as any)?.message || 'Lỗi không xác định'}</Text>
                <Text size="xs" c="dimmed">Kiểm tra S3 endpoint + access key/secret của cluster trong Settings → Sửa cluster.</Text>
              </Stack>
            ) : (
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr><Table.Th>Tên</Table.Th><Table.Th>Kích thước</Table.Th><Table.Th>Sửa đổi</Table.Th><Table.Th /></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(files.data ?? []).length === 0 && (
                    <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm">Thư mục trống.</Text></Table.Td></Table.Tr>
                  )}
                  {(files.data ?? []).map((entry) => (
                    <Table.Tr key={entry.key}>
                      <Table.Td>
                        {entry.is_dir ? (
                          <Anchor onClick={() => setPrefix(entry.key)}>
                            <Group gap={6}><IconFolder size={16} />{entry.name}</Group>
                          </Anchor>
                        ) : (
                          <Group gap={6}><IconFile size={16} />{entry.name}</Group>
                        )}
                      </Table.Td>
                      <Table.Td>{entry.is_dir ? '—' : fmtBytes(entry.size)}</Table.Td>
                      <Table.Td>{entry.last_modified ? new Date(entry.last_modified).toLocaleString() : '—'}</Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end">
                          {!entry.is_dir && (
                            <ActionIcon variant="subtle" aria-label="download" onClick={() => download(entry)}><IconDownload size={16} /></ActionIcon>
                          )}
                          {isAdmin && !entry.is_dir && (
                            <ActionIcon color="red" variant="subtle" aria-label="delete" onClick={() => confirmDelete(entry.name, () => remove(entry))}><IconTrash size={16} /></ActionIcon>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      <Modal opened={folderOpen} onClose={folderCtl.close} title="Tạo thư mục">
        <Stack>
          <TextInput label="Tên thư mục" value={folderName} onChange={(e) => setFolderName(e.currentTarget.value)} />
          <Button onClick={createFolder} disabled={!folderName}>Tạo</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
