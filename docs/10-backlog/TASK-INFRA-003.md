# TASK-INFRA-003 · AWS base con OpenTofu
- Hito M0 · 2 días · Escalado: sí (arquitectura y seguridad)
- Historias / RNF: RNF-04, RNF-08
- Depende de: Q-027 (cuenta de AWS)

## Objetivo
Infraestructura en eu-north-1: RDS PostgreSQL 16 (PITR 35 días, cifrado, `sslmode=verify-full`), S3 con Object Lock (modo *compliance*, 6 años) para evidencias y documentos, claves KMS, rol OIDC de GitHub para despliegues, y el esqueleto de Lambda y Secrets Manager para `verifactu-sender`.

## Contexto
ADR 002 · ADR 003 · `07-arquitectura.md` §10 y §13.

## Ficheros
`infra/aws/*.tf` (`rds.tf`, `s3.tf`, `kms.tf`, `iam_oidc.tf`, `sender.tf`, `variables.tf`, `outputs.tf`), `infra/aws/README.md`.

## Interfaz exacta
Salidas: `db_endpoint`, `evidence_bucket`, `documents_bucket`, `sender_function_name`, `sender_secret_arn`, `github_deploy_role_arn`. Roles: `wc-github-deploy` (solo despliegue), `wc-sender` (solo leer su secreto y su clave KMS, red hacia RDS y AEAT).

## Criterios de aceptación
- `tofu plan` sin cambios tras aplicar; estado remoto cifrado.
- Ningún secreto en el código ni en las salidas.
- Política del bucket de evidencias impide borrar objetos (prueba con `aws s3api delete-object` → denegado).
- Solo el rol `wc-sender` puede leer el secreto del certificado (prueba con otro rol → denegado).

## Tests requeridos
`tofu validate` y `tflint` en CI; checklist de las pruebas de denegación adjunta al PR.
