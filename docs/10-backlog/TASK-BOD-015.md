# TASK-BOD-015 · Calculadoras enológicas, ajustes, reglas de la casa y mermas legales
- Hito M2 · 2 días · Escalado: sí (mermas legales)
- Historias / RNF: US-BOD-15, US-BOD-16
- Depende de: TASK-BOD-002, TASK-BOD-011
- Estado: en construcción (rama `cursor/enologia-calculadoras-2060`)

## Objetivo
Calculadoras puras (SO2 por pH, frío, alcohol probable, ensamblaje), ajustes por entidad con supuestos marcados, reglas que avisan o bloquean al previsualizar y tabla de mermas legales sin valores inventados.

## Contexto
`02-modelo-dominio.md` §9.3 · DDL `cellar.enology_setting`, `cellar.loss_tolerance`, `cellar.practice` · Q-035, Q-036.

## Ficheros
`api/src/core/enology/**`, `api/src/routes/enology*.ts`.

## Interfaz exacta
`POST /api/v1/enology/calculators/{so2|cold_stabilisation|probable_alcohol|blend}` · `GET/PUT /api/v1/enology/settings` · `POST /api/v1/enology/checks`.

## Criterios de aceptación
- SO2: libre necesario = molecular × (1 + 10^(pH − 1,81)); 13 % vol → −7,5 °C; 225 g/L → 13,37 % vol.
- Merma por encima del % legal → aviso con motivo; tabla vacía mientras falten los valores del asesor.
- Tras la FML solo SO2 sin aviso; carbón activo bloquea (`WC140`); envasado sin analítica previa reciente avisa.

## Tests requeridos
Pruebas doradas de cada calculadora; unit de cada regla; auditoría de ajustes.
