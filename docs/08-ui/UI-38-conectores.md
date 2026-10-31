# UI-38 · Conectores y clientes de máquina

| | |
|---|---|
| Ruta | `/ajustes/conectores` |
| Objetivo | Ver y configurar cómo se ejecuta cada flujo regulatorio (manual, *computer use*, API), el estado del ejecutor local, del emisor de Verifactu y de los clientes de máquina (CVBOT, agentes) con sus alcances |
| Historias | US-CORE-07, US-MCP-01/02/03, US-VFT-02 |
| Módulo y permiso | núcleo · `settings.manage` |
| Patrón | Panel |

## Componentes
Tarjetas por flujo (Verifactu, SILICIE, SISV, EMCS, EDI, INFOVI, ecológico) con conector activo, último uso y salud; ejecutor local: equipo, último latido, capacidades, versión; emisor Verifactu: último envío, tiempo de espera, caducidad del certificado (fecha, nunca el certificado); clientes de máquina con alcances, último uso, rotación de token.

## Datos (API)
- `GET /api/v1/connectors`; `PATCH /api/v1/connectors/{id}` (cambiar modo requiere aprobación).
- `GET /api/v1/runners` (latidos, capacidades).
- `GET /api/v1/verifactu/sender-health` (sin datos del certificado salvo la caducidad).
- `GET/POST /api/v1/api-clients`; `POST /api/v1/api-clients/{id}/rotate` (el token se muestra **una vez**).

## Reglas
- Nunca se muestran ni se piden aquí certificados, contraseñas de portales ni secretos (regla dura 0.2): la pantalla explica dónde viven (llavero del ejecutor, Secrets Manager).
- Un cliente de máquina nunca recibe `regulatory.approve`.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Cambiar modo de un conector | `settings.manage` | Tras aprobación | Aprobación |
| Nuevo cliente de máquina | `settings.manage` | Token mostrado una vez; alcances explícitos | Passkey |
| Rotar / revocar token | `settings.manage` | Inmediato | Passkey |
| Pausar el ejecutor local | `settings.manage` | Deja de reclamar trabajos | — |

## Móvil
Estado (lectura).

## Wireframe
```
Conectores
┌ Verifactu · API (emisor AWS) · último envío 10:41 · certificado caduca 02-2028 ┐
┌ SILICIE · computer use · ejecutor "Equipo bodega" · latido hace 40 s           ┐
┌ SISV · computer use · —                                                         ┐
Clientes de máquina: CVBOT (lectura, borradores con confirmación) · rotado 01-01
```
