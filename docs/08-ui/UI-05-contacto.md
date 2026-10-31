# UI-05 · Ficha de contacto

| | |
|---|---|
| Ruta | `/contactos/:id` |
| Objetivo | Ver y editar un contacto con sus direcciones, personas, condiciones por entidad, documentos, deuda e historial |
| Historias | US-CONT-01/03/04, US-VENT-02, US-EDI-02 (GLN y códigos de cliente) |
| Módulo y permiso | contacts · ver `contacts.read`; editar y RGPD `contacts.write` (la supresión requiere aprobación del `owner`) |
| Patrón | Ficha con pestañas |

## Componentes
`PageHeader` (nombre, `StatusPill`), `Tabs`: Resumen · Direcciones · Personas · Condiciones · Documentos · Cobros · EDI · Historial (`AuditTrail`).

## Datos (API)
- `GET /api/v1/contacts/{id}` (+ `?include=addresses,persons,terms,gln`).
- `PATCH /api/v1/contacts/{id}` (`If-Match` con versión para evitar pisar cambios).
- `GET /api/v1/contacts/{id}/documents` (pedidos, albaranes, facturas).
- `GET /api/v1/receivables?contact_id=`.
- `POST /api/v1/contacts/{id}/gdpr-export` y `POST /api/v1/contacts/{id}/gdpr-erase-request` (US-CONT-04).

## Campos y validaciones
| Pestaña | Campos | Validación |
|---|---|---|
| Resumen | Tipo, nombre fiscal y comercial, NIF/NIF-IVA, país, idioma (ES/EN), canal por defecto, notas | NIF como en UI-04; idioma define el PDF de la factura |
| Direcciones | Fiscal, envío (varias), con horario de entrega | Una fiscal obligatoria para facturar |
| Personas | Nombre, cargo, correo, teléfono | Correo válido |
| Condiciones por entidad | Para P.O y para CVPO: tarifa, forma y días de pago, recargo de equivalencia, retención, regla de entidad facturadora específica | Si recargo de equivalencia → tax code `IVA21_RE` por defecto |
| EDI | GLN del comprador, de facturación y de entrega; departamento; códigos de artículo del cliente | GLN 13 dígitos con dígito de control |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Guardar | `contacts.write` | Actualiza y audita | — |
| Fusionar con… | `contacts.write` | Navega a UI-06 con este contacto | — |
| Exportar datos (RGPD) | `contacts.write` | ZIP con todos sus datos | — |
| Solicitar supresión (RGPD) | `contacts.write` | Solicitud de aprobación; anonimiza lo que no tenga obligación de conservación | Aprobación del `owner` |

## Estados
Contacto fusionado: banner "Fusionado en <otro>" con enlace; solo lectura.

## Móvil
Pestañas como lista desplegable; condiciones por entidad en tarjetas.

## Wireframe
```
Distribuciones Ejemplo S.L.                   [Fusionar] [Guardar]
Resumen | Direcciones | Personas | Condiciones | Documentos | Cobros | EDI | Historial
NIF B00000000   País ES   Idioma ES   Canal Distribuidor
┌ Condiciones P.O ─────────┐ ┌ Condiciones CVPO ─────────┐
│ Tarifa Distribuidor 2027 │ │ Tarifa Distribuidor 2027  │
│ Transferencia 30 días    │ │ Transferencia 30 días     │
└──────────────────────────┘ └───────────────────────────┘
```
