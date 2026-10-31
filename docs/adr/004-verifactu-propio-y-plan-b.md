# ADR 004 · Verifactu propio en WineCore y plan B con Holded

- **Estado**: propuesto · 31-10-2026; versión 2 el mismo día (Pedro saca Verifactu de la ruta crítica: pasa a **M4**). Q-002 y Q-003 siguen sin respuesta: la decisión se aplica como **SUPUESTO** (sus recomendaciones) hasta que Pedro responda. Depende además de Q-007, Q-008 y Q-033.
- **Relacionado**: `04-regulatorio/verifactu.md`, ADR 003 (certificado), `03-maquinas-estado.md` §5 y §8, `09-roadmap.md` (M2 y M4).

## Contexto

- **HECHO**: CVPO (Impuesto sobre Sociedades) debe tener su sistema de facturación adaptado **antes del 01-01-2027**; P.O (persona física) **antes del 01-07-2027** (RD 1007/2023, disp. final 4.ª, redacción del RDL 15/2025). El aplazamiento a octubre de 2028 anunciado por Hacienda el 05-10-2026 **no está en el BOE** a 31-10-2026.
- **HECHO**: VERI*FACTU (envío inmediato por servicio web) exime de firma XAdES y de registro de eventos, y se presume que cumple por diseño los requisitos de integridad (RRSIF art. 16.2–16.3).
- **HECHO**: si WineCore es de desarrollo propio, quien lo produce firma la declaración responsable (FAQ de la AEAT).
- **HECHO**: Holded ya está adaptado a Verifactu.
- La §12.1 del plan pide empezar las integraciones por *computer use*; Verifactu no es un portal sino un requisito sobre el propio software, así que no aplica.
- Decisión de Pedro (31-10-2026): primero las operaciones del núcleo (stock, bodega, ventas, SILICIE); Verifactu en M4. Hasta entonces CVPO factura en Holded con Verifactu (Q-033, SUPUESTO).

## Decisión

1. WineCore implementa Verifactu **en modalidad VERI*FACTU exclusiva** ("solo VERI*FACTU"), por servicio web, para CVPO y P.O con **una cadena por entidad**.
2. La huella, el XML, el QR y el parseo de respuestas viven en `api/src/core/regulatory/verifactu/` y se generan **dentro de la transacción de emisión**: o se emite la factura con su registro, o no se emite nada. El envío lo hace el emisor del entorno `verifactu` de Timbal, aislado (ADR 003).
3. **Aprobación** (SUPUESTO, Q-003): la de la emisión es la del envío. El envío es automático e inmediato.
4. **Control del 01-06-2027 (M4)**: la batería VF-01…VF-22 de `verifactu.md` §16 en el entorno de pruebas de la AEAT, sin diferencias de huella, con informe aprobado por Pedro.
5. **Hasta M4**: CVPO factura en **Holded con Verifactu** desde el 01-01-2027 con sus propias series; P.O factura en WineCore sin Verifactu desde M2 hasta el 30-06-2027, salvo que su Holded ya haya enviado registros en 2027 (Q-033). **Plan B** (Q-008): si el control del 01-06-2027 no se supera, las dos entidades siguen en Holded con Verifactu desde el 01-07-2027; el paso a WineCore se hace al empezar un mes, tras dos semanas de facturación paralela en el entorno de pruebas sin incidencias, y Holded no se da de baja hasta que WineCore lleve dos semanas en producción sin incidencias.
6. **Si se publica el aplazamiento** a 2028: no cambia el diseño. Una entidad que aún no haya enviado registros VERI*FACTU en 2027 podría facturar en WineCore sin Verifactu antes de M4; la que ya los haya enviado debe mantener VERI*FACTU hasta el 31-12-2027 (art. 16.5) y espera a M4. Pedro decide con el asesor.
7. **Versión del sistema**: `Version` = versión del módulo de facturación (`billing-x.y.z`). Cada versión nueva exige su declaración responsable firmada antes de desplegarse en producción (comprobación en la CI, TASK-REG-010).

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| NO VERI*FACTU (sin envío, con firma y eventos) | Más trabajo (firma XAdES por registro, registro de eventos, conservación reforzada) y el certificado firmaría cada factura; no aporta nada a una bodega pequeña |
| Facturar siempre en Holded y sincronizar con WineCore | Mantiene la doble fuente de verdad que se quiere eliminar (D1); WineCore no podría garantizar la trazabilidad factura ↔ lote ↔ stock |
| *Computer use* sobre la aplicación gratuita de facturación de la AEAT | Sin API, manual por factura, no integra series ni rectificativas de WineCore |
| Proveedor de API de Verifactu de terceros | Dependencia y coste; los datos de todas las facturas pasan por un tercero; seguimos teniendo que certificar el sistema |

## Consecuencias

- Verifactu no está en la ruta crítica de M0–M3. M4 tiene una fecha legal inamovible: el 01-07-2027 para P.O (`09-roadmap.md`).
- Las series de CVPO en Holded para 2027 son distintas de las que usará WineCore desde M4, y las facturas de CVPO de Holded se importan como externas para cobrarlas en WineCore (M2).
- La declaración responsable y el productor (Q-007) bloquean producción, no el desarrollo.
- Vigilancia del BOE para el aplazamiento (vigilante `boe-watch`).
