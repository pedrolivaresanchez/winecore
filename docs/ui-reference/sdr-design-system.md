# Sistema de diseño SDR (closer-ui) → WineCore

Referencia visual de Timbal SDR. El código de origen es de solo lectura. WineCore copia el aspecto (shell, primitivos, tokens) y conserva rutas, API, auth y la lógica de cada pantalla.

## Stack

Tailwind CSS 4 (`@theme`), React 19, Vite. Fuentes `@fontsource/inter` y `@fontsource/jetbrains-mono`. Iconos Nucleo (`nucleo-ui-essential-outline-18`, `nucleo-core-essential-outline-24`) solo a través de `src/ui/icons.tsx`. Motion con `motion` y los tokens `--duration-*` / `--ease-*`. Toasts con Sonner estilizado (`src/ui/toast.tsx`). Clases con `clsx` + `tailwind-merge` (`src/lib/cn.ts`). i18n con i18next; español por defecto. Sin Radix, sin Lucide, sin shadcn.

## Tokens (`src/index.css`)

Tinta neutra: `ink-0` #fff … `ink-900` #292929 (control y texto principal) y `ink-950` #171717 (valores). Fondo del rail `sidebar` #f6f5f3, igual que `canvas`. Hoja de trabajo `surface` blanca. Acento de marca `flame` (#ef5107 en 500): solo marca, nunca un botón.

Texto: `text` ink-950, `text-secondary` ink-800, `text-tertiary` ink-700. Bordes `border` ink-200, `border-subtle` ink-150. Foco `focus-ring` = info-500. Estados success / warning / danger / info con escala 50–700. Chips de catálogo en OKLCH (`--color-tag-*`).

Tipografía, solo cuatro tamaños: **12** `caption`, **13** `label`, **14** `body`, **24** `heading`. Pesos 400 y 500. Mono para atajos y datos técnicos.

Alturas de control: 28 / 32 / 36 px. Radios de control cuadrado 7 / 8 / 10 px; menú 10 px sobre filas de 6 px; tarjetas y paneles 16 px (`rounded-2xl`); chips de estado en píldora.

Sombras: `shadow-control`, `shadow-card`, `shadow-surface` (borde inset, no combinar con `border`), `shadow-overlay` (menús), `shadow-modal`, `shadow-focus`, y las caras de botón `--btn-*-face` (gradiente interior + sombra de 1 px). Scrim: ink-900 al 30 % en claro, sin desenfoque. Z: `sticky` 10, `dock` 25, `overlay-backdrop` 30, `modal` 40, `dropdown` 45, `toast` 50, `tooltip` 60.

Movimiento: abrir menú/modal 250 ms, cerrar 150 ms; cajón 400 / 350; rail 250 / 150. Curva `--ease-smooth-out`. Sin escala al pulsar. `prefers-reduced-motion` apaga la animación.

## Iconos y fuentes

Inter para la UI, JetBrains Mono para teclado y cifras técnicas. Cada glifo sale de `src/ui/icons.tsx` (trazo 1.5). Prohibidos Lucide, Phosphor y los destellos de “IA”.

## Primitivos (`src/ui/`) — cuándo

| Pieza | Uso |
| --- | --- |
| `Button` | Acciones. `primary` es la tinta (ink), nunca flame. `secondary` es la cara blanca. `ghost` en la barra. `danger` para destruir. `loading` mantiene la cara. Forma heredada: el ERP es `square`. |
| `Input`, `Textarea`, `Select` | Campos. Misma cara que el botón secundario. `invalid` sacude. |
| `FieldButton` | Fila que abre un menú (filtros). |
| `Checkbox`, `Switch` | Elección dentro de un formulario o una fila. |
| `SegmentedControl` | Pocos valores exclusivos (entidad, tipo, tema). `sm` en el rail, `md` en la página. `fill` solo si el control es la anchura del panel. |
| `Chip` / `MenuChip` | Controles de la barra de una lista (28 px, radio 7). `dashed` si el filtro está vacío. |
| `Badge` | Estado o categoría: tinte sin borde. No es un control. |
| `EntityChip` | Quién o qué, con ×. Píldora. |
| `Card` | Lectura (panel, ajustes), no una rejilla. |
| `DataGrid` | Lista de registros, a sangre, filas de 36 px. El nombre es un enlace. |
| `Table` | Tabla de lectura, no el workspace. |
| `Drawer` | Vista previa y hojas. En &lt;640 px el diálogo también baja a hoja. |
| `Dialog` | Confirmación y alta corta. Scrim sin blur. |
| `GlassMenu` + `MenuItem` | Todo menú. Nada de dropdowns sueltos. |
| `DatePicker` | Fechas. |
| `EmptyState` | Título, una línea y la acción. |
| `Alert` | Error recuperable, dos frases como mucho. |
| `Skeleton` | La forma de lo que va a llegar. |
| `Tooltip` | Nombre de un control solo icono. La ayuda larga es `InfoTip`. |
| `OverflowTips` | Texto truncado. |
| `IconWell`, `Kbd` | Pozo de icono y atajo. |
| `ToastProvider` | Resultado de una acción (“Guardado”). Una decisión va a un diálogo. |

## Shell y página

Ventana `h-dvh`, fondo `sidebar`. Rail a la izquierda: 272 px abierto, 56 px cerrado; por debajo de 1280 px arranca cerrado si nadie eligió. Cabecera del rail 48 px (marca 20 px en tinta + nombre a 13 px). Buscador 32 px con la cara secundaria. Filas 28 px, tipo `label`. Cuenta abajo: avatar, nombre, menú de cristal (tema, salir).

La hoja de contenido es blanca, a ras, con una línea a la izquierda. En el móvil (&lt;768 px) el rail es un cajón y una barra de 44 px lleva el título. Ajustes no abre un segundo panel: el rail se cambia por el catálogo y una fila vuelve atrás; el contenido es una columna de 640 px con título a 24 px.

Lista (patrón CRM): tres bandas fijas — cabecera 48 px (objeto + acción primaria), barra 44 px (búsqueda, columnas), filtros 40 px sobre `surface-subtle` — y la rejilla a sangre. Ficha: barra 44 px (volver + verbos), nombre a 14 px, chips de estado, pestañas, bloques con línea de pelo. Lectura (panel, alta, ajustes): columna centrada.

## Reglas (ui/AGENTS.md)

Valores solo en tokens. Cuatro tamaños de tipo. Alturas 28/32/36. Forma de control por superficie (`ButtonShapeProvider`), no en cada llamada. Una cara por polaridad. Foco visible (`outline` a 2 px o `shadow-focus`). Un botón en vuelo usa `loading`, no `disabled`. Menús `GlassMenu`. Scrim sin blur. Z solo de la escala. Copias por i18n, en español, cortas: título de hasta cuatro palabras, estado en chip, vacío = título + una línea + acción. Movimiento por la receta del gesto, no por el número más cercano.

## Auditoría: WineCore antes → cambio

| Área | Divergencia | Cambio |
| --- | --- | --- |
| Estructura | `components/ui` (shadcn), shell en `app/*.tsx`, rutas dentro de `Workspace` | `src/ui`, `src/app/shell`, `src/app/routes.tsx`, `ui/AGENTS.md` |
| Dependencias | Radix, CVA, Lucide, next-themes, tw-animate, fuente del sistema | Inter, JetBrains Mono, Nucleo, motion, i18next, Sonner propio. Se quitan Radix, Lucide y shadcn |
| Tokens | oklch sueltos, `text-meta/compact/body/title`, radio 7–16 mezclado | Escala SDR: tinta, flame, caption/label/body/heading, sombras y z de `index.css` |
| Botones | Relleno plano, píldora, alto táctil 44 px, primario = tinta plana | Caras con gradiente; primario ink; alturas 28/32/36; el ERP hereda `square` |
| Iconos | Lucide | Nucleo vía `ui/icons.tsx` |
| Menús | Radix dropdown + “cristal” casero | `GlassMenu` |
| Tabla | `DataTable` con tarjeta y página acolchada | `DataGrid` a sangre, tres bandas |
| Diálogo / cajón | `ConfirmDialog` y `SlideOver` propios | `Dialog` y `Drawer` |
| Shell | Cabecera sticky, contenido `max-w` 1280, barra inferior, ajustes en hoja | Rail 272/56, hoja a ras, cajón móvil, ajustes sustituyen el rail |
| Páginas | `PageHeader` + pastillas | Panel en columna de lectura; Contactos con el marco CRM; ficha con barra, chips y pestañas |
| i18n | Objeto `copy` | i18next, paquete `es`, `copy` sigue siendo el catálogo español |
| Marca | Monograma flame | Baldosa ink de 20 px, como el rail de SDR. Flame queda en los tokens y no pinta botones |
| Extra WineCore | El cambiador de entidad no existe en SDR | `SegmentedControl` `sm` en el rail; la lógica de entidad no cambia |
