import type { UserCtx } from '../auth/permissions';
import { can } from '../auth/permissions';
import { domainError } from '../errors';
import type { EntityFilter, GroupBy, ReportScope } from './types';
import { GROUP_BY } from './types';

const GROUP_SET = new Set<string>(GROUP_BY);

export function parseReportQuery(url: URL, user: UserCtx): ReportScope {
  const fields: Record<string, string> = {};
  const from = url.searchParams.get('from')?.trim() ?? '';
  const to = url.searchParams.get('to')?.trim() ?? '';
  if (!isDate(from)) fields.from = 'Indica la fecha inicial (AAAA-MM-DD)';
  if (!isDate(to)) fields.to = 'Indica la fecha final (AAAA-MM-DD)';
  if (!fields.from && !fields.to && from > to) fields.to = 'La fecha final es anterior a la inicial';
  if (!fields.from && !fields.to && monthSpan(from, to) > 120) {
    fields.to = 'El periodo no puede superar 10 años';
  }

  const groupRaw = url.searchParams.get('group_by')?.trim() || 'month';
  if (!GROUP_SET.has(groupRaw)) fields.group_by = 'El agrupamiento no es válido';

  let compare: ReportScope['compare'] = null;
  const compareRaw = url.searchParams.get('compare');
  if (compareRaw != null && compareRaw.trim() !== '') {
    if (compareRaw.trim() !== 'previous_year') fields.compare = 'La comparación no es válida';
    else compare = 'previous_year';
  }

  let requested: EntityFilter = 'both';
  const entityRaw = url.searchParams.get('entity');
  if (entityRaw != null && entityRaw.trim() !== '') {
    const normalized = entityRaw.trim().toLowerCase().replace(/\./g, '');
    if (normalized === 'po') requested = 'PO';
    else if (normalized === 'cvpo') requested = 'CVPO';
    else if (normalized === 'both' || normalized === 'ambas' || normalized === 'all' || normalized === 'todas') {
      requested = 'both';
    } else fields.entity = 'La entidad debe ser P.O, CVPO o ambas';
  }

  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);

  const allowed = allowedEntities(user);
  if (requested === 'PO' && !allowed.has('PO')) throw domainError('WC_FORBIDDEN');
  if (requested === 'CVPO' && !allowed.has('CVPO')) throw domainError('WC_FORBIDDEN');
  const po = requested !== 'CVPO' && allowed.has('PO');
  const cvpo = requested !== 'PO' && allowed.has('CVPO');
  if (!po && !cvpo) throw domainError('WC_FORBIDDEN');
  const entities = [...(po ? ['PO'] : []), ...(cvpo ? ['CVPO'] : [])];
  const entity: EntityFilter = po && cvpo ? 'both' : po ? 'PO' : 'CVPO';
  return {
    from,
    to,
    groupBy: groupRaw as GroupBy,
    compare,
    entity,
    entities,
    po,
    cvpo,
  };
}

function allowedEntities(user: UserCtx): Set<string> {
  const codes = new Set<string>();
  let unrestricted = false;
  for (const role of user.roles) {
    if (!can({ ...user, roles: [role] }, 'reports.read')) continue;
    if (role.legalEntityId === null) unrestricted = true;
    else if (role.legalEntityCode === 'PO' || role.legalEntityCode === 'CVPO') codes.add(role.legalEntityCode);
  }
  if (unrestricted) {
    codes.add('PO');
    codes.add('CVPO');
  }
  return codes;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function monthSpan(from: string, to: string): number {
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}
