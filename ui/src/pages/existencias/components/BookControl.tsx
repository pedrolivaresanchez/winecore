import { copy } from '@/i18n'
import { InfoTip, SegmentedControl } from '@/ui'

export function BookControl({
  value,
  onChange,
}: {
  value: 'physical' | 'fiscal'
  onChange: (value: 'physical' | 'fiscal') => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <SegmentedControl
        size="sm"
        aria-label={copy.stock.book}
        value={value}
        onChange={onChange}
        options={[
          { value: 'physical', content: copy.stock.physical },
          { value: 'fiscal', content: copy.stock.fiscal },
        ]}
      />
      <InfoTip label={copy.stock.book}>{copy.stock.booksInfo}</InfoTip>
    </div>
  )
}
