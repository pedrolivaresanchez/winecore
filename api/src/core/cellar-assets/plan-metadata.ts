/**
 * Convención del plano de bodega.
 * El origen es la esquina superior izquierda. La x crece hacia la derecha
 * y la y hacia abajo, en unidades de plano (no milímetros). El lienzo de
 * referencia mide 1000 por 640. La rotación va en grados, en sentido horario.
 */
export const PLAN_METADATA = {
  coordinates: {
    origin: 'top_left',
    unit: 'plan',
    x_axis: 'right',
    y_axis: 'down',
    rotation: 'degrees_clockwise',
    reference_width: 1000,
    reference_height: 640,
    description_es:
      'El origen es la esquina superior izquierda del plano. La x crece hacia la derecha y la y hacia abajo, en unidades de plano (el lienzo de referencia mide 1000 por 640). La rotación está en grados, en sentido horario.',
  },
} as const;

export type PlanMetadata = typeof PLAN_METADATA;
