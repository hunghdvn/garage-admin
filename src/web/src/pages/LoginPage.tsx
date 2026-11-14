import { useState } from 'react'
import { Button, Card, Center, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await login(username, password)
    } catch (err: any) {
      const status = err?.response?.status
      const message =
        status === 429
          ? 'Quá nhiều lần thử, vui lòng thử lại sau'
          : status === 401 || status === 400
            ? 'Sai tài khoản hoặc mật khẩu'
            : err?.response?.data?.error || 'Đăng nhập thất bại'
      notifications.show({ color: 'red', message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Center h="100vh">
      <Card withBorder shadow="md" p="xl" w={360}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={3} ta="center">Garage Admin</Title>
            <TextInput label="Tài khoản" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
            <PasswordInput label="Mật khẩu" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
            <Button type="submit" loading={busy} fullWidth>Đăng nhập</Button>
          </Stack>
        </form>
      </Card>
    </Center>
  )
}
