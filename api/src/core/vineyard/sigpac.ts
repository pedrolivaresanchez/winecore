/** Referencia SIGPAC: provincia:municipio:agregado:zona:polígono:parcela:recinto. */

export interface SigpacRef {
  province: number;
  municipality: number;
  aggregate: number;
  zone: number;
  polygon: number;
  parcel: number;
  enclosure: number;
}

const PART = /^\d{1,6}$/;

export function parseSigpac(value: string): SigpacRef | string {
  const parts = value.trim().split(':');
  if (parts.length !== 7) {
    return 'La referencia SIGPAC tiene 7 partes: provincia:municipio:agregado:zona:polígono:parcela:recinto';
  }
  const numbers: number[] = [];
  for (const part of parts) {
    if (!PART.test(part)) return 'Cada parte de la referencia SIGPAC es un entero sin signo';
    numbers.push(Number(part));
  }
  const province = numbers[0];
  const municipality = numbers[1];
  const aggregate = numbers[2];
  const zone = numbers[3];
  const polygon = numbers[4];
  const parcel = numbers[5];
  const enclosure = numbers[6];
  if (
    province === undefined || municipality === undefined || aggregate === undefined || zone === undefined
    || polygon === undefined || parcel === undefined || enclosure === undefined
  ) {
    return 'La referencia SIGPAC está incompleta';
  }
  if (province < 1 || province > 52) return 'La provincia SIGPAC está entre 1 y 52';
  if (municipality < 1 || municipality > 999) return 'El municipio SIGPAC está entre 1 y 999';
  if (aggregate > 999) return 'El agregado SIGPAC está entre 0 y 999';
  if (zone > 999) return 'La zona SIGPAC está entre 0 y 999';
  if (polygon < 1 || polygon > 32767) return 'El polígono SIGPAC es un entero positivo';
  if (parcel < 1) return 'La parcela SIGPAC es un entero positivo';
  if (enclosure > 999) return 'El recinto SIGPAC está entre 0 y 999';
  return { province, municipality, aggregate, zone, polygon, parcel, enclosure };
}

export function formatSigpac(ref: SigpacRef): string {
  return [
    ref.province,
    ref.municipality,
    ref.aggregate,
    ref.zone,
    ref.polygon,
    ref.parcel,
    ref.enclosure,
  ].join(':');
}
