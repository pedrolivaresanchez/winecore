# Revisión de seguridad · 31-10-2026

Revisión del código de `main` (API, interfaz y MCP). No incluye datos reales ni valores de secretos. Los cambios de esta rama corrigen lo que se podía cerrar sin cambiar el contrato de facturación, de cobros o de la interfaz.

| Severidad | Hallazgo | Dónde | Estado |
|---|---|---|---|
| Alta | CORS aceptaba cualquier origen y permitía credenciales. Un sitio ajeno podía leer respuestas autenticadas con la cookie de sesión. | `api/src/app.ts` | Corregido. Solo el origen de despliegue (`APP_PUBLIC_URL` y `WEBAUTHN_ORIGIN`). Fuera de producción también `localhost` y `127.0.0.1`. |
| Alta | Existía la herramienta MCP `purchasing_expense_approve`, que aprobaba un gasto. La matriz y `docs/13-mcp.md` prohíben aprobar desde un cliente de máquina. | `api/src/mcp/tools/expenses.ts` | Eliminada. El catálogo rechaza nombres con `approve`, `issue`, `void`, `send`, `delete` o `secret`. |
| Alta | `approvals_request_create` creaba solicitudes de cualquier tipo con solo alcance de lectura. No está en el catálogo de `docs/13-mcp.md`. | `api/src/mcp/tools/approvals.ts` | Eliminada. Listar y enlazar solicitudes sigue existiendo. |
| Media | Un error de base de datos se escribía en el registro con el mensaje completo. Ese mensaje puede incluir la sentencia y, con ella, correo, NIF o IBAN. | `api/src/app.ts`, `api/src/index.ts`, `api/src/core/redact.ts` | Corregido. El registro y el arranque sustituyen ese texto por «Error interno». La respuesta HTTP de un fallo no controlado sigue siendo genérica. |
| Media | `auth.denied` guardaba el correo en claro en la auditoría. | `api/src/auth/guard.ts` | Corregido. Se guarda el SHA-256 del correo, no el correo. |
| Media | `POST /v1/approvals/:id/decide` llamaba al servicio de aprobación con el cliente de máquina y después respondía prohibido. El servicio ya rechazaba al no humano antes de escribir; la ruta ya no lo invoca. | `api/src/routes/approvals.ts` | Corregido. |
| Media | El hash de la confirmación MCP se comparaba con desigualdad normal. | `api/src/mcp/confirm.ts` | Corregido con comparación en tiempo constante. El token de máquina se busca por su SHA-256 en la base; no se compara el token en claro. |
| Baja | `assertRow` componía SQL con el nombre de tabla y el identificador en una cadena. El identificador ya se validaba como UUID y la tabla era fija. | `api/src/core/cellar/service/operations.ts` | Corregido: plantilla `sql` e identificador permitido. |
| Baja | El perfil asesor veía la calle y el código postal. El correo y el teléfono ya se ocultaban. | `api/src/core/party/contacts.ts`, `api/src/mcp/tools/contacts.ts` | Corregido. Siguen la ciudad y el NIF: el asesor tiene lectura fiscal y las facturas llevan el NIF. |
| Baja | La captura de un gasto por MCP no limitaba el tamaño. La especificación marca 10 MB. | `api/src/mcp/tools/expenses.ts` | Corregido. |
| Baja | La API no enviaba cabeceras de endurecimiento. | `api/src/auth/policy.ts` | Añadidas `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` y CSP `default-src 'none'`. HSTS solo en producción. |
| Baja | La clave de pruebas de `WINECORE_DATA_KEY` que está en el código de test se aceptaría en producción. | `api/src/config/index.ts` | Rechazada cuando `NODE_ENV=production`. |
| Info | `AUTH_MODE=dev` ya se rechaza si `NODE_ENV=production`. `x-dev-user` solo se lee en modo dev y, además, nunca si el proceso es de producción. | `api/src/config/index.ts`, `api/src/auth/guard.ts` | Ya estaba; se reforzó el segundo control. |
| Info | La caché de `/me?project_id` dura 60 s, tiene 500 entradas y guarda el hash del token, no el token. No se escribe el token en el registro. | `api/src/auth/timbal.ts` | Comprobado y cubierto con pruebas. |
| Info | Bearer y cookie: si llega `Authorization`, no se usa la cookie. Un bearer inválido no cae en la cookie. | `api/src/auth/guard.ts` | Comprobado con prueba. |
| Info | Toda ruta que no es `GET /health` ni `GET /healthcheck` tiene guarda (`requireUser`, `requirePermission`, `requireOwner` o `requireUserOrMachine`). El preflight CORS es `OPTIONS`. | `api/src/app.ts` | Prueba que enumera las rutas de Elysia. |
| Info | Los IBAN de las respuestas JSON salen con los 4 últimos dígitos. El fichero SEPA lleva el IBAN completo porque el banco lo exige; lo descarga quien tiene `finance.manage`. | `api/src/core/finance/` | Sin cambio. |
| Info | `exports.fiscal` no es una clave distinta: los CSV de informes usan `reports.read`, que tienen los mismos perfiles (titular, aprobador, administración y asesor). | `api/src/core/auth/permissions.ts` | Sin cambio. |
| Info | `billing.void` y `regulatory.approve` comprueban la entidad jurídica en la operación. La guarda de ruta comprueba que el rol tiene el permiso en alguna entidad. | rutas de facturación y regulatorio | Sin cambio. |

## Recomendaciones que no se han aplicado

- **CSRF de doble envío** (`docs/adr/008-autenticacion.md`). La interfaz envía el token en memoria (`Authorization: Bearer`). La cookie `timbal_access_token` sigue siendo un segundo camino. Exigir `X-WineCore-CSRF` rompería a los clientes actuales. Conviene hacerlo cuando la interfaz envíe esa cabecera y la cookie de Timbal sea `SameSite=Strict`.
- **Token de refresco en `localStorage`** (`ui/src/auth/tokens.ts`). Un script inyectado en la página puede leerlo. El token de acceso ya está solo en memoria.
- **Cuerpo de `/me` sin objeto `project`**. Si Timbal responde 200 con el correo y sin proyecto, se acepta. Conviene exigir `project.id` igual al proyecto cuando Timbal lo garantice.
- **Caducidad de la confirmación MCP**: el código usa 15 minutos y la especificación dice 10. Bajarlo cambia confirmaciones en curso.
- **`billing_invoice_delivery_mark_sent`** es una escritura directa. No envía correo: CVBOT registra que ya lo envió desde Outlook. No entra en el veto de herramientas `send`. Pasarla a prepare/commit cambiaría el cliente.
- **Validar un mayor SILICIE** (`POST /v1/silicie-ledgers/:id/validate`) deja pasar a cualquier asesor, sin filtrar por entidad. La ruta tiene guarda de usuario y el resto de perfiles necesita `regulatory.prepare`.
- **Notas libres de un contacto** pueden contener un correo escrito a mano. El asesor las sigue viendo. Conviene no anotar datos de contacto en ese campo.
- **Cabeceras de la interfaz estática**. Las de esta revisión las pone la API. El HTML que sirve Timbal necesita las suyas en el alojamiento de la interfaz.
- **Límite de la caché de sesión y del límite MCP** es por proceso. Un redespliegue los vacía. Es aceptable con un solo escritor.

## Secretos

No hay valores de secretos en el repositorio ni en los flujos de CI. `TIMBAL_PROJECT_SECRET` no sale en `/health` ni en los registros de esta revisión. `WINECORE_DATA_KEY` es obligatorio en producción, se usa para cifrar IBAN y TOTP, y la clave de las pruebas queda rechazada en ese entorno.
