import { ApiError, api, apiText } from '@/lib/api'
import type { DesignInput, DesignView, DeviationReport, PlanView, RecipeDetail, RecipeSummary, VintageReport } from '@/pages/lote-diseno/model'

export function readDesign(code: string) {
  return api<DesignView>(`/v1/lots/${encodeURIComponent(code)}/design`)
}

export function saveDesign(code: string, body: DesignInput) {
  return api<DesignView>(`/v1/lots/${encodeURIComponent(code)}/design`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function captureRecipe(code: string, body: { name?: string; notes?: string }) {
  return api<RecipeDetail>(`/v1/lots/${encodeURIComponent(code)}/recipe`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listRecipes(status?: string) {
  const params = new URLSearchParams({ limit: '100' })
  if (status) params.set('status', status)
  return api<{ items: RecipeSummary[]; total: number }>(`/v1/recipes?${params.toString()}`)
}

export function readRecipe(id: string) {
  return api<RecipeDetail>(`/v1/recipes/${encodeURIComponent(id)}`)
}

export function patchRecipe(id: string, body: Record<string, unknown>) {
  return api<RecipeDetail>(`/v1/recipes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function publishRecipe(id: string) {
  return api<RecipeDetail>(`/v1/recipes/${encodeURIComponent(id)}/publish`, { method: 'POST', body: '{}' })
}

export function openVersion(id: string) {
  return api<RecipeDetail>(`/v1/recipes/${encodeURIComponent(id)}/versions`, { method: 'POST', body: '{}' })
}

export function createPlan(code: string, body: { recipe_id: string; version_no: number; start_date: string }) {
  return api<PlanView>(`/v1/lots/${encodeURIComponent(code)}/plan`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function readDeviations(code: string, recipeId: string, versionNo: number | null) {
  const params = new URLSearchParams({ recipe_id: recipeId })
  if (versionNo != null) params.set('version_no', String(versionNo))
  return api<DeviationReport>(`/v1/lots/${encodeURIComponent(code)}/deviations?${params.toString()}`)
}

export function readVintage(search: string) {
  return api<VintageReport>(`/v1/vintage-comparison${search}`)
}

export async function downloadVintageCsv(search: string): Promise<void> {
  const text = await apiText(`/v1/vintage-comparison.csv${search}`)
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'comparacion-anadas.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export function messageOf(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  const field = error.fields ? Object.values(error.fields).find(Boolean) : undefined
  return field || error.message || fallback
}
