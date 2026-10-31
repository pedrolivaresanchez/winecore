# ADR 003 · Certificado electrónico y su custodia

- **Estado**: propuesto (depende de Q-027; **Q-006 aplazada por decisión de Pedro**: se decide al final, antes del paso a producción) · 31-10-2026
- **Relacionado**: ADR 002 (AWS en eu-north-1), ADR 004 (Verifactu), ADR 007 (despliegue), ADR 009 (ejecutor local), `04-regulatorio/verifactu.md` §10, `07-arquitectura.md` §10.

## Contexto

- WineCore necesita certificado electrónico para dos cosas muy distintas:
  1. **Verifactu**: envío automático, inmediato y desatendido de los registros de CVPO (desde el 01-01-2027) y de P.O (antes del 01-07-2027) al servicio web de la AEAT. Tiene que funcionar 24/7 aunque nadie tenga el ordenador encendido.
  2. **Portales** (SILICIE, EMCS, modelos, quizá SISV): trabajos puntuales, aprobados uno a uno, que hoy hace una persona con el certificado de P.O. Van por el ejecutor local (ADR 009) y el certificado nunca sale de ese equipo.
- **HECHO** (Orden HAC/1177/2024, art. 5): para Verifactu vale cualquier certificado válido en la sede de la AEAT; puede enviar el propio obligado **o un tercero** que le represente (apoderamiento, arts. 79–81 del RGAT) o colaborador social (Orden HAC/1398/2003).
- **HECHO** (WSDL de Verifactu): la AEAT publica un servicio específico para **certificados de sello** (`www10.agenciatributaria.gob.es`), además del de certificados de persona (`www1`).
- **HECHO** (notas de Timbal, `07-arquitectura.md` §10): en Timbal las variables secretas llegan a **todos** los componentes del entorno, incluidos los agentes con modelos de lenguaje. No hay restricción por componente.
- El certificado de P.O es **personal** (persona física) y permite cualquier trámite en su nombre (R7). El de representante de CVPO también permite cualquier trámite de la sociedad.

## Decisión (propuesta)

### 1. Dos zonas de custodia separadas

| Zona | Qué certificado | Dónde | Quién lo usa |
|---|---|---|---|
| **Servidor** (solo Verifactu) | Un certificado **dedicado** a Verifactu. Preferido: **sello electrónico cualificado de CVPO** (identifica a la sociedad, no a una persona; servicio `www10`). Alternativa: certificado de representante de CVPO emitido solo para este uso | AWS Secrets Manager (eu-north-1), cifrado con una clave KMS propia | Solo la función `verifactu-sender` |
| **Local** (portales) | Certificado de P.O y, si hace falta, el de representante de CVPO | Llavero del equipo dedicado del ejecutor local (ADR 009, Q-026) | Solo `runner/`, en trabajos aprobados |

Ningún certificado ni contraseña va al repositorio, a Timbal, a los logs, a las trazas, a los prompts ni a los PR (regla dura 0.2).

### 2. El emisor de Verifactu se aísla fuera de Timbal

`verifactu-sender` es una **función pequeña en AWS Lambda** (eu-north-1, dentro de la VPC de RDS), separada de `api/`:

- Se ejecuta cada minuto (EventBridge Scheduler), que coincide con el tiempo de espera inicial de 60 s de la AEAT.
- Lee de PostgreSQL los registros `pending` de cada entidad en orden de cadena (`FOR UPDATE SKIP LOCKED` con *lease*), los envuelve en el mensaje SOAP, los envía con TLS mutuo y escribe la respuesta. **No genera** registros ni huellas: eso lo hace `api/src/core` dentro de la transacción de emisión. Si el emisor se viera comprometido, no podría crear facturas.
- Rol de base de datos propio `winecore_vf_sender` con permisos mínimos: `SELECT` de `regulatory.verifactu_record` y `verifactu_installation`; `UPDATE` solo de las columnas de estado de envío (las que permite `WC130`); `INSERT` en `regulatory.submission` y `connector_run`.
- Rol IAM propio: solo él puede leer el secreto del certificado y usar la clave KMS. CloudTrail registra cada lectura; una alarma avisa si lo lee otra identidad.
- Código en `sender/` del mismo repositorio, TypeScript, reutilizando `api/src/core/regulatory/verifactu/` (sin dependencias de Elysia ni de Timbal). Lo despliega la CI con OIDC de GitHub hacia AWS (sin claves de AWS permanentes) y solo desde `main` y `staging` (ADR 007).

### 3. P.O

Opciones, por orden de preferencia (PENDIENTE de confirmar con el asesor y en preproducción, Q-006):

1. **P.O apodera a CVPO** en el registro de apoderamientos de la AEAT para el trámite de Verifactu, y el certificado de la zona servidor envía también los registros de P.O. Hay que confirmar que un sello de entidad puede actuar como apoderado; si no, el apoderamiento se hace a favor del representante de CVPO y se usa su certificado dedicado.
2. Certificado de P.O en la zona servidor, con consentimiento expreso de su titular. **No recomendado** (certificado personal con todos los poderes).
3. P.O sigue en Holded con Verifactu hasta resolverlo (su obligación es el 01-07-2027).

### 4. Ciclo de vida

| Momento | Acción | Quién |
|---|---|---|
| Alta | Pedro solicita el certificado; lo sube **él** a Secrets Manager con un procedimiento guiado (`docs/runbooks/certificado-verifactu.md`, TASK-INFRA-009); nadie más ve el fichero ni la contraseña | Pedro |
| Uso | Solo `verifactu-sender`; cada envío queda en `connector_run` | Sistema |
| Aviso de caducidad | Diario desde 30 días antes (vigilante) | Sistema → CVBOT |
| Renovación | Igual que el alta; la versión anterior se desactiva tras el primer envío correcto con la nueva | Pedro |
| Incidente | Revocación inmediata ante el prestador, borrado del secreto, rotación de la clave KMS, revisión de CloudTrail y de los envíos | Pedro |
| Preproducción | Cualquier certificado reconocido (puede ser el mismo); envíos solo a `prewww1`/`prewww10` | Pedro |

## Alternativas consideradas

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| Certificado como variable secreta de Timbal (solo `main` y `staging`) | Lo más simple; sin componente nuevo | La variable llega a todos los componentes, agentes incluidos; un fallo en una dependencia o una herramienta mal diseñada podría leerla; depende de la custodia de un tercero | **Respaldo** solo si AWS no está listo el 20-11-2026 y con certificado de sello |
| Emisor en el equipo del ejecutor local | El certificado no sale de casa | Si el equipo se apaga, no hay envío "instantáneo y continuado" (RRSIF art. 16.1); punto único de fallo | Rechazada para Verifactu |
| Proveedor externo o colaborador social | Sin certificado propio | Dependencia y coste; datos de facturas a un tercero | Rechazada (plan B es Holded completo, ADR 004) |
| HSM dedicado (CloudHSM) | Clave no exportable | Coste desproporcionado (cientos de €/mes) | Rechazada |

## Consecuencias

- Componente nuevo (`sender/`, unas 300 líneas) y un despliegue más en la CI; coste ≈ 1–2 €/mes (Lambda dentro del nivel gratuito, Secrets Manager y KMS).
- El certificado de mayor riesgo nunca está en Timbal ni al alcance de los agentes.
- Depende de la cuenta de AWS (Q-027), que ya hace falta para RDS (ADR 002).
- Preguntas a Pedro: Q-006 (tipo de certificado y apoderamiento de P.O), aplazada por Pedro: se decide al final y como tarde el **15-12-2026**. Mientras, el emisor se desarrolla y se prueba con un certificado reconocido de pruebas en el entorno de pruebas.
