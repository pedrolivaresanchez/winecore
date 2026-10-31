# ADR 001 · Repositorio, remotos y proyecto Timbal

- **Estado**: propuesto (pendiente de Q-001 y Q-004) · 31-10-2026
- **Decisores**: Pedro (dueño de producto)
- **Fuentes** (consultadas el 31-10-2026): documentación de Timbal (https://docs.timbal.ai/deployment/platform, https://docs.timbal.ai/deployment/index, https://docs.timbal.ai/installation, https://docs.timbal.ai/api-reference/authentication), código del CLI (https://github.com/timbal-ai/timbal, commit `fd24b41`, `cli/commands/push.zig`, `configure.zig`, `credential_helper.zig`, `env.zig`) y OpenAPI v2.0.0.

## Contexto

El plan (§3.1) pide un repo con **dos remotos**: `origin` (GitHub `pedrolivaresanchez/WineCore`, privado) donde se revisa, y `timbal` (`https://api.timbal.ai/orgs/122/projects/<id>/git`) donde se despliega, con la misma SHA en ambos. Hechos verificados en la documentación y el código de Timbal:

| # | Hecho | Fuente |
|---|---|---|
| H1 | Un proyecto Timbal **es** un repositorio git alojado por Timbal; los **entornos son ramas** (`main` → producción, `staging` → staging). | docs/deployment/platform |
| H2 | `timbal push --name <N> --org <ID>` crea el proyecto en el primer push (`POST /orgs/{org}/projects`), añade el remoto **`timbal`** y **no toca `origin`** ("GitHub remotes stay intact"). `--dry-run` muestra lo que haría sin crear nada. | push.zig; docs/deployment/platform |
| H3 | El primer push a `main` sustituye un commit "Initial scaffold" del servidor con `--force-with-lease` sobre su SHA exacta (no se usa `--force`). | push.zig |
| H4 | `timbal create` **no** tiene `--name` ni `--org` (el plan lo daba por supuesto); exige un directorio vacío. En un repo existente se usa `timbal add api|ui|agent|workflow`. | create.zig, add.zig |
| H5 | La credencial del CLI es una **API key personal** que "hereda todos tus permisos en todas las organizaciones"; no hay cuentas de servicio documentadas. El CLI la lee de `~/.timbal/credentials` (no de `TIMBAL_API_KEY`). Git autentica con usuario `timbal` y la API key como contraseña. | docs/api-reference/authentication; credential_helper.zig |
| H6 | **No hay integración con GitHub documentada** ("Connect GitHub", webhooks o auto-deploy): no aparece en la documentación ni en la API. | Búsqueda en llms-full.txt y OpenAPI |
| H7 | Si `timbal push` se ejecuta en un clon **sin** el remoto `timbal` (p. ej. un checkout de CI), crea un **proyecto nuevo**. | push.zig (deducido del código) |
| H8 | La plataforma puede hacer commits propios en la rama (editor "Composer"), lo que haría divergir `timbal` de GitHub. | Plugin oficial de Cursor (`timbal-codegen`) |

## Decisión

1. **GitHub (`origin`) es la fuente de verdad**: PR, revisión, CI y aprobación de Pedro. El remoto `timbal` **solo recibe** las SHA que ya están en `dev`, `staging` o `main` de GitHub, empujadas por CI (ADR 007). Prohibido editar en el Composer de Timbal sobre esas ramas.
2. **Cuenta de Timbal dedicada** para WineCore (p. ej. `winecore-ci@…`) que sea **miembro solo de la org 122**, con un rol mínimo (crear proyecto, escribir en el repo git del proyecto, desplegar, gestionar variables y leer logs). Motivo: H5 — una API key de una persona que también pertenece a la **org 1** podría actuar sobre la org 1 (regla dura 0.1). La API key de esa cuenta se guarda solo en GitHub Secrets (`TIMBAL_API_KEY`, en *environments* protegidos) y en el perfil local `winecore` de quien cree el proyecto.
3. **Si** Pedro confirma que existe "Settings → Git Settings → Connect GitHub" con despliegue automático desde GitHub, ese será el **único** mecanismo de despliegue y CI **no** empujará a `timbal` (evita despliegues dobles, R10). Hasta entonces, el mecanismo es el de CI (ADR 007).
4. **Nunca** se hace `--force` contra `timbal` ni contra ramas de entorno de GitHub. Si `timbal` diverge (H8), el push de CI falla y se trae el cambio por PR (`git fetch timbal && git merge timbal/<rama>`).

## Procedimiento de creación (lo ejecuta Pedro o quien él designe; nada de esto se ha ejecutado aún)

> Requisitos: Q-001 resuelta (repo privado), cuenta dedicada creada y miembro de la org 122, git instalado.

```bash
# 1. Instalar el CLI (instala también uv y bun)
curl -LsSf https://timbal.ai/install.sh | sh
timbal version

# 2. Perfil dedicado, siempre con org 122 (nunca el perfil 'default')
timbal configure --profile winecore
#   Timbal API Key: (la de la cuenta dedicada)
#   Organization ID: 122
#   Platform base URL [https://api.timbal.ai]: (Intro)
#   Default output format [json]: (Intro)
grep -A3 '^\[profile winecore\]' ~/.timbal/config      # debe mostrar: org = 122

# 3. Clonar el repo de GitHub y crear la estructura Timbal (repo ya con contenido → timbal add)
git clone git@github.com:pedrolivaresanchez/WineCore.git && cd WineCore
git checkout main
mkdir -p workforce
timbal add api api --force
timbal add ui ui --force
git add -A && git commit -m "chore: estructura Timbal (api/, ui/, workforce/)"
git push origin main                                     # pasa por PR si main está protegida

# 4. Simular y crear el proyecto en la org 122 (sin -u: el upstream sigue siendo origin)
timbal push --profile winecore --org 122 --name WineCore --dry-run
#   Esperado: "Would create project 'WineCore' in organization 122 at https://api.timbal.ai, add remote 'timbal', and push branch 'main'."
timbal push --profile winecore --org 122 --name WineCore

# 5. Comprobar que hay exactamente dos remotos
git remote -v
#   origin  git@github.com:pedrolivaresanchez/WineCore.git (fetch/push)
#   timbal  https://api.timbal.ai/orgs/122/projects/<id>/git (fetch/push)

# 6. Ramas de entorno
git checkout -b staging && git push origin staging && timbal push --profile winecore
git checkout -b dev     && git push origin dev     && timbal push --profile winecore
#   Si el entorno no aparece solo: créalo en la UI de Timbal (o POST /orgs/122/projects/<id>/envs) y asocia la rama.
```

Después de crear el proyecto, **anotar aquí**:

| Dato | Valor |
|---|---|
| ID del proyecto (`<id>`) | _pendiente_ |
| Remoto `timbal` | `https://api.timbal.ai/orgs/122/projects/<id>/git` |
| `env_id` de `main` / `staging` / `dev` | _pendiente_ |
| Host del gateway por entorno | _pendiente_ (`proj-env-<env_id>` o `e<env_id>`.deployments.timbal.ai; discrepancia en la documentación) |
| Cuenta de Timbal dedicada | _pendiente_ |

Y en el proyecto Timbal: activar la autenticación de la app (`PATCH /orgs/122/projects/<id>/auth {"enabled": true}`) **antes** del primer despliegue con datos (ADR 008).

## Alternativas descartadas

- **Usar la API key personal de Pedro**: hereda permisos en todas sus orgs, incluida la org 1. Descartada por la regla 0.1.
- **`timbal push` desde CI**: si el clon de CI no tiene el remoto `timbal`, crea proyectos nuevos (H7). Se usa `git push` directo con el *credential helper* (ADR 007).
- **Timbal como fuente de verdad**: sin PR ni revisión obligatoria; contradice el plan.

## Consecuencias

- CI necesita `TIMBAL_API_KEY`, `TIMBAL_PROJECT_ID` y un `TIMBAL_ENV_ID` por rama (Q-004).
- Un job diario compara `git ls-remote` de ambos remotos (ADR 007) y avisa si divergen.
- El remoto `timbal` puede cambiar de host si Timbal cambia el gateway; la URL se guarda en una variable de GitHub, no en el código.
