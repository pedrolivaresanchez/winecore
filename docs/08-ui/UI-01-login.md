# UI-01 · Entrar

| | |
|---|---|
| Ruta | `/login` (y `/login/callback`) |
| Objetivo | Entrar con la cuenta de Microsoft 365 (o correo) mediante el acceso de Timbal; solo entra quien está en la lista de personas de WineCore |
| Historias | US-CORE-01 |
| Módulo y permiso | núcleo · público |
| Patrón | Formulario mínimo |
| ADR | 008 (autenticación) |

## Componentes
`Card` centrada con logotipo, `Button` primario "Entrar con Microsoft", enlace secundario "Entrar con correo", `Banner` de error.

## Datos (API)
- Redirección al proveedor de Timbal (`timbalAuth`); al volver, `GET /api/v1/me` → persona, roles por entidad, módulos activos.
- Si la cuenta no está en `core.app_user` o está `revoked`: `403 WC_AUTH_NOT_ALLOWED`.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Entrar con Microsoft | público | Flujo OAuth de Timbal → sesión | — |
| Entrar con correo | público | Enlace de un solo uso por correo (si Pedro lo activa) | — |

## Estados
- Cargando: botón con spinner.
- Error de proveedor: "No se pudo entrar. Prueba de nuevo."
- Cuenta no autorizada: "Tu cuenta no tiene acceso. Pide a Pedro que te dé de alta." (no revela si la cuenta existe).

## Textos
Título: "Entrar". Sin nombres de agentes ni iconos de IA.

## Móvil
Igual, a pantalla completa; botón de 36 px.

## Wireframe
```
┌──────────────────────────────┐
│           WineCore           │
│  ┌────────────────────────┐  │
│  │  Entrar con Microsoft  │  │
│  └────────────────────────┘  │
│      Entrar con correo       │
└──────────────────────────────┘
```
