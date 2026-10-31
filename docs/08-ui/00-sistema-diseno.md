# 08-UI · 00 · Sistema de diseño

> Versión 1 · 31-10-2026. Base: reglas del SDR ("Closer UI — design rules", plan §3.3) y plantilla de UI de Timbal (`blueprint-ui-simple-chat`: React 19, Vite, Tailwind 4, Radix, TanStack Table, React Router 7, Recharts; tokens generados desde `src/design/dna.json`). **Pendiente**: copia de solo lectura del código del SDR (Q-004.6). Hasta tenerla, las primitivas se implementan con los nombres y reglas de este documento; cuando llegue, se sustituyen por las del SDR sin cambiar las pantallas.
> §12.4: **escritorio excelente, móvil correcto** (el móvil principal es CVBOT), responsive *mobile-first*.

## 1. Reglas (obligatorias; las comprueba la revisión de PR)
1. **Tokens, nunca hex sueltos**: colores, sombras, radios y espaciados desde `ui/src/index.css` (tokens). Acción primaria con `ink-900`; `flame` solo para la marca.
2. **Solo 4 tamaños de texto**: 12 (metadatos), 13 (tablas y formularios), 14 (texto base), 24 (título de página).
3. **Controles** de 28 / 32 / 36 px de alto (36 en móvil por accesibilidad táctil). **Radios**: 7/8/10 px en controles, 16 px en tarjetas.
4. **Pills** para estados, filtros y etiquetas; **tablas tipo CRM con celdas cuadradas** (sin pills dentro de la rejilla salvo `StatusPill`).
5. **Menús** con `GlassMenu`; **diálogos** con *scrim* tintado y sin desenfoque.
6. **Iconos solo de Nucleo**; marcas con `BrandMark`; **prohibidos** iconos de brillos, varitas o "IA".
7. **Español por defecto** (i18n con `ui/src/i18n/es.json`); **títulos de 4 palabras como máximo**; texto mínimo; verbos en botones ("Emitir", "Aprobar", "Guardar").
8. Formatos `es-ES`: `1.234,56 €`; fechas `31/10/2026`; horas 24 h; litros con 3 decimales `1.234,500 L`; unidades enteras; porcentajes `21 %`.
9. Accesibilidad WCAG 2.1 AA: foco visible, navegación por teclado, `aria-label` en iconos, contraste de tokens comprobado (`dna:check`).

## 2. Primitivas (`ui/src/ui/`)
| Componente | Uso | Notas |
|---|---|---|
| `Button` (`primary` ink-900, `secondary`, `ghost`, `danger`) | Acciones | Tamaños 28/32/36 |
| `IconButton` | Acciones con icono Nucleo | `aria-label` obligatorio |
| `Input`, `Textarea`, `NumberInput` (decimal es-ES), `MoneyInput`, `VolumeInput` (L/mL) | Formularios | Validación en línea con mensaje bajo el campo |
| `Select`, `Combobox` (búsqueda remota), `DatePicker`, `DateTimePicker` | Formularios | Fechas en Europe/Madrid |
| `Checkbox`, `Switch`, `RadioGroup` | Formularios | — |
| `Badge`/`StatusPill`, `Tag` | Estados y etiquetas | Paleta de estados de §4 |
| `Card`, `KeyValue`, `StatTile` | Fichas y panel | Radio 16 |
| `DataTable` (TanStack) | Índices | Celdas cuadradas, ordenación, filtros en pills, paginación por cursor, selección múltiple, columnas configurables, exportar CSV |
| `Tabs`, `Stepper`, `Timeline` | Fichas y asistentes | — |
| `GlassMenu`, `Dialog`, `Sheet` (móvil), `Drawer` | Menús y superposiciones | *Scrim* tintado |
| `Toast`, `Tooltip`, `Banner` | Avisos | — |
| `EmptyState`, `Skeleton`, `ErrorState`, `NoPermission`, `ModuleDisabled` | Estados (§3) | — |
| `PageHeader` | Título (≤ 4 palabras), migas, acciones | — |
| `EntitySwitcher` | Filtro global P.O / CVPO / Ambas | Persistido por usuario |
| `MoneyCell`, `VolumeCell`, `QtyCell`, `DateCell` | Celdas formateadas | Alineadas a la derecha |
| `ApprovalCard`, `DiffView`, `PayloadSummary` | Bandeja de aprobaciones | Muestra exactamente lo que se aprobará |
| `PasskeyPrompt` | Verificación reforzada | WebAuthn; alternativa TOTP |
| `MermaidView` | Genealogía y diagramas | Renderiza el `mermaid` que devuelve la API |
| `Chart` (envoltorios de Recharts) | Cinética de fermentación, ventas | Colores de tokens |
| `FileDrop`, `CameraCapture`, `QrScanner` | Gastos, fotos, depósitos | Móvil: cámara trasera |
| `AuditTrail` | Historial de un registro | Lista de cambios con antes/después |

## 3. Estados comunes de pantalla
| Estado | Componente | Texto (ejemplos) |
|---|---|---|
| Cargando | `Skeleton` con la forma final | — |
| Vacío | `EmptyState` con una línea y la acción principal | "Aún no hay facturas" · botón "Nueva factura" |
| Error | `ErrorState` con código y "Reintentar" | "No se ha podido cargar (WC_…)" |
| Sin permisos | `NoPermission` | "No tienes permiso para ver esto" |
| Módulo desactivado | `ModuleDisabled` | "Módulo desactivado" · enlace a Ajustes (solo `owner`) |
| Sin conexión (móvil) | `Banner` | "Sin conexión. Los cambios no se han guardado" |
| Envío en curso | `Banner` informativo | "Enviando a la AEAT…" |

## 4. Paleta de estados (StatusPill)
`neutral` (borrador, pendiente), `info` (en curso, enviado), `success` (emitida, aceptado, cobrada), `warning` (pendiente de aprobación, parcialmente, con errores), `danger` (rechazado, vencida, anulado). El texto del estado siempre acompaña al color.

## 5. Disposición
- **Escritorio** (≥ 1024 px): barra lateral plegable (240/64 px) + barra superior (selector de entidad, búsqueda global, avisos, aprobaciones pendientes, usuario) + contenido (máx. 1280 px). Índices a ancho completo; fichas en dos columnas (datos 2/3, panel lateral 1/3 con estado, acciones e historial).
- **Tableta** (768–1023 px): barra lateral plegada por defecto.
- **Móvil** (< 768 px): barra inferior con 5 accesos (Inicio, Aprobaciones, Bodega, Buscar, Más); `Sheet` en lugar de `Dialog`; las tablas se muestran como listas de tarjetas con los 3 campos clave; acción principal fija abajo. Pantallas de bodega y viñedo pensadas primero para móvil (botones de 36 px, cámara, QR, dictado).

## 6. Textos y tono
Español claro, frases cortas, sin jerga técnica en la interfaz ("Enviar a la AEAT", no "submit"). Confirmaciones explícitas que dicen qué pasará: "Se emitirán 10 facturas de CVPO por 3.240,00 €. Esta acción no se puede deshacer." Errores con el motivo y cómo resolverlo, seguidos del código entre paréntesis.

## 7. Seguridad en la interfaz
Nunca se muestran secretos ni IBAN completos (solo últimos 4); los textos de terceros (EDI, OCR) se muestran como texto plano escapado; las acciones irreversibles requieren confirmación y, si son aprobaciones, passkey.
