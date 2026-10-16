import type { ExportFile, ExportFormat, RollupResult } from '../shared/contract';
import { rollupToCsv } from './csv';
import { rollupToHtml, rollupToMarkdown } from './summary';

export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'markdown', 'html'];

export function exportRollup(result: RollupResult, format: ExportFormat): ExportFile {
  const base = `${result.root.key}_rollup_${result.today}`;
  switch (format) {
    case 'csv':
      return { filename: `${base}.csv`, mimeType: 'text/csv;charset=utf-8', content: rollupToCsv(result) };
    case 'markdown':
      return { filename: `${base}_summary.md`, mimeType: 'text/markdown;charset=utf-8', content: rollupToMarkdown(result) };
    case 'html':
      return { filename: `${base}_summary.html`, mimeType: 'text/html;charset=utf-8', content: rollupToHtml(result) };
  }
}
