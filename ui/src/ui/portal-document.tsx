import { createContext, useContext, type ReactNode } from 'react'

/**
 * The document a layer portals into, and whose viewport it measures.
 *
 * Menus, tooltips, hover cards and toasts portal to `document.body` so a scroll container
 * cannot clip them. That is right for every surface drawn in the tab, and wrong for the one
 * that is not: the chat popped out into its own always-on-top window is the tab's React tree
 * rendered into another document, so a model menu opened there would open in the tab behind
 * it, measured against the tab's viewport. Under this provider the same primitives portal
 * into, listen on and measure the window the tree is actually in.
 */
const PortalDocumentContext = createContext<Document | null>(null)

export function PortalDocumentProvider({
  document: doc,
  children,
}: {
  document: Document
  children: ReactNode
}) {
  return <PortalDocumentContext.Provider value={doc}>{children}</PortalDocumentContext.Provider>
}

/** The document overlays opened from here belong to — the tab's, unless a provider says otherwise. */
export function usePortalDocument(): Document {
  return useContext(PortalDocumentContext) ?? (globalThis.document as Document)
}

/** The other window's document under a provider that names one; null in the tab. */
export function useForeignDocument(): Document | null {
  const doc = useContext(PortalDocumentContext)
  return doc != null && (typeof document === 'undefined' || doc !== document) ? doc : null
}

/** The window a document is shown in: its viewport, its resize and its timers. */
export function viewOf(doc: Document): Window {
  return doc.defaultView ?? window
}

/**
 * Whether a value is a DOM node, from any window.
 *
 * `instanceof Node` asks about this window's `Node`, and an element of the popped-out
 * window is an instance of that window's. A focus or drag target in it would read as
 * "not a node" and every contains-check guarded by it would quietly fail.
 */
export function isDomNode(value: unknown): value is Node {
  return value != null && typeof (value as Node).nodeType === 'number' && typeof (value as Node).nodeName === 'string'
}
