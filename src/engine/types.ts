import type { Blocker, Person, ProjectStyle, StatusCategory } from '../shared/contract';

export interface WorklogEntry {
  author: Person | null;
  seconds: number;
}

/** A Jira issue reduced to what the rollup engine needs, independent of project type. */
export interface NormalizedIssue {
  id: string;
  key: string;
  summary: string;
  issueType: string;
  /** Jira hierarchy level: -1 subtask, 0 standard, 1 epic, 2+ above epic (Advanced Roadmaps / Plans). */
  hierarchyLevel: number;
  isSubtask: boolean;
  parentKey: string | null;
  projectKey: string;
  projectStyle: ProjectStyle;
  status: string;
  statusCategory: StatusCategory;
  assignee: Person | null;
  labels: string[];
  dueDate: string | null;
  storyPoints: number | null;
  originalEstimateSeconds: number;
  hasOriginalEstimate: boolean;
  timeSpentSeconds: number;
  remainingEstimateSeconds: number;
  worklogs: WorklogEntry[];
  /** False when Jira returned only a page of the issue's worklogs. */
  worklogsComplete: boolean;
  flagged: boolean;
  blockers: Blocker[];
}

/** Resolved ids of the site-specific custom fields the engine reads. */
export interface FieldMap {
  storyPoints: string[];
  epicLink: string | null;
  flagged: string | null;
}
