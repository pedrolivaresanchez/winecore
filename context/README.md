# context/ — contexto del proyecto (versión publicable)

Esta carpeta contiene **solo contexto sin datos personales**. El contexto original (transcripción completa de la reunión, resumen de HappyScribe, handover de la administradora saliente, especificación previa e informe consolidado de CVBOT, plan maestro) contiene nombres, correos y teléfonos de terceros, importes y detalles fiscales. Por eso:

- vive **fuera de git**, en `data/context-raw/` (ignorado por `.gitignore`) en el equipo de quien trabaja con él, y en el almacenamiento privado que Pedro decida;
- aquí se publica un **resumen anonimizado** con el conocimiento de dominio necesario para implementar.

| Fichero | Contenido | Origen |
|---|---|---|
| `resumen-contexto.md` | Conocimiento de dominio anonimizado: proceso de bodega, comercial, facturación, regulatorio, logística y reglas operativas de la administración. Cada regla lleva su fuente (marca de tiempo de la reunión o mes del correo). | Reunión del 31-10-2026, handover, informe y especificación previa |
| `data_summary.md` | Estructura y volúmenes de los exports de Holded y Shopify, tal como llegó. **Ojo**: dice que la contabilidad solo cubre 2026; el export trae también 2022–2025 (ver `docs/00-triaje.md` H9). | Adjunto original (sin datos personales) |
| `mapping_holded_bacosoft.md` | Tabla de mapeo de funcionalidades tal como llegó. La versión verificada y vigente es `docs/05-mapeo-holded-bacosoft.md`. | Adjunto original (sin datos personales) |

Reglas:
1. Nada de `data/` se copia aquí.
2. Si alguien añade contexto, lo anonimiza antes: personas por su rol, sin correos, teléfonos, direcciones, NIF de personas, IBAN ni importes de clientes.
3. Los descuadres heredados concretos (depósitos, palets, fechas) se tratan en privado; la especificación solo los menciona de forma genérica.
