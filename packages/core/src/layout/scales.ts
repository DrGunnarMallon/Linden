// Scales and tick helpers — see SPEC.md §6.

/** Shared y scale: data (depth) → mm from the top of the plot area. */
export interface YScale {
  domain: [number, number];
  height: number;
  /** true = values increase downwards. */
  reverse: boolean;
  toMm(value: number): number;
}

export function makeYScale(domain: [number, number], height: number, reverse: boolean): YScale {
  const [d0, d1] = domain;
  const span = d1 - d0 || 1;
  return {
    domain,
    height,
    reverse,
    toMm(v) {
      const t = (v - d0) / span;
      return (reverse ? t : 1 - t) * height;
    },
  };
}

/** Removes float noise such as 0.30000000000000004. */
export function clean(n: number): number {
  return Number(n.toPrecision(12));
}

export function formatNumber(n: number): string {
  return String(clean(n) === 0 ? 0 : clean(n));
}

/** 1, 2 or 5 × 10^k giving roughly `target` intervals over `span`. */
export function niceStep(span: number, target: number): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}

/** Multiples of `step` within [lo, hi] (inclusive, with float tolerance). */
export function ticksAt(lo: number, hi: number, step: number): number[] {
  if (!(step > 0) || hi < lo) return [];
  const eps = 1e-9 * Math.max(1, Math.abs(hi), Math.abs(lo));
  const first = Math.ceil((lo - eps) / step);
  const last = Math.floor((hi + eps) / step);
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(clean(k * step));
  return out;
}

/** Piecewise-linear interpolation; xs ascending. undefined outside [xs[0], xs[n-1]] (no extrapolation). */
export function interpolate(xs: readonly number[], ys: readonly number[], x: number): number | undefined {
  const n = xs.length;
  if (n === 0 || x < xs[0]! || x > xs[n - 1]!) return undefined;
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (x >= x0 && x <= x1) {
      return x1 === x0 ? ys[i]! : ys[i]! + ((x - x0) / (x1 - x0)) * (ys[i + 1]! - ys[i]!);
    }
  }
  return ys[n - 1];
}

/**
 * Common-scale family of a variable: columns share mm per unit only within the same kind and unit,
 * so e.g. percentages and counts never share a scale.
 */
export function scaleKey(v: { kind: string; unit?: string }): string {
  return `${v.kind}|${v.unit ?? ""}`;
}

/** Smallest 1, 2 or 5 × 10^k that is ≥ x (1 for x ≤ 0). */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(x));
  const f = [1, 2, 5, 10].find((m) => m * mag >= x * (1 - 1e-12))!;
  return clean(f * mag);
}

/**
 * Value range drawn as wide as 100 % for a scale family: 100 for percentage kinds, else the
 * family's maximum rounded up to a nice number. mm per unit = xScale × 100 / range.
 */
export function referenceRange(kind: string, max: number): number {
  return kind === "percent" || kind === "volumePercent" ? 100 : niceCeil(max);
}
