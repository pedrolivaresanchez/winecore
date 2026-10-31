import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/provider'
import { BrandMark } from '@/components/BrandMark'
import { Field } from '@/components/Field'
import { fieldAria } from '@/lib/field'
import { Alert, Button, Card, CardContent, Input } from '@/ui'
import { copy } from '@/i18n'

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <path fill="currentColor" d="M1 1h6.5v6.5H1zM8.5 1H15v6.5H8.5zM1 8.5h6.5V15H1zM8.5 8.5H15V15H8.5z" />
    </svg>
  )
}

export function LoginPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const [emailMode, setEmailMode] = useState(false)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [field, setField] = useState<string | undefined>()
  const urlCode = params.get('error')
  const urlError =
    urlCode === 'access_denied' || urlCode === 'no_access'
      ? copy.login.notAllowed
      : urlCode
        ? copy.login.providerError
        : null

  useEffect(() => {
    document.title = `${copy.login.title} · ${copy.appName}`
  }, [])

  async function onEmail(event: FormEvent) {
    event.preventDefault()
    const next = email.trim()
    if (!next) {
      setField('Escribe un correo.')
      return
    }
    setField(undefined)
    setError(null)
    setSending(true)
    try {
      await auth.sendMagicLink(next)
      setSent(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.login.providerError)
    } finally {
      setSending(false)
    }
  }

  return (
    <main
      data-screen="login"
      className="flex min-h-dvh items-center justify-center bg-canvas px-4"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <BrandMark word="always" />
        <Card className="w-full">
          <CardContent className="grid gap-4">
            <div>
              <h1 className="text-heading font-medium text-ink-900">{copy.login.title}</h1>
              <p className="mt-1 text-label text-text-tertiary">{copy.login.lead}</p>
            </div>
            {error || urlError ? <Alert tone="danger">{error ?? urlError}</Alert> : null}
            <Button type="button" variant="primary" className="w-full" onClick={() => auth.loginWithOAuth('microsoft')}>
              <MicrosoftMark />
              {copy.login.microsoft}
            </Button>
            {sent ? (
              <Alert tone="info">{copy.login.sent}</Alert>
            ) : emailMode ? (
              <form className="grid gap-3" onSubmit={onEmail}>
                <Field id="correo" label={copy.login.emailLabel} error={field}>
                  <Input
                    {...fieldAria('correo', field)}
                    invalid={Boolean(field)}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder={copy.login.placeholder}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={sending}
                  />
                </Field>
                <Button type="submit" variant="primary" className="w-full" loading={sending}>
                  {sending ? copy.login.sending : copy.login.send}
                </Button>
              </form>
            ) : (
              <Button type="button" variant="ghost" className="w-full" onClick={() => setEmailMode(true)}>
                {copy.login.email}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
