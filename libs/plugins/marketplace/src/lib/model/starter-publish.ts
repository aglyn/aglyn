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

import { planLockReason } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { siteFontPairing } from '@aglyn/aglyn/app-utils/site-font-pairings'
import { SITE_STARTER_MAX_SCREENS } from '@aglyn/aglyn/app-utils/site-starter'
import type { SiteStarterBuiltinReading } from '@aglyn/aglyn/app-utils/site-starter-theme'

/*==========================================
 * "PUBLISH AS A STARTER", BEFORE THE CLICK (AGL-4049).
 *
 * The starter door (`server/publish-starter.ts`) refuses a publish for four
 * things the workspace sets up elsewhere — a plan that sells on the
 * marketplace, a publisher profile, payouts for a starter with a price, a
 * published Home page — and for a site past the most pages a starter may
 * have. Each is read here from what the dialog already loads, so the dialog
 * says it before the click, disabled with the reason and a link to where it
 * is fixed, never after it. The door still decides: these are what it would
 * say, read early.
 *
 * Pure: the dialog's hook hands in what it read.
 *=========================================*/

/** The pages a starter publish captures, as counted before the click. */
export interface StarterPublishPages {
  /** Pages in the site's routing that were saved at least once and not deleted. */
  count: number
  /** Whether one of them is the Home page, at `/`. */
  hasHome: boolean
}

/** One screen document, as the dialog reads it. */
export interface StarterPublishScreen {
  $id: string
  versionId?: unknown
  deletedAt?: unknown
  [field: string]: unknown
}

/**
 * The pages the door will capture: every page in the host's routing map
 * (`screens`, id → slug) with a published version and not deleted, as the
 * door walks them. An email screen is never in the routing map.
 */
export function starterPublishPages(
  routing: unknown,
  screens: readonly StarterPublishScreen[],
): StarterPublishPages {
  const map =
    routing && typeof routing === 'object' && !Array.isArray(routing)
      ? (routing as Record<string, unknown>)
      : {}
  const published = screens.filter(
    (screen) => screen.$id in map && !!screen.versionId && !screen.deletedAt,
  )
  return {
    count: published.length,
    hasHome: published.some((screen) => map[screen.$id] === '/'),
  }
}

export type StarterPublishStepId = 'plan' | 'profile' | 'payouts' | 'home' | 'pages'

/** One thing that stands between this site and a starter publish. */
export interface StarterPublishStep {
  id: StarterPublishStepId
  /** What is missing, in one sentence. */
  text: string
  /** Where it is fixed, or `null` until the address is known. */
  href: string | null
  /** The link's label: the page it opens. */
  actionLabel: string
}

/** What the dialog has read, each `undefined`/`null` while it is pending. */
export interface StarterPublishFacts {
  /** The owning org's plan, as `usePlanFeature(hostId, 'marketplaceSelling')` resolves it. */
  plan: { ready: boolean; locked: boolean; planLabel?: string; upgradeHref?: string }
  /**
   * `publisherProfiles/{orgId}`: `undefined` while it loads or when it cannot
   * be read, `null` when the org has none.
   */
  profile: Record<string, unknown> | null | undefined
  /** The pages it will capture, or `null` while they load. */
  pages: StarterPublishPages | null
  /** The price typed in the form, in whole dollars. */
  priceUsd: number
  /**
   * The server says this org is the platform at the staff fee waiver, so a
   * price needs no payout account (AGL-4049). Only the server can say.
   */
  sellsAsPlatform?: boolean
  /** `/{org}/marketplace`, or `null` until the org's address is known. */
  marketplacePath: string | null
  /** The site's Pages list, or `null` until its address is known. */
  pagesPath: string | null
}

const sectionOf = (facts: StarterPublishFacts, section: string) =>
  facts.marketplacePath ? `${facts.marketplacePath}/${section}` : null

/** Whether the profile read says there is one, as the door reads it: a handle. */
const hasProfile = (profile: Record<string, unknown>) =>
  typeof profile['handle'] === 'string' && !!profile['handle']

/**
 * Whether a profile's payout account can take a sale, as far as the console
 * can tell: an account that takes charges. The door also checks which Stripe
 * world the account belongs to, which only the server knows, and says so if
 * that is what is missing.
 */
export const payoutsReady = (profile: Record<string, unknown>) =>
  typeof profile['stripeAccountId'] === 'string' &&
  !!String(profile['stripeAccountId']).trim() &&
  profile['stripeChargesEnabled'] === true

/**
 * Every step that stands between this site and a starter publish, the setup
 * steps first, then the site's own. A read still pending refuses nothing.
 */
export function starterPublishSteps(facts: StarterPublishFacts): StarterPublishStep[] {
  const steps: StarterPublishStep[] = []
  if (facts.plan.ready && facts.plan.locked) {
    steps.push({
      id: 'plan',
      text: planLockReason('Publishing to the marketplace', facts.plan.planLabel),
      href: facts.plan.upgradeHref ?? null,
      actionLabel: 'See plans',
    })
  }
  const profile = facts.profile
  if (profile === null || (profile && !hasProfile(profile))) {
    steps.push({
      id: 'profile',
      text:
        'Set up your publisher profile first: the handle and name people see on your listings.',
      href: sectionOf(facts, 'profile'),
      actionLabel: 'Publisher Profile',
    })
  } else if (profile && facts.priceUsd > 0 && !facts.sellsAsPlatform && !payoutsReady(profile)) {
    steps.push({
      id: 'payouts',
      text: 'Set up payouts first to sell a starter with a price, or publish it free.',
      href: sectionOf(facts, 'payouts'),
      actionLabel: 'Payouts',
    })
  }
  const pages = facts.pages
  if (pages && !pages.hasHome) {
    // The starter check's own words (`siteStarterRefusal`), then the fix.
    steps.push({
      id: 'home',
      text: 'A starter needs a published Home page at /. Publish the page at / under Pages.',
      href: facts.pagesPath,
      actionLabel: 'Pages',
    })
  } else if (pages && pages.count > SITE_STARTER_MAX_SCREENS) {
    steps.push({
      id: 'pages',
      text:
        `A starter can have at most ${SITE_STARTER_MAX_SCREENS} pages, ` +
        `and this site has ${pages.count}.`,
      href: facts.pagesPath,
      actionLabel: 'Pages',
    })
  }
  return steps
}

/**
 * Where a setup refusal from the door (412) is fixed. The door's words are
 * shown as they are; this picks the link beside them from what the dialog
 * read: the plan, the profile, or payouts for a priced starter. With nothing
 * read to say which, the publisher profile, where the other two are set up.
 */
export function starterRefusalLink(
  facts: StarterPublishFacts,
): { href: string | null; actionLabel: string } {
  if (facts.plan.ready && facts.plan.locked) {
    return { href: facts.plan.upgradeHref ?? null, actionLabel: 'See plans' }
  }
  const profile = facts.profile
  if (profile !== null && profile && hasProfile(profile) && facts.priceUsd > 0) {
    return { href: sectionOf(facts, 'payouts'), actionLabel: 'Payouts' }
  }
  return { href: sectionOf(facts, 'profile'), actionLabel: 'Publisher Profile' }
}

/** The two theme shapes a publisher chooses between. */
export type StarterThemeChoice = 'builtin' | 'full'

/** What a starter publish adds to the listing form's body. */
export interface StarterPublishBody {
  theme: SiteStarterBuiltinReading['theme'] | { kind: 'full' }
  /** Always a base starter: publishers' AI starters are not offered yet. */
  mode: 'base'
  facets: { kind: string | null }
}

/**
 * The starter half of the publish body, or `null` until it can be sent: no
 * theme chosen (neither is chosen for the publisher), or the built-in chosen
 * on a site that wears none. The full theme is the site's own, read by the
 * door off the site itself.
 */
export function starterPublishBody(input: {
  choice: StarterThemeChoice | null
  builtin: SiteStarterBuiltinReading | null
  kind: string | null
}): StarterPublishBody | null {
  const facets = { kind: input.kind || null }
  if (input.choice === 'full') return { theme: { kind: 'full' }, mode: 'base', facets }
  if (input.choice === 'builtin' && input.builtin) {
    return { theme: input.builtin.theme, mode: 'base', facets }
  }
  return null
}

/** What a publish captures, in a sentence, from the pages counted before the click. */
export function starterCapturesSentence(pages: StarterPublishPages): string {
  return (
    (pages.count === 1
      ? 'Captures its one published page, '
      : `Captures its ${pages.count} published pages, `) +
    'the shared header and footer they sit in, and the theme you choose below.'
  )
}

/** The fonts a pairing sets, as a person names them. */
function pairingLabel(id: string | null): string | null {
  const pairing = siteFontPairing(id)
  if (!pairing) return null
  return pairing.heading.family === pairing.body.family
    ? pairing.body.family
    : `${pairing.heading.family} and ${pairing.body.family}`
}

/**
 * The line under the built-in theme choice: what the starter would carry, or
 * why this site has no built-in to name. `hostReady` is false while the site
 * is still being read.
 */
export function starterBuiltinDetail(
  builtin: SiteStarterBuiltinReading | null,
  hostReady = true,
): string {
  if (!hostReady) return "Reading this site's theme…"
  if (!builtin) {
    return 'This site wears its own theme, not a built-in one, so a starter can carry it only as its full theme.'
  }
  const fonts = pairingLabel(builtin.theme.fonts)
  const recolored = Object.values(builtin.theme.brand).some((colors) => colors && Object.keys(colors).length)
  return (
    `${builtin.baseName}, ${recolored ? 'with the brand colors this site set over it' : 'in its own colors'}` +
    `${fonts ? `, set in ${fonts}` : ''}. A site created from it can switch to another built-in theme.`
  )
}

/** What the built-in choice leaves behind, for a site whose fonts it cannot name, or `null`. */
export function starterFontsNote(builtin: SiteStarterBuiltinReading | null): string | null {
  if (!builtin || builtin.fontsCarried) return null
  return (
    `This site's fonts are not a pairing a built-in theme can name, so the starter uses ` +
    `${builtin.baseName}'s own fonts. Choose the full theme to keep them.`
  )
}

/**
 * What "Publish as a starter" reads before the click, for a surface that
 * cannot read it (AGL-4049): the native apps ask
 * `GET /api/marketplace/starter-publish-facts`, and show these words.
 */
export interface StarterPublishFactsAnswer {
  /** What the publish captures, in a sentence. */
  captures: string
  /** The site's built-in theme as the publish body sends it, or `null` when it wears none. */
  builtin: SiteStarterBuiltinReading['theme'] | null
  /** The line under the built-in choice. */
  builtinDetail: string
  /** What the built-in choice leaves behind, or `null`. */
  fontsNote: string | null
  /**
   * What stands in the way, by step: a step left out is one that is done.
   * `payouts` says what a price would need, whether or not one is typed yet.
   */
  steps: Partial<Record<StarterPublishStepId, string>>
  /** Whether a step stands in the way of a free publish too, so Publish is off. */
  blocked: boolean
}

/** The answer, from what the door would read. Pure: the route hands in what it read. */
export function starterPublishFactsAnswer(input: {
  facts: Omit<StarterPublishFacts, 'priceUsd'>
  builtin: SiteStarterBuiltinReading | null
}): StarterPublishFactsAnswer {
  const { facts, builtin } = input
  const free = starterPublishSteps({ ...facts, priceUsd: 0 })
  const priced = starterPublishSteps({ ...facts, priceUsd: 1 })
  return {
    captures: starterCapturesSentence(facts.pages ?? { count: 0, hasHome: false }),
    builtin: builtin?.theme ?? null,
    builtinDetail: starterBuiltinDetail(builtin),
    fontsNote: starterFontsNote(builtin),
    steps: Object.fromEntries(priced.map((step) => [step.id, step.text])),
    blocked: free.length > 0,
  }
}
