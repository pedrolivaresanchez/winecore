import { useEffect } from 'react'
import { isAuthEnabled, useSession } from '@/auth/provider'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/ui'
import { copy } from '@/i18n'

export function NoAccess() {
  const { logout } = useSession()

  useEffect(() => {
    document.title = `Sin acceso · ${copy.appName}`
  }, [])

  return (
    <main
      data-screen="sin-acceso"
      className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center"
      style={{
        paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <BrandMark word="always" />
      <h1 className="mt-8 max-w-sm text-heading font-medium text-balance text-ink-900">{copy.noAccess}</h1>
      {isAuthEnabled ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-8"
          onClick={() => {
            logout()
            window.location.assign('/login')
          }}
        >
          {copy.user.logout}
        </Button>
      ) : null}
    </main>
  )
}
