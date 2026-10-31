# UI-25 · Operación de bodega

| | |
|---|---|
| Rutas | `/bodega/operaciones/nueva` · `/bodega/operaciones/:id` |
| Objetivo | Registrar una operación (recepción, prensado, fin de fermentación, trasiego, ensamblaje, filtración, adición, envasado, etiquetado, merma, destrucción, limpieza, toma de muestras) con conservación de volumen y sus efectos en libros, SISV y SILICIE |
| Historias | US-BOD-02/03/04/05/06/07/08/09/12/13, US-INV-06 |
| Módulo y permiso | cellar · borrador y confirmar `cellar.operate`; mermas por incidencia y destrucciones: aprobación `cellar_loss` |
| Patrón | Formulario guiado por tipo |

## Componentes
Selector de tipo (tarjetas con icono Nucleo), formulario con secciones **Entradas · Salidas · Merma** (`VolumeInput` en L con 3 decimales, unidades o kg según el caso), resumen de conservación en vivo ("Entra 5.000 L = sale 4.960 L + merma 40 L ✓"), vista previa de efectos (libro físico, fiscal, SISV, SILICIE), adjuntos (parte, foto).

## Datos (API)
- `POST /api/v1/cellar-operations` (borrador) · `PATCH` · `POST /api/v1/cellar-operations/{id}/confirm` (transacción: número, movimientos, aristas DAG, anotaciones SISV y movimientos fiscales).
- `POST /api/v1/cellar-operations/{id}/preview` → efectos sin guardar.
- `POST /api/v1/cellar-operations/{id}/rectify` (crea la operación rectificativa con motivo).

## Validaciones por tipo
| Tipo | Regla |
|---|---|
| Todos | Fecha no futura y no en periodo cerrado (`WC021`); recipiente con capacidad (`WC025`); un lote por recipiente (`WC026`) |
| Trasiego, ensamblaje, filtración, envasado | Entra = sale + merma (`WC020`) |
| Ensamblaje | Fórmula opcional (mL → %); crea lote nuevo y aristas DAG (`WC030`) |
| Envasado | Entrada en L; salida N unidades × volumen nominal; merma = diferencia (`WC023`); producto y lote envasado nuevo |
| Trasiego depósito ↔ barrica | Muestra "Cambio de mayor SILICIE (A17/A16)" en la vista previa |
| Merma por incidencia, destrucción | Motivo obligatorio y aprobación |
| Adición | Producto enológico apto en ecológico si el lote es ecológico; dosis y cantidad; factura de compra |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Guardar borrador | `cellar.operate` | — | — |
| Confirmar | `cellar.operate` | Efectos en libros y registros | `Dialog` con la vista previa de efectos |
| Rectificar (confirmada) | `cellar.operate` | Operación rectificativa + movimientos `reversal` | Motivo |

## Estados
Operación pendiente de aprobación (merma por incidencia): `StatusPill` "pendiente de aprobación"; no tiene efectos hasta aprobarse.

## Móvil
Uso principal en bodega: tipo → escanear recipiente origen → escanear destino → litros → confirmar. Funciona con conexión intermitente (cola local con aviso).

## Wireframe
```
Nueva operación · Trasiego                                  [Confirmar]
Entradas   INOX-03 · L25-T01 · 5.000,000 L
Salidas    BAR-012 · 225,000 L   BAR-013 · 225,000 L   INOX-05 · 4.510,000 L
Merma      lías · 40,000 L
✓ Entra 5.000 L = sale 4.960 L + merma 40 L
Efectos: físico ✓ · SISV: merma · SILICIE: A17/A16 450 L a CRIANZA-TINTO, A30 40 L
```
