import { useState } from 'react'
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from 'h2d-glass-ui'
import { toast } from 'h2d-glass-ui'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useTranslation } from 'react-i18next'

export function ProfilePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/auth/password', { current_password: current, new_password: next })
      toast.success(t('profile.passwordChanged'))
      setCurrent(''); setNext('')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('profile.passwordChangeFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>{t('profile.title')}</h3>
      <p style={{ color: 'var(--flg-text-muted, inherit)' }}>
        {t('profile.loggedInAs')} <b>{user?.username}</b> ({user?.role})
      </p>
      <Card style={{ maxWidth: 420 }}>
        <form onSubmit={submit}>
          <CardHeader><CardTitle>{t('profile.changePassword')}</CardTitle></CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('profile.currentPassword')} required>
              <Input type="password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} required />
            </Field>
            <Field label={t('profile.newPassword')} description={t('profile.minChars')} required>
              <Input type="password" value={next} onChange={(e) => setNext(e.currentTarget.value)} required />
            </Field>
            <Button type="submit" disabled={busy || !current || !next}>{t('profile.update')}</Button>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
