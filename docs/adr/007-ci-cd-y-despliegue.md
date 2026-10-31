# ADR 007 · CI/CD, ramas de entorno y despliegue en Timbal

- **Estado**: propuesto (depende de Q-004) · actualizado 31-10-2026: el proyecto Timbal existe (id 3942, org 122, entorno Main 4165 ↔ `main`); Pedro conectará GitHub desde la UI de Timbal. Con el **Plan A** de ADR 001 (conexión de GitHub verificada) se eliminan los jobs `push-timbal` y `deploy-timbal`; con el **Plan B** se usan tal cual.
- **Fuentes** (31-10-2026): https://docs.timbal.ai/deployment/platform, https://docs.timbal.ai/api-reference/projects/environments/deploy, …/environments/update-config, https://docs.timbal.ai/evals/running-evals, código del CLI (`credential_helper.zig`, `push.zig`) y ADR 001.

## Contexto

- Timbal despliega **por rama** (entorno = rama) y expone `POST /orgs/{org}/projects/{id}/envs/{env_id}/deploy {rev}` (idempotente por rev). La documentación dice que hay que redesplegar tras empujar; la API sugiere que un push redespliega solo. No hay receta oficial de CI salvo para evals.
- Git autentica contra Timbal con usuario `timbal` y la API key como contraseña.
- Riesgos: despliegue doble (R10), divergencia de remotos, migraciones de BD fuera de control, secretos en logs.

## Decisión

### 1. Ramas

| Rama | Entorno Timbal | BD | Quién hace merge | Protección en GitHub |
|---|---|---|---|---|
| `main` | producción | `winecore_prod` | **Solo Pedro** (PR aprobado) | PR obligatorio, 1 aprobación de Pedro (CODEOWNERS), checks obligatorios, sin *force push*, sin borrado, historial lineal |
| `staging` | staging | `winecore_staging` (sintética) | Agente padre (CI verde) | PR obligatorio, checks obligatorios, sin *force push* |
| `dev` | dev | `winecore_dev` (sintética) | Agente padre (CI verde) | PR obligatorio, checks obligatorios, sin *force push* |
| `feat/<TASK-ID>-slug`, `fix/…`, `docs/…` | ninguno (Timbal crea entornos por rama según su doc; **no se empujan** a `timbal`) | — | — | — |
| `spec/fase-1` | — | — | Pedro | — |

Flujo: `feat/*` → PR a `dev` (squash) → al cerrar un hito, PR `dev` → `staging` (merge) → demo → PR `staging` → `main` aprobado por Pedro.

### 2. Workflows de GitHub Actions

| Workflow | Disparo | Jobs (todos obligatorios para el merge salvo indicación) |
|---|---|---|
| `guardrails.yml` (ya existe) | PR y push | gitleaks; bloqueo de `data/`, hojas de cálculo, CSV no sintéticos, certificados y `.env`; detector de datos personales |
| `ci.yml` | PR y push a `dev`/`staging`/`main` | `lint-ts` (Biome) y `typecheck` (tsc) en `core/`, `api/`, `ui/`; `lint-py` (ruff) y `typecheck-py` (mypy) en `workforce/`; `unit` (bun test); `db-invariants` (PostgreSQL 16 en servicio de Actions: aplica migraciones + `invariants_test.sql`); `integration` (API + BD sintética); `golden` (ficheros regulatorios byte a byte); `property` (fast-check, ≥ 1.000 casos por propiedad); `evals` (`python -m timbal.evals.cli workforce/`); `e2e-smoke` (Playwright contra la app en local con datos sintéticos) |
| `deploy.yml` | push a `dev`, `staging`, `main` (tras merge) | `db-migrate` → `push-timbal` → `deploy-timbal` → `smoke-remote` (ver §3) |
| `remotes-drift.yml` | diario 06:00 UTC y manual | Plan B: compara `git ls-remote` de `origin` y `timbal` para `dev`, `staging` y `main`. Plan A: compara la cabeza de cada rama de GitHub con el commit desplegado (`GET /orgs/122/projects/3942/envs/{env_id}/deployments?trigger=latest` → `target.commit`). Si difieren, falla (GitHub avisa por correo a Pedro y al agente padre) y escribe el detalle en el resumen del job. Requiere una credencial de Timbal (de solo lectura si existe) |
| `nightly.yml` | diario 02:00 UTC | Propiedades con 20.000 casos; restauración de la copia de `dev`; e2e completo |

### 3. Despliegue (`deploy.yml`)

Cada job de despliegue usa un **environment** de GitHub (`timbal-dev`, `timbal-staging`, `timbal-main`) con sus secretos y variables; `timbal-main` exige **aprobación manual de Pedro** en el propio workflow (además del PR).

```yaml
# Esqueleto normativo (la tarea TASK-INFRA-006 lo implementa tal cual)
name: deploy
on:
  push:
    branches: [dev, staging, main]
concurrency: { group: deploy-${{ github.ref_name }}, cancel-in-progress: false }
permissions: { contents: read }
jobs:
  db-migrate:
    runs-on: ubuntu-latest
    environment: timbal-${{ github.ref_name }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun api/db/migrate.ts --apply --grants        # rol winecore_migrator
        env: { DATABASE_URL_MIGRATOR: ${{ secrets.DATABASE_URL_MIGRATOR }} }
  push-timbal:
    needs: db-migrate
    runs-on: ubuntu-latest
    environment: timbal-${{ github.ref_name }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Empujar la MISMA SHA al remoto de Timbal (fast-forward; nunca --force)
        env:
          TIMBAL_API_KEY: ${{ secrets.TIMBAL_API_KEY }}
          TIMBAL_GIT_URL: https://api.timbal.ai/orgs/122/projects/${{ vars.TIMBAL_PROJECT_ID }}/git
        run: |
          git -c credential.helper= \
              -c 'credential.helper=!f() { echo username=timbal; echo "password=${TIMBAL_API_KEY}"; }; f' \
              push "$TIMBAL_GIT_URL" "${GITHUB_SHA}:refs/heads/${GITHUB_REF_NAME}"
  deploy-timbal:
    needs: push-timbal
    runs-on: ubuntu-latest
    environment: timbal-${{ github.ref_name }}
    steps:
      - name: Desplegar el rev (idempotente)
        env: { TIMBAL_API_KEY: ${{ secrets.TIMBAL_API_KEY }} }
        run: |
          curl -fsS -X POST -H "Authorization: Bearer ${TIMBAL_API_KEY}" -H "Content-Type: application/json" \
            -d "{\"rev\": \"${GITHUB_SHA}\"}" \
            "https://api.timbal.ai/orgs/122/projects/${{ vars.TIMBAL_PROJECT_ID }}/envs/${{ vars.TIMBAL_ENV_ID }}/deploy"
      - name: Esperar a que el despliegue termine (máx. 15 min)
        env: { TIMBAL_API_KEY: ${{ secrets.TIMBAL_API_KEY }} }
        run: bun scripts/wait-timbal-deploy.ts --project ${{ vars.TIMBAL_PROJECT_ID }} --env ${{ vars.TIMBAL_ENV_ID }} --sha "${GITHUB_SHA}"
  smoke-remote:
    needs: deploy-timbal
    runs-on: ubuntu-latest
    environment: timbal-${{ github.ref_name }}
    steps:
      - run: curl -fsS "${{ vars.WINECORE_BASE_URL }}/api/health" | grep -q "\"sha\":\"${GITHUB_SHA}\""
```

Notas:
- Si la API de Timbal no acepta una SHA en `rev` (pendiente), se usa el nombre de la rama: la SHA ya es la cabeza de esa rama en `timbal`.
- `api/health` devuelve `{status, sha, migrations}`; el smoke comprueba que la SHA desplegada es la de GitHub.
- **Evals como gate en Timbal**: `PATCH …/envs/{env_id}/config {"components": {}, "evals": true}` en `staging` y `main` (los evals ya corren en CI; el gate de Timbal es la segunda barrera).
- **Plan A (conexión de GitHub verificada, ADR 001)**: se eliminan `push-timbal` y `deploy-timbal`. Como el despliegue arranca al hacer merge, las migraciones deben estar aplicadas **antes**: el job `db-migrate` pasa a ejecutarse en el PR hacia la rama de entorno, como check obligatorio "pre-deploy" protegido por el *environment* (aprobación de Pedro para `main`), y solo migraciones compatibles hacia atrás (expand → migrate → contract). `smoke-remote` se mantiene tras el merge. Nunca ambos mecanismos a la vez.
- **Composer**: la plataforma ya hizo un commit por su cuenta en este proyecto (`f89f339`). Con el Plan B, cualquier commit del Composer en una rama de entorno hace fallar `push-timbal` (no es *fast-forward*): es lo deseado; se investiga y se rehace por PR. Con el Plan A, la protección de ramas de GitHub impide que la app de Timbal empuje sin PR.

### 4. Secretos y variables

| Nombre | Tipo | Dónde | Uso |
|---|---|---|---|
| `TIMBAL_API_KEY` | secreto | environments `timbal-*` | Solo Plan B. Cuenta dedicada solo org 122 (ADR 001) |
| `TIMBAL_PROJECT_ID` (= `3942`), `TIMBAL_ENV_ID` (`main` = `4165`; `staging` y `dev` cuando existan), `WINECORE_BASE_URL` | variables | environments `timbal-*` | IDs y URL del entorno |
| `DATABASE_URL_MIGRATOR` | secreto | environments `timbal-*` | Rol `winecore_migrator` |
| `DATABASE_URL` (app), `WINECORE_DATA_KEY`, `S3_*`, claves de modelos | secretos | **Variables secretas de Timbal** por entorno (`timbal env push --secret …`) | Tiempo de ejecución |

Los logs de CI nunca imprimen secretos (`::add-mask::` para valores derivados; `set +x`).

### 5. Reglas

1. Nunca `--force` contra `timbal` ni contra ramas de entorno.
2. El remoto `timbal` solo recibe SHA que ya están en la misma rama de GitHub.
3. Las migraciones se aplican **antes** de desplegar el código que las necesita y son compatibles hacia atrás durante un despliegue (expand → migrate → contract).
4. Un despliegue fallido no se "arregla" en Timbal: se corrige en GitHub y se vuelve a desplegar; rollback = desplegar la SHA anterior (`deploy {rev: <sha anterior>}`) o `git revert`.
5. El job diario de deriva de remotos es obligatorio desde M0.

## Consecuencias
- Requiere configurar en GitHub: protección de ramas, CODEOWNERS (`* @pedrolivaresanchez`), environments con aprobación y secretos (Q-004).
- Si Timbal permite IP de salida fija o red privada hacia la BD, el job `db-migrate` podría moverse a Timbal; hoy corre en GitHub.
