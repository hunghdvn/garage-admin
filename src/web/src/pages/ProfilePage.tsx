import { useState } from 'react'
import { Button, Card, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function ProfilePage() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/auth/password', { current_password: current, new_password: next })
      notifications.show({ color: 'green', message: 'Đã đổi mật khẩu' })
      setCurrent(''); setNext('')
    } catch (err: any) {
      notifications.show({ color: 'red', message: err?.response?.data?.error || 'Đổi mật khẩu thất bại' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack>
      <Title order={3}>Hồ sơ</Title>
      <Text c="dimmed">Đăng nhập với tài khoản <b>{user?.username}</b> ({user?.role})</Text>
      <Card withBorder maw={420}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={5}>Đổi mật khẩu</Title>
            <PasswordInput label="Mật khẩu hiện tại" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} required />
            <PasswordInput label="Mật khẩu mới" value={next} onChange={(e) => setNext(e.currentTarget.value)} required />
            <Button type="submit" loading={busy} disabled={!current || !next}>Cập nhật</Button>
          </Stack>
        </form>
      </Card>
    </Stack>
  )
}
