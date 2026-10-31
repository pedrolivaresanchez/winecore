import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { Button, EmptyState } from '@/ui'
import { copy } from '@/i18n'

export function NotFound() {
  const navigate = useNavigate()
  useChromeTitle(copy.notFound.title)
  return (
    <div data-screen="no-encontrada" className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState
        title={copy.notFound.title}
        description={copy.notFound.body}
        action={
          <Button type="button" variant="primary" size="sm" onClick={() => navigate('/')}>
            {copy.notFound.back}
          </Button>
        }
      />
    </div>
  )
}
