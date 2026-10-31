export type Subject = 'grape' | 'must' | 'wine_aging' | 'blend_candidate' | 'bottle'
export type ScoreScale = '0-10' | '0-100'
export type FieldKind = 'text' | 'number' | 'integer' | 'scale' | 'select' | 'boolean' | 'date'
export type DescriptorFamily = 'visual' | 'nose' | 'mouth' | 'defect' | 'other'
export type TastingSource = 'manual' | 'voice' | 'chat'
export type SessionStatus = 'open' | 'revealed'

export type TemplateField = {
  id: string
  field_key: string
  label: string
  kind: FieldKind
  required: boolean
  position: number
  options: string[] | null
  min_value: number | null
  max_value: number | null
  unit: string | null
  help: string | null
  is_active: boolean
}

export type Template = {
  id: string
  code: string
  name: string
  subject: Subject
  score_scale: ScoreScale
  is_active: boolean
  fields: TemplateField[]
}

export type Descriptor = {
  code: string
  name_es: string
  family: DescriptorFamily
  is_active: boolean
}

export type NoteAttachment = {
  id: string
  role: string
  filename: string
}

export type Note = {
  id: string
  template_id: string
  template_code: string
  tasted_at: string
  taster_user_id: string | null
  taster_name: string
  subject: Subject
  parcel_id: string | null
  lot_id: string | null
  vessel_id: string | null
  product_id: string | null
  wine_id: string | null
  vintage: number | null
  score_scale: ScoreScale
  visual_score: number | null
  nose_score: number | null
  mouth_score: number | null
  overall_score: number | null
  descriptors: string[]
  descriptors_text: string | null
  defects: string[]
  decision: string | null
  notes: string | null
  voice_transcript: string | null
  place: string | null
  glass: string | null
  context: string | null
  evolution: string | null
  values: Record<string, unknown>
  source: TastingSource
  attachments: NoteAttachment[]
  created_at: string
  updated_at: string
}

export type NoteDraft = {
  template_id: string
  tasted_at: string
  taster_name: string
  parcel_id?: string | null
  lot_id?: string | null
  wine_id?: string | null
  vintage?: number | null
  visual_score?: number | null
  nose_score?: number | null
  mouth_score?: number | null
  overall_score?: number | null
  descriptors: string[]
  defects: string[]
  decision?: string | null
  notes?: string | null
  voice_transcript?: string | null
  values: Record<string, unknown>
  source: TastingSource
}

export type NotePatch = {
  visual_score?: number | null
  nose_score?: number | null
  mouth_score?: number | null
  overall_score?: number | null
  descriptors?: string[]
  defects?: string[]
  decision?: string | null
  notes?: string | null
  voice_transcript?: string | null
  values?: Record<string, unknown>
}

export type PublicSample = {
  sample_no: number
  lot_id?: string
  lot_code?: string
  vessel_id?: string | null
  vessel_code?: string | null
}

export type SessionVote = {
  id: string
  sample_no: number
  day_no: number
  taster_name: string
  vote: 'yes' | 'no'
  score: number | null
  comment: string | null
}

export type DayBallot = {
  day_no: number
  yes: number
  no: number
  yes_ratio: number
  mean_score: number | null
}

export type SessionAggregate = {
  sample_no: number
  votes: number
  yes: number
  no: number
  yes_ratio: number
  mean_score: number | null
  consistency: number | null
  days: DayBallot[]
  selected: boolean
  lot_id?: string
  lot_code?: string
  vessel_id?: string | null
  vessel_code?: string | null
}

export type Session = {
  id: string
  title: string
  target: string
  status: SessionStatus
  started_on: string
  days: number
  notes: string | null
  revealed: boolean
  revealed_at: string | null
  samples: PublicSample[]
  votes: SessionVote[]
  aggregate: SessionAggregate[] | null
}

export type Selection = {
  session_id: string
  target: string
  revealed: true
  lots: {
    lot_id: string
    lot_code: string
    vessel_id: string | null
    vessel_code: string | null
    sample_no: number
    yes_ratio: number
    mean_score: number | null
    consistency: number | null
  }[]
}

export type EvolutionPoint = {
  at: string
  kind: 'tasting' | 'analysis'
  lot_id: string | null
  lot_code: string | null
  vintage: number | null
  tasting?: {
    id: string
    subject: Subject
    taster_name: string
    visual_score: number | null
    nose_score: number | null
    mouth_score: number | null
    overall_score: number | null
    defects: string[]
    decision: string | null
  }
  analysis?: {
    id: string
    analysis_kind: string
    lab: string
    results: { code: string; name: string; value: number; unit: string }[]
  }
}

export type EvolutionView = {
  scope:
    | { kind: 'lot'; lot_id: string; lot_code: string; vintage: number | null; wine_id: string | null; wine_code: string | null }
    | { kind: 'wine'; wine_id: string; wine_code: string; wine_name: string; vintages: number[] }
  points: EvolutionPoint[]
}
