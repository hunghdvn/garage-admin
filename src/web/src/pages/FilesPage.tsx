import { toast , Input , Spinner } from 'h2d-glass-ui'
import { useEffect, useRef, useState } from 'react'
import {
  ActionIcon, Anchor, Breadcrumbs, Button, Card, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { IconFolderPlus, IconUpload, IconTrash, IconDownload, IconFolder, IconFile, IconEdit } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { api, type BucketListItem, type FileEntry } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'
import { confirmDelete } from '../lib/confirmDelete'
import { useTranslation } from 'react-i18next'

export function FilesPage() {
  const { t } = useTranslation()
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
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null)
  const [renameName, setRenameName] = useState('')

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
      toast.success(t('files.uploaded', { name: file.name }))
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('files.uploadFailed'))
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
      toast.error(err?.response?.data?.error || t('files.createFolderFailed'))
    }
  }

  async function remove(entry: FileEntry) {
    try {
      await api.delete('/files', { params: { bucket, key: entry.key } })
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('files.deleteFailed'))
    }
  }

  function openRename(entry: FileEntry) {
    setRenameEntry(entry)
    setRenameName(entry.name)
  }

  async function submitRename() {
    if (!renameEntry) return
    const isDir = renameEntry.is_dir
    // dst keeps the current prefix, swaps the last segment for the new name.
    const dst = prefix + renameName + (isDir ? '/' : '')
    try {
      await api.post('/files/rename', { src: renameEntry.key, dst }, { params: { bucket } })
      setRenameEntry(null)
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('files.renameFailed'))
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
        <h3>{t('nav.files')}</h3>
        <Select data={bucketOptions} value={bucket || null} onChange={(v) => v && setBucket(v)} placeholder={t('files.selectBucket')} allowDeselect={false} />
      </Group>

      {!bucket ? (
        <span>{t('files.selectBucketHint')}</span>
      ) : (
        <>
          <Group justify="space-between">
            <Breadcrumbs>
              <a onClick={() => setPrefix('')}>{bucket}</a>
              {segments.map((seg, i) => (
                <a key={i} onClick={() => setPrefix(crumbPrefix(i))}>{seg}</a>
              ))}
            </Breadcrumbs>
            {isAdmin && (
              <Group>
                <Button variant="light" leftSection={<IconFolderPlus size={16} />} onClick={folderCtl.open}>{t('files.newFolder')}</Button>
                <Button leftSection={<IconUpload size={16} />} loading={uploading} onClick={() => fileInput.current?.click()}>{t('files.upload')}</Button>
                <input ref={fileInput} type="file" hidden onChange={onUpload} />
              </Group>
            )}
          </Group>

          <Card withBorder>
            {files.isLoading ? <Spinner /> : files.error ? (
              <Stack gap={4}>
                <span>{t('files.cannotBrowse')}</span>
                <span>{(files.error as any)?.response?.data?.error || (files.error as any)?.message || t('files.unknownError')}</span>
                <span>{t('files.checkS3')}</span>
              </Stack>
            ) : (
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr><Table.Th>{t('files.name')}</Table.Th><Table.Th>{t('files.size')}</Table.Th><Table.Th>{t('files.modified')}</Table.Th><Table.Th /></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(files.data ?? []).length === 0 && (
                    <Table.Tr><Table.Td colSpan={4}><span>{t('files.emptyFolder')}</span></Table.Td></Table.Tr>
                  )}
                  {(files.data ?? []).map((entry) => (
                    <Table.Tr key={entry.key}>
                      <Table.Td>
                        {entry.is_dir ? (
                          <a onClick={() => setPrefix(entry.key)}>
                            <Group gap={6}><IconFolder size={16} />{entry.name}</Group>
                          </a>
                        ) : (
                          <Group gap={6}><IconFile size={16} />{entry.name}</Group>
                        )}
                      </Table.Td>
                      <Table.Td>{entry.is_dir ? '—' : fmtBytes(entry.size)}</Table.Td>
                      <Table.Td>{entry.last_modified ? new Date(entry.last_modified).toLocaleString() : '—'}</Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end">
                          {!entry.is_dir && (
                            <button aria-label="download" onClick={() => download(entry)}><IconDownload size={16} /></button>
                          )}
                          {isAdmin && (
                            <button aria-label="rename" onClick={() => openRename(entry)}><IconEdit size={16} /></button>
                          )}
                          {isAdmin && (
                            <button aria-label="delete"
                              onClick={() => confirmDelete(entry.is_dir ? t('files.folderConfirm', { name: entry.name }) : entry.name, () => remove(entry))}>
                              <IconTrash size={16} />
                            </button>
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

      <Modal opened={folderOpen} onClose={folderCtl.close} title={t('files.createFolder')}>
        <Stack>
          <Input value={folderName} onChange={(e) => setFolderName(e.currentTarget.value)} />
          <Button onClick={createFolder} disabled={!folderName}>{t('common.create')}</Button>
        </Stack>
      </Modal>

      <Modal opened={renameEntry !== null} onClose={() => setRenameEntry(null)} title={renameEntry?.is_dir ? t('files.renameFolder') : t('files.renameFile')}>
        <Stack>
          <Input value={renameName} onChange={(e) => setRenameName(e.currentTarget.value)} />
          {renameEntry?.is_dir && <span>{t('files.renameFolderHint')}</span>}
          <Button onClick={submitRename} disabled={!renameName || renameName === renameEntry?.name}>{t('common.save')}</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
