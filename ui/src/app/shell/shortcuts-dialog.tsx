import type { ReactNode } from 'react'
import { Dialog, DialogBody, DialogHeader, Kbd } from '@/ui'
import { GO_KEYS, isMac } from '@/app/shell/shortcuts'
import { copy } from '@/i18n'

function Row({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-4 border-b border-border-subtle last:border-b-0">
      <span className="min-w-0 truncate text-label text-control">{children}</span>
      <span className="flex shrink-0 items-center gap-1 text-caption text-text-tertiary">{keys}</span>
    </div>
  )
}

function Go({ letter }: { letter: string }) {
  return (
    <>
      <Kbd>G</Kbd>
      <span>{copy.command.keys.then}</span>
      <Kbd>{letter.toUpperCase()}</Kbd>
    </>
  )
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const keys = copy.command.keys
  return (
    <Dialog open={open} onClose={onClose} size="sm" labelledBy="shortcuts-title">
      <DialogHeader title={copy.command.shortcutsTitle} titleId="shortcuts-title" description={copy.command.shortcutsLead} onClose={onClose} />
      <DialogBody className="pb-5">
        <Row
          keys={
            <>
              <Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </>
          }
        >
          {keys.palette}
        </Row>
        <Row keys={<Kbd>/</Kbd>}>{keys.search}</Row>
        <Row keys={<Kbd>[</Kbd>}>{keys.rail}</Row>
        <Row keys={<Kbd>?</Kbd>}>{keys.help}</Row>
        {GO_KEYS.map((entry) => (
          <Row key={entry.key} keys={<Go letter={entry.key} />}>
            {keys[entry.label]}
          </Row>
        ))}
      </DialogBody>
    </Dialog>
  )
}
