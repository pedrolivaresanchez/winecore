export type CatasSection = 'notas' | 'ciegas' | 'evolucion'

export function sectionPath(section: CatasSection, params: URLSearchParams): string {
  const next = new URLSearchParams()
  const lot = params.get('lot_id')
  const wine = params.get('wine_id')
  if (lot) next.set('lot_id', lot)
  if (wine) next.set('wine_id', wine)
  const base = section === 'notas' ? '/bodega/catas' : `/bodega/catas/${section}`
  const query = next.toString()
  return query ? `${base}?${query}` : base
}
