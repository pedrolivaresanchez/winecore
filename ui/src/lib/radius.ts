/**
 * Concentric corner solver.
 *
 * When a rounded element sits inside a padded rounded container, the corners
 * only look right when both arcs share a center: outer = inner + padding.
 * This solves the inverse (inner from outer) numerically, per the reference
 * implementation: sample the -padding level set of the outer corner's SDF
 * along the angular sweep, then fit a circle to those samples by gradient
 * descent. It converges to outerRadius - padding.
 */
export function innerRadius(
  outerRadius: number,
  padding: number,
  { lr = 0.1, epochs = 5000 }: { lr?: number; epochs?: number } = {},
): number {
  // SDF of a circular corner of radius R centered at (R, R)
  const sdf = (x: number, y: number) => Math.hypot(x - outerRadius, y - outerRadius) - outerRadius

  // Sample the -padding level set along the corner's angular sweep
  const targets: [number, number][] = []
  for (let t = Math.PI; t <= 1.5 * Math.PI; t += 0.01) {
    // March along the ray from the corner center until sdf == -padding
    let r = outerRadius
    for (let i = 0; i < 100; i++) {
      const x = outerRadius + r * Math.cos(t)
      const y = outerRadius + r * Math.sin(t)
      r -= sdf(x, y) + padding // Newton-ish
    }
    targets.push([outerRadius + r * Math.cos(t), outerRadius + r * Math.sin(t)])
  }

  // Fit a circle (center fixed at the known concentric center) to those points
  let R = outerRadius // initial guess: the wrong answer
  for (let e = 0; e < epochs; e++) {
    let grad = 0
    for (const [x, y] of targets) {
      const d = Math.hypot(x - outerRadius, y - outerRadius)
      grad += 2 * (R - d) // d/dR of (R - d)^2
    }
    R -= lr * (grad / targets.length)
  }
  return R
}

const cache = new Map<string, number>()

/** Memoized inner radius for nested elements, in px. */
export function nestedRadius(outerRadius: number, padding: number): number {
  const key = `${outerRadius}:${padding}`
  let value = cache.get(key)
  if (value === undefined) {
    value = Math.max(0, innerRadius(outerRadius, padding))
    cache.set(key, value)
  }
  return value
}
