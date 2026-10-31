# TASK-INFRA-009 · Runbook y alta del certificado de Verifactu
- Hito M1 · 0,5 días · Escalado: sí (custodia del certificado)
- Historias / RNF: US-VFT-02, RNF-05
- Depende de: TASK-INFRA-003, Q-006 (aplazada por Pedro: solo para el certificado de producción; en M1 se usa un certificado reconocido de pruebas)

## Objetivo
Procedimiento guiado para que **Pedro** suba el certificado dedicado a AWS Secrets Manager, lo rote y lo revoque, sin que nadie más vea el fichero ni la contraseña.

## Contexto
ADR 003 §4 · `04-regulatorio/verifactu.md` §10 y §11.

## Ficheros
`docs/runbooks/certificado-verifactu.md`, `scripts/cert-expiry-check.ts`.

## Interfaz exacta
`cert-expiry-check.ts` (lo ejecuta el emisor una vez al día) → devuelve `{ notAfter: string, daysLeft: number }` **sin** exponer el certificado; aviso desde 30 días.

## Criterios de aceptación
- El runbook cubre alta, renovación, revocación ante incidente y entorno de pruebas.
- CloudTrail registra cada lectura del secreto; alarma si lo lee una identidad distinta de `wc-sender`.

## Tests requeridos
Unitario de `cert-expiry-check.ts` con un certificado sintético autofirmado generado en el test.
