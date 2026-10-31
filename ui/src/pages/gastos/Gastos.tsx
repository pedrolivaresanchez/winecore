import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { NoPermission } from '@/components/NoPermission'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { ExpenseCapture } from '@/pages/gastos/ExpenseCapture'
import { ExpenseList } from '@/pages/gastos/ExpenseList'
import { ExpenseReview } from '@/pages/gastos/ExpenseReview'

export function Gastos({ me }: { me: Me }) {
  const params = useParams()
  const rest = params['*'] ?? ''

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js')
  }, [])

  if (!allows(me, 'purchasing.read')) return <NoPermission />
  if (rest === 'capturar') return <ExpenseCapture me={me} />
  if (rest) return <ExpenseReview me={me} id={decodeURIComponent(rest)} />
  return <ExpenseList me={me} />
}
