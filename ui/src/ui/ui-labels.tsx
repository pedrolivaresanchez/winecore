import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * The few words a primitive says on its own.
 *
 * `src/ui` does not import i18n: the primitives are a design-system export and the app owns
 * its copy. The strings a primitive has to utter without a caller handing them over — the
 * name of the × on a dialog — live here, defaulted in English and overridden once at the
 * root, the way `ToastProvider` takes its labels. A `DialogHeader` reads its close label
 * from this rather than from a prop because thirty call sites passing the same word is
 * thirty chances to leave one in English.
 */
export type UiLabels = {
  /** Accessible name of the × that closes a dialog or a drawer. */
  close: string
  /** Accessible name of an `InfoTip`'s «i» when the caller does not name it. */
  moreInfo: string
  /** The words on a `WhyPopover` that brings no trigger of its own. */
  why: string
}

const DEFAULT_LABELS: UiLabels = { close: 'Close', moreInfo: 'More information', why: 'Why?' }

const UiLabelsContext = createContext<UiLabels>(DEFAULT_LABELS)

export function UiLabelsProvider({
  labels,
  children,
}: {
  labels: Partial<UiLabels>
  children: ReactNode
}) {
  const value = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels])
  return <UiLabelsContext.Provider value={value}>{children}</UiLabelsContext.Provider>
}

export function useUiLabels(): UiLabels {
  return useContext(UiLabelsContext)
}
