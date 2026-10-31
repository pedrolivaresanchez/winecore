# TASK-VFT-007 · Batería de preproducción VF-01…VF-22
- Hito M1 · 2 días · Escalado: sí (Verifactu)
- Historias / RNF: US-VFT-06
- Depende de: TASK-VFT-005, TASK-FACT-005, TASK-FACT-006

## Objetivo
Automatizar la batería de `verifactu.md` §16 contra el entorno de pruebas de la AEAT con datos sintéticos y generar el informe del gate del 01-12-2026 para la aprobación de Pedro.

## Contexto
`04-regulatorio/verifactu.md` §16 · ADR 004 · certificado reconocido de pruebas (no requiere cerrar Q-006, aplazada por Pedro).

## Ficheros
`api/test/preprod/verifactu.battery.ts`, `api/test/golden/verifactu/VF-*`, `docs/runbooks/gate-verifactu.md`.

## Interfaz exacta
`bun run test:preprod:verifactu --env test` → informe JSON + PDF con resultado por caso, huellas, CSV y consulta posterior; el informe se adjunta a una solicitud de aprobación.

## Criterios de aceptación
- 22/22 con el resultado esperado y cero diferencias de huella.
- Solo se ejecuta contra `prewww1`/`prewww10` (bloqueo explícito de los endpoints de producción).

## Tests requeridos
La propia batería; test que verifica que la URL de producción está bloqueada en este comando.
