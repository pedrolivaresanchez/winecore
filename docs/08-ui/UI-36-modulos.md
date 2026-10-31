# UI-36 · Módulos

| | |
|---|---|
| Ruta | `/ajustes/modulos` |
| Objetivo | Activar o desactivar módulos (§12.6 del plan) sin perder datos, con sus dependencias |
| Historias | US-CORE-04 |
| Módulo y permiso | núcleo · `modules.manage`; cambiar: aprobación `module_toggle` |
| Patrón | Lista de interruptores |

## Componentes
Lista de módulos con `Switch`, descripción, dependencias ("EMCS necesita Stock"), estado y fecha; `Dialog` de confirmación con consecuencias.

## Datos (API)
`GET /api/v1/modules`; `POST /api/v1/modules/{code}/toggle-request` → aprobación.

## Reglas
- Desactivar **oculta** pantallas, rutas, herramientas MCP y jobs del módulo; no borra datos.
- No se puede desactivar un módulo del que depende otro activo.
- Verifactu no se puede desactivar con instalaciones activas (obligación legal); la pantalla lo explica.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Activar / desactivar | `modules.manage` | Tras la aprobación, cambia `core.module_state` | Aprobación |

## Móvil
No disponible.

## Wireframe
```
Módulos
[✓] Contactos      [✓] Catálogo     [✓] Ventas      [✓] Facturación
[✓] Verifactu      [✓] Stock        [✓] Bodega      [ ] Viñedo (M4)
[ ] EDI (M3)       [ ] EMCS (M3)    [ ] SISV (M3)   [✓] SILICIE
```
