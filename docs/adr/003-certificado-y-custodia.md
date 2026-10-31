# ADR 003 · Certificado electrónico y su custodia (en Timbal)

- **Estado**: propuesto. **Q-006 aplazada por decisión de Pedro**: se decide al final, antes de activar Verifactu en producción (M4). Todo en Timbal, sin AWS (decisión de Pedro, 31-10-2026).
- **Relacionado**: ADR 002 (datos), ADR 004 (Verifactu), ADR 009 (ejecutor local), `04-regulatorio/verifactu.md` §10, `07-arquitectura.md` §10.

## Contexto

- WineCore necesita certificado para dos cosas: (1) **Verifactu**, envío automático y desatendido de los registros por servicio web (M4); (2) **portales** (SILICIE, EMCS, modelos y quizá SISV), con trabajos aprobados uno a uno que hace el ejecutor local (ADR 009).
- **HECHO** (Orden HAC/1177/2024, art. 5): vale cualquier certificado válido en la sede de la AEAT; puede enviar el propio obligado o un tercero con apoderamiento o colaboración social. La AEAT tiene un servicio específico para **certificados de sello** (`www10`).
- **HECHO** (documentación de Timbal): las variables secretas son del proyecto y se asignan a entornos (`env_ids`); dentro de un entorno llegan a **todos** sus componentes, agentes incluidos. Cada entorno puede desactivar componentes (`deploy_mode: disabled`).
- El certificado de P.O es personal y permite cualquier trámite en su nombre (R7).

## Decisión (propuesta)

1. **Dos zonas de custodia**:
   - **Entorno `verifactu` del proyecto 3942**: solo corre el emisor (`api/` con `WINECORE_ROLE=verifactu-sender`); la UI y la workforce están desactivadas en ese entorno. El certificado dedicado (preferible un **sello electrónico de CVPO**) es una variable secreta asignada **solo** a ese entorno. Otro entorno `verifactu-pruebas` igual, con un certificado de pruebas, para la preproducción de la AEAT.
   - **Equipo del ejecutor local**: el certificado de P.O, en el llavero del sistema; nunca sale de ese equipo.
2. El emisor **no genera** registros ni huellas (eso lo hace el núcleo al emitir): solo lee los pendientes de la Knowledge Base, los envía y anota el resultado.
3. **P.O**: preferible que apodere a CVPO para el trámite de Verifactu y que un solo certificado envíe por ambas (confirmar con el asesor); alternativa: P.O sigue en Holded hasta resolverlo.
4. **Antes de usarlo** se comprueba que una variable con `env_ids` no aparece en los demás entornos (prueba en TASK-INFRA-009).
5. **Ciclo de vida**: lo sube Pedro desde la consola de Timbal (nadie más ve el fichero ni la contraseña); aviso de caducidad 30 días antes; ante un incidente, revocación ante el prestador, borrado de la variable y revisión de los envíos.

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| Certificado en el entorno principal | Llegaría a los agentes y a todos los componentes |
| Emisor en el equipo del ejecutor local | Si el equipo se apaga, no hay envío continuo e inmediato (RRSIF art. 16.1) |
| Proveedor externo de envío | Dependencia y datos de facturas en manos de un tercero |
| AWS (versión anterior de este ADR) | Pedro decide no usar AWS |

## Consecuencias

- Un entorno más en Timbal (`verifactu`, y `verifactu-pruebas` para la preproducción), con su coste según el plan.
- Nada de esto bloquea el desarrollo hasta M4: Verifactu sale de la ruta crítica (decisión de Pedro, 31-10-2026).
