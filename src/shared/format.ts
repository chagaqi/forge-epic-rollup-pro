/** Formatting shared by exports and the UI so numbers read the same everywhere. */

export function hours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

export function formatHours(seconds: number): string {
  const h = hours(seconds);
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatPercent(v: number | null): string {
  return v === null ? 'n/a' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function formatPoints(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
