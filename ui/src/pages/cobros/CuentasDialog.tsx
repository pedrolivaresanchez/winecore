import { useState } from 'react'
import { Alert, Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input, Select, Switch } from '@/ui'
import { Field } from '@/components/Field'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { accountsPath, createBankAccount, type BankAccount } from '@/lib/finance'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { entityLabel } from '@/pages/cobros/money'

export function CuentasDialog({
  me,
  open,
  onClose,
  onCreated,
}: {
  me: Me
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const accounts = useApi<{ items: BankAccount[] }>(open ? accountsPath(null) : null)
  const canManage = allows(me, 'finance.manage')
  const [entity, setEntity] = useState<string>(me.entities[0]?.code ?? '')
  const [bank, setBank] = useState('')
  const [iban, setIban] = useState('')
  const [bic, setBic] = useState('')
  const [isDefault, setIsDefault] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setError(null)
    setSaving(true)
    try {
      await createBankAccount({
        legal_entity_id: entity,
        bank_name: bank.trim(),
        iban: iban.replace(/\s/g, ''),
        bic: bic.trim() || null,
        is_default: isDefault,
      })
      setBank('')
      setIban('')
      setBic('')
      accounts.reload()
      onCreated()
    } catch (err: unknown) {
      const apiError = err instanceof ApiError ? err : null
      const field = apiError?.fields ? Object.values(apiError.fields)[0] : undefined
      setError(field || apiError?.message || copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="cuentas-title" size="md">
      <DialogHeader titleId="cuentas-title" title={copy.cobros.accounts} onClose={onClose} />
      <DialogBody>
        <div data-screen="cobros-cuentas" className="grid gap-4 pb-2">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
            {(accounts.data?.items ?? []).length === 0 && !accounts.loading ? (
              <li className="px-4 py-3 text-label text-text-secondary">{copy.cobros.noAccounts}</li>
            ) : null}
            {(accounts.data?.items ?? []).map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-label text-ink-900">{account.bank_name}</p>
                  <p className="text-caption text-text-tertiary">
                    {entityLabel(account.legal_entity_id, me.entities)} · {fill(copy.cobros.ibanMasked, { last4: account.iban_last4 })}
                    {account.bic ? ` · ${account.bic}` : ''}
                  </p>
                </div>
                {account.is_default ? <span className="shrink-0 text-caption text-text-tertiary">{copy.cobros.defaultAccount}</span> : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <div className="grid gap-3">
              <h3 className="text-caption text-text-tertiary">{copy.cobros.accountNew}</h3>
              <Field id="cuenta-entidad" label={copy.cobros.entity}>
                <Select id="cuenta-entidad" className="w-full" value={entity} onChange={(event) => setEntity(event.target.value)}>
                  {me.entities.map((item) => (
                    <option key={item.id} value={item.code}>
                      {item.code === 'PO' ? copy.entity.po : item.code === 'CVPO' ? copy.entity.cvpo : item.legal_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="cuenta-banco" label={copy.cobros.bank}>
                <Input id="cuenta-banco" value={bank} maxLength={80} onChange={(event) => setBank(event.target.value)} />
              </Field>
              <Field id="cuenta-iban" label={copy.cobros.iban}>
                <Input id="cuenta-iban" value={iban} autoComplete="off" spellCheck={false} onChange={(event) => setIban(event.target.value)} />
              </Field>
              <Field id="cuenta-bic" label={copy.cobros.bic}>
                <Input id="cuenta-bic" value={bic} maxLength={11} onChange={(event) => setBic(event.target.value)} />
              </Field>
              <label className="flex items-center justify-between gap-3 text-label text-text-secondary">
                {copy.cobros.defaultAccount}
                <Switch checked={isDefault} onChange={setIsDefault} aria-label={copy.cobros.defaultAccount} />
              </label>
            </div>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.cobros.cancel}
        </Button>
        {canManage ? (
          <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            {copy.cobros.addAccount}
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}
