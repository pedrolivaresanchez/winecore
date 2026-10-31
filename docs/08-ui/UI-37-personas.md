# UI-37 · Personas, roles y seguridad

| | |
|---|---|
| Rutas | `/ajustes/personas` (gestión) · `/ajustes/seguridad` (cada usuario: sus passkeys, TOTP y sesiones) |
| Objetivo | Dar de alta y de baja a personas con roles por entidad, y que cada persona gestione sus métodos de verificación reforzada |
| Historias | US-CORE-01/02/03 |
| Módulo y permiso | núcleo · gestión `users.manage`; seguridad: la propia persona |
| Patrón | Índice + ficha; formulario de seguridad |

## Componentes
`DataTable` (nombre, correo, roles por entidad, estado, último acceso, passkeys); ficha con roles por entidad (`owner`, `approver`, `admin`, `cellar`, `field`, `advisor`) y alcance; seguridad: lista de passkeys con alta (WebAuthn), TOTP de respaldo, sesiones activas y cierre.

## Datos (API)
- `GET/POST /api/v1/users`; `PATCH /api/v1/users/{id}` (roles, estado).
- `POST /api/v1/users/{id}/revoke` (baja inmediata: revoca sesiones, passkeys y TOTP).
- `GET /api/v1/me/credentials`; `POST /api/v1/me/passkeys/register` (WebAuthn); `POST /api/v1/me/totp`; `DELETE /api/v1/me/sessions/{id}`.

## Reglas
- Siempre debe quedar al menos un `owner` activo.
- Los roles `approver` se asignan por entidad (Q-005): quien aprueba para P.O puede no aprobar para CVPO.
- Clientes de máquina (CVBOT, ejecutor local, agentes) **no** se gestionan aquí: van en UI-38 con alcances.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Alta | `users.manage` | Invitación; entra con su cuenta | — |
| Cambiar roles | `users.manage` | Efecto inmediato; auditado | Passkey del `owner` |
| Baja | `users.manage` | Revocación inmediata | Passkey + motivo |
| Añadir passkey / TOTP | la propia persona | Credencial nueva | Verificación actual |

## Móvil
Seguridad disponible (registrar la passkey del teléfono).

## Wireframe
```
Personas                                              [Invitar]
┌──────────────┬──────────────────────────┬────────┬──────────┐
│ Nombre       │ Roles                    │ Estado │ Passkeys │
│ Pedro        │ owner (ambas)            │ activo │ 2        │
│ Administrac. │ admin (ambas)            │ activo │ 1        │
└──────────────┴──────────────────────────┴────────┴──────────┘
```
