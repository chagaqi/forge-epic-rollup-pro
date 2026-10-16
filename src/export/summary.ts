import type { DistributionBucket, RiskItem, RollupResult } from '../shared/contract';
import { daysBetween } from '../engine/dates';
import { formatHours, formatMoney, formatPercent, formatPoints } from '../shared/format';

/** The executive summary as structured sections, rendered to Markdown or HTML below. */
interface Summary {
  title: string;
  subtitle: string;
  headline: Array<[string, string]>;
  status: DistributionBucket[];
  factors: RollupResult['risk']['factors'];
  blocked: RiskItem[];
  overdue: RiskItem[];
  recommendations: string[];
  scope: string;
}

function build(r: RollupResult): Summary {
  const t = r.totals;
  const sp = t.storyPoints;
  const forecastSeconds = t.time.timeSpentSeconds + t.time.remainingEstimateSeconds;
  const variance = t.time.varianceSeconds;
  const headline: Array<[string, string]> = [
    ['Progress (issues)', `${formatPercent(t.progress.byCount)} (${t.doneCount} of ${t.issueCount} done)`],
    ['Progress (story points)', sp.total > 0 ? `${formatPercent(t.progress.byStoryPoints)} (${formatPoints(sp.done)} of ${formatPoints(sp.total)} pts)` : 'No story points'],
    [
      'Time',
      `${formatHours(t.time.timeSpentSeconds)} spent, ${formatHours(t.time.remainingEstimateSeconds)} remaining, ` +
        `${formatHours(t.time.originalEstimateSeconds)} originally estimated` +
        (t.time.originalEstimateSeconds > 0
          ? ` (forecast ${formatHours(forecastSeconds)}, ${variance < 0 ? `${formatHours(-variance)} over` : `${formatHours(variance)} under`})`
          : ''),
    ],
  ];
  const c = r.cost;
  if (c.enabled && c.visible) {
    let cost = `${formatMoney(c.totals.actual, c.currency)} actual, ${formatMoney(c.totals.forecast, c.currency)} forecast at completion`;
    if (c.budget) {
      cost += `; budget ${formatMoney(c.budget.amount, c.currency)} (${formatPercent(c.budgetBurnPercent)} burned, ${
        (c.forecastVariance ?? 0) < 0 ? `${formatMoney(-(c.forecastVariance ?? 0), c.currency)} forecast overrun` : `${formatMoney(c.forecastVariance ?? 0, c.currency)} headroom`
      })`;
    }
    headline.push(['Cost', cost]);
  }
  if (r.root.dueDate) {
    const days = daysBetween(r.today, r.root.dueDate);
    headline.push(['Due date', `${r.root.dueDate} (${days >= 0 ? `${days} days left` : `${-days} days overdue`})`]);
  }
  headline.push(['Dependency risk', `${r.risk.level} (${r.risk.score}/100)`]);

  const h = r.hierarchy;
  const parts = [
    h.levels.aboveEpic ? `${h.levels.aboveEpic} above-epic` : '',
    h.levels.epics ? `${h.levels.epics} epic${h.levels.epics === 1 ? '' : 's'}` : '',
    `${h.levels.standard} standard issue${h.levels.standard === 1 ? '' : 's'}`,
    `${h.levels.subtasks} subtask${h.levels.subtasks === 1 ? '' : 's'}`,
  ].filter(Boolean);
  const scope =
    `${parts.join(', ')} across ${h.projectStyles.join(' and ')} projects.` + (h.truncated ? ' Large hierarchy: results were truncated at the safety limit.' : '');

  return {
    title: `Executive Summary: ${r.root.key} ${r.root.summary}`,
    subtitle: `Generated ${r.generatedAt.slice(0, 10)} · ${r.root.issueType} · ${r.root.status}`,
    headline,
    status: r.statusDistribution.byCategory,
    factors: r.risk.factors,
    blocked: r.risk.blocked,
    overdue: r.risk.overdue,
    recommendations: r.risk.recommendations,
    scope,
  };
}

const mdText = (s: string) => s.replace(/([\\`*_[\]<>|#])/g, '\\$1').replace(/\r?\n/g, ' ');

export function rollupToMarkdown(r: RollupResult): string {
  const s = build(r);
  const out: string[] = [`# ${mdText(s.title)}`, '', `_${mdText(s.subtitle)}_`, '', '## Headline', ''];
  out.push('| Metric | Value |', '| --- | --- |', ...s.headline.map(([k, v]) => `| ${mdText(k)} | ${mdText(v)} |`), '');
  out.push('## Status distribution', '', '| Category | Issues | Share | Story points | Share |', '| --- | ---: | ---: | ---: | ---: |');
  out.push(...s.status.map((b) => `| ${b.label} | ${b.count} | ${b.percent}% | ${formatPoints(b.storyPoints)} | ${b.storyPointPercent}% |`), '');
  out.push('## Dependency risk', '', '| Factor | Weight | Contribution | Detail |', '| --- | ---: | ---: | --- |');
  out.push(...s.factors.map((f) => `| ${f.label} | ${f.weight} | ${f.contribution} | ${mdText(f.detail)} |`), '');
  const list = (title: string, items: RiskItem[]) => {
    if (!items.length) return;
    out.push(`### ${title} (${items.length})`, '');
    out.push(...items.map((i) => `- **${i.key}** ${mdText(i.summary)}: ${mdText(i.reason)}${i.assignee ? ` (${mdText(i.assignee)})` : ''}`), '');
  };
  list('Blocked', s.blocked);
  list('Overdue', s.overdue);
  if (s.recommendations.length) out.push('## Recommended actions', '', ...s.recommendations.map((x, i) => `${i + 1}. ${mdText(x)}`), '');
  out.push('## Scope', '', mdText(s.scope), '');
  return out.join('\n');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const LEVEL_COLORS: Record<string, string> = { LOW: '#1f845a', MEDIUM: '#b38600', HIGH: '#c25100', CRITICAL: '#c9372c' };

/** Self-contained, printable HTML (no external assets, so it opens offline and prints to PDF cleanly). */
export function rollupToHtml(r: RollupResult): string {
  const s = build(r);
  const e = escapeHtml;
  const rows = (cells: string[][]) => cells.map((c) => `<tr>${c.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('');
  const items = (title: string, list: RiskItem[]) =>
    list.length
      ? `<h3>${e(title)} (${list.length})</h3><ul>${list
          .map((i) => `<li><strong>${e(i.key)}</strong> ${e(i.summary)}: ${e(i.reason)}${i.assignee ? ` (${e(i.assignee)})` : ''}</li>`)
          .join('')}</ul>`
      : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(s.title)}</title>
<style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#172b4d;max-width:880px;margin:32px auto;padding:0 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #dfe1e6;padding-bottom:4px}h3{font-size:15px}
.sub{color:#626f86;margin:0 0 16px}.badge{display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;font-weight:600;background:${LEVEL_COLORS[r.risk.level]}}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ebecf0;padding:6px 8px;text-align:left;vertical-align:top}th{color:#626f86;font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}@media print{body{margin:0}}
</style></head><body>
<h1>${e(s.title)}</h1>
<p class="sub">${e(s.subtitle)} · <span class="badge">${e(r.risk.level)} risk ${r.risk.score}/100</span></p>
<h2>Headline</h2><table>${rows(s.headline.map(([k, v]) => [`<strong>${e(k)}</strong>`, e(v)]))}</table>
<h2>Status distribution</h2><table><tr><th>Category</th><th>Issues</th><th>Share</th><th>Story points</th><th>Share</th></tr>${s.status
    .map(
      (b) =>
        `<tr><td>${e(b.label)}</td><td class="n">${b.count}</td><td class="n">${b.percent}%</td><td class="n">${formatPoints(b.storyPoints)}</td><td class="n">${b.storyPointPercent}%</td></tr>`,
    )
    .join('')}</table>
<h2>Dependency risk</h2><table><tr><th>Factor</th><th>Weight</th><th>Contribution</th><th>Detail</th></tr>${s.factors
    .map((f) => `<tr><td>${e(f.label)}</td><td class="n">${f.weight}</td><td class="n">${f.contribution}</td><td>${e(f.detail)}</td></tr>`)
    .join('')}</table>
${items('Blocked', s.blocked)}${items('Overdue', s.overdue)}
${s.recommendations.length ? `<h2>Recommended actions</h2><ol>${s.recommendations.map((x) => `<li>${e(x)}</li>`).join('')}</ol>` : ''}
<h2>Scope</h2><p>${e(s.scope)}</p>
</body></html>
`;
}
