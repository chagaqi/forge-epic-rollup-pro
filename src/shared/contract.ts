/**
 * Contract shared by the Forge resolver (backend) and the Custom UI (frontend).
 * Every resolver key the UI may `invoke()` is listed here; a contract test
 * asserts both sides stay in sync.
 */
export const RESOLVER_KEYS = [
  'getAppState',
  'getRollup',
  'listEpics',
  'exportRollup',
  'saveSettings',
  'saveBudget',
] as const;

export type ResolverKey = (typeof RESOLVER_KEYS)[number];

export type StatusCategory = 'new' | 'indeterminate' | 'done';
export type ProjectStyle = 'company-managed' | 'team-managed' | 'unknown';
export type LicenseState = 'ACTIVE' | 'TRIAL' | 'SANDBOX' | 'INACTIVE' | 'UNLICENSED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ExportFormat = 'csv' | 'markdown' | 'html';
export type CostVisibility = 'all' | 'admins';

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'LICENSE_INACTIVE'
  | 'JIRA_ERROR'
  | 'INTERNAL';

export interface LicenseInfo {
  state: LicenseState;
  /** Whether the app's features may be used in this state. */
  allowed: boolean;
  isEvaluation: boolean;
  trialEndDate: string | null;
  message: string;
}

export interface ProjectSettings {
  /** ISO 4217 currency code, e.g. USD. */
  currency: string;
  /** Hourly rate used when a person has no explicit rate. 0 disables costing. */
  defaultHourlyRate: number;
  /** accountId -> hourly rate. */
  userRates: Record<string, number>;
  /** Issues carrying any of these labels contribute hours but no cost. */
  nonBillableLabels: string[];
  /** Who sees cost figures. Per-person cost breakdowns are always admin-only. */
  costVisibility: CostVisibility;
  /** Count story points that are set directly on subtasks (off by default: boards ignore them). */
  includeSubtaskStoryPoints: boolean;
  /** Explicit story point field ids (customfield_NNNNN). Empty = auto-detect. */
  storyPointFieldIds: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface Budget {
  amount: number;
  currency: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface Person {
  accountId: string;
  displayName: string;
}

export interface Blocker {
  key: string;
  status: string;
  /** Link text from the blocked issue's point of view, e.g. "is blocked by". */
  relation: string;
}

export interface TimeTotals {
  originalEstimateSeconds: number;
  timeSpentSeconds: number;
  remainingEstimateSeconds: number;
  /** original - (spent + remaining). Negative = over the original estimate. */
  varianceSeconds: number;
}

export interface StoryPointTotals {
  total: number;
  done: number;
  remaining: number;
  estimatedIssues: number;
  unestimatedIssues: number;
}

export interface Progress {
  /** 0..100, or null when there is nothing to measure. */
  byCount: number | null;
  byStoryPoints: number | null;
  byTime: number | null;
}

export interface CostFigures {
  /** Amounts in major currency units, rounded to cents. */
  actual: number;
  remaining: number;
  forecast: number;
  billableSeconds: number;
  nonBillableSeconds: number;
}

export interface RollupNode {
  key: string;
  summary: string;
  issueType: string;
  hierarchyLevel: number;
  isSubtask: boolean;
  projectKey: string;
  projectStyle: ProjectStyle;
  status: string;
  statusCategory: StatusCategory;
  assignee: Person | null;
  dueDate: string | null;
  labels: string[];
  storyPoints: number | null;
  /** This issue's own values (not including descendants). */
  own: TimeTotals;
  /** This issue plus all descendants. */
  rollup: TimeTotals & { storyPoints: number; issueCount: number; doneCount: number };
  cost: CostFigures | null;
  flags: { blocked: boolean; overdue: boolean; flagged: boolean; overEstimate: boolean; nonBillable: boolean };
  blockers: Blocker[];
  daysOverdue: number;
  children: RollupNode[];
}

export interface DistributionBucket {
  key: string;
  label: string;
  category: StatusCategory;
  count: number;
  percent: number;
  storyPoints: number;
  storyPointPercent: number;
}

export interface CostSummary {
  enabled: boolean;
  visible: boolean;
  currency: string;
  totals: CostFigures;
  budget: Budget | null;
  /** actual / budget * 100 */
  budgetBurnPercent: number | null;
  /** budget - forecast. Negative = forecast overrun. */
  forecastVariance: number | null;
  /** Admin-only. Null when hidden. */
  byPerson: Array<{ accountId: string | null; displayName: string; hourlyRate: number; seconds: number; cost: number }> | null;
}

export interface RiskFactor {
  key: 'blocked' | 'overdue' | 'schedule' | 'overEstimate' | 'unestimated' | 'budget';
  label: string;
  weight: number;
  /** 0..1 severity */
  value: number;
  /** weight * value, rounded */
  contribution: number;
  detail: string;
}

export interface RiskItem {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  reason: string;
  daysOverdue: number;
  blockers: Blocker[];
}

export interface RiskSummary {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  blocked: RiskItem[];
  overdue: RiskItem[];
  recommendations: string[];
}

export interface HierarchyInfo {
  depth: number;
  issueCount: number;
  levels: { aboveEpic: number; epics: number; standard: number; subtasks: number };
  projectStyles: ProjectStyle[];
  /** Which parent-child strategies produced children. */
  sources: Array<'parent' | 'epic-link'>;
  truncated: boolean;
  storyPointFieldIds: string[];
}

export interface RollupResult {
  generatedAt: string;
  today: string;
  root: RollupNode;
  totals: {
    issueCount: number;
    doneCount: number;
    time: TimeTotals;
    storyPoints: StoryPointTotals;
    progress: Progress;
  };
  statusDistribution: { byCategory: DistributionBucket[]; byStatus: DistributionBucket[] };
  cost: CostSummary;
  risk: RiskSummary;
  hierarchy: HierarchyInfo;
}

export interface AppState {
  license: LicenseInfo;
  projectKey: string | null;
  issueKey: string | null;
  canConfigure: boolean;
  /** Full settings for admins; rates stripped for everyone else. */
  settings: ProjectSettings | null;
}

export interface EpicListItem {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  dueDate: string | null;
  assignee: Person | null;
}

export interface EpicList {
  projectKey: string;
  projectStyle: ProjectStyle;
  epics: EpicListItem[];
  nextPageToken: string | null;
}

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

export interface RollupResponse {
  rollup: RollupResult;
  license: LicenseInfo;
  canConfigure: boolean;
}

/** Response data type of each resolver, used by the typed UI client. */
export interface ResolverData {
  getAppState: AppState;
  getRollup: RollupResponse;
  listEpics: EpicList;
  exportRollup: ExportFile;
  saveSettings: ProjectSettings;
  saveBudget: Budget | null;
}
