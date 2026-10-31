import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

const MADRID = 'Europe/Madrid';

export function madridNow(): TZDate {
  return new TZDate(new Date(), MADRID);
}

export function toMadridOffsetString(instant: Date): string {
  return format(new TZDate(instant, MADRID), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Calendar date of an instant in Europe/Madrid (`YYYY-MM-DD`). */
export function businessDate(instant: Date): string {
  return format(new TZDate(instant, MADRID), 'yyyy-MM-dd');
}
