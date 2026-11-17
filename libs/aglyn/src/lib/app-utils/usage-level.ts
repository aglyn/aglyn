/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * STAFF USAGE LEVEL (AGL-4228).
 *
 * How much an account, a workspace or a site actually uses the platform, as
 * a member of staff judged it after looking. It is a category staff pick, not
 * a measurement, and it is never "real" or "fake": everybody who signs up is
 * a real person, they just use the platform to very different degrees.
 *
 * Stored on the thing itself — `users/{uid}`, `orgs/{orgId}`, `hosts/{hostId}`
 * — as `usageLevel`, beside who set it and when. Only staff write it, through
 * `/api/admin/usage-level`; the security rules deny every client write to the
 * three keys.
 *
 * `unreviewed` is stored, never left out, on workspaces and sites: the staff
 * lists filter by equality on it, and a query cannot find a document by a
 * field it lacks. `createOrganization` and `provisionHost` write it at birth,
 * and `tools/scripts/backfill-usage-level.mjs` stamped the ones made before.
 * Accounts are listed from Firebase Auth rather than a query, so an account
 * with no `users/{uid}.usageLevel` simply reads as not reviewed.
 */

/** Where the level is stored, on all three. */
export const USAGE_LEVEL_FIELD = 'usageLevel'
/** When staff last set it (a server timestamp). */
export const USAGE_LEVEL_AT_FIELD = 'usageLevelAt'
/** Which member of staff last set it (their uid). */
export const USAGE_LEVEL_BY_FIELD = 'usageLevelBy'

/** Every key only staff may write. */
export const USAGE_LEVEL_KEYS = [
  USAGE_LEVEL_FIELD,
  USAGE_LEVEL_AT_FIELD,
  USAGE_LEVEL_BY_FIELD,
] as const

/** Least use first; `unreviewed` is where everything starts. */
export const USAGE_LEVELS = ['unreviewed', 'trying', 'building', 'live', 'power'] as const

export type UsageLevel = (typeof USAGE_LEVELS)[number]

/** The level every new workspace and site is born with. */
export const DEFAULT_USAGE_LEVEL: UsageLevel = 'unreviewed'

/** The levels staff pick, which each mark the thing reviewed. */
export const REVIEWED_USAGE_LEVELS = USAGE_LEVELS.filter(
  (level): level is Exclude<UsageLevel, 'unreviewed'> => level !== 'unreviewed',
)

/** What staff read: the chip, the select, the filter. */
export const USAGE_LEVEL_LABELS: Readonly<Record<UsageLevel, string>> = {
  unreviewed: 'Not reviewed',
  trying: 'Trying it out',
  building: 'Building',
  live: 'Live and using it',
  power: 'Power user',
}

/** One line on what each level means, shown under the select. */
export const USAGE_LEVEL_DESCRIPTIONS: Readonly<Record<UsageLevel, string>> = {
  unreviewed: 'Nobody on staff has looked yet.',
  trying: 'Signed up and looked around; little or nothing of their own built.',
  building: 'Putting their own content in; not live or not used yet.',
  live: 'Published their own site and using it for their business.',
  power: 'Runs their business on the platform: several sites, daily use, or selling through it.',
}

/** The chip's MUI color, so the five read apart at a glance. */
export const USAGE_LEVEL_COLORS: Readonly<
  Record<UsageLevel, 'default' | 'info' | 'warning' | 'success' | 'secondary'>
> = {
  unreviewed: 'default',
  trying: 'info',
  building: 'warning',
  live: 'success',
  power: 'secondary',
}

/** The filter's answers, least use first. */
export const USAGE_LEVEL_FILTER_OPTIONS: ReadonlyArray<{ value: UsageLevel; label: string }> =
  USAGE_LEVELS.map((value) => ({ value, label: USAGE_LEVEL_LABELS[value] }))

export function isUsageLevel(value: unknown): value is UsageLevel {
  return typeof value === 'string' && (USAGE_LEVELS as readonly string[]).includes(value)
}

/** A stored value as a level: anything missing or unknown is not reviewed. */
export function readUsageLevel(value: unknown): UsageLevel {
  return isUsageLevel(value) ? value : DEFAULT_USAGE_LEVEL
}

/** The three things staff set a level on. */
export const USAGE_LEVEL_TARGETS = ['user', 'org', 'site'] as const
export type UsageLevelTarget = (typeof USAGE_LEVEL_TARGETS)[number]

/** The collection each target's level lives in. */
export const USAGE_LEVEL_COLLECTIONS: Readonly<Record<UsageLevelTarget, string>> = {
  user: 'users',
  org: 'orgs',
  site: 'hosts',
}
