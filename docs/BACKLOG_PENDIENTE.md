# Trabajo aplazado (31-10-2026)

Pedro pidió concentrar el presupuesto en lo que tiene que poder usarse ya: contactos, productos y tarifas, facturas y albaranes, cobros, gastos, stock, depósitos reales en el plano, aprobaciones con passkey y el menú. Nada de lo de abajo se ha borrado. Las ramas siguen en el remoto.

## Aplazado a propósito

| Tema | Dónde está | Estado |
|---|---|---|
| Modelos AEAT (303, 390, 347, 349, 115, 130) | Rama `cursor/modelos-aeat-2060`, commit `c307e3e` | Hecho y probado. No está en `main`. No presenta nada a la AEAT. |
| INFOVI | Rama `cursor/infovi-2060`, commit `9540bab` | Borrador sin terminar. No está en `main`. |
| Remesas SEPA | Ya hay código de remesas en `main` (`cursor/cobros-bancos-2060`). La ampliación queda parada. | No se sigue. |
| Exportación y EORI | Rama `cursor/exportacion-eori-2060` | En `main` lo que ya se integró. No se amplía. |
| Enología avanzada (fermentación, cata a ciegas, higiene) | Ramas `cursor/enologia-calculadoras-2060`, `cursor/catas-2060`, `cursor/higiene-envasado-2060` y la API ya mergeada de cata a ciegas | Lo que está en `main` se queda. No se construye más. |
| Viñedo y cuaderno de campo | Ramas `cursor/vinedo-cuaderno-2060`, `cursor/vendimia-vinedo-2060`, `cursor/ui-vinedo-sdr-2060` | En `main` lo ya integrado. No se sigue. |
| Informes avanzados | Rama `cursor/graficos-api-2060` | En `main` lo ya integrado. No se sigue. |
| Presentación SILICIE a la AEAT | Rama `cursor/silicie-presentacion-2060` y el WIP `cursor/puesta-en-marcha-2060` commit `4d4593e` | No se presenta nada. Los datos (CAE, asientos, existencias) sí se cargan y se guardan. |

Los 149 puntos de la reunión siguen en `docs/10-backlog/` y en `docs/04-regulatorio/`. Este archivo solo dice qué no se está construyendo ahora.

## Ramas con trabajo a medias, ya empujadas

| Rama | Commit | Qué es |
|---|---|---|
| `cursor/importar-holded-2060` | `1bbe16c` | Borrador anterior. No está en `main` y no se despliega. La carga que sí se usa está en `main`: líneas, albaranes y presupuestos en las tablas históricas, visibles en Facturas, Gastos y Ventas. |
| `cursor/importar-depositos-2060` | `05c45db` | Importar depósitos por CSV. Ya está en `main`. |
| `cursor/infovi-2060` | `9540bab` | INFOVI. Aplazado. |
| `cursor/puesta-en-marcha-2060` | `4d4593e` | CAE, ejercicio y reglas desde Ajustes. Aplazado. |
| `cursor/modelos-aeat-2060` | `c307e3e` | Libros de IVA y borradores. Aplazado. |

Los pull requests abiertos contra ramas antiguas no se han cerrado. Su código, cuando ya estaba en `main`, sigue ahí.

## Cómo conectar CVBOT (MCP)

La URL es `https://e4165.deployments.timbal.ai/api/m2m/mcp`. El cliente es `pedro-owner`, en nombre del propietario que entra con Microsoft, con lectura de facturación, ventas y contactos. Caduca a los 90 días.

El token no está en git. Está en el secreto `WINECORE_MCP_OWNER_TOKEN` del entorno `main` del proyecto 3942 (org 122). Se recupera en Timbal, en las variables del entorno, o con `timbal env pull --rev main`. Hay que tratarlo como una contraseña.

La llamada es HTTP POST con `Authorization: Bearer <token>`, `Content-Type: application/json` y `Accept: application/json, text/event-stream`. El cuerpo es JSON-RPC (`initialize`, `tools/list`, `tools/call`). La lista de facturas pendientes de envío es la herramienta `billing_invoices_pending_delivery_list`. El PDF es `billing_invoice_pdf_get` con `invoice_id`. No hay herramienta para aprobar ni para enviar el correo.
