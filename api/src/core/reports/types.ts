export const GROUP_BY = ['product', 'wine', 'lot', 'year', 'month', 'customer', 'category'] as const;

export type GroupBy = (typeof GROUP_BY)[number];

export type ReportName = 'sales' | 'expenses' | 'stock';

export type EntityFilter = 'PO' | 'CVPO' | 'both';

export interface ReportMetrics {
  amount: string;
  base: string;
  tax: string;
  units: string;
  volume_ml: string;
}

export interface ReportPoint extends ReportMetrics {
  key: string;
  label: string;
  as_of?: string;
  previous: (ReportMetrics & { key: string }) | null;
}

export interface ReportBody {
  report: ReportName;
  from: string;
  to: string;
  entity: EntityFilter;
  entities: string[];
  group_by: GroupBy;
  compare: 'previous_year' | null;
  currency: 'EUR';
  totals: ReportMetrics;
  previous_totals: ReportMetrics | null;
  series: ReportPoint[];
}

export interface ReportScope {
  from: string;
  to: string;
  groupBy: GroupBy;
  compare: 'previous_year' | null;
  entity: EntityFilter;
  entities: string[];
  po: boolean;
  cvpo: boolean;
}
