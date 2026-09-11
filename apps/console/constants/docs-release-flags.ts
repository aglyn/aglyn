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
 * The docs-prose half of the release-flag leak guard (AGL-1605).
 *
 * AGL-1600 made it impossible for a flag-gated nav tab to reach a published
 * SCREENSHOT. Nothing stopped the same feature reaching published PROSE, which
 * is how a complete Contacts CRM page — with pricing — went to production for a
 * feature nobody could open (AGL-1601), along with the same claim on five more
 * surfaces (AGL-1603). Both leaks were found by a human reading the site, two
 * and a half weeks before public beta. This registry plus
 * `docs-release-flags.spec.ts` is what replaces that detection mechanism.
 *
 * The mapping "which docs pages document which flagged feature" cannot be
 * inferred: grepping for "contacts" hits `{{contact.firstName}}` merge tags and
 * "contact support", and half the hits are cross-references that are correct
 * precisely because they link to a page that already discloses the rollout. So
 * it is declared here, and the spec's anti-vacuity assertions make an
 * UNDECLARED flag fail rather than pass silently.
 */

import { RELEASE_FLAGS, type ReleaseFlagKey } from '@aglyn/aglyn'

/**
 * The `edit-from-the-live-site.md` treatment: the admonition a page that is
 * ABOUT an unreleased feature must open with. Matched on the marker, not on
 * loose prose — "we're working on it" further down the page is not disclosure.
 */
export const ROLLING_OUT_ADMONITION =
  /^:::(?:caution|warning|note|info)\s+Rolling out\s*$/m

/**
 * Claims a page may not make about a feature the reader cannot open. The
 * AGL-1601 defect was the first of these: a **Plan availability: Paid** callout
 * attached to a dark console page.
 */
export const PRICE_CLAIM_PATTERNS: readonly {
  readonly name: string
  readonly pattern: RegExp
}[] = [
  {
    name: 'a "Plan availability" admonition',
    pattern: /^:::\w+\s+Plan availability/im,
  },
  { name: 'a price in dollars', pattern: /\$\d/ },
  {
    name: 'a plan-tier band table',
    pattern:
      /^\|\s*\**(?:Free|Starter|Pro|Business|Scale|Advanced|Agency)\**\s*\|/m,
  },
]

export interface FlagDocPage {
  /** Path relative to `apps/docs`. Asserted to exist — a rename must fail. */
  readonly path: string
  /**
   * How this page discloses that the feature is not available yet.
   *
   * - `'admonition'` — the page's SUBJECT is the feature, so it must open with
   *   the `:::caution Rolling out` block.
   * - a regex (or several, all required) — the page covers many features, so
   *   the disclosure sits beside the mention rather than at the top. The
   *   patterns are windowed on purpose: they tie the claim to its
   *   qualification, so deleting the qualification fails even though the words
   *   "rolling out" still appear elsewhere on the page.
   *
   * Read the other way, these are also the assertions that fire when the flag
   * turns ON: a disclosure that still matches an enabled feature is a stale
   * marker, which is exactly how a guard like this goes quietly vacuous.
   */
  readonly disclosure: 'admonition' | readonly RegExp[]
  /**
   * Whether the whole-file price/plan assertions apply.
   *
   * Only a page whose subject IS the feature can be checked whole-file. An
   * aggregate page (billing, What's New, the docs home) prices the rest of the
   * product in the same file, so a whole-file rule there would either fail
   * forever or have to be defanged. `false` REQUIRES `priceClaimNote`, so the
   * exemption is a reviewed decision rather than a silent default.
   */
  readonly checkNoPriceClaim: boolean
  readonly priceClaimNote?: string
}

/**
 * Flag key → the docs pages that document it.
 *
 * Entries STAY after a flag flips on: the spec then asserts the inverse (the
 * disclosure must be gone), which is what stops a rolling-out marker rotting in
 * place on a shipped feature.
 */
export const FLAG_DOC_PAGES: Partial<
  Record<ReleaseFlagKey, readonly FlagDocPage[]>
> = {
  // AGL-1132 / AGL-1944. This flag was excused as undocumentable while it was
  // console-only: "you are taken to Stripe to pay" stayed true either way, so
  // there was nothing for a customer to read. AGL-1944 changed that. The
  // STOREFRONT half is a merchant-visible change to how their own shoppers
  // buy — the card form opens on their pages instead of Stripe's — and a
  // merchant deciding whether to ask for it needs to know what does and does
  // not change about a sale. So the excuse no longer holds and the flag moves
  // here.
  release_native_checkout: [
    {
      path: 'docs/guides/commerce-end-to-end.md',
      // Windowed on the mention rather than the top of the page: this guide
      // covers the whole commerce flow and only one SECTION of it is flagged.
      // A bare /rolling out/ would keep matching some unrelated paragraph long
      // after this disclosure came down.
      disclosure: [
        /### Paying without leaving your site[\s\S]{0,900}\*\*Rolling out\.\*\*[\s\S]{0,200}off by default/,
      ],
      checkNoPriceClaim: false,
      priceClaimNote:
        'An aggregate guide: it opens with a `:::info Plan availability` admonition for COMMERCE itself, which is shipped and paid-for and has nothing to do with this flag. A whole-file price check here would fail on that admonition forever, and defanging it would remove the guard from the pages that need it.',
    },
  ],

  // AGL-1302 follow-on. The template AGL-1603 was told to copy.
  release_edit_bar: [
    {
      path: 'docs/building-sites/besigner/edit-from-the-live-site.md',
      disclosure: 'admonition',
      checkNoPriceClaim: true,
    },
    {
      path: 'docs/whats-new.md',
      disclosure: [/Edit from the live site\][\s\S]{0,120}\*\(rolling out\)\*/],
      checkNoPriceClaim: false,
      priceClaimNote:
        'A changelog prices the whole product; the admin bar itself carries no price claim anywhere.',
    },
  ],
  // AGL-1860. The flag closes the console PANEL and the chat ROUTE together
  // (a released-off feature 404s), and the one page about it is ABOUT the
  // feature — the admonition treatment, whole-file. While
  // PUBLISHED_ON_IN_PRODUCTION declares the flag ON, the spec reads this entry
  // the other way: the admonition must be absent.
  release_assist: [
    {
      path: 'docs/getting-started/aglyn-assist.md',
      disclosure: 'admonition',
      checkNoPriceClaim: true,
    },
  ],
}

/**
 * OFF flags with no customer-facing docs, and why. The escape hatch from the
 * "every OFF flag is declared" assertion — so it is deliberately narrow, and
 * the spec checks that the flag's LABEL really is absent from the published
 * tree outside `docs/staff-console/` (where naming every flag is the point).
 */
export const FLAGS_WITHOUT_DOCS: Partial<Record<ReleaseFlagKey, string>> = {}

/**
 * Where a published-ON verdict was read, and why it holds. Every field is
 * something a reviewer can check against the Firebase console, so none of
 * them is optional.
 */
export interface PublishedOnEvidence {
  /** The production Remote Config template version that publishes the flag. */
  readonly templateVersion: number
  /** When that version was published, as `YYYY-MM-DD`. */
  readonly publishedAt: string
  /**
   * The parameter value that version publishes, verbatim. The spec parses it
   * with the gate's own parser and requires it to turn the flag on for every
   * workspace on every plan: a percentage or a tier list is still a rollout,
   * and a page about a rollout still owes the reader its disclosure.
   */
  readonly publishedValue: string
  /** Why the in-repo default and the template seed stay OFF regardless. */
  readonly defaultStaysOff: string
  /** What had to be true before production could publish the flag ON. */
  readonly precondition: string
}

/**
 * Flags production publishes ON while their in-repo default stays OFF
 * (AGL-2784).
 *
 * `defaultEnabled` is only the fallback for an unreachable Remote Config, and
 * the template seeds the same value, so neither says whether a customer can
 * open the feature. Usually that gap never matters, because shipping a flag
 * means flipping its default. A flag whose default is kept OFF on purpose —
 * so that a code change can never be what releases it — ships by publishing
 * Remote Config instead, and without a declaration here the spec reads the
 * default and requires that flag's pages to say it is still rolling out.
 *
 * A key here counts as ON for disclosure: its pages must carry no rolling-out
 * disclosure, and none is required of them. Its FLAG_DOC_PAGES entry stays,
 * because that entry is what points the stale-marker half at those pages.
 * Only a registry key that is OFF by default belongs here; the spec refuses
 * any other.
 */
export const PUBLISHED_ON_IN_PRODUCTION: Partial<
  Record<ReleaseFlagKey, PublishedOnEvidence>
> = {
  release_assist: {
    templateVersion: 8,
    publishedAt: '2026-08-23',
    publishedValue: '{"enabled":true,"rolloutPercent":0}',
    defaultStaysOff:
      'Flipping the default in code has to be a failing test rather than a quiet deploy: assist-anthropic-subprocessor-gate.spec.ts pins both defaultEnabled and the template seed to false, so the flag can only be released by publishing Remote Config.',
    precondition:
      'AGL-1909: Anthropic has to be a published subprocessor before Assist sends it customer content. aglyn.com/legal/subprocessors lists Anthropic for the Aglyn Assist helper.',
  },
}

/** Every flag whose in-repo default (and seeded Remote Config value) is OFF. */
export const OFF_BY_DEFAULT_FLAG_KEYS: readonly ReleaseFlagKey[] =
  RELEASE_FLAGS.filter((flag) => !flag.defaultEnabled).map((flag) => flag.key)
