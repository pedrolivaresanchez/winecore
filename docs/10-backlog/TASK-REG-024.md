# TASK-REG-024 · Certificados ecológicos
- Hito M4 · 1 día · Escalado: sí (normativa ecológica)
- Historias / RNF: US-ECO-01
- Depende de: TASK-CONT-001

## Objetivo
Certificados propios y de proveedores con vigencia, organismo y categorías; regla de certificado vigente en la recepción.

## Contexto
`04-regulatorio/ecologico.md` §1–§2 (R14) · `regulatory.organic_certificate`.

## Ficheros
`api/src/routes/organic-certificates.ts`, `api/src/core/regulatory/organic/certificates.ts`.

## Interfaz exacta
`validCertificate(tx, { contactId|entityId, date, category }): OrganicCertificate|null`; usada por recepciones (`WC_ECO_CERT_MISSING`) y por la ficha de etiqueta.

## Criterios de aceptación
- Aviso 30 días antes de caducar un certificado de proveedor habitual.

## Tests requeridos
Integración de vigencias (límites inclusivos).
