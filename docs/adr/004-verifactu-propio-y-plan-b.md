# ADR 004 · Verifactu propio en WineCore y plan B con Holded

- **Estado**: propuesto (depende de Q-002, Q-003, Q-007 y Q-008) · 31-10-2026
- **Relacionado**: `04-regulatorio/verifactu.md`, ADR 003 (certificado), `03-maquinas-estado.md` §5 y §8, `09-roadmap.md` (M1 y M5).

## Contexto

- **HECHO**: CVPO (Impuesto sobre Sociedades) debe tener su sistema de facturación adaptado **antes del 01-01-2027**; P.O (persona física) **antes del 01-07-2027** (RD 1007/2023, disp. final 4.ª, redacción del RDL 15/2025). El aplazamiento a octubre de 2028 anunciado por Hacienda el 05-10-2026 **no está en el BOE** a 31-10-2026.
- **HECHO**: VERI*FACTU (envío inmediato por servicio web) exime de firma XAdES y de registro de eventos, y se presume que cumple por diseño los requisitos de integridad (RRSIF art. 16.2–16.3).
- **HECHO**: si WineCore es de desarrollo propio, quien lo produce firma la declaración responsable (FAQ de la AEAT).
- **HECHO**: Holded ya está adaptado a Verifactu.
- La §12.1 del plan pide empezar las integraciones por *computer use*; Verifactu no es un portal sino un requisito sobre el propio software, así que no aplica.
- Solo hay un mes entre el gate (01-12-2026) y la obligación de CVPO.

## Decisión

1. WineCore implementa Verifactu **en modalidad VERI*FACTU exclusiva** ("solo VERI*FACTU"), por servicio web, para CVPO y P.O con **una cadena por entidad**.
2. La huella, el XML, el QR y el parseo de respuestas viven en `api/src/core/regulatory/verifactu/` y se generan **dentro de la transacción de emisión**: o se emite la factura con su registro, o no se emite nada. El envío lo hace `verifactu-sender`, aislado (ADR 003).
3. **Aprobación**: la de la emisión es la del envío (Q-003). El envío es automático e inmediato.
4. **Gate del 01-12-2026**: la batería VF-01…VF-22 de `verifactu.md` §16 en el entorno de pruebas de la AEAT, sin diferencias de huella, con informe aprobado por Pedro.
5. **Plan B**: si el gate no se supera, CVPO factura desde el 01-01-2027 en **Holded con Verifactu** y una serie propia; WineCore sigue en pruebas y el cambio se hace al empezar un mes, tras dos semanas de facturación paralela en el entorno de pruebas sin incidencias. Holded no se da de baja hasta que WineCore lleve dos semanas en producción sin incidencias (Q-008).
6. **Si se publica el aplazamiento** a 2028: no cambia el diseño. Pedro decide si CVPO arranca igualmente en VERI*FACTU el 01-01-2027 (recomendado: sí, la operativa ya está hecha y el envío voluntario es válido) o espera.
7. **Versión del sistema**: `Version` = versión del módulo de facturación (`billing-x.y.z`). Cada versión nueva exige su declaración responsable firmada antes de desplegarse en producción (comprobación en la CI, TASK-REG-010).

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| NO VERI*FACTU (sin envío, con firma y eventos) | Más trabajo (firma XAdES por registro, registro de eventos, conservación reforzada) y el certificado firmaría cada factura; no aporta nada a una bodega pequeña |
| Facturar siempre en Holded y sincronizar con WineCore | Mantiene la doble fuente de verdad que se quiere eliminar (D1); WineCore no podría garantizar la trazabilidad factura ↔ lote ↔ stock |
| *Computer use* sobre la aplicación gratuita de facturación de la AEAT | Sin API, manual por factura, no integra series ni rectificativas de WineCore |
| Proveedor de API de Verifactu de terceros | Dependencia y coste; los datos de todas las facturas pasan por un tercero; seguimos teniendo que certificar el sistema |

## Consecuencias

- M1 tiene un único camino crítico: huella + XML + emisor + batería en preproducción (`09-roadmap.md`).
- El plan B obliga a preparar series de Holded para 2027 distintas de las de WineCore (`CF27-`), y la migración de partidas abiertas de enero desde Holded si se activa.
- La declaración responsable y el productor (Q-007) bloquean producción, no el desarrollo.
- Vigilancia del BOE para el aplazamiento (vigilante `boe-watch`).
