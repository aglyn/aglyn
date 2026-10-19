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
 * The native apps' plan card (AGL-3992): the usage meters it rotates through,
 * which one leads for what is on screen, and in what order the rest follow.
 *
 * ONE mapping for both apps, generated into the native contracts, so the
 * Apple and Kotlin cards cannot drift. Every meter here is one the console's
 * Billing › Usage page already meters, read from the same source it reads,
 * against the same entitlement; none is invented for the card:
 *
 * | meter            | Usage page label                              | used                                   | limit                       |
 * | ---------------- | --------------------------------------------- | -------------------------------------- | --------------------------- |
 * | `storage`        | Storage (organization)                        | `/api/media/storage` usedBytes         | its allowanceMb             |
 * | `bandwidth`      | Bandwidth (this month, organization)          | `/api/billing/host-usage`, every site + the org | `bandwidthGb`       |
 * | `emailSends`     | Campaign emails (this month, organization)    | `orgs/{org}/counters/campaignEmailSends` | `emailSendsPerMonth`      |
 * | `aiCredits`      | AI credits (this month)                       | `/api/ai/billing/credits`              | `assistCreditsPerMonth`     |
 * | `dataStorage`    | Data storage (organization)                   | `orgs/{org}/usage/{month}` dataStorageMb | `dataStorageMbPerOrg`     |
 * | `seats`          | Team seats (incl. you)                        | `/api/orgs/members?counts=1`           | the managers seat quota     |
 * | `pages`          | Pages (a site's)                              | `/api/hosts/usage` screens             | `screensPerHost`            |
 * | `forms`          | Saved forms (a site's)                        | `hosts/{host}/forms` count             | `formsPerHost`              |
 * | `sites`          | Sites                                         | the workspace's sites                  | `hostLimit`                 |
 *
 * The card is already headed by the workspace's name and plan, so a label
 * drops the page's "(organization)" qualifier and keeps the rest.
 */

const METERS = [
  'storage',
  'bandwidth',
  'emailSends',
  'aiCredits',
  'dataStorage',
  'seats',
  'pages',
  'forms',
  'sites',
] as const

export type PlanCardMeter = (typeof METERS)[number]

/**
 * The meters the card can show, in the order a tie between two equally full
 * meters is broken. Plain `string[]` and records below, as the native
 * contracts generator reads values; `satisfies` keeps them total.
 */
export const PLAN_CARD_METERS: string[] = [...METERS]

/** Each meter's label, the Usage page's own words less its "(organization)" qualifier. */
export const PLAN_CARD_METER_LABELS: Record<string, string> = {
  storage: 'Storage',
  bandwidth: 'Bandwidth (this month)',
  emailSends: 'Campaign emails (this month)',
  aiCredits: 'AI credits (this month)',
  dataStorage: 'Data storage',
  seats: 'Team seats (incl. you)',
  pages: 'Pages',
  forms: 'Saved forms',
  sites: 'Sites',
} satisfies Record<PlanCardMeter, string>

/** The unit a meter's figures are written in, as the Usage page writes them; empty for a count. */
export const PLAN_CARD_METER_UNITS: Record<string, string> = {
  storage: 'MB',
  bandwidth: 'GB',
  emailSends: '',
  aiCredits: '',
  dataStorage: 'MB',
  seats: '',
  pages: '',
  forms: '',
  sites: '',
} satisfies Record<PlanCardMeter, string>

const CONTEXTS = ['media', 'website', 'email', 'ai', 'forms', 'data', 'team', 'sites'] as const

export type PlanCardContext = (typeof CONTEXTS)[number]

/** What the screen in front is about, for the meter that leads. */
export const PLAN_CARD_CONTEXTS: string[] = [...CONTEXTS]

/** The meters that lead for each context, in order; the rest follow by how full they are. */
export const PLAN_CARD_CONTEXT_METERS: Record<string, string[]> = {
  media: ['storage'],
  website: ['bandwidth'],
  email: ['emailSends'],
  ai: ['aiCredits'],
  forms: ['forms'],
  data: ['dataStorage'],
  team: ['seats'],
  sites: ['sites'],
} satisfies Record<PlanCardContext, PlanCardMeter[]>

/**
 * Each screen's context, by the screen id the native nav manifest opens (its
 * rows' `screen`). A screen not named here has none, and the fullest meter
 * leads. A site's Home is the website's front door; the workspace's Home has
 * no context (`planCardContext`).
 */
export const PLAN_CARD_SCREEN_CONTEXTS: Record<string, string> = {
  'site.media': 'media',
  'site.pages': 'website',
  'logic.page': 'website',
  'shell.analytics': 'website',
  'email.messages': 'email',
  'marketing.overview': 'email',
  'outreach.sequences': 'email',
  'ai.jobs': 'ai',
  'ai.credits': 'ai',
  'forms.list': 'forms',
  'data.datasets': 'data',
  'core.team': 'team',
  'core.team.roles': 'team',
  'core.team.activity': 'team',
  'core.site.users': 'team',
  'site.sites': 'sites',
} satisfies Record<string, PlanCardContext>

/** The screen id of Home, which is a site's website when the window stands in a site. */
export const PLAN_CARD_HOME_SCREEN = 'shell.home'

/** How long one meter stays before the card moves on, slowly (Zach: "auto rotates slowly"). */
export const PLAN_CARD_ADVANCE_MS = 8000

/** The share from which a meter warns, as the console's meter does (`USAGE_METER_WARNING_PCT`, 80). */
export const PLAN_CARD_WARNING_SHARE = 0.8

/** One meter's reading: `null` where the read failed or the plan does not cap it. */
export interface PlanCardReading {
  meter: string
  used: number | null
  limit: number | null
}

/** The context of the screen in front: a site's Home is its website; a screen not mapped has none. */
export function planCardContext(screen: string | null, inSite: boolean): string | null {
  if (!screen) return null
  if (screen === PLAN_CARD_HOME_SCREEN) return inSite ? 'website' : null
  return PLAN_CARD_SCREEN_CONTEXTS[screen] ?? null
}

/** A meter the card can draw: read, capped (an unlimited quota arrives as `null`), and with something to cap. */
function drawable(reading: PlanCardReading): reading is PlanCardReading & { used: number; limit: number } {
  return (
    typeof reading.used === 'number' &&
    Number.isFinite(reading.used) &&
    typeof reading.limit === 'number' &&
    Number.isFinite(reading.limit) &&
    reading.limit > 0
  )
}

function rank(meter: string): number {
  const index = PLAN_CARD_METERS.indexOf(meter)
  return index < 0 ? PLAN_CARD_METERS.length : index
}

/**
 * The order the card shows its meters in: the context's own meters first, in
 * the mapping's order, then every other meter fullest first (a tie keeps
 * `PLAN_CARD_METERS`' order). A meter that failed to read or that the plan
 * does not cap is left out. Sites leads only on the Sites list: elsewhere it
 * follows every other meter, however full, because a missing site is the
 * limit a workspace is least likely to upgrade for.
 */
export function planCardMeterOrder(
  readings: readonly PlanCardReading[],
  context: string | null,
): string[] {
  const shown = readings.filter(drawable)
  const seen = new Set<string>()
  const unique = shown.filter((reading) => {
    if (seen.has(reading.meter)) return false
    seen.add(reading.meter)
    return true
  })
  const leading = (context && PLAN_CARD_CONTEXT_METERS[context]) || []
  const lead = leading.filter((meter) => unique.some((reading) => reading.meter === meter))
  const rest = unique
    .filter((reading) => !lead.includes(reading.meter))
    .sort((a, b) => {
      const aSites = a.meter === 'sites'
      const bSites = b.meter === 'sites'
      if (aSites !== bSites) return aSites ? 1 : -1
      const byShare = b.used / b.limit - a.used / a.limit
      return byShare !== 0 ? byShare : rank(a.meter) - rank(b.meter)
    })
    .map((reading) => reading.meter)
  return [...lead, ...rest]
}

/**
 * Whether the card shows at all: a meter to draw, and either a plan the viewer
 * can upgrade (the workspace menu's "Upgrade plan" rule) or a meter at its
 * warning share, which every plan is told about.
 */
export function planCardShows(readings: readonly PlanCardReading[], offersUpgrade: boolean): boolean {
  const shown = readings.filter(drawable)
  if (!shown.length) return false
  return offersUpgrade || shown.some((reading) => reading.used / reading.limit >= PLAN_CARD_WARNING_SHARE)
}
