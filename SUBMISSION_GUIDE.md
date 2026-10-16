# Epic Rollup Pro: Atlassian Marketplace Submission Guide

This guide takes the repository from a green CI build to a live, paid, **Runs on Atlassian** listing. Items marked **☐** are manual steps for the vendor account owner.

---

## 1. Positioning

**Opportunity (from the scraped Marketplace data behind this project).** The Atlassian Marketplace has the best demand-to-competition ratio in the data set (≈3,838 installs per app). The closest incumbent, *ESU Lite: Epic reports for time, status & resolution values*, has **2,817 installs and a 2.99★ rating**. Its reviews cluster around three gaps, and each one maps to a feature here:

| Incumbent complaint | Epic Rollup Pro answer | Where in the code |
| --- | --- | --- |
| Breaks on team-managed (next-gen) projects | Hierarchy walked via `parent` JQL and `issuetype.hierarchyLevel`; legacy Epic Link only as a de-duplicated fallback; renamed epic types (e.g. *Feature*) and project-scoped statuses handled | `src/jira/hierarchy.ts`, `src/engine/normalize.ts` |
| "No export function" | One-click CSV, Markdown and printable HTML executive summary | `src/export/` |
| No cost / budget view | Rates in Forge KVS, worklog-author costing, budget burn, forecast at completion | `src/engine/cost.ts` |
| *(new)* No early warning | Dependency risk score with factor breakdown and recommended actions | `src/engine/risk.ts` |

**Economics.** Atlassian's 2026 revenue share update applies a **0% revenue share until a partner reaches $1M lifetime Forge revenue**. The threshold is measured across all of a partner's Forge apps; after it, the standard Forge rate applies. Qualifying Runs on Atlassian apps also get the 100% revenue share discount. To count as a Forge app, an app must contain no Connect modules, use OAuth, and use Forge UI; this app meets all three. Re-check the current terms before pricing:
<https://www.atlassian.com/blog/developer/updates-to-marketplace-revenue-share-2026>

---

## 2. Runs on Atlassian eligibility

The badge is awarded automatically, not applied for. Atlassian's criteria and how this app meets them:

| Criterion | Status |
| --- | --- |
| Runs only on Atlassian-hosted compute and storage | ✅ Forge functions + Forge KVS (`@forge/kvs`). No `remotes`, no Connect, no Forge Remote. |
| Data residency matches the host product | ✅ All app data is in Forge hosted storage; issue data never leaves Jira. |
| No egress of data | ✅ No `permissions.external`. The UI loads no external scripts, fonts or images (enforced by `tests/integration/manifest.test.ts`, which also greps the source for `fetch`, `XMLHttpRequest`, `WebSocket` and URLs). |
| Minimal scopes | ✅ Exactly `read:jira-work` and `storage:app` (test-enforced). |

**☐ Verify on the deployed production version:**

```bash
forge deploy -e production
forge eligibility -e production   # must report eligible for Runs on Atlassian
```

Anything that adds egress, such as analytics, error reporting, a CDN font or a remote, can cost the badge. Keep it out, or confirm with `forge eligibility` before release.

---

## 3. Pre-submission technical checklist

1. **☐ Register the app** with `forge register`. This replaces the placeholder `app.id` (`ari:cloud:ecosystem::app/00000000-…`) in `manifest.yml`; commit the change.
2. **☐ Green build**: `npm ci && npm run verify`. This runs typecheck, the Custom UI and playground builds, manifest validation with Atlassian's `@forge/manifest`, a backend bundle with Forge's own webpack config plus a smoke test, and 181 tests.
3. **☐ Deploy & install to a test site**:
   ```bash
   npm run deploy -- -e production
   forge install --site <test-site>.atlassian.net --product jira -e production
   ```
4. **☐ Licensing**: `app.licensing.enabled: true` is set. Do not set `LICENSE_OVERRIDE` in production; the code ignores it there anyway. Test with the Marketplace's license tokens or a private listing:
   - active → full app; trial → banner showing the trial end date;
   - inactive / missing (production) → "License required" screen, and no Jira reads are performed.
5. **☐ Personal data reporting**: the `personal-data-report` scheduled trigger runs weekly. After the first week, check `forge logs -e production` for the `Personal data report:` line.
6. **☐ Manual QA on a real site.** Run each item on **one company-managed and one team-managed project**:
   - [ ] Issue panel on an epic: KPIs, status bar, risk panel, issue tree, exports download.
   - [ ] Issue panel on a story with subtasks, and on an issue with no children (graceful hint).
   - [ ] Company-managed epic with stories linked only via Epic Link (if the site still has the field).
   - [ ] Team-managed epic type renamed (e.g. to *Feature*) is still listed on the project page.
   - [ ] Plans hierarchy: Initiative → Epic → Story → Subtask rolls up (Premium sites).
   - [ ] A story with more than 20 worklogs costs every worklog at its author's rate.
   - [ ] Project admin: Settings tab saves rates; Cost & budget tab sets and clears a budget.
   - [ ] Non-admin: no Settings tab, no per-person cost, no budget editor; with *cost visibility = admins*, no cost figures at all.
   - [ ] User without permission on a child issue: that issue is absent from the rollup and exports.
   - [ ] Dark mode (Jira theme) renders with design tokens.
   - [ ] Large epic (500+ issues) completes; above 1,500 issues the truncation banner appears.

---

## 4. Listing content

**App name:** Epic Rollup Pro: Time, Cost & Risk Reports
**Tagline (≤ 80 chars):** Epic rollups for every Jira project: time, story points, cost, risk & export

**Highlights**

1. **Works on team-managed and company-managed projects.** Epic → story → subtask rollups of estimates, time spent, remaining work and story points, with no Epic Link configuration.
2. **Know what an epic costs.** Hourly rates per person, budget burn, and forecast at completion, computed from real worklogs.
3. **See trouble early, share it in one click.** A dependency risk score with blocked and overdue lists, plus CSV and executive summary exports.

**Description bullets**

- Rolls up Original Estimate, Time Spent, Remaining Estimate and Story Points across Epics, child issues and subtasks, without double counting.
- Status distribution by category and workflow status, by issue count or story points.
- Billable cost with per-person rates, non-billable labels and per-epic budgets; cost visibility can be restricted to project admins.
- Dependency risk score (0–100) from blocked links, flags, overdue work, schedule pressure, estimate overruns, unestimated work and budget overrun, with recommended actions.
- One-click CSV (Excel-ready) and executive summary (Markdown / printable HTML).
- Project page lists every epic in the project (including renamed team-managed epic types) with a full rollup.
- **Runs on Atlassian**: no data leaves Atlassian, only two permissions, and every view respects the viewer's Jira permissions.

**Keywords:** epic report, rollup, time tracking, story points, budget, cost, burn, risk, dependencies, export, CSV, team-managed, next-gen

**☐ Screenshots** (1840×900 recommended). Capture them from the playground, which runs the production code against realistic fixtures: `npm run playground:preview`.

| # | URL (append to `/playground/`) | Shows |
| --- | --- | --- |
| 1 | `?dataset=classic&module=issuePanel&license=ACTIVE&admin=true` | Hero: KPIs, status bar, risk panel |
| 2 | same, *Issues* tab | Hierarchy table with signals |
| 3 | same, *Cost & budget* tab | Budget burn, per-person cost |
| 4 | `?dataset=nextgen&module=issuePanel&license=ACTIVE&admin=true` + Dark mode | Team-managed epic ("Feature"), dark theme |
| 5 | `?dataset=classic&module=projectPage&license=ACTIVE&admin=true` | Project page epic list |
| 6 | An exported HTML executive summary opened in a browser | Export |

Use only fixture data, which is fictional; never screenshot a customer site.

**☐ Pricing**: per-user tiers, set in the Marketplace pricing tab. Enable the free 30-day trial; the app's TRIAL state shows the trial end date.

---

## 5. Privacy & Security tab answers

| Question | Answer |
| --- | --- |
| Does the app store data outside Atlassian? | No. Forge hosted storage only. |
| What end-user data is stored? | Project settings (currency, hourly rates keyed by Atlassian account id, non-billable labels, visibility flags), per-issue budgets, a cache of custom field ids, and the account id of whoever last changed settings or budgets. No issue content is stored. |
| Personal data | Atlassian account ids only. Reported weekly through the Forge personal data reporting API; closed accounts are erased from rates and audit fields (`src/privacy/`). |
| Data in transit / at rest | Handled by the Forge platform (TLS, Atlassian-managed encryption). |
| Egress | None. |
| Access control | All Jira reads use the viewing user's permissions (`asUser`). Writes require *Administer Projects* on the project, checked server-side. |
| Logging | Only unexpected errors (no issue content) and the weekly privacy report summary. |
| Data retention / deletion | App data lives in Forge storage and follows Atlassian's retention rules for uninstalled apps. Budgets and settings can be cleared by project admins at any time. |
| Third-party subprocessors | None. |

**☐** Complete the Marketplace security self-assessment, and link a privacy policy and EULA (for example on the vendor site).

---

## 6. Known limits (document in the listing FAQ)

- Hierarchies are walked up to 4 levels below the opened issue and 1,500 issues. Beyond that, results are marked as truncated.
- Extra worklog pages (beyond the 20 Jira embeds) are fetched for up to 40 issues per rollup. Remaining unlogged time is costed at the assignee's rate.
- Costs use the current rates, not historical rates at the time the work was logged.
- "Overdue" uses the site time zone from the Jira context, falling back to UTC.
- Story points on epics are shown but never added to the rollup. Subtask story points are opt-in per project.

---

## 7. Release & versioning

- Forge major versions are created when scopes or egress change. Those require admin re-consent and can affect Runs on Atlassian, so keep the two-scope footprint.
- Tag releases (`vX.Y.Z`), and keep `CHANGELOG` entries in the PR description until a changelog file is introduced.
- Before every release: `npm run verify`, then `forge deploy -e staging`, smoke test, then `forge deploy -e production`, then `forge eligibility -e production`.
