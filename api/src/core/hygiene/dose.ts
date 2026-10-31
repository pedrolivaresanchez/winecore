import { money } from '../money';
import { domainError } from '../errors';
import type { DoseUnit } from './constants';

export interface DoseCheck {
  actual: string;
  unit: DoseUnit;
  min: string;
  max: string;
  procedureUnit: DoseUnit;
  contactMinutes: number;
  minContactMinutes: number;
  rinseRequired: boolean;
  rinsed: boolean;
}

/** La dosis real tiene que caer en el rango del procedimiento, con su tiempo y aclarado. */
export function assertDose(check: DoseCheck): void {
  const fields: Record<string, string> = {};
  if (check.unit !== check.procedureUnit) {
    fields.actual_dose_unit = 'La unidad no es la del procedimiento';
  } else {
    const actual = money.fromString(check.actual);
    const min = money.fromString(check.min);
    const max = money.fromString(check.max);
    if (actual.lt(min) || actual.gt(max)) {
      fields.actual_dose = 'Queda fuera del rango del procedimiento';
    }
  }
  if (check.contactMinutes < check.minContactMinutes) {
    fields.actual_contact_time_min = 'No alcanza el tiempo de contacto del procedimiento';
  }
  if (check.rinseRequired && !check.rinsed) {
    fields.rinsed = 'El procedimiento exige aclarado';
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_HYGIENE_DOSE', fields);
}
