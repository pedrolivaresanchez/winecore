# Despliegue en Timbal (Plan B)

Workflow `.github/workflows/deploy.yml`. Publica `main` en el proyecto WineCore de Timbal (org **122**, proyecto **3942**, entorno **Main** **4165**). No hace nada mientras la variable de repositorio `TIMBAL_DEPLOY_ENABLED` no sea `true`.

## Pasos

1. **db-migrate** — en `api/`: `bun install --frozen-lockfile` y `bun run migrate` (`DB_MODE=timbal`, org 122, `TIMBAL_KB_ID`).
2. **push-timbal** — empuja la SHA exacta del commit a `main` del git interno (`https://api.timbal.ai/orgs/122/projects/3942/git`, usuario `timbal`, clave por `GIT_ASKPASS`). Si el remoto tiene un commit que no es ancestro de esa SHA, se aborta. Nunca `--force`.
3. **deploy-timbal** — `POST /orgs/122/projects/3942/envs/4165/deploy` con `{rev: <sha>}` y sondea `GET …/deployments?trigger=latest` hasta éxito, fallo o 15 min.
4. **smoke-remote** — `GET {TIMBAL_MAIN_URL}/api/health` con reintentos. `sha` tiene que ser la del commit de GitHub.

Cada job usa el environment de GitHub `timbal-main` (un despliegue a la vez).

## Secretos y variables

| Nombre | Tipo |
|---|---|
| `TIMBAL_API_KEY` | secreto del environment `timbal-main` |
| `TIMBAL_DEPLOY_ENABLED` | variable de repositorio (`true` para activar) |
| `TIMBAL_KB_ID` | variable del environment `timbal-main` |
| `TIMBAL_MAIN_URL` | variable del environment `timbal-main`: origen https del gateway, sin ruta |

Opcionales, si el vocabulario de estado no coincide: `TIMBAL_DEPLOY_SUCCESS_STATUSES`, `TIMBAL_DEPLOY_FAILURE_STATUSES`. `TIMBAL_DEPLOY_REV` sustituye el `rev` del POST.

## Cómo lo activa Pedro

1. GitHub → Settings → Environments → `timbal-main`, con Pedro como reviewer obligatorio.
2. En ese environment: secreto `TIMBAL_API_KEY` (cuenta solo de la org 122) y variables `TIMBAL_KB_ID` y `TIMBAL_MAIN_URL` (el host de Main no está confirmado: `https://proj-env-4165.deployments.timbal.ai` o `https://e4165.deployments.timbal.ai`).
3. Variable de repositorio `TIMBAL_DEPLOY_ENABLED=true`.
4. El primer reemplazo del andamiaje en Timbal es manual (ADR 001). Este workflow no fuerza ese push: si `main` remoto no está en nuestro historial, el job falla.
