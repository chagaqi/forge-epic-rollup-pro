import { classicDataset } from '../../fixtures/datasets';
import { csvCell, rollupToCsv, toCsvLine } from '../../src/export/csv';
import { exportRollup } from '../../src/export';
import { escapeHtml, rollupToHtml, rollupToMarkdown } from '../../src/export/summary';
import { normalizeIssue } from '../../src/engine/normalize';
import { computeRollup } from '../../src/engine/rollup';
import { resolveFieldMap } from '../../src/jira/fields';
import type { RollupResult } from '../../src/shared/contract';
import { epic, issue, NOW, settings, TODAY } from '../helpers/factories';

function rollupOf(issues = [epic('E-1', { summary: 'Launch <script>alert(1)</script> | pipes' }), issue('A-1', { parentKey: 'E-1', summary: '=HYPERLINK("http://evil")', labels: ['a', 'b'] })], costVisible = true): RollupResult {
  return computeRollup({
    rootKey: 'E-1',
    issues,
    settings: settings({ defaultHourlyRate: 50 }),
    budget: null,
    today: TODAY,
    generatedAt: NOW.toISOString(),
    costVisible,
    costBreakdownVisible: false,
    sources: ['parent'],
    truncated: false,
    storyPointFieldIds: [],
  });
}

describe('csv', () => {
  it('quotes and escapes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(-3)).toBe('-3'); // numbers are never treated as formulas
    expect(csvCell(Number.NaN)).toBe('');
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('neutralises formula injection in %j', (text) => {
    expect(csvCell(text).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('writes BOM, CRLF, header and a row per issue depth-first', () => {
    const csv = rollupToCsv(rollupOf());
    expect(csv.startsWith('﻿Depth,Key,Parent,Summary')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Rollup Actual Cost (USD)');
    expect(lines[1]!.startsWith('0,E-1,,Launch <script>alert(1)</script> | pipes,Epic')).toBe(true);
    expect(lines[2]!.startsWith(`1,A-1,E-1,"'=HYPERLINK(""http://evil"")"`)).toBe(true);
    expect(lines[2]!.endsWith(',a b')).toBe(true);
    expect(toCsvLine(['x', 1, null])).toBe('x,1,');
  });

  it('drops cost columns when costs are hidden', () => {
    const csv = rollupToCsv(rollupOf(undefined, false));
    expect(csv).not.toContain('Cost');
  });

  it('every row has as many cells as the header (classic fixture)', () => {
    const ds = classicDataset(NOW);
    const map = resolveFieldMap(ds.fields);
    const keys = ['CLS-1', 'CLS-2', 'CLS-3', 'CLS-4', 'CLS-5', 'CLS-6', 'CLS-7', 'CLS-8', 'CLS-9', 'CLS-10'];
    const issues = ds.issues.filter((i) => keys.includes(i.key)).map((i) => normalizeIssue(i, map));
    const r = computeRollup({ rootKey: 'CLS-1', issues, settings: settings({ defaultHourlyRate: 10 }), budget: null, today: TODAY, generatedAt: NOW.toISOString(), costVisible: true, costBreakdownVisible: true, sources: ['parent'], truncated: false, storyPointFieldIds: map.storyPoints });
    const rows = rollupToCsv(r).slice(1).trimEnd().split('\r\n');
    // No cell in this fixture contains commas or quotes, so a naive split is exact.
    const widths = new Set(rows.map((row) => row.split(',').length));
    expect(rows).toHaveLength(11);
    expect(widths.size).toBe(1);
  });
});

describe('executive summary', () => {
  it('markdown escapes table-breaking and markup characters', () => {
    const md = rollupToMarkdown(rollupOf());
    expect(md).toContain('# Executive Summary: E-1 Launch \\<script\\>alert(1)\\</script\\> \\| pipes');
    expect(md).toContain('## Headline');
    expect(md).toContain('| Dependency risk | LOW (');
    expect(md).toContain('## Status distribution');
    expect(md).toContain('| To Do | 1 | 100% | 0 | 0% |');
  });

  it('html is self-contained and escapes user text (no XSS)', () => {
    const html = rollupToHtml(rollupOf());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<script>');
    expect(html).toContain('Launch &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<link|src=|https?:\/\/(?!evil)/); // no external assets
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('names files after the root and date', () => {
    const r = rollupOf();
    expect(exportRollup(r, 'csv')).toMatchObject({ filename: 'E-1_rollup_2026-10-16.csv', mimeType: 'text/csv;charset=utf-8' });
    expect(exportRollup(r, 'markdown').filename).toBe('E-1_rollup_2026-10-16_summary.md');
    expect(exportRollup(r, 'html').mimeType).toBe('text/html;charset=utf-8');
  });
});
