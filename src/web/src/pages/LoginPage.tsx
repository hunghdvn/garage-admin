import { useState } from 'react'
import { Button, Card, CardContent, CardFooter, CardHeader, CardTitle, Field, Input, toast } from 'h2d-glass-ui'
import { useAuth } from '../auth/AuthContext'
import { useTranslation } from 'react-i18next'

export function LoginPage() {
  const { login } = useAuth()
  const { t } = useTranslation()
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
          ? t('login.tooMany')
          : status === 401 || status === 400
            ? t('login.invalidCredentials')
            : err?.response?.data?.error || t('login.failed')
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: 16, background: 'var(--flg-surface, transparent)' }}>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <form onSubmit={submit}>
          <CardHeader style={{ textAlign: 'center', padding: '24px 24px 8px' }}>
            <CardTitle style={{ fontSize: 22 }}>Garage Admin</CardTitle>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 24px 16px' }}>
            <Field label={t('login.username')} required>
              <Input value={username} onChange={(e) => setUsername(e.currentTarget.value)} required autoComplete="username" />
            </Field>
            <Field label={t('login.password')} required>
              <Input type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required autoComplete="current-password" />
            </Field>
          </CardContent>
          <CardFooter style={{ padding: '8px 24px 24px' }}>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? '...' : t('login.submit')}</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
