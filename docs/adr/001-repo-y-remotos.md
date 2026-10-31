# ADR 001 · Repositorio, remotos y proyecto Timbal

- **Estado**: propuesto, **en curso** (Q-004) · actualizado 31-10-2026 13:05 CET con los datos del proyecto que facilitó Pedro
- **Decisores**: Pedro (dueño de producto)
- **Fuentes** (consultadas el 31-10-2026): documentación de Timbal (https://docs.timbal.ai/deployment/platform, https://docs.timbal.ai/deployment/index, https://docs.timbal.ai/installation, https://docs.timbal.ai/api-reference/authentication), código del CLI (https://github.com/timbal-ai/timbal, commit `fd24b41`: `cli/commands/push.zig`, `configure.zig`, `credential_helper.zig`, `env.zig`), OpenAPI v2.0.0, y **datos del proyecto comunicados por Pedro el 31-10-2026** (no verificados por mí: no tengo credencial de Timbal).

## Estado actual (31-10-2026)

| Dato | Valor | Fuente |
|---|---|---|
| Proyecto Timbal | **WineCore**, id **3942**, org **122** | Pedro |
| Remoto git de Timbal | `https://api.timbal.ai/orgs/122/projects/3942/git` | Pedro |
| Entornos | **Main**, id **4165**, rama `main` (producción). `staging` y `dev`: **no existen todavía** | Pedro |
| Contenido actual de `main` en Timbal | Commit **`f89f339`** con 5 ficheros generados **por el Composer de Timbal por su cuenta**. Pedro lo declara **desechable** | Pedro |
| Conexión con GitHub | **Aún no** conectada; la hará Pedro desde la UI de Timbal ("Settings → Git Settings → Connect GitHub") | Pedro |
| Repo de GitHub (`origin`) | `pedrolivaresanchez/winecore`, **público** por decisión de Pedro (Q-001): todo lo que se sube va anonimizado | `gh repo view` + Pedro |
| Credencial de Timbal en este entorno | Ninguna. No he ejecutado nada contra Timbal ni contra la org 1 | — |
| Host del gateway de Main | `proj-env-4165.deployments.timbal.ai` o `e4165.deployments.timbal.ai` (la documentación y el SDK discrepan) | PENDIENTE |

## Contexto (hechos de la documentación y el código de Timbal)

| # | Hecho | Fuente |
|---|---|---|
| H1 | Un proyecto Timbal **es** un repositorio git alojado por Timbal; los **entornos son ramas**. | docs/deployment/platform |
| H2 | `timbal push` crea un proyecto en el primer push si no hay remoto Timbal, añade el remoto **`timbal`** y **no toca `origin`** ("GitHub remotes stay intact"). | push.zig; docs/deployment/platform |
| H3 | En un proyecto recién creado, el CLI sustituye el commit de andamiaje del servidor con `--force-with-lease` sobre **su SHA exacta**. | push.zig |
| H4 | La credencial del CLI y de git es una **API key personal** que "hereda todos tus permisos en todas las organizaciones" (usuario git `timbal`, contraseña = API key). No hay cuentas de servicio documentadas. | docs/api-reference/authentication; credential_helper.zig |
| H5 | La documentación pública **no describe** la conexión con GitHub; Pedro confirma que la opción existe en la UI. Su comportamiento (sentido de la sincronización, despliegue automático, permisos que pide sobre GitHub) **no está documentado**. | Búsqueda en llms-full.txt y OpenAPI; Pedro |
| H6 | Si `timbal push` se ejecuta en un clon **sin** el remoto `timbal`, crea **otro** proyecto. | push.zig (deducido del código) |
| H7 | La plataforma **hace commits propios** (Composer). **Confirmado en este proyecto**: `f89f339` lo creó el Composer sin que nadie lo pidiera. | Plugin oficial de Timbal; Pedro |

## Decisión

1. **GitHub (`origin`) es la fuente de verdad**: PR, revisión, CI y aprobación de Pedro. Nada llega a una rama de entorno de Timbal que no esté antes en la misma rama de GitHub.
2. **Mecanismo de despliegue: uno solo** (R10).
   - **Plan A (preferido)**: la conexión de GitHub que hará Pedro, **si** tras conectarla se cumple la lista de comprobación del §"Verificación tras conectar GitHub". En ese caso CI **no** empuja al remoto `timbal`.
   - **Plan B**: si la conexión no hace lo que necesitamos (p. ej. solo importa una vez, o no despliega `staging`/`dev`), CI empuja la misma SHA al remoto `timbal` y llama al despliegue (ADR 007).
3. **El andamiaje `f89f339` se descarta** sin traerlo a GitHub (el repo es público y desconocemos su contenido): nunca se hace `git merge` de `timbal/main` en GitHub.
   - Si el Plan A lo sustituye al conectar, no hay que hacer nada.
   - Si hace falta el Plan B, el **arranque** de `main` en Timbal es la **única excepción** a la regla de no forzar: `git push --force-with-lease=refs/heads/main:<SHA completa de f89f339> timbal <SHA de origin/main>:refs/heads/main`, el mismo mecanismo que usa el CLI oficial para sustituir el andamiaje (H3), con la *lease* fijada a esa SHA exacta (si alguien ha empujado otra cosa, falla) y **con la aprobación expresa de Pedro** para esa acción concreta. Después, nunca más.
4. **Composer prohibido en ramas de entorno** (`main`, `staging`, `dev`). Si la conexión con GitHub da a Timbal permiso de escritura en el repo, la protección de ramas de GitHub debe impedir que Timbal empuje a `main`/`staging`/`dev` sin PR (sin excepciones de *bypass* para su app).
5. **Credencial de Timbal para CI (solo Plan B)**: una **cuenta dedicada** miembro **solo de la org 122** (motivo: H4; una API key de alguien que también pertenece a la org 1 podría actuar sobre la org 1, regla dura 0.1). Su API key vive únicamente en GitHub Secrets (`TIMBAL_API_KEY`, en *environments* protegidos).
6. **Nunca** `--force` contra ramas de entorno de GitHub ni, salvo la excepción del punto 3, contra `timbal`. Si `timbal` diverge (H7), el push de CI falla y se investiga; los cambios hechos en Timbal se rehacen por PR en GitHub.

## Verificación tras conectar GitHub (Plan A) — la hace Pedro y la anoto aquí

| # | Comprobación | Resultado esperado | Resultado |
|---|---|---|---|
| V1 | ¿Qué permisos pide la app de Timbal sobre GitHub? | Lectura del repo (y, si pide escritura, no puede saltarse la protección de ramas) | _pendiente_ |
| V2 | Tras conectar, ¿qué hay en `main` del proyecto 3942? | La SHA de `origin/main` (el andamiaje `f89f339` sustituido) | _pendiente_ |
| V3 | Un merge en `main` de GitHub, ¿despliega solo el entorno Main 4165? | Sí, en minutos | _pendiente_ |
| V4 | ¿Se pueden asociar `staging` y `dev` a nuevos entornos con despliegue desde sus ramas de GitHub? | Sí | _pendiente_ |
| V5 | ¿Las ramas `feat/*` crean entornos efímeros? ¿Con qué coste? ¿Se pueden desactivar? | Desactivados o sin coste relevante | _pendiente_ |
| V6 | ¿El Composer puede seguir haciendo commits? ¿Dónde los deja (GitHub o el repo interno)? | Desactivado, o solo en ramas que no son de entorno | _pendiente_ |
| V7 | `GET …/envs/4165/deployments?trigger=latest` (o la UI) muestra como `target.commit` la SHA de `origin/main` | Coinciden | _pendiente_ |

Si V2–V4 y V6 son correctas → Plan A. Si alguna falla → Plan B.

## Procedimiento (sin credencial, lo ejecuta Pedro o quien él designe)

### Plan A — conexión con GitHub
1. Proteger antes las ramas de GitHub (`main` con PR y aprobación de Pedro; `staging` y `dev` con PR y checks; sin *force push*; sin *bypass* para apps) — ADR 007.
2. En Timbal (org 122 → proyecto 3942) → **Settings → Git Settings → Connect GitHub** con la cuenta `pedrolivaresanchez`, repo `pedrolivaresanchez/winecore`, rama `main` ↔ entorno Main 4165.
3. Hacer la verificación V1–V7 y anotar los resultados en la tabla.
4. Crear los entornos `staging` y `dev` (UI de Timbal) asociados a sus ramas de GitHub.

### Plan B — CI empuja al remoto `timbal`
```bash
# En el equipo de quien hace el arranque (perfil dedicado, nunca 'default')
curl -LsSf https://timbal.ai/install.sh | sh
timbal configure --profile winecore        # API key de la cuenta dedicada; Organization ID: 122
git clone git@github.com:pedrolivaresanchez/winecore.git && cd winecore
git remote add timbal https://api.timbal.ai/orgs/122/projects/3942/git
git -c credential.helper='!timbal credential-helper' fetch timbal main   # para obtener la SHA completa de f89f339
git rev-parse timbal/main                  # debe empezar por f89f339; si no, PARAR y avisar
git remote -v                              # exactamente: origin (GitHub) y timbal (proyecto 3942)

# Arranque único, con aprobación expresa de Pedro (punto 3 de la decisión):
git push --force-with-lease=refs/heads/main:$(git rev-parse timbal/main) timbal origin/main:refs/heads/main

# Ramas de entorno (sin forzar; son nuevas en Timbal)
git push timbal origin/staging:refs/heads/staging
git push timbal origin/dev:refs/heads/dev
# Crear en la UI los entornos staging y dev y asociarles su rama; anotar sus env_id.
```
A partir de ahí, solo CI empuja (ADR 007), siempre *fast-forward*.

## Datos a anotar al terminar

| Dato | Valor |
|---|---|
| Proyecto / org | 3942 / 122 |
| Remoto `timbal` | `https://api.timbal.ai/orgs/122/projects/3942/git` |
| Entorno Main | 4165 (rama `main`) |
| Entorno staging | _pendiente_ |
| Entorno dev | _pendiente_ |
| Mecanismo elegido (A o B) | _pendiente_ |
| Host del gateway por entorno | _pendiente_ |
| Cuenta de Timbal dedicada (solo Plan B) | _pendiente_ |

## Alternativas descartadas
- **Fusionar el andamiaje del Composer en GitHub** (`git merge --allow-unrelated-histories timbal/main`): metería en un repo **público** ficheros que no hemos revisado y rompería el historial lineal. Descartada.
- **Usar la API key personal de Pedro en CI**: hereda permisos en todas sus orgs, incluida la org 1. Descartada (regla 0.1).
- **`timbal push` desde CI**: en un clon sin remoto `timbal` crearía otro proyecto (H6). Se usa `git push` directo con *credential helper* (ADR 007).

## Consecuencias
- Con el Plan A, CI no necesita credencial de escritura en Timbal; el job diario de deriva (ADR 007) compara `origin/main` con el commit desplegado por la API de Timbal (necesita una credencial de solo lectura si Timbal la ofrece; si no, se hace a mano en la revisión semanal).
- Con el Plan B, CI necesita `TIMBAL_API_KEY` (cuenta dedicada), `TIMBAL_PROJECT_ID = 3942` y `TIMBAL_ENV_ID` por rama (`4165` para `main`).
