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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Card style={{ width: 360 }}>
        <form onSubmit={submit}>
          <CardHeader><CardTitle>Garage Admin</CardTitle></CardHeader>
          <CardContent>
            <Field label={t('login.username')} required>
              <Input value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
            </Field>
            <Field label={t('login.password')} required>
              <Input type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
            </Field>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>{t('login.submit')}</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
