# TASK-VFT-004 · Emisor `verifactu-sender` (Lambda)
- Hito M1 · 2 días · Escalado: sí (Verifactu y certificado)
- Historias / RNF: US-VFT-02
- Depende de: TASK-VFT-003, TASK-INFRA-009

## Objetivo
Función AWS Lambda que cada minuto envía, por entidad y en orden de cadena, los registros pendientes con TLS mutuo, respeta el control de flujo, marca `Incidencia`, reintenta (30 s, 2 min, 10 min, 1 h y cada hora) y guarda evidencias.

## Contexto
ADR 003 · `04-regulatorio/verifactu.md` §10–§11 · `03-maquinas-estado.md` §8 · rol `winecore_vf_sender`.

## Ficheros
`sender/src/handler.ts`, `sender/src/lease.ts`, `sender/src/transport.ts`, `infra/aws/sender.tf` (ajustes).

## Interfaz exacta
Handler `scheduled()` → por instalación activa: `SELECT … FOR UPDATE SKIP LOCKED` de `pending` ordenados por `chain_seq` (nunca uno antes que su anterior), `submission` + `connector_run`, envío a `www1`/`www10` (o `prewww1`/`prewww10` en pruebas), actualización de estados y `next_send_not_before`; evidencias a S3.

## Criterios de aceptación
- Con la AEAT simulada caída, los registros quedan `pending`, el banner del panel cuenta los pendientes y el siguiente envío lleva `Incidencia = S`.
- Nunca dos envíos simultáneos de la misma entidad.
- El certificado solo se lee de Secrets Manager en memoria; nunca se escribe en disco ni en logs.

## Tests requeridos
Integración con servidor SOAP simulado (éxito, error por registro, 5xx, tiempo agotado, cambio de `TiempoEsperaEnvio`); prueba en preproducción (VF-16, VF-17).
