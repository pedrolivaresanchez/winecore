# UI-34 · Ajustes generales y series

| | |
|---|---|
| Rutas | `/ajustes` · `/ajustes/series` |
| Objetivo | Configurar datos de las entidades (P.O y CVPO), establecimiento con CAE, series de numeración y parámetros (avisos, umbrales, regla de fecha fiscal) |
| Historias | US-CORE-06, US-VFT-05, US-INV-03 (regla fiscal), Q-015 |
| Módulo y permiso | núcleo · `settings.manage` |
| Patrón | Formularios por secciones |

## Secciones
| Sección | Contenido | Notas |
|---|---|---|
| Entidades | Razón social, NIF, dirección, régimen (IS/IRPF), nº de Registro de Envasadores, GLN y prefijo GS1 | Datos de facturas y etiquetas |
| Establecimiento | CAE (solo visible enmascarado), clave de actividad, matrícula RIA, mayores SILICIE (`silicie_ledger`) | Mayores inmutables (`WC122`) |
| Series | Por entidad, tipo de documento y año: prefijo, relleno, por defecto, Verifactu sí/no | Sin huecos (`core.take_number`); una serie usada no se borra |
| Verifactu | Instalación por entidad y entorno, versión, declaración responsable (PDF), estado | Solo lectura salvo activación |
| Parámetros | `inventory.fiscal_exit_rule` (D2), umbrales de alertas de fermentación, límites de SO₂ ecológico, días de aviso de plazos | Cambiar la regla fiscal pide aprobación y no reescribe el pasado |

## Datos (API)
`GET/PATCH /api/v1/settings/{key}`; `GET/POST /api/v1/number-series`; `GET/PATCH /api/v1/legal-entities/{id}`; `GET/POST /api/v1/silicie-ledgers`.

## Validaciones
Prefijo de serie: caracteres válidos para Verifactu (ASCII 32–126 sin `" ' < > =`), longitud total del número ≤ 60. Año de serie = año de emisión.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Guardar sección | `settings.manage` | Actualiza y audita | Ajustes sensibles (regla fiscal, series en uso): aprobación |
| Nueva serie | `settings.manage` | Alta | — |

## Móvil
No disponible (aviso).

## Wireframe
```
Ajustes   [General] [Series] [Reglas de facturación] [Módulos] [Personas] [Conectores] [Aprobaciones]
Series · CVPO · 2027
┌────────┬──────────┬────────┬───────────┬───────────┐
│ Tipo   │ Prefijo  │ Último │ Defecto   │ Verifactu │
│ Factura│ CF27-    │ 0012   │ ✓         │ ✓         │
└────────┴──────────┴────────┴───────────┴───────────┘
```
