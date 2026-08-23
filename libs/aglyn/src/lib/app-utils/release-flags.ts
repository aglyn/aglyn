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
import type { OrgPlan } from '../foundation'
import { PLAN_LABELS, SELF_SERVE_PLANS } from './plan-entitlements'
import { PLATFORM_BRAND_NAME } from './platform-brand'

export type ReleaseFlagKey =
  | 'release_contacts'
  | 'release_bookings'
  | 'release_events'
  | 'release_data_store'
  | 'release_workflows'
  | 'release_redirects'
  | 'release_commerce_v2'
  | 'release_member_accounts'
  | 'release_marketplace'
  | 'release_marketing'
  | 'release_email'
  | 'release_inbox'
  | 'release_logic'
  | 'release_addon_store'
  | 'release_native_checkout'
  | 'release_edit_bar'
  | 'release_assist'

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
    key: 'release_member_accounts',
    label: 'User Accounts',
    description:
      'Visitor accounts on published sites: the /signin, /signup and ' +
      '/recover pages and the Members blocks (AGL-2486). Platform-wide ' +
      'kill switch only — whether a given SITE serves those pages is the ' +
      'per-site User Accounts toggle, which is off until a site opts in.',
    defaultEnabled: true,
  },
  {
    key: 'release_marketplace',
    label: 'Marketplace',
    description: 'Marketplace browsing, publishing and plugin installs.',
    defaultEnabled: true,
    // AGL-1654: was 'nav-tab-marketplace', which matched no nav item, so
    // `gateNavTabItems` never hid the tab. The org Marketplace tab is a
    // console constant rather than a plugin nav item, so the id has to be
    // kept in step with `org-nav-tabs.ts` by hand; the spec
    // `release-flag-nav-tab-ids.spec.ts` is what holds it there.
    //
    // The second half of that comment — "the page behind it carries no
    // `<FeatureGate>`" — was still true until AGL-2019 and is no longer.
    // Flipping this flag off used to subtract the marketplace plugin from
    // the loader and both API dispatchers while the page went on rendering
    // in full, so the OFF state was itself broken and "just turn the flag
    // off" was not an available answer for an operator who does not want a
    // marketplace. The page is gated now, so off means off.
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
      'Pay without leaving the page, instead of a redirect to ' +
      'checkout.stripe.com. TWO surfaces: the console plan checkout uses ' +
      'embedded Checkout (AGL-1132), and a merchant storefront uses the ' +
      'Payment Element on the merchant\u2019s own domain (AGL-1944) \u2014 ' +
      'which is the half that costs conversions, since leaving the store ' +
      'mid-purchase is where carts get abandoned. Both keep the webhook as ' +
      'the only thing that fulfils. OFF by default: the redirect is the ' +
      'proven path, and neither surface can be verified without putting a ' +
      'real card through it. Also gated on a publishable key being set, ' +
      'per surface \u2014 so flipping this alone degrades to the redirect ' +
      'rather than to a dead button.',
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
  {
    key: 'release_assist',
    label: `${PLATFORM_BRAND_NAME} Assist`,
    description:
      'The in-console AI chat helper on every page (AGL-1860): docs-' +
      'grounded answers with deep links, page-context guidance on Pro+. ' +
      'OFF by default, and blocked on TWO published legal artifacts ' +
      '(AGL-1909), neither of which is a repo file — both are live besigner ' +
      'pages, so publication is what satisfies them: (1) the privacy-policy ' +
      'disclosure for stored Q&A, because the data loop records every ' +
      'exchange org-scoped under orgs/{orgId}/assistExchanges; and (2) the ' +
      'Anthropic row on /legal/subprocessors, which was deliberately ' +
      'REMOVED on 2026-08-13 (subprocessorsV2a-20260813) on the premise ' +
      'that no production key existed — so the page is not merely ' +
      'incomplete without it, it is affirmatively wrong. NOTE the real ' +
      'trigger is ANTHROPIC_API_KEY, not this flag: /api/ai/assist (the ' +
      'besigner copy assistant, AGL-89/130/169) carries no release flag at ' +
      'all and sends customer site content to Anthropic on the key plus a ' +
      'Pro entitlement alone. Setting the key in production therefore makes ' +
      'Anthropic a subprocessor whether or not this flag is ever flipped.',
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
 * per-tenant bucketing, GrowthBook-style); `plans` narrows either of those
 * to a set of tiers (AGL-2486).
 */
export interface ReleaseFlagValue {
  enabled: boolean
  /** 0–100; only consulted while `enabled` is false. */
  rolloutPercent?: number
  /**
   * Plan/tier targeting (AGL-2486). The tiers this flag is being rolled out
   * to, or ABSENT for "every tier".
   *
   * ABSENT AND EMPTY BOTH MEAN EVERY TIER, and that is load-bearing: every
   * flag stored before this field existed parses to `undefined` here, and an
   * operator who unticks every box has plainly not asked for a flag that
   * reaches nobody. Reading an empty list as "no tiers" would dark-launch
   * nothing while the console still said the flag was on — the inverted
   * reading of this field is the whole hazard, so it is closed in the parser
   * rather than left to each call site.
   */
  plans?: OrgPlan[]
  /** Free-form staff note ("waiting on AGL-199", owner, etc.). */
  note?: string
}

const clampPercent = (value: unknown): number => {
  const percent = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/**
 * Every plan a flag may target, cheapest first — `SELF_SERVE_PLANS` then
 * `enterprise`, the same ladder `planGrantingFeature` walks and the same
 * order the plan grid renders. Derived, never re-typed: pricing v3 inserted
 * `scale` mid-ladder and added `agency`, and a second hand-written tier list
 * here would have missed both.
 */
export const RELEASE_FLAG_PLAN_LADDER: readonly OrgPlan[] = [
  ...SELF_SERVE_PLANS,
  'enterprise' as OrgPlan,
]

const isOrgPlan = (value: unknown): value is OrgPlan =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(PLAN_LABELS, value)

/**
 * The tiers on the ladder at or above `plan` — what the console's "Pro and
 * above" shortcut expands to before it is STORED as an explicit list.
 *
 * Deliberately a UI convenience and not a stored "minimum plan" mode: a
 * stored threshold would silently re-aim every live flag the day a tier is
 * inserted into the middle of the ladder (pricing v3 did exactly that with
 * `scale`). An explicit list means the audience of a published flag only
 * ever changes because a human changed it.
 */
export function releaseFlagPlansAtOrAbove(plan: OrgPlan): OrgPlan[] {
  const index = RELEASE_FLAG_PLAN_LADDER.indexOf(plan)
  return index < 0 ? [] : RELEASE_FLAG_PLAN_LADDER.slice(index)
}

/**
 * Sanitises whatever is stored at `plans`, in ladder order.
 *
 * Returns `undefined` — not `[]` — for "no targeting declared", so the
 * absence survives a round trip through the staff editor and cannot be
 * written back as a list that means something else. Unknown tier names are
 * dropped for the same reason `parseOrgReleaseFlagOverrides` drops unknown
 * keys: a renamed or retired tier must never gate anything. A list that
 * names ONLY unknown tiers collapses to `undefined` (every tier) rather than
 * to an empty list, because a typo must inherit, never silently target.
 */
export function parseReleaseFlagPlans(raw: unknown): OrgPlan[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const named = new Set(raw.filter(isOrgPlan))
  if (named.size === 0) return undefined
  return RELEASE_FLAG_PLAN_LADDER.filter((plan) => named.has(plan))
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
      const plans = parseReleaseFlagPlans(parsed.plans)
      return {
        enabled: parsed.enabled === true,
        rolloutPercent: clampPercent(parsed.rolloutPercent),
        // Spread, so a flag stored before AGL-2486 has NO `plans` key at all
        // rather than an explicit `undefined`. `JSON.stringify` drops both,
        // but the two are not the same to `'plans' in value`, which is what
        // the staff PUT uses to tell "the operator cleared the targeting"
        // apart from "this client never sent the field".
        ...(plans ? { plans } : {}),
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
  /**
   * The subject org's plan, when the caller knows it (AGL-2486). Optional so
   * every pre-existing call site compiles and answers unchanged: a flag that
   * declares no tier targeting never reads this.
   */
  plan?: OrgPlan | null,
): boolean {
  if (!releaseFlagTargetsPlan(value, plan)) return false
  if (value.enabled) return true
  const percent = clampPercent(value.rolloutPercent)
  if (percent <= 0 || !subjectId) return false
  if (percent >= 100) return true
  return releaseFlagBucket(flagKey, subjectId) < percent
}

/**
 * Does this flag's tier targeting admit `plan`? (AGL-2486)
 *
 * THE SEMANTICS, because an operator who cannot predict the audience will
 * not stage a rollout at all:
 *
 *  - The tier list is a FILTER, applied before and independently of the
 *    percentage. The percentage then picks a cohort WITHIN the admitted
 *    tiers. "Pro and above at 50%" is therefore both "half of the Pro+
 *    workspaces" and "the global 50% cohort, restricted to Pro+" — the two
 *    readings name the same set, and they do so because
 *    {@link releaseFlagBucket} hashes `flagKey:orgId` and NOTHING ELSE.
 *  - Which is also why the bucket is stable. Adding, removing or reordering
 *    tiers cannot reshuffle the bucket, so an org already inside a 50%
 *    rollout keeps the feature when an unrelated tier joins the list. Had
 *    the plan been mixed into the hash — the obvious way to write this — a
 *    tier edit would have re-drawn the cohort under every customer already
 *    in it, and a plan change would have re-rolled the dice for one.
 *  - The filter binds the FULLY-ENABLED path too, not just the rollout.
 *    "On, Enterprise + Agency" is how a launch to the top of the ladder is
 *    expressed, and it is what was actually asked for. Untargeted flags are
 *    unaffected: no list means every tier, so `enabled` still means everyone.
 *  - An UNKNOWN plan fails a declared list. Same conservatism as a missing
 *    subject on a percentage rollout: a caller that cannot say which
 *    workspace it is asking about gets the safe answer rather than a
 *    confidently wrong one. A per-org staff override still wins over all of
 *    it — see {@link isReleaseFlagOnForOrg} — so a targeted flag can still be
 *    handed to one org off-ladder.
 */
export function releaseFlagTargetsPlan(
  value: ReleaseFlagValue,
  plan: OrgPlan | null | undefined,
): boolean {
  const plans = value.plans
  // `!plans` would be the idiom here, but `strictNullChecks` is off repo-wide
  // and an empty array is truthy — both "absent" and "empty" have to be named
  // for the every-tier reading to actually hold.
  if (plans == null || plans.length === 0) return true
  if (!plan) return false
  return plans.includes(plan)
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
  /**
   * The org's plan, for tier targeting (AGL-2486). Optional, and checked
   * only AFTER the override: a staff grant is a decision about one named
   * customer and outranks the tier filter exactly as it already outranks the
   * rollout bucket. That ordering is what lets a Free org preview a
   * Business-targeted flag without widening the flag for every Free org.
   */
  plan?: OrgPlan | null,
): boolean {
  const override = overrides?.[flagKey]
  if (typeof override === 'boolean') return override
  return isReleaseFlagOn(flagKey, value, subjectId, plan)
}
