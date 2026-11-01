export { derivePrefix, formatSeriesNumber, seriesPrefixError } from './prefix';
export {
  DOC_TYPES,
  createSeries,
  deactivateSeries,
  ensureDefaultSeries,
  ensureSeriesForYear,
  isDocType,
  listSeries,
  readSeries,
  seriesYear,
  takeNumber,
  takeProvisionedNumber,
  type DocType,
  type EnsureSeriesInput,
  type EnsuredSeries,
  type ProvisionedSeries,
  type SeriesFilter,
  type SeriesJson,
} from './numbering';
export { AUTOMATIC_SERIES, SERIES_PLAN, planPrefix } from './plan';
export {
  HOLDED_CODE,
  numberingProposal,
  openNumbering,
  type NumberingProposal,
} from './proposal';
