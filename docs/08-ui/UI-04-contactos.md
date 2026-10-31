# UI-04 · Clientes y proveedores

| | |
|---|---|
| Ruta | `/contactos` |
| Objetivo | Encontrar, filtrar y crear contactos (clientes, proveedores, transportistas) compartidos por las dos entidades |
| Historias | US-CONT-01/03, US-MIG-01 |
| Módulo y permiso | contacts · ver `contacts.read`; crear `contacts.write` |
| Patrón | Índice |

## Componentes
`PageHeader` ("Contactos", acción "Nuevo contacto"), `DataTable`, filtros en pills (tipo, canal, país, entidad con condiciones, con deuda vencida, duplicado sospechoso), `Sheet`/`Dialog` de alta rápida.

## Datos (API)
- `GET /api/v1/contacts?q=&kind=&channel=&country=&has_overdue=&cursor=`.
- `POST /api/v1/contacts` (alta rápida; ver UI-05 para la ficha completa) con `Idempotency-Key`.

## Columnas
Nombre fiscal · nombre comercial · NIF/NIF-IVA · país · canal por defecto · entidades con condiciones (P.O/CVPO) · saldo vencido · aviso de duplicado.

## Campos del alta rápida y validaciones
| Campo | Validación |
|---|---|
| Tipo (empresa / persona) | Obligatorio |
| Nombre fiscal | 2–200 caracteres |
| NIF / NIF-IVA | `normalizeTaxId`: formato y letra de control (España); UE: formato por país y comprobación en VIES (aviso, no bloqueo) |
| País | ISO 3166-1 |
| Correo y teléfono | Formato; opcionales |
| Canal por defecto | Lista `sales.channel` |

Si el NIF ya existe: "Ya existe <nombre> con este NIF" y enlace a su ficha (no se crea).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Nuevo contacto | `contacts.write` | Crea el contacto | — |
| Exportar CSV | `contacts.read` | Descarga de la vista filtrada | — |
| Ver duplicados | `contacts.write` | Navega a UI-06 | — |

## Estados
Vacío: "Aún no hay contactos" + "Nuevo contacto". Sin resultados: "Nada coincide con los filtros".

## Móvil
Lista de tarjetas (nombre, NIF, saldo vencido); búsqueda fija arriba; alta en `Sheet`.

## Wireframe
```
Contactos                                  [Nuevo contacto]
[Buscar…] (Clientes) (España) (Con vencido) (+ filtro)
┌──────────────────────┬───────────┬────┬───────┬─────────┐
│ Nombre               │ NIF       │ País│ Canal │ Vencido │
│ Distribuciones Ejem. │ B0000000… │ ES │ Dist. │ 1.210 € │
└──────────────────────┴───────────┴────┴───────┴─────────┘
```
