# 08-UI · 01 · Navegación y mapa de rutas

> Rutas de `ui/src/app/routes.tsx` (React Router 7). Cada ruta declara permiso y módulo; si el módulo está desactivado muestra `ModuleDisabled`; si falta permiso, `NoPermission`. Menú lateral agrupado; los grupos sin ninguna ruta visible se ocultan.

| Grupo (menú) | Pantalla | Ruta | Módulo | Permiso para ver | Ficha |
|---|---|---|---|---|---|
| — | Entrar | `/login` | núcleo | público | `UI-01-login.md` |
| Inicio | Panel | `/` | núcleo | autenticado | `UI-02-panel.md` |
| Inicio | Aprobaciones | `/aprobaciones`, `/aprobaciones/:id` | núcleo | `regulatory.approve` o solicitante | `UI-03-aprobaciones.md` |
| Ventas | Clientes y proveedores | `/contactos` | contacts | `contacts.read` | `UI-04-contactos.md` |
| Ventas | Ficha de contacto | `/contactos/:id` | contacts | `contacts.read` | `UI-05-contacto.md` |
| Ventas | Duplicados | `/contactos/duplicados` | contacts | `contacts.write` | `UI-06-duplicados.md` |
| Catálogo | Productos | `/catalogo` | catalog | `catalog.read` | `UI-07-catalogo.md` |
| Catálogo | Ficha de producto | `/catalogo/:id` | catalog | `catalog.read` | `UI-08-producto.md` |
| Catálogo | Tarifas | `/catalogo/tarifas`, `/catalogo/tarifas/:id` | catalog | `catalog.read` | `UI-09-tarifas.md` |
| Ventas | Pedidos | `/ventas/pedidos`, `/ventas/pedidos/:id` | sales | `sales.read` | `UI-10-pedidos.md` |
| Ventas | Albaranes | `/ventas/albaranes`, `/ventas/albaranes/:id` | sales | `sales.read` | `UI-11-albaranes.md` |
| Facturación | Facturas | `/facturas` | billing | `billing.read` | `UI-12-facturas.md` |
| Facturación | Factura | `/facturas/nueva`, `/facturas/:id` | billing | `billing.read` | `UI-13-factura.md` |
| Facturación | Rectificar | `/facturas/:id/rectificar` | billing | `billing.write` | `UI-14-rectificativa.md` |
| Facturación | Verifactu | `/facturas/verifactu` | verifactu | `billing.read` | `UI-15-verifactu.md` |
| Facturación | Intercompañía | `/facturas/intercompania` | billing | `billing.read` | `UI-16-intercompania.md` |
| Compras | Gastos | `/compras`, `/compras/:id` | purchasing | `purchasing.read` | `UI-17-gastos.md` |
| Cobros | Cobros y pagos | `/cobros` | billing (M1) / finance (M6) | `finance.read` | `UI-18-cobros.md` |
| Stock | Existencias | `/stock` | inventory | `inventory.read` | `UI-19-existencias.md` |
| Stock | Movimientos | `/stock/movimientos` | inventory | `inventory.read` | `UI-20-movimientos.md` |
| Stock | Conciliación | `/stock/conciliacion` | inventory | `inventory.read` | `UI-21-conciliacion.md` |
| Stock | Aforos | `/stock/aforos`, `/stock/aforos/:id` | inventory | `inventory.read` | `UI-22-aforos.md` |
| Bodega | Depósitos | `/bodega/depositos`, `/bodega/depositos/:code` | cellar | `cellar.read` | `UI-23-depositos.md` |
| Bodega | Lotes | `/bodega/lotes`, `/bodega/lotes/:code` | cellar | `cellar.read` | `UI-24-lote.md` |
| Bodega | Nueva operación | `/bodega/operaciones/nueva`, `/bodega/operaciones/:id` | cellar | `cellar.operate` | `UI-25-operacion.md` |
| Viñedo | Parcelas | `/vinedo`, `/vinedo/:code` | vineyard | `vineyard.read` | `UI-26-vinedo.md` |
| Regulatorio | Calendario | `/regulatorio` | (cualquier regulatorio) | `regulatory.read` | `UI-27-calendario.md` |
| Regulatorio | Envío | `/regulatorio/envios/:id` | según flujo | `regulatory.read` | `UI-28-envio.md` |
| Regulatorio | Cuadres | `/regulatorio/cuadres` | silicie + sisv | `regulatory.read` | `UI-29-cuadres.md` |
| Regulatorio | EDI | `/regulatorio/edi` | edi | `regulatory.read` | `UI-30-edi.md` |
| Regulatorio | e-DA | `/regulatorio/emcs`, `/regulatorio/emcs/:id` | emcs | `regulatory.read` | `UI-31-emcs.md` |
| Asistente | Asistente | `/asistente` | assistant | autenticado | `UI-32-asistente.md` |
| Informes | Informes | `/informes` | núcleo | `*.read` | `UI-33-informes.md` |
| Ajustes | General y series | `/ajustes`, `/ajustes/series` | núcleo | `settings.manage` | `UI-34-ajustes.md` |
| Ajustes | Reglas de facturación | `/ajustes/reglas-facturacion` | billing | `settings.manage` | `UI-35-reglas-facturacion.md` |
| Ajustes | Módulos | `/ajustes/modulos` | núcleo | `modules.manage` | `UI-36-modulos.md` |
| Ajustes | Personas y roles | `/ajustes/personas`, `/ajustes/seguridad` | núcleo | `users.manage` (seguridad: cada usuario) | `UI-37-personas.md` |
| Ajustes | Conectores | `/ajustes/conectores` | núcleo | `settings.manage` | `UI-38-conectores.md` |
| Ajustes | Aprobaciones | `/ajustes/aprobaciones` | núcleo | `settings.manage` | `UI-39-politicas.md` |
| Ajustes | Historial | `/auditoria` | núcleo | `audit.read` | `UI-40-auditoria.md` |
| Ajustes | Migración | `/migracion` | núcleo | `owner` | `UI-41-migracion.md` |

**Búsqueda global** (barra superior, atajo `/`): contactos, productos, lotes, facturas, pedidos y albaranes (`system_search`).
**Selector de entidad**: P.O · CVPO · Ambas; filtra índices y paneles; los formularios de documento muestran la entidad resuelta por D3 y no dependen del selector.
**Avisos**: campana con `core.notification` sin leer; contador de aprobaciones pendientes.
