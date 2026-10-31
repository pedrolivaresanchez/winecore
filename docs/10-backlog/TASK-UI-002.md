# TASK-UI-002 · Primitivas del sistema de diseño
- Hito M0 · 2 días · Escalado: no
- Historias / RNF: RNF-10
- Depende de: TASK-UI-001

## Objetivo
Implementar las primitivas de `08-ui/00-sistema-diseno.md` §2 con los tokens y reglas (tamaños de texto 12/13/14/24, controles 28/32/36, iconos Nucleo, sin iconos de IA) y una página de muestra.

## Contexto
`08-ui/00-sistema-diseno.md` §1–§4.

## Ficheros
`ui/src/ui/*` (Button, IconButton, Input, NumberInput, MoneyInput, VolumeInput, Select, Combobox, DatePicker, DateTimePicker, Checkbox, Switch, RadioGroup, StatusPill, Tag, Card, KeyValue, StatTile, DataTable, Tabs, Stepper, Timeline, GlassMenu, Dialog, Sheet, Drawer, Toast, Tooltip, Banner, EmptyState, Skeleton, ErrorState, NoPermission, ModuleDisabled, PageHeader, MoneyCell, VolumeCell, QtyCell, DateCell, MermaidView, Chart, FileDrop, CameraCapture, QrScanner), `ui/src/pages/_showcase.tsx`.

## Interfaz exacta
`MoneyInput` y `VolumeInput` aceptan formato es-ES (coma decimal) y devuelven cadenas decimales (nunca `number`); `DataTable` con paginación por cursor y filtros en *pills*.

## Criterios de aceptación
- Contraste AA en todos los estados de `StatusPill`.
- `VolumeInput` convierte L ↔ mL sin pérdida (3 decimales en L).

## Tests requeridos
Unitarios de los inputs numéricos; capturas visuales de la página de muestra (escritorio y móvil).
