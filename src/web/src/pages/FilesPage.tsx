import { useEffect, useRef, useState } from 'react'
import { Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Spinner } from 'h2d-glass-ui'
import { IconFolderPlus, IconUpload, IconTrash, IconDownload, IconFolder, IconFile, IconEdit } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { api, type BucketListItem, type FileEntry } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtBytes } from './BucketsPage'
import { confirmDelete } from '../lib/confirmDelete'
import { toast } from 'h2d-glass-ui'
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
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null)
  const [renameName, setRenameName] = useState('')

  const buckets = useQuery({ queryKey: ['buckets'], queryFn: async () => (await api.get<BucketListItem[]>('/buckets')).data })

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
      await api.post('/files/upload', file, { params: { bucket, key: prefix + file.name }, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
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
      setFolderOpen(false); setFolderName(''); refresh()
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
  function openRename(entry: FileEntry) { setRenameEntry(entry); setRenameName(entry.name) }
  async function submitRename() {
    if (!renameEntry) return
    const isDir = renameEntry.is_dir
    const dst = prefix + renameName + (isDir ? '/' : '')
    try {
      await api.post('/files/rename', { src: renameEntry.key, dst }, { params: { bucket } })
      setRenameEntry(null); refresh()
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('nav.files')}</h3>
        <Select value={bucket || null} onValueChange={(v) => v && setBucket(v)} placeholder={t('files.selectBucket')}>
          {bucketOptions.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
        </Select>
      </div>

      {!bucket ? (
        <span style={{ opacity: 0.6 }}>{t('files.selectBucketHint')}</span>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
              <a onClick={() => setPrefix('')} style={{ cursor: 'pointer' }}>{bucket}</a>
              {segments.map((seg, i) => (
                <span key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span>/</span>
                  <a onClick={() => setPrefix(crumbPrefix(i))} style={{ cursor: 'pointer' }}>{seg}</a>
                </span>
              ))}
            </div>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => setFolderOpen(true)}><IconFolderPlus size={16} /> {t('files.newFolder')}</Button>
                <Button onClick={() => fileInput.current?.click()} disabled={uploading}><IconUpload size={16} /> {t('files.upload')}</Button>
                <input ref={fileInput} type="file" hidden onChange={onUpload} />
              </div>
            )}
          </div>

          <Card>
            {files.isLoading ? <Spinner /> : files.error ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'red', fontWeight: 600 }}>{t('files.cannotBrowse')}</span>
                <span style={{ color: 'red', fontSize: 13 }}>{(files.error as any)?.response?.data?.error || (files.error as any)?.message || t('files.unknownError')}</span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>{t('files.checkS3')}</span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('files.name')}</TableHead>
                      <TableHead>{t('files.size')}</TableHead>
                      <TableHead>{t('files.modified')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(files.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4}><span style={{ opacity: 0.6, fontSize: 13 }}>{t('files.emptyFolder')}</span></TableCell></TableRow>
                    )}
                    {(files.data ?? []).map((entry) => (
                      <TableRow key={entry.key}>
                        <TableCell>
                          {entry.is_dir ? (
                            <a onClick={() => setPrefix(entry.key)} style={{ cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}><IconFolder size={16} />{entry.name}</a>
                          ) : (
                            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><IconFile size={16} />{entry.name}</span>
                          )}
                        </TableCell>
                        <TableCell>{entry.is_dir ? '—' : fmtBytes(entry.size)}</TableCell>
                        <TableCell>{entry.last_modified ? new Date(entry.last_modified).toLocaleString() : '—'}</TableCell>
                        <TableCell>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            {!entry.is_dir && <Button variant="ghost" size="sm" onClick={() => download(entry)}><IconDownload size={16} /></Button>}
                            {isAdmin && <Button variant="ghost" size="sm" onClick={() => openRename(entry)}><IconEdit size={16} /></Button>}
                            {isAdmin && <Button variant="ghost" size="sm" onClick={() => confirmDelete(entry.is_dir ? t('files.folderConfirm', { name: entry.name }) : entry.name, () => remove(entry))}><IconTrash size={16} /></Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('files.createFolder')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('files.folderName')}><Input value={folderName} onChange={(e) => setFolderName(e.currentTarget.value)} /></Field>
          </div>
          <DialogFooter>
            <Button onClick={createFolder} disabled={!folderName}>{t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameEntry !== null} onOpenChange={(o) => { if (!o) setRenameEntry(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{renameEntry?.is_dir ? t('files.renameFolder') : t('files.renameFile')}</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('files.newName')}><Input value={renameName} onChange={(e) => setRenameName(e.currentTarget.value)} /></Field>
            {renameEntry?.is_dir && <span style={{ fontSize: 11, opacity: 0.6 }}>{t('files.renameFolderHint')}</span>}
          </div>
          <DialogFooter>
            <Button onClick={submitRename} disabled={!renameName || renameName === renameEntry?.name}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
