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
 * Alerts a plugin contributes to the usage-alerts sweep (AGL-2984).
 *
 * The usage-alerts cron walks every org, reads its usage once, and sends
 * core's own alerts: the plan quotas, the customer's budget and the free
 * plan's bandwidth cap. A plugin that meters a cost or enforces a ceiling
 * core knows nothing about registers a contributor here from its
 * `serverDeclarations` entry, in either or both of two shapes:
 *
 * - `quotaChecks` answers the bands the WORKSPACE is warned about — a used
 *   figure against a limit, how often it may be announced, what happens at
 *   it, and the words for approaching and reaching it. The sweep runs them
 *   after its own quota checks, through the same approach threshold, guards
 *   and both channels, so a plugin's band warns exactly as a platform band
 *   does.
 * - `evaluate` decides STAFF alerts, and the sweep hands it each org's
 *   reading after the budget alert and before the bandwidth cap.
 *
 * THE PIPELINE IS THE SWEEP'S. A contributor decides whether an alert is due
 * and what it says; the context does everything else:
 *
 * - `recordAlert(key, threshold)` records the dedupe guard and answers
 *   whether the alert may be SENT. On an org's first, silent evaluation it
 *   records the guard as though the alert went out and answers `false`, so a
 *   contributor that sends only on `true` honors the first-sweep seeding
 *   without knowing when it applies.
 * - `alertStaff(alert)` is the sweep's own sender: the staff bell, then the
 *   staff inbox, then a row in the run's report saying whether the mail went
 *   out. On an org's first, silent evaluation it sends nothing, whoever calls
 *   it.
 * - `guards` is the org's guard map as the sweep read it. A contributor reads
 *   it to dedupe and never writes a guard itself: the sweep writes what
 *   `recordAlert` recorded, once, with the rest of the org's update.
 *
 * Guard keys share one map with core's own checks (`hosts`, `bandwidth`,
 * `budget` and the rest), so a contributor names its keys for what it
 * measures and never reuses one of core's.
 *
 * Contributors run one at a time and are ISOLATED: a throw is logged against
 * the contributor and the next one runs. A guard the failed contributor
 * recorded for an alert it never delivered is dropped rather than written, so
 * the next sweep tries that alert again instead of counting it as announced.
 * One plugin's failure costs no other plugin's alert, none of core's, and not
 * the rest of the sweep.
 *
 * The order is deterministic: the catalog order of `FIRST_PARTY_PLUGINS`,
 * then any other plugin id in code-unit order, then registration order within
 * a plugin. The order contributors REGISTER in depends on how each process
 * loaded the declarations, and a list that followed it could send and report
 * one org's alerts in a different order per process.
 */

import type { NotificationLevel } from '../app-utils/notifications'
import type {
  OrgSpendBreakdown,
  UsageAlertGuard,
} from '../app-utils/usage-budget'
import { FIRST_PARTY_PLUGINS } from './enabled-plugins'

/** One staff alert, as the sweep delivers and reports it. */
export interface UsageStaffAlert {
  /** The guard key the alert was recorded under; the report row's `quota`. */
  quota: string
  /** The threshold passed to `recordAlert`; the report row's `threshold`. */
  threshold: number
  /** The bell's title and the email's subject: one set of words for both. */
  title: string
  /** The bell's body. The email carries it verbatim, followed by the link. */
  body: string
  /** A console path. The bell links it; the email makes it absolute. */
  link: string
  /** The email's tag and log label. */
  emailContext: string
  /**
   * How loud the bell draws it (AGL-3437). A contributor's threshold is its
   * own unit, not a percentage, so only the contributor can say; absent, the
   * `billing.usage` default answers.
   */
  level?: NotificationLevel
}

/** What the sweep hands a contributor for one org. */
export interface UsageAlertContext {
  orgId: string
  /** The org's slug, or `null` when the document carries none. */
  orgSlug: string | null
  /** The org document as the sweep read it. */
  org: Readonly<Record<string, unknown>>
  /** The `YYYY-MM` month the sweep dedupes against, fixed for the whole run. */
  month: string
  /** The org's spend this month, built from the figures the sweep read. */
  spend: Readonly<OrgSpendBreakdown>
  /** The org's guard map as the sweep read it, before this run's updates. */
  guards: Readonly<Record<string, Readonly<UsageAlertGuard>>>
  /**
   * Records the guard for `key` at `threshold` and answers whether the alert
   * may be sent. Call it once the alert is due, and send only on `true`.
   */
  recordAlert: (key: string, threshold: number) => boolean
  /** Delivers one staff alert through the sweep's senders and reports it. */
  alertStaff: (alert: UsageStaffAlert) => Promise<void>
}

/**
 * One band a workspace is warned about as it approaches and reaches it — the
 * shape of a plugin's quota check.
 *
 * The sweep owns everything past the numbers and the words: the approach
 * percentage, the guard under `key`, the first-sweep seeding, both channels,
 * and the sentence every notice opens with — the workspace, then the figures,
 * then `noun` ("The Acme workspace has used 2,300 of the 2,750 AI assist
 * credits your plan includes this month").
 */
export interface UsageQuotaCheck {
  /** The guard key; named for what it measures, never one of core's. */
  key: string
  /** How the alert's title names the band: "AI assist credits". */
  label: string
  /** What the figures count, in the opening sentence. */
  noun: string
  used: number
  /** `UNLIMITED` or anything not above 0 is skipped. */
  limit: number
  /**
   * How often one threshold may be announced: `crossing` for something the
   * workspace HAS, announced once when reached and again only after usage
   * falls back below; `monthly` for a meter that resets on the 1st.
   */
  cadence: 'crossing' | 'monthly'
  /**
   * What happens at the band, which the notice has to say because the three
   * call for different actions: `stops` (new use is refused, nothing is
   * charged), `bills` (it keeps working and starts charging) or `continues`
   * (nothing is refused and nothing is charged).
   */
  outcome: 'stops' | 'bills' | 'continues'
  /** What is true now, at or past the band. */
  reached: string
  /** What will happen at the band, said while approaching it. */
  approach: string
  /** Replaces the generic title at 100%, when that would not be true. */
  reachedTitle?: string
}

/** What the sweep hands a contributor's quota checks for one org. */
export interface UsageQuotaContext {
  orgId: string
  /** The org document as the sweep read it. */
  org: Readonly<Record<string, unknown>>
  /** The `YYYY-MM` month the sweep dedupes against. */
  month: string
  /** The org's spend this month, built from the figures the sweep read. */
  spend: Readonly<OrgSpendBreakdown>
}

/** A plugin's rule for the usage-alerts sweep. */
export interface UsageAlertContributor {
  pluginId: string
  /** Unique within the plugin; two plugins may use the same id. */
  id: string
  /** Evaluates one org's STAFF alerts, sending only through the context. */
  evaluate?: (context: UsageAlertContext) => Promise<void>
  /**
   * The bands the WORKSPACE is warned about, which the sweep runs after its
   * own through the same thresholds, guards and senders.
   */
  quotaChecks?: (context: UsageQuotaContext) => Promise<readonly UsageQuotaCheck[]>
}

const registrations: UsageAlertContributor[] = []

const CATALOG_ORDER = new Map(
  FIRST_PARTY_PLUGINS.map((plugin, index) => [plugin.id, index]),
)

function catalogRank(pluginId: string): number {
  return CATALOG_ORDER.get(pluginId) ?? Number.MAX_SAFE_INTEGER
}

/** Code-unit order, which no locale can reorder. */
function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Registers a contributor. Idempotent per plugin and id: registering the same
 * pair again replaces the earlier contributor in place, so a declarations
 * module evaluated twice does not alert twice. A contributor with no plugin,
 * no id, or neither `evaluate` nor `quotaChecks` throws.
 */
export function registerUsageAlertContributor(
  contributor: UsageAlertContributor,
): void {
  const pluginId = String(contributor.pluginId ?? '').trim()
  const id = String(contributor.id ?? '').trim()
  if (!pluginId || !id) {
    throw new Error('a usage alert contributor needs a pluginId and an id')
  }
  const evaluate =
    typeof contributor.evaluate === 'function' ? contributor.evaluate : undefined
  const quotaChecks =
    typeof contributor.quotaChecks === 'function'
      ? contributor.quotaChecks
      : undefined
  if (!evaluate && !quotaChecks) {
    throw new Error(
      `usage alert contributor "${pluginId}:${id}" has neither an evaluate ` +
        'nor a quotaChecks function',
    )
  }
  const entry: UsageAlertContributor = {
    pluginId,
    id,
    ...(evaluate ? { evaluate } : {}),
    ...(quotaChecks ? { quotaChecks } : {}),
  }
  const index = registrations.findIndex(
    (existing) => existing.pluginId === pluginId && existing.id === id,
  )
  if (index >= 0) registrations[index] = entry
  else registrations.push(entry)
}

/** Every registered contributor, in the order the sweep runs them. */
export function listUsageAlertContributors(): UsageAlertContributor[] {
  return registrations
    .map((entry, sequence) => ({ entry, sequence }))
    .sort(
      (a, b) =>
        catalogRank(a.entry.pluginId) - catalogRank(b.entry.pluginId) ||
        codeUnitOrder(a.entry.pluginId, b.entry.pluginId) ||
        a.sequence - b.sequence,
    )
    .map(({ entry }) => ({ ...entry }))
}

/** Test seam: forget every contributor. */
export function resetUsageAlertContributorsForTests(): void {
  registrations.length = 0
}
