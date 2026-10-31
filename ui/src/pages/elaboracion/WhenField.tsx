import { copy } from '@/i18n'
import { DatePicker } from '@/ui'

export function WhenField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <DatePicker
      className="w-full"
      withTime
      locale="es"
      timeZone="Europe/Madrid"
      labels={{ clear: copy.elaboracion.clearDate, today: copy.elaboracion.today, time: copy.elaboracion.time }}
      value={value || null}
      onChange={(next) => onChange(next ?? '')}
    />
  )
}
