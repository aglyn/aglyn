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

/**
 * Release flags (AGL-227): platform-level "is this feature launched"
 * gating backed by Firebase Remote Config. A separate axis from plan
 * entitlements (`plan-entitlements.ts`) — entitlements ask whether the
 * tenant's PLAN includes a feature, release flags ask whether the feature
 * is released to the public at all (or partially, via percentage rollout).
 * Staff bypass release flags everywhere but see a flagged warning.
 */

/** Remote Config parameter keys for release-gated features. */
export type ReleaseFlagKey =
  | 'release_contacts'
  | 'release_bookings'
  | 'release_events'
  | 'release_data_store'
  | 'release_workflows'
  | 'release_redirects'
  | 'release_community'

export interface ReleaseFlagDefinition {
  key: ReleaseFlagKey
  label: string
  description: string
  /**
   * Fallback verdict when Remote Config is unreachable (offline, blocked,
   * first paint before activate). MUST match the seeded value in
   * cloud/firebase-remoteconfig.template.json so environments without a
   * published template behave like the template intends.
   */
  defaultEnabled: boolean
  /** Host dashboard tab id (host-nav-tabs.ts) this flag hides, if any. */
  navTabId?: string
}

/**
 * The registry: one entry per gated feature. Adding a flag = add it here,
 * seed it in the Remote Config template, and (optionally) wrap the page in
 * `<FeatureGate>` — the staff admin editor and nav filtering pick it up
 * from this list.
 */
export const RELEASE_FLAGS: readonly ReleaseFlagDefinition[] = [
  {
    key: 'release_contacts',
    label: 'Contacts CRM',
    description:
      'Unified contacts list, segments and profile drawer (Contacts CRM v1).',
    defaultEnabled: false,
    navTabId: 'nav-tab-contacts',
  },
  {
    key: 'release_bookings',
    label: 'Bookings',
    description: 'Bookings & scheduling for host sites.',
    defaultEnabled: true,
    navTabId: 'nav-tab-bookings',
  },
  {
    key: 'release_events',
    label: 'Events',
    description: 'Event calendar management (AGL-145 add-on surface).',
    defaultEnabled: true,
    navTabId: 'nav-tab-events',
  },
  {
    key: 'release_data_store',
    label: 'Data store',
    description: 'Datasets, models and dynamic data bindings.',
    defaultEnabled: true,
    navTabId: 'nav-tab-data',
  },
  {
    key: 'release_workflows',
    label: 'Workflows',
    description: 'Workflow builder and automation runs.',
    defaultEnabled: true,
    navTabId: 'nav-tab-workflows',
  },
  {
    key: 'release_redirects',
    label: 'Redirects',
    description: 'Redirect manager with usage analytics.',
    defaultEnabled: true,
    navTabId: 'nav-tab-redirects',
  },
  {
    key: 'release_community',
    label: 'Community marketplace',
    description: 'Community browsing, publishing and plugin installs.',
    defaultEnabled: true,
    navTabId: 'nav-tab-community',
  },
]

export const RELEASE_FLAG_KEYS = RELEASE_FLAGS.map(
  (definition) => definition.key,
) as readonly ReleaseFlagKey[]

export function isReleaseFlagKey(value: string): value is ReleaseFlagKey {
  return (RELEASE_FLAG_KEYS as readonly string[]).includes(value)
}

export function getReleaseFlagDefinition(
  key: ReleaseFlagKey,
): ReleaseFlagDefinition {
  const definition = RELEASE_FLAGS.find((entry) => entry.key === key)
  if (!definition) throw new Error(`Unknown release flag: ${key}`)
  return definition
}

/**
 * The JSON payload stored in each Remote Config parameter. `enabled: true`
 * turns the feature on for everyone; `enabled: false` with a positive
 * `rolloutPercent` enables it for that percentage of subjects (stable
 * per-tenant bucketing, GrowthBook-style).
 */
export interface ReleaseFlagValue {
  enabled: boolean
  /** 0–100; only consulted while `enabled` is false. */
  rolloutPercent?: number
  /** Free-form staff note ("waiting on AGL-199", owner, etc.). */
  note?: string
}

const clampPercent = (value: unknown): number => {
  const percent = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/**
 * Parses a Remote Config parameter string into a `ReleaseFlagValue`.
 * Tolerant by design — the template is hand-editable in the Firebase
 * console, so plain "true"/"false" strings and malformed JSON must not
 * crash gating: anything unreadable falls back to the registry default.
 */
export function parseReleaseFlagValue(
  raw: string | null | undefined,
  fallbackEnabled: boolean,
): ReleaseFlagValue {
  const text = raw?.trim()
  if (!text) return { enabled: fallbackEnabled }
  if (text === 'true') return { enabled: true }
  if (text === 'false') return { enabled: false }
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'boolean') return { enabled: parsed }
    if (parsed && typeof parsed === 'object') {
      return {
        enabled: parsed.enabled === true,
        rolloutPercent: clampPercent(parsed.rolloutPercent),
        note: typeof parsed.note === 'string' ? parsed.note : undefined,
      }
    }
  } catch {
    // fall through to the registry default
  }
  return { enabled: fallbackEnabled }
}

/**
 * FNV-1a 32-bit hash → 0–99 bucket. Deterministic so a subject keeps the
 * same rollout verdict across sessions and surfaces, and seeded with the
 * flag key so a subject doesn't land in the same bucket for every flag.
 */
export function releaseFlagBucket(flagKey: string, subjectId: string): number {
  let hash = 0x811c9dc5
  const seed = `${flagKey}:${subjectId}`
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 100
}

/**
 * The gating verdict for one subject. `subjectId` should be the tenantId
 * when available (whole workspaces get features together) and fall back to
 * the uid; an empty subject only passes fully-enabled flags.
 */
export function isReleaseFlagOn(
  flagKey: ReleaseFlagKey,
  value: ReleaseFlagValue,
  subjectId: string | null | undefined,
): boolean {
  if (value.enabled) return true
  const percent = clampPercent(value.rolloutPercent)
  if (percent <= 0 || !subjectId) return false
  if (percent >= 100) return true
  return releaseFlagBucket(flagKey, subjectId) < percent
}
