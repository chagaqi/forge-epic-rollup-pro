import { daysBetween, isIsoDate, todayIn } from '../../src/engine/dates';
import { clamp01, largestRemainderPercents, ratioPercent } from '../../src/engine/percent';

describe('largestRemainderPercents', () => {
  it.each([
    [[1, 1, 1], [34, 33, 33]],
    [[2, 2, 3], [29, 28, 43]],
    [[1, 0, 0], [100, 0, 0]],
    [[0, 0, 0], [0, 0, 0]],
    [[1, 2, 3, 4, 5, 6, 7], [4, 7, 11, 14, 18, 21, 25]],
  ])('%j -> %j and always sums to 100 (or 0)', (input, expected) => {
    const out = largestRemainderPercents(input);
    expect(out).toEqual(expected);
    const sum = out.reduce((a, b) => a + b, 0);
    expect(sum).toBe(input.some((v) => v > 0) ? 100 : 0);
  });

  it('sums to 100 for many random inputs', () => {
    for (let i = 0; i < 200; i++) {
      const values = Array.from({ length: 1 + (i % 9) }, (_, j) => ((i * 31 + j * 17) % 23) + 1);
      expect(largestRemainderPercents(values).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
});

describe('ratioPercent / clamp01', () => {
  it('returns null for an empty whole and one decimal otherwise', () => {
    expect(ratioPercent(1, 0)).toBeNull();
    expect(ratioPercent(1, 3)).toBe(33.3);
    expect(ratioPercent(2, 2)).toBe(100);
    expect(ratioPercent(10030, 20000)).toBe(50.2); // half-up despite binary floating point
  });
  it('clamps and treats NaN as 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('dates', () => {
  it('computes today in the site time zone', () => {
    const late = new Date('2026-10-16T23:30:00Z');
    expect(todayIn(late, 'UTC')).toBe('2026-10-16');
    expect(todayIn(late, 'Australia/Sydney')).toBe('2026-10-17');
    expect(todayIn(late, 'America/Los_Angeles')).toBe('2026-10-16');
  });
  it('falls back to UTC for an invalid zone', () => {
    expect(todayIn(new Date('2026-10-16T23:30:00Z'), 'Not/AZone')).toBe('2026-10-16');
  });
  it('counts whole days', () => {
    expect(daysBetween('2026-10-10', '2026-10-16')).toBe(6);
    expect(daysBetween('2026-10-16', '2026-10-10')).toBe(-6);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // across DST in Europe: UTC math is immune
    expect(daysBetween('garbage', '2026-10-10')).toBe(0);
  });
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-10-16')).toBe(true);
    expect(isIsoDate('16/10/2026')).toBe(false);
  });
});
