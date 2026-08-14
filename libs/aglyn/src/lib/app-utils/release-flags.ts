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
  | 'release_commerce_v2'
  | 'release_marketplace'
  | 'release_marketing'
  | 'release_email'
  | 'release_inbox'
  | 'release_logic'
  | 'release_addon_store'
  | 'release_native_checkout'
  | 'release_edit_bar'

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
    key: 'release_commerce_v2',
    label: 'Commerce v2',
    description:
      'Full ecommerce wave: catalog/variants, cart + checkout, digital ' +
      'goods, reservations, POS, and the repriced commerce tiers ' +
      '(AGL-276..331).',
    defaultEnabled: true,
  },
  {
    key: 'release_marketplace',
    label: 'Marketplace',
    description: 'Marketplace browsing, publishing and plugin installs.',
    defaultEnabled: true,
    // AGL-1654: was 'nav-tab-marketplace', which matched no nav item, so
    // `gateNavTabItems` never hid the tab. The org Marketplace tab is a
    // console constant rather than a plugin nav item, and the page behind
    // it carries no `<FeatureGate>` — so flipping the flag off subtracted
    // the marketplace plugin from the loader and both API dispatchers while
    // leaving a live tab into a page whose backend had gone.
    navTabId: 'nav-tab-org-marketplace',
  },
  // AGL-422: every first-party plugin is release-flagged — the flag now
  // feeds the plugin LOADER (console, published sites, API dispatch), not
  // just nav visibility, so staff can kill-switch a whole plugin platform-
  // wide from the Feature Flags page.
  {
    key: 'release_marketing',
    label: 'Marketing',
    description: 'Overlays, campaigns at-a-glance, and A/B experiments.',
    defaultEnabled: true,
    navTabId: 'nav-tab-marketing',
  },
  {
    key: 'release_email',
    label: 'Email',
    description: 'Designed emails, campaigns, and audience sending.',
    defaultEnabled: true,
  },
  {
    key: 'release_inbox',
    label: 'Inbox',
    description: 'Form submissions, site members, and the lead inbox.',
    defaultEnabled: true,
    navTabId: 'nav-tab-inbox',
  },
  {
    key: 'release_logic',
    label: 'Logic',
    description: 'Variables, no-code functions, and reference health.',
    defaultEnabled: true,
    navTabId: 'nav-tab-logic',
  },
  {
    key: 'release_addon_store',
    label: 'Add-on store',
    description:
      'Self-serve add-on purchases on the Billing page: seats, datasets, ' +
      'extra sites, POS registers, Event Calendar (AGL-524..531).',
    defaultEnabled: true,
  },
  {
    key: 'release_native_checkout',
    label: 'In-page checkout',
    description:
      'Pay for a plan without leaving the console — Stripe embedded ' +
      'Checkout instead of a redirect to checkout.stripe.com (AGL-1132). ' +
      'OFF by default: the redirect is the proven path, and this one cannot ' +
      'be verified without putting a real card through it.',
    defaultEnabled: false,
  },
  {
    key: 'release_edit_bar',
    label: 'Site admin bar',
    description:
      'Edit-access admin bar on published sites: a signed-in editor can ' +
      'jump from a live page straight into the besigner for the screen ' +
      'serving it (admin edit bar, AGL-1302 follow-on). OFF by default ' +
      'until the cross-origin connect flow is verified on a live tenant ' +
      'domain; flipping it off also invalidates every outstanding edit ' +
      'token at the verify site.',
    defaultEnabled: false,
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
 * The gating verdict for one subject.
 *
 * `subjectId` is the ORG ID, or nothing. A rollout is a cohort of
 * workspaces, so a whole workspace has to land on one side of the
 * percentage: every surface that asks about an org must ask with the same
 * string, or they answer differently about the same customer.
 *
 * This docstring used to sanction falling back to the uid, and the server
 * gates fell back to a hostId. Since a hostId, a uid and an orgId hash to
 * three different buckets, a mid-rollout flag could be on in the console
 * and off on the published site for one workspace — stable per subject, so
 * it never flickered, it just stayed wrong (AGL-1656).
 *
 * An empty subject only passes fully-enabled flags. That is the deliberate
 * cost: a request with no resolvable org never joins a partial rollout,
 * which is the conservative answer rather than a confidently wrong one.
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

/**
 * Per-org release-flag overrides (AGL-1635), stored on the org doc at
 * `releaseFlags`. A present key is a staff DECISION about one organization
 * and wins over both the Remote Config value and the rollout bucket; an
 * absent key inherits.
 *
 * A separate field from `entitlements.features` on purpose: those ask
 * whether the org's PLAN includes a feature, these ask whether a
 * not-yet-released feature is switched on for this one customer. Folding
 * them together would make "granted by the deal" and "previewing an
 * unreleased build" indistinguishable at the point a support question is
 * asked.
 *
 * Why the org doc and not a Remote Config condition: RC conditions are
 * template-global and would need one published condition per org, with a
 * template publish (a manual, separate deploy) for every grant.
 */
export type OrgReleaseFlagOverrides = Partial<Record<ReleaseFlagKey, boolean>>

/**
 * Sanitises whatever is actually stored at `org.releaseFlags`.
 *
 * Tolerant for the same reason `parseReleaseFlagValue` is: this map is
 * hand-editable in the Firebase console and survives registry renames, so a
 * retired flag key or a non-boolean must be dropped rather than allowed to
 * gate anything. Unknown keys are discarded — a stale key can never grant a
 * flag that no longer exists, and a typo silently inherits instead of
 * silently forcing.
 */
export function parseOrgReleaseFlagOverrides(
  raw: unknown,
): OrgReleaseFlagOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const overrides: OrgReleaseFlagOverrides = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean' && isReleaseFlagKey(key)) {
      overrides[key] = value
    }
  }
  return overrides
}

/**
 * The gating verdict with a per-org override applied on top of
 * `isReleaseFlagOn`.
 *
 * The override is checked FIRST and short-circuits, so a forced-off flag
 * stays off for an org even while the flag is globally enabled — the
 * per-org kill switch is half the point, not just the per-org grant. Every
 * release-flag gate resolves through here so the console, the tenant
 * runtime and the API dispatchers cannot disagree about one org.
 */
export function isReleaseFlagOnForOrg(
  flagKey: ReleaseFlagKey,
  value: ReleaseFlagValue,
  subjectId: string | null | undefined,
  overrides: OrgReleaseFlagOverrides | null | undefined,
): boolean {
  const override = overrides?.[flagKey]
  if (typeof override === 'boolean') return override
  return isReleaseFlagOn(flagKey, value, subjectId)
}
