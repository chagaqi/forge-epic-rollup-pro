/**
 * Integer percentages that always sum to exactly 100 (largest remainder method),
 * so a stacked status bar never renders 99% or 101%.
 */
export function largestRemainderPercents(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let leftover = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    leftover--;
  }
  return floors;
}

/** part/whole as a 0..100 number with one decimal, or null when whole is 0. */
export function ratioPercent(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  // Multiply before dividing: (10030 / 20000) * 1000 is 501.4999… in floating point, 10030 * 1000 / 20000 is exactly 501.5.
  return Math.round((part * 1000) / whole) / 10;
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
