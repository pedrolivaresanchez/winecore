# WineCore UI — design rules

Heredado de tdesign, el mismo sistema que Timbal SDR (`closer-ui`).
Los primitivos viven en `src/ui/`, los tokens en `src/index.css`.
Telefonía, voz y la celebración de cierre no forman parte de WineCore, y del chat
solo queda el asistente (`src/app/shell/assistant-*`): el ERP es cuadrado, como el CRM de SDR.


All UI here comes from the **tdesign** design system, via the `timbal-chat` export.
Primitives live in `src/ui/`, tokens in `src/index.css`. These rules are inherited
from tdesign and are not negotiable.

## Tokens

Every visual value is a token in `src/index.css`. No raw hex, no arbitrary sizes,
no off-grid spacing, no inline shadows. If a value is not a token, it does not ship.

## Hard rules

| Rule | Detail |
| --- | --- |
| Primary actions | `ink-900`. **Never** `flame`. Flame is brand only. |
| Type sizes | Four only: `caption` 12, `label` 13, `body` 14, `heading` 24 |
| Control heights | 28 / 32 / 36px only. `SegmentedControl` is 32px (`md`) by default; use `size="sm"` (28px) only in dense chrome like the account menu. Fit-content by default — use `fill` only for panel tabs |
| Control shape | Pills everywhere except the CRM, which is square. Never pass `shape` at a call site: it comes from `ButtonShapeProvider`, set once per product at the route root |
| Radii | 7 / 8 / 10px on controls (the `Input` scale, shared by squared `Button` and the toolbar `Chip`), 10px menu panels over 6px rows, 16px cards and panels, pill for app CTAs and for every chip (`Badge`, `CatalogChip`, `EntityChip`) |
| Faces | One recipe per polarity, from `src/ui/button.tsx`. `textureSecondaryFace` for chrome that only displays; `textureSecondary` for anything pressable. A surface that lights up on hover must do something |
| Icons | Nucleo only, through `src/ui/icons.tsx`. No Lucide, no Phosphor |
| Brand marks | A third-party product or channel wears its official mark through `BrandMark` (`src/ui/brand-mark.tsx`: Gmail, Google Calendar, Meet, WhatsApp, LinkedIn, Aircall, Fathom, HubSpot, Slack, Stripe, Zernio, Docusign, Outlook, Lusha) — never a generic envelope or bubble standing in for it, and never a brand mark on generic UI. Only where the row proves the provider (`features/crm/components/channel-brand.ts`): imported history with no source keeps the object's glyph. `color` on cards, `mono` in dense rows, `tile` on connection cards |
| Banned icons | Sparkles, star-bursts, AI glitter — anything that says "AI did this" |
| Focus | Visible, everywhere. `Button` draws a 2px outline in `focus-ring`, 2px off the face, so the face's own rim light survives; anything else uses `shadow-focus`, which carries the same ring. Never a halo you have to look for |
| Busy | A press in flight is `<Button loading>`: the face and label stay, the spinner takes the icon's slot, presses stop. Not `disabled` — a button that greys out the moment it is pressed reads as refused |
| Menus | `GlassMenu`. No ad-hoc dropdowns |
| Scrims | Tint only, never a blur (`OverlayScrim`: ink-900 at 30% light, black at 40% dark). The record behind a dialog, a drawer or the palette stays legible; only a glass menu frosts, and only its own panel |
| Z-index | Semantic scale only: `--z-sticky` through `--z-tooltip` |
| Avatars | Real photos when the identity provider / profile has one (account menu, ranking podium & list, outbound mail). Initials otherwise. AE avatars on slots stay photo-first because the SDR is saying that person's name out loud |
| Copy | Every string through i18n. Spanish is the default. Less of it — see Copy |

## Copy

A screen that explains itself in sentences is read once and skimmed past forever after, and
the sentence keeps taking the room of the thing somebody came to change. Pedro, 23 October:
«quitar texto y dejarlo todo más fino… que los usuarios puedan clicar cosas, expandir
contenido, hacer hover y no exponer tanto de primeras». The explanation is not deleted: it
moves one gesture away. Nothing a person needs to decide may be lost — only moved.

**Word budget.** A title is at most four words. A section carries at most one line of helper
text, and only when the title cannot carry it. No paragraph on the face of anything. A chip
says its state in three words or fewer. An empty state is a title, one short line and the action.

| Rule | Before | After |
| --- | --- | --- |
| 1. No explanatory sentence on the face. A block has a short title; what it means, why, and what happens next go behind an `InfoTip`, a `WhyPopover` or a `Reveal`. | «Sin reunión de seguimiento» over «La lectura dice que se acordó un Deep dive, pero no hay una reunión posterior en el calendario. Busca por el título exacto si existe.» | «Sin reunión de seguimiento ⓘ», the sentence inside the «i» |
| 2. State is a chip, an icon or a number, not a sentence. | «Sin cambios propuestos.» · «La cuenta tiene 2 abiertos» | `StatusChip` «Sin cambios» (hover lists why) · «2 deals» |
| 3. Remove instructions the UI can show by itself — the control's state says it. | «Elegido por ti. Al aprobar, la reunión queda en este deal.» under a picked row | The row looks picked. Nothing else. |
| 4. Rationale and AI reasoning are collapsed by default, one line of summary at most. | One orange sentence per field: «Etapa: no se propuso «Demo» porque la reunión no estaba en este negocio cuando se leyó. Reprocesa para proponerlo» | The field, a quiet «¿Por qué?» whose popover holds the sentence and «Reprocesar» |
| 5. Help in Settings is one line under the title at most; the rest behind the «i» (`help` on the settings shell) or a «Cómo funciona» `Reveal`. | Perfil › «Asistir a las reuniones que agendo» over a 35-word paragraph | The label, «La invitación te incluye y entra en tu calendario.», and the rest behind the «i» |
| 6. Empty states: one short line and the action. | «Nada pendiente» over «Cuando un SDR pida Unqualified o un cambio de facturación, la petición aparece aquí y le llega al responsable por correo.» | «Nada pendiente» · «Aquí llegan las peticiones de los SDR.» |

Which one to reach for (all in `src/ui/disclosure.tsx`):

- **`InfoTip`** — the «i» beside a title: what it means, why it is so, what happens next. Hover
  or focus peeks it, a click or a tap pins it, so a link inside it can be followed.
- **`WhyPopover`** — the rationale behind a state or a proposal, with the one thing to do about
  it (`actions`). Quiet «¿Por qué?» by default; pass a `trigger` when the state itself is the
  natural thing to click.
- **`Reveal`** — reasoning, a long summary, history, setup steps: one line that unfolds.
- **`StatusChip`** with a `detail` — a state whose reasons somebody might ask for.
- **`Tooltip`** stays what it was: the name of an icon-only control, not a place for help.

Every one of them is reachable without a mouse: hover-only on desktop always has a focus and a
tap path. Errors are the exception to brevity, not to the budget: what happened and what to do,
two short sentences at most, and the technical detail behind a `Reveal`.

## Motion

The scale is [transitions.dev](https://transitions.dev), adopted from timbal-platform so
the two products move identically. Tokens live in `src/index.css` (`--duration-*`,
`--ease-*`, `--scale-*`, `--distance-*`) and are mirrored for `motion/react` in
`src/lib/motion.ts`. `--ease-out-quart` is an alias of `--ease-smooth-out`.

**Match on usage, never on the nearest number.** Work out what the motion *does* — dropdown
open, modal close, sheet, tab slide — then take the recipe whose documented usage matches. A
300ms modal close is `--duration-quick` (150ms) because both are "modal close".

| Surface | Recipe | Open | Close |
| --- | --- | --- | --- |
| Dropdown, menu, select, filter, picker, popover, palette | `dropdownMotion()` | 250ms | 150ms |
| Modal / dialog | `modalMotion()`, `Dialog` | 250ms | 150ms |
| Sheet, drawer, record peek, mobile rail | `sheetMotion()`, `Drawer` | 400ms | 350ms |
| Desktop rail collapse | `railMotion()` | 250ms | 150ms |
| Tabs, segmented control, accordion | `tabsMotion()`, `.t-acc` | 250ms symmetric | |
| Switch / toggle | `.t-toggle` | 350ms bounce | |
| Checkbox check | `.t-check` | fill 150ms, draw 350ms | 150ms |
| Swapped pane under tabs | `pageMotion()` | 250ms, enter only | |
| Column that yields width | `columnMotion()` | 250ms | 150ms |
| Strip that yields height | `stripMotion()` | 250ms | 150ms |
| Bar floating over content — selection dock | `dockMotion()` | 250ms | 150ms |
| Toast | `toastMotion()` | 350ms | 250ms |
| Tooltip | `Tooltip` | 150ms after 80ms | 50ms |
| Spinner in a control | `ButtonSpinner`, `animate-spinner` | icon-swap in (250ms), then `--duration-spin` linear turns | |
| Empty state arriving | `EmptyState` (`animate-fade-up`) | 400ms, enter only | |

Banned:

- A bespoke duration or `cubic-bezier` on a surface that has a recipe.
- A `y` translate on an anchored panel. It grows from its trigger: scale + opacity only.
- Per-row stagger inside a menu, and any animation at all on data-grid rows. A surface
  people touch a hundred times a day must not perform.
- Bouncing or delaying a close. Overshoot is for entrances; dismissal is instant.
- Total stagger over ~300ms. Drop the stagger before shrinking the offset further.

No press scale on controls — hit feedback is the face and colour change. No infinite
decorative animation, and always respect `prefers-reduced-motion`.

## CRM surfaces

The CRM is record-centric, and the rules below are what make it read as one product rather
than a grid bolted next to a form.

- **Frame.** Every CRM grid opens with three strips, and each one answers a different
  question. The 48px header answers *which records*: the object, the open cuts, and the one
  button that makes another record. The 44px view bar answers *which of them, drawn how* —
  search, the view type, columns, sort, export, Save. The 40px filter bar on `surface-subtle`
  holds the conditions themselves, because a cut you can read at a glance is a cut you
  trust. `CrmWorkspace` owns those measurements; `CrmPage` keeps the
  header plus an optional toolbar for reading surfaces. They share the 48px header on
  purpose, because that inch is the only thing on screen during a navigation and a title
  that moves says "different app". Each strip carries a hairline — the rows do different
  jobs, and a single line cannot say where identity ends and the cut begins. The last line
  is where chrome stops and data starts. Below `md` the object header is the mobile app
  bar, so the workspace drops it and keeps the two working strips; those scroll sideways
  rather than wrapping, because a second row of chrome is the same bug the three strips
  were invented to prevent.
- **The object is a picker and the cuts are tabs, both in the header.** `ObjectSwitcher` turns
  the title into the way to companies, contacts and deals — the name of the thing you are
  looking at is the most obvious place to reach for another one, and it costs no width the
  caption was not already spending. `ViewTabs` sits beside it because a saved view you cannot
  see is a saved view you forget you have. The strip stays honest about width by only holding
  what you opened: `+` is the catalog of every view and list, tabs close, and the long tail
  lives in the menu rather than in the row. That is what the earlier dropdown-only answer got
  wrong — it was sized for a dozen views nobody had opened instead of the three they had.
- **One control per thing, and every panel owns its whole subject.** Two chips that open the
  same panel are not two entry points — they are one control the reader has to disambiguate
  before touching either. The strip briefly carried `Filters` and `Advanced filters` (the
  same component, the same open state, different badges), a `Metrics` menu listing the
  columns that Columns already lists, a gear holding a reset that was also inside Columns,
  and a duplicate-view button that the tab menu and the `+` catalog both already offered.
  Nine controls, five subjects. When something new needs a home, put it in the panel that
  owns its subject — columns in Columns, the drawing in the view type, the filter on the
  filter bar — and add a chip only for a verb none of them own. Copying a competitor's
  toolbar copies its clutter: HubSpot's row is that long because it grew a control per
  feature, and a row of nine is read as a wall rather than a set of choices.
- **Density.** 13px (`text-label`) everywhere in the CRM: rail, chrome, headers, cells. 36px
  grid rows, 12px cell padding, 28px toolbar controls. The app sheet is square and flush to
  the window, not a rounded card floating over the rail.
- **Rows get the pixels.** A grid runs edge to edge with no card, no max width and no page
  padding. Reading surfaces (reports, settings) keep a centred column. `Table` has one face
  for each: `variant="grid"` is flush and 36px, for a workspace like Lists or Tasks, and the
  default framed 52px card is for a reading surface. A rounded card pressed against the
  window edge is neither.
- **Settings is a place, and the rail goes with you.** `/settings` does not add a second
  column: the app rail swaps its contents for the settings catalog (`shell/settings-sidebar.tsx`),
  keeping the same 48px header, `px-2` gutter, 28px rows and pinned account menu, with one row
  at the top as the way back. It is forced open for the visit — a catalog of unlabelled icons
  is unusable — and the stored width preference is left untouched. Four groups: Personal,
  Workspace, Data, Automation. The catalog itself is `features/settings/settings-nav.tsx`;
  add an area there, not in a router.
- **A settings area is a form or a table, never both.** Content lives in `SettingsSurface`
  under a `SettingsPanelHeader`: page title, one line of description, the committing action on
  the right. A row, a section and a group may carry one muted line under the label
  (`description`, `text-caption`); anything beyond that line is `help`, the «i» beside the title.
  Forms run in a 640px column; tables and matrices take `SETTINGS_FRAME_WIDE`.
  Groups inside a panel are a caption plus a block (`SettingsGroup`) — never a tinted band,
  which would compete with the page title. A group of rows and fields is `framed`: the rows sit
  in one 16px card divided by hairlines, so a caption and its control read as one line instead
  of two marks on blank paper. A table, a list of cards or a picker of tiles is already its own
  edge and stays unframed. Every block on a page shares one right edge — a form capped at 640px
  beside a full-width table strands its switches mid-page. Every measurement lives in
  `settings/shell/settings-frame.ts`; do not hand-roll another one.
- **The data model is objects first, attributes inside them.** `/settings/objects` lists the
  registry with record and attribute counts; an object opens on its own page with tabs for
  configuration, attributes, appearance and permissions. Objects come from `crm_objects` at
  runtime — never hardcode the nine standard ones in a UI list, or custom objects vanish from
  whatever you wrote. `RegistryGlyph` renders an object's mark from its `icon` and `tint`.
- **Lists are destinations, not records of a list.** They live in the rail and in Cmd-K, and
  they open on the object grid (`?list=<id>`) with the full toolbar. A list's own page is its
  definition and audience only. The rail and Cmd-K carry every object's lists, and those are
  the only two places you reach one from: the cut picker on an object page is saved views
  only, because which arrangement of this grid you want and which named set you want are
  answered from different places. A list you can see and cannot open is a dead end.
- **An entry point that offers to create something opens the form.** `CreateListDialog` is
  one component precisely so the rail, the Lists page and Cmd-K all open the same thing;
  navigating somebody to a page where the button lives again is not an entry point, and a
  query parameter nobody reads is not one either.
- **One filter chrome, three panels.** Filter, sort and view settings are popovers off the
  toolbar, built from the same parts: `FieldButton` rows, `AttributeField` for picking a
  property, `RowMenu` for per-row actions, a `MenuFoot` line where the control is not
  self-evident. Conditions nest two deep with an and/or joiner that only the second row can
  flip, because the joiner belongs to the group and not to the line you happen to be looking
  at. Do not add a fourth panel or a bespoke filter UI for one surface; extend these.
- **A property's values come from `choicesFor(def)`, never from `def.catalog_key`.** Most
  selects read a catalog, and two do not: a deal's stage is a row in a pipeline and so is its
  pipeline, both shipped with a null catalog key. Every picker that resolved options from the
  catalog alone drew an empty menu for those — the grid showed `Discovery` in the Stage column
  while the Stage filter said "nothing matches". `property-choices.ts` is the one place that
  knows where a property's values live, so a new source is taught once instead of per surface.
  And when it comes back empty (`email.direction` and the other database enums), the control
  degrades to a typed value: `isPickableSelect` guards that, because a menu whose only possible
  content is "nothing matches" reads as a broken screen rather than as a filter.
- **An attribute picker drills into groups.** One row per group with a count and a chevron,
  its members behind it, loose attributes above. Flattening puts eighty rows in front of
  somebody looking for `Name`. Searching flattens anyway, since a term means you know what you
  want — matches come back labelled `Group › Field`. The placeholder names the object.
- **A picker opens on candidates, never on a blank field.** `PickerMenu` (`src/ui/picker-menu.tsx`)
  is the dropdown for choosing one thing out of many: search at the top, rows carrying a mark, a
  label and a hint, and a last row that creates the thing when it turns out not to exist. It
  arrives already listing the likely answers — `RecordPickerMenu` asks the search endpoint with an
  empty term, which returns the most recently touched records the caller can see. A field that
  shows nobody until two characters are typed makes somebody name the record before it will admit
  which records exist, and "add a contact" is nearly always one of the handful touched this week.
  Arrow keys and Enter run the whole panel, create row included. Reach for this over another
  input with a list bolted underneath; `RecordPicker` stays only for fields inside a form.
- **A chip with nothing in it is dashed.** `Chip variant="dashed"` for an empty filter or an
  unsorted grid: the rim says a control lives here without claiming the grid is cut. It takes
  the face back the moment it holds something, and `label` sets the preamble (`Sorted by`) a
  weight behind the value so the strip can be scanned for the property.
- **Menus nest without closing each other.** `GlassMenu` panels portal to `document.body`, so
  a child is not a DOM descendant of its parent; the layer context in that file is what stops
  a parent from reading a click on its own submenu as a click on the page. Anything else that
  portals a layer over a menu has to register the same way or it will close the menu that
  opened it.
- **An arrangement belongs to the cut you opened.** Changing filter, sort or columns is local
  until saved, and then it saves back onto the active list or view rather than into a personal
  side-channel — a shared list that looks different to everybody is not a shared list. With no
  cut open, the only option is "Save as view".
- **A view is built before it is named.** "New view" opens a dashed tab on every record of the
  object and writes nothing (`?draft=`, session-only). You narrow it until the grid is the one
  you wanted, and Save writes a private view under the name already on the tab (or "New view")
  — the audience and the default live in the tab's settings afterwards, not in a dialog on
  the way in. That tab then becomes the saved view in place. Which cut Save writes to is read
  from the URL, never from the loaded set of views: a set that has not caught up with a write
  you just made is not the absence of that view, and treating it as one is what left the
  toolbar offering "Save as view" over a view that already existed.
- **Acting on a selection happens in the dock.** `SelectionDock` floats bottom-centre over
  the grid while rows are ticked, on ink so it does not read as more chrome. It replaced a
  banner under the toolbar, which pushed every row down by 44px at the moment somebody was
  clicking checkboxes — the row under the cursor moved and the next tick hit the wrong
  record. Destructive actions go behind its `More` menu, never on the face of it. The dock
  offers a *slice*, not only the page or the whole cut: *primeros N* takes the first N of the
  current sort (working-session sizes — 25, 50, 100, 250 — because "the 25 I ticked by hand"
  is what somebody means), and every verb on it — edit several properties, create a task per
  record, research — reports the records it skipped by name, permission apart from failure.
- **A record is a page, and a name is a link.** Opening a company, contact or any other
  record from a grid, board or list goes to its page. The name is a real `href`, so
  Cmd/Ctrl-click and middle-click open another tab the way the rest of the web does. A task
  row is always a link: the account when the row already has it, otherwise the tasks grid
  with `?task=` (the URL Slack uses, which then opens the same record a click would). Other
  activities get an `href` only where that is the page a plain click would reach (`rowHref`);
  otherwise they stay a button rather than lying about where they go. Hover cards stay a
  glance; they are not a second place to read the record.
- **A record's identity card lights one verb, by who is looking.** Agendar and Llamar print
  their labels; the viewer's primary sits first in its colour and the other beside it on the
  neutral face (`headerVerbs` in `record-header.ts`). An SDR's is Llamar, in green; an AE's and
  everyone else's is Agendar, in azure (Pedro, 23 October 2026). It reads the CRM role's key,
  which «Ver como» swaps, so viewing as somebody shows their card. Two lit buttons side by
  side were two claims to be first.
- **Cells edit in place.** A property is one component (`property-cell.tsx`) with a read mode
  and an edit mode. Enter commits, Escape reverts, and the grid never opens a dialog to change
  one value.
- **Aggregations are server-side.** A footer that counts the fifty rows on screen and calls it
  the answer is worse than no footer.
- **A metric is a footer total somebody kept.** The band above the rows (`metrics-band.tsx`)
  runs the same nine calculations over the same filtered set, so it shares the round trip with
  the footer — and that shared response is keyed by property *and* kind, because a card can
  average `amount` while the grid's footer sums it, and keying by property alone handed both
  of them whichever value landed last. Metrics live on the view's `layout` beside the columns
  and the sort, so they save, restore and mark the arrangement dirty for free; nothing about
  the band is personal state. Their names are derived from property and calculation rather
  than typed, so re-pointing a card cannot leave a stale label, and only column-backed
  properties are offered (`METRIC_KINDS`): custom and calculated ones are not aggregatable, and
  a permanent inch of chrome that can only ever show an em dash is worse than one card fewer.
  The chip owns the set the way the pencil owns the quick filters — the cards themselves are
  numbers, not controls, so there is one place to look for "which numbers".
- **Cmd-K is the way past the tree.** One palette, mounted at the shell, offering records
  first, then lists, then places. Any surface can open it through `useShell().openCommand`.
  Facet chips at the top — Todo · Contactos · Empresas · Negocios · Llamadas · Notas ·
  Reuniones — say what is being asked about, a chip whose object the seat cannot see is not
  offered, and the chosen chip is remembered for the session. An activity hit opens the record
  it happened to, scrolled to the card. A *Por significado* group answers from the semantic
  index only when the exact search runs out or the query becomes a sentence, is deduped
  against the exact hits, and says it is approximate.
- **The CRM is square.** Every control under `/crm/*` — buttons, toolbar chips, the dialogs
  and menus opened from them — sits on the 7/8/10 radius scale, because a capsule resting on
  a column edge reads as belonging to a different application. The decision is declared once
  in `CrmLayout` and inherited through context, never passed per button. The rest of WineCore
  keeps its pills: a call desk is not a spreadsheet. The pills inside the CRM are the chips,
  and only the chips. The **entity chip** (`EntityChip`, `src/ui/chip.tsx`) is *who* and
  *what*: a recipient, a guest, the account a task is about, a search term — 24px on the
  `fill-selected` wash, caption type, a faint × that is the only control on it. The **tag**
  (`Badge`, `CatalogChip`) is *which state* or *which category*: a soft tint of its colour
  with ink of the same hue, no rim. Both are round everywhere. Do not hand-roll a
  name-with-an-× or a coloured label anywhere; use the chip.
- **Chips are round, rimless and few** (Pedro, 23 October: «los chips… los odio»). Status was
  square and candy — a saturated fill with a darker rim — and on a CRM where every control is
  square, a square chip read as one more control and the rim made a column of them a column of
  buttons. A capsule cannot be mistaken for a control here, and a tint without an edge reads as
  a label sitting on the row. One family in `src/ui/badge.tsx`: `tint` (the chip) or `dot` (a
  coloured dot and the word, for state inside a line of meta), `md` 24px or `sm` 20px, an
  optional 12px `icon`, a `count`. `badgeClass` / `catalogChipFace` give the same face to a
  button or a cell. Metadata that is not a state (`Built in`, `8 tools`, `AI`) is not a chip
  at all: it is one muted meta line, `De serie · 8 herramientas · IA`, with an icon only where it
  carries a warning — a row of pills is read as a wall, and the state chip beside it stops
  standing out.
- **Every value of a catalog has its own colour, and no two share one.** Twenty tones in one
  family (`src/ui/tag-palette.ts`, tokens `--color-tag-<tone>-bg|fg|dot` generated by
  `scripts/tag-palette.mjs`): seventeen hues and three leaning greys. On paper the colours are
  production's eight chips (lime, blue, peach, gold, purple, rose, teal, red — Martí, 25 October:
  «le gustan más los colores que hay en prod») measured in OKLCH, each keeping its own lightness
  and strength, and the other nine hues sit between them; the dark sheet is one lightness per
  role. No tint clips, every ink is 4.5:1 on its tint in both themes, and no two of the sixty
  tints sit closer than the test allows (`tag-palette.test.ts`). Each tone has three steps (`blue`,
  `blue-2`, `blue-3`) for the catalog longer than the palette. A value's `colour` is assigned by
  `catalog-colours.ts` and drawn through the CRM context, never hashed at the chip: a status
  ladder by meaning (idle greys, working blues, engaged teals, goal greens, stalled ambers, dead
  reds, the tagged rung leading its band), a scale cold to hot, a pipeline's open stages cold to
  hot with won green and lost red, anything else seven hues apart around the wheel. A colour
  somebody picked is kept; a duplicate moves to the nearest free colour of its family. Settings ›
  Catálogos defaults a new value to the next free colour, marks the taken swatches and warns
  softly on a repeat. `use_case_scale` is the exception: its colour is the column's.
- **Toolbar controls wear a face, not a fill.** A chip in a workspace strip takes the same
  white gradient, hairline and 1px drop as the buttons beside it. Flat grey fill is reserved
  for *selected*, and a resting chip that has already spent that fill leaves the applied
  filter with no way to look applied.

## Phone and tablet

Every surface works at 390px and 820px. The shell does most of it, so a screen inherits the
answer instead of inventing one:

- **The rail starts collapsed under 1280px** unless somebody chose otherwise. Open, it is a
  third of a tablet; the choice, once made, holds at any width.
- **A dialog is a bottom sheet under 640px** — full width, top corners, footer where the thumb
  is, on the sheet recipe. A palette (`align="top"`) keeps its place. A drawer goes full-bleed.
- **A grid's pinned column never drops under 240px.** It carries the checkbox and the mark
  before the name starts, and it is the column the row is read by.
- **Engagement cards are containers** (`feedCard`, `feedGrid` in `activity-card.tsx`): when the
  *card* is narrow the meta folds under the heading, whatever the window is doing. A meeting's
  title keeps a line of its own under 36rem.

## The design sheet

`/design.html` in development renders every primitive state on one page — the brand marks
in all three faces and sizes, each button variant at rest, focused, loading and disabled, the
status chips, the skeletons, an empty state with an illustration, a dialog — light, or dark
with `?dark`. It is not a route and is never built. Add the state there when you add one, and
screenshot it from there when a review needs proof.

## The one deliberate exception

tdesign's register is quiet, machined and precise. WineCore's close celebration is
not: booking a meeting fires a confirmation, a sound and a random line of
praise, and marking a deal won showers the window with confetti.

That is a product requirement, not decoration. Prospecting runs on constant
rejection and the yes is what people live for. It is kept honest by being tightly
scoped:

- One overlay with confetti, 1.5 seconds, then gone.
- Existing motion tokens and token colours only.
- `flame` as a brand accent, never as a button.
- No new colours.
- Nothing at all under `prefers-reduced-motion`.

Ranking is the other place visual energy is allowed. Everywhere else stays quiet.

## Adding a primitive

Put it in `src/ui/`, export it from `src/ui/index.ts`, and build it from tokens. If
you find yourself adding a variant to satisfy one screen, the screen is probably
wrong. Two exceptions were added for WineCore and both earned it: a `warning` toast
tone (recoverable failures read differently from errors) and `DrawerHeader` /
`DrawerBody` (the Drawer had no header, unlike Dialog).

Skeletons take the shape of what they stand for — `SkeletonText` for a paragraph,
`SkeletonRows` for a list or a feed (mark, title, meta) — so the loaded rows land where the
placeholders were. `EmptyState` takes an `illustration` when the empty thing has a face of
its own (the marks of the channels not yet connected) instead of the isometric stage.
