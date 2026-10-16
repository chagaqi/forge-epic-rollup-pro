import type { FieldMap } from '../engine/types';
import type { KeyValueStore } from '../storage/store';
import type { JiraApi, RawField } from './api';

const STORY_POINTS_TYPE = 'com.pyxis.greenhopper.jira:jsw-story-points'; // "Story point estimate"
const EPIC_LINK_TYPE = 'com.pyxis.greenhopper.jira:gh-epic-link';
const STORY_POINT_NAMES = ['story points', 'story point estimate'];

export const FIELD_CACHE_KEY = 'cache:fieldmap:v1';
export const FIELD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Resolve the site-specific custom field ids the engine needs.
 *
 * Company-managed (classic) projects traditionally estimate with the "Story Points" number
 * field and link stories to epics with "Epic Link". Team-managed (next-gen) projects use
 * "Story point estimate" and the native `parent` field. Sites often have all of them, so
 * every candidate is requested and the first populated one wins per issue.
 */
export function resolveFieldMap(fields: RawField[]): FieldMap {
  const named = (f: RawField) => STORY_POINT_NAMES.indexOf(f.name.trim().toLowerCase());
  const storyPoints = fields
    .filter((f) => f.schema?.custom === STORY_POINTS_TYPE || (named(f) >= 0 && f.schema?.type === 'number'))
    // Classic "Story Points" first, then "Story point estimate", then other jsw-story-points fields.
    .sort((a, b) => rank(named(a)) - rank(named(b)) || a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map((f) => f.id);
  const epicLink = fields.find((f) => f.schema?.custom === EPIC_LINK_TYPE)?.id ?? null;
  const flagged = fields.find((f) => f.name === 'Flagged' && f.custom)?.id ?? null;
  return { storyPoints: [...new Set(storyPoints)], epicLink, flagged };
}

function rank(nameIndex: number): number {
  return nameIndex < 0 ? STORY_POINT_NAMES.length : nameIndex;
}

export async function getFieldMap(
  api: JiraApi,
  store: KeyValueStore,
  now: Date,
  storyPointOverride: string[] = [],
): Promise<FieldMap> {
  let map: FieldMap | null = null;
  const cached = await store.get<{ at: number; map: FieldMap }>(FIELD_CACHE_KEY);
  if (cached && now.getTime() - cached.at < FIELD_CACHE_TTL_MS) {
    map = cached.map;
  } else {
    map = resolveFieldMap(await api.getFields());
    await store.set(FIELD_CACHE_KEY, { at: now.getTime(), map });
  }
  return storyPointOverride.length ? { ...map, storyPoints: storyPointOverride } : map;
}

export const BASE_FIELDS = [
  'summary',
  'issuetype',
  'parent',
  'project',
  'status',
  'assignee',
  'labels',
  'duedate',
  'timeoriginalestimate',
  'timespent',
  'timeestimate',
  'worklog',
  'issuelinks',
];

export function issueFields(map: FieldMap): string[] {
  return [...BASE_FIELDS, ...map.storyPoints, ...(map.epicLink ? [map.epicLink] : []), ...(map.flagged ? [map.flagged] : [])];
}
