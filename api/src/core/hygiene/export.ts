import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { businessDate } from '../time';
import { isBusinessDate } from '../inventory/periods';
import { invalid } from '../cellar/service/http';
import {
  CLOSURE_LABEL,
  EFFLUENT_PENDING,
  PLATE_GRADE_LABEL,
  SEAL_LABEL,
  type ClosureType,
  type PlateGrade,
  type SealType,
} from './constants';
import { decimalOut } from './parse';

export interface AppccReport {
  title: string;
  period: { from: string; to: string };
  generated_at: string;
  environmental_note: string;
  cleanings: Record<string, unknown>[];
  disinfections: Record<string, unknown>[];
  bottling_checks: Record<string, unknown>[];
  equipment_maintenance: Record<string, unknown>[];
  filtrations: Record<string, unknown>[];
}

export async function buildAppccReport(writer: Writer, request: Request): Promise<AppccReport> {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!isBusinessDate(from)) invalid({ from: 'Debe ser una fecha YYYY-MM-DD' });
  if (!isBusinessDate(to)) invalid({ to: 'Debe ser una fecha YYYY-MM-DD' });
  if (from > to) invalid({ to: 'El periodo está al revés' });
  const cleanings = await loadCleanings(writer, from, to);
  const checks = await loadChecks(writer, from, to);
  const maintenance = await loadMaintenance(writer, from, to);
  const filtrations = await loadFiltrations(writer, from, to);
  const disinfectionLogs = cleanings.filter((row) => row.purpose === 'disinfection' || row.purpose === 'both');
  const cleaningLogs = cleanings.filter((row) => row.purpose === 'cleaning' || row.purpose === 'both');
  const bottleDisinfections = checks
    .filter((row) => row.bottles_disinfected === true)
    .map((row) => ({
      record_kind: 'bottling_disinfection',
      occurred_on: row.occurred_on,
      operator: row.operator,
      operation_number: row.operation_number,
      procedure_name: row.disinfection_procedure_name,
      equipment_code: row.equipment_code,
      notes: row.notes,
    }));
  return {
    title: 'Registro APPCC de bodega',
    period: { from, to },
    generated_at: new Date().toISOString(),
    environmental_note: EFFLUENT_PENDING,
    cleanings: cleaningLogs,
    disinfections: [...disinfectionLogs, ...bottleDisinfections],
    bottling_checks: checks,
    equipment_maintenance: maintenance,
    filtrations,
  };
}

export function appccCsv(report: AppccReport): string {
  const lines = ['tipo;fecha;operario;referencia;detalle;equipo;notas'];
  const push = (tipo: string, fecha: unknown, operario: unknown, referencia: unknown, detalle: unknown, equipo: unknown, notas: unknown) => {
    lines.push([tipo, fecha, operario, referencia, detalle, equipo, notas].map(csv).join(';'));
  };
  for (const row of report.cleanings) {
    push('limpieza', row.occurred_on, row.operator, row.procedure_code, `${row.product_name} ${row.actual_dose} ${row.actual_dose_unit}`, row.equipment_code, row.effluent_note);
  }
  for (const row of report.disinfections) {
    push('desinfeccion', row.occurred_on, row.operator, row.procedure_code ?? row.procedure_name, row.record_kind ?? row.purpose, row.equipment_code, row.notes ?? row.effluent_note);
  }
  for (const row of report.bottling_checks) {
    push('envasado', row.occurred_on, row.operator, row.operation_number, `${row.closure_label} / ${row.seal_label}`, row.equipment_code, row.notes);
  }
  for (const row of report.equipment_maintenance) {
    push('mantenimiento', row.occurred_on, row.operator, row.equipment_code, row.notes, row.equipment_code, row.next_due_on);
  }
  for (const row of report.filtrations) {
    push('filtracion', row.occurred_on, row.operator, row.plate_grade_label, row.plate_format, row.equipment_code, row.supplier_name);
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

async function loadCleanings(writer: Writer, from: string, to: string) {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT l.occurred_on::VARCHAR AS occurred_on, l.operator, l.actual_dose::VARCHAR AS actual_dose,
           l.actual_dose_unit, l.actual_contact_time_min, l.rinsed, l.notes,
           p.code AS procedure_code, p.name AS procedure_name, p.purpose, p.product_name,
           p.active_substance, p.effluent_destination, p.effluent_note,
           o.number AS operation_number, v.code AS vessel_code, e.code AS equipment_code
    FROM hygiene.cleaning_log l
    JOIN hygiene.cleaning_procedure p ON p.id = l.procedure_id
    JOIN cellar.operation o ON o.id = l.operation_id
    LEFT JOIN cellar.vessel v ON v.id = l.vessel_id
    LEFT JOIN hygiene.equipment e ON e.id = l.equipment_id
    WHERE o.status = 'confirmed'
      AND l.occurred_on BETWEEN CAST(${from} AS DATE) AND CAST(${to} AS DATE)
    ORDER BY l.occurred_on, l.id
  `);
  return rows.map((row) => ({
    record_kind: 'cleaning_log',
    occurred_on: String(row.occurred_on).slice(0, 10),
    operator: String(row.operator),
    procedure_code: String(row.procedure_code),
    procedure_name: String(row.procedure_name),
    purpose: String(row.purpose),
    product_name: String(row.product_name),
    active_substance: String(row.active_substance),
    actual_dose: decimalOut(row.actual_dose),
    actual_dose_unit: String(row.actual_dose_unit),
    actual_contact_time_min: Number(row.actual_contact_time_min),
    rinsed: row.rinsed === true,
    notes: row.notes == null ? null : String(row.notes),
    effluent_destination: String(row.effluent_destination),
    effluent_note: String(row.effluent_note),
    operation_number: row.operation_number == null ? null : String(row.operation_number),
    vessel_code: row.vessel_code == null ? null : String(row.vessel_code),
    equipment_code: row.equipment_code == null ? null : String(row.equipment_code),
  }));
}

async function loadChecks(writer: Writer, from: string, to: string) {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT o.occurred_at, o.number AS operation_number, c.operator, c.bottles_disinfected,
           c.fill_rejects, c.closure_rejects, c.label_rejects, c.closure_type, c.seal_type, c.notes,
           e.code AS equipment_code, e.name AS equipment_name, p.name AS procedure_name
    FROM hygiene.bottling_check c
    JOIN cellar.operation o ON o.id = c.operation_id
    JOIN hygiene.equipment e ON e.id = c.equipment_id
    LEFT JOIN hygiene.cleaning_procedure p ON p.id = c.disinfection_procedure_id
    WHERE o.status = 'confirmed'
    ORDER BY o.occurred_at, c.id
  `);
  return rows.flatMap((row) => {
    const occurredOn = businessDate(new Date(String(row.occurred_at)));
    if (occurredOn < from || occurredOn > to) return [];
    const closure = String(row.closure_type) as ClosureType;
    const seal = String(row.seal_type) as SealType;
    return [{
      record_kind: 'bottling_check',
      occurred_on: occurredOn,
      operation_number: row.operation_number == null ? null : String(row.operation_number),
      operator: String(row.operator),
      bottles_disinfected: row.bottles_disinfected === true,
      disinfection_procedure_name: row.procedure_name == null ? null : String(row.procedure_name),
      fill_rejects: Number(row.fill_rejects),
      closure_rejects: Number(row.closure_rejects),
      label_rejects: Number(row.label_rejects),
      closure_type: closure,
      closure_label: CLOSURE_LABEL[closure],
      seal_type: seal,
      seal_label: SEAL_LABEL[seal],
      equipment_code: String(row.equipment_code),
      equipment_name: String(row.equipment_name),
      notes: row.notes == null ? null : String(row.notes),
    }];
  });
}

async function loadMaintenance(writer: Writer, from: string, to: string) {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT m.performed_at, m.notes, m.operator, m.next_due_on::VARCHAR AS next_due_on,
           e.code AS equipment_code, e.name AS equipment_name, e.kind
    FROM hygiene.equipment_maintenance m
    JOIN hygiene.equipment e ON e.id = m.equipment_id
    ORDER BY m.performed_at, m.id
  `);
  return rows.flatMap((row) => {
    const occurredOn = businessDate(new Date(String(row.performed_at)));
    if (occurredOn < from || occurredOn > to) return [];
    return [{
      record_kind: 'equipment_maintenance',
      occurred_on: occurredOn,
      operator: String(row.operator),
      notes: String(row.notes),
      next_due_on: row.next_due_on == null ? null : String(row.next_due_on).slice(0, 10),
      equipment_code: String(row.equipment_code),
      equipment_name: String(row.equipment_name),
      equipment_kind: String(row.kind),
    }];
  });
}

async function loadFiltrations(writer: Writer, from: string, to: string) {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT f.occurred_at, f.plate_grade, f.plate_format, f.plate_count, f.operator, f.notes,
           e.code AS equipment_code, c.legal_name AS supplier_name
    FROM hygiene.filtration f
    LEFT JOIN hygiene.equipment e ON e.id = f.equipment_id
    LEFT JOIN party.contact c ON c.id = f.supplier_contact_id
    ORDER BY f.occurred_at, f.id
  `);
  return rows.flatMap((row) => {
    const occurredOn = businessDate(new Date(String(row.occurred_at)));
    if (occurredOn < from || occurredOn > to) return [];
    const grade = String(row.plate_grade) as PlateGrade;
    return [{
      record_kind: 'filtration',
      occurred_on: occurredOn,
      operator: String(row.operator),
      plate_grade: grade,
      plate_grade_label: PLATE_GRADE_LABEL[grade],
      plate_format: String(row.plate_format),
      plate_count: Number(row.plate_count),
      equipment_code: row.equipment_code == null ? null : String(row.equipment_code),
      supplier_name: row.supplier_name == null ? null : String(row.supplier_name),
      notes: row.notes == null ? null : String(row.notes),
    }];
  });
}

function csv(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (/[;"\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
