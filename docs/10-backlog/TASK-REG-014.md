# TASK-REG-014 · Importación en SISV por el ejecutor
- Hito M3 · 1,5 días · Escalado: sí (envío regulatorio)
- Historias / RNF: US-SISV-02
- Depende de: TASK-REG-013, TASK-RUN-002

## Objetivo
Procedimiento `sisv.import_books`: entrar con certificado, "Importar libro", cargar cada fichero aprobado, "Importar fichero", recoger el resultado y las capturas.

## Contexto
`04-regulatorio/sisv.md` §3 y §6 · ADR 005.

## Ficheros
`runner/src/procedures/sisv.import_books.ts`.

## Interfaz exacta
Un trabajo por envío mensual; resultado por libro (`recorded` o `rejected` con el error).

## Criterios de aceptación
- Si queda una importación "Pendiente", se elimina antes de reintentar.

## Tests requeridos
Portal simulado; prueba real asistida con Pedro antes de M3 (Q-012).
