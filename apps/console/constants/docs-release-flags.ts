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
  // AGL-1601 / AGL-1603 / AGL-1604. The flag gates the console PAGE only —
  // ingestion, `GET /v1/contacts` and the audience-band meter all run — so
  // every disclosure below says the page is unavailable, not the feature.
  release_contacts: [
    {
      path: 'docs/content-and-data/contacts/overview.md',
      disclosure: 'admonition',
      checkNoPriceClaim: true,
    },
    {
      path: 'api/resources/contacts.md',
      disclosure: [/Contacts page\*\*[\s\S]{0,80}rolling out/],
      checkNoPriceClaim: true,
    },
    {
      path: 'docs/getting-started/console-tour.md',
      // AGL-1603's worst item: the page offered a remedy (enable the plugin
      // under Organization → Plugins) that CANNOT work for a Remote Config
      // flag. Both halves are asserted — the qualification and the dead end.
      disclosure: [
        /\*\*Contacts\*\* is the exception[\s\S]{0,200}rolling out/,
        /dead end/i,
      ],
      checkNoPriceClaim: true,
    },
    {
      path: 'docs/intro.md',
      disclosure: [/contacts CRM \(rolling out\)/i],
      checkNoPriceClaim: false,
      priceClaimNote:
        'The docs home carries a general "Plan availability" callout explaining the docs convention; it is not a claim about Contacts.',
    },
    {
      path: 'docs/whats-new.md',
      disclosure: [
        /\[Contacts CRM\][^\n]*\n?[^\n]*\*\(rolling out\)\*/,
        // The release note still quotes the real overage rates. That is
        // allowed only while it says, next to them, that nobody is billed.
        /per 1,000\/month[\s\S]{0,400}not billed yet/i,
      ],
      checkNoPriceClaim: false,
      priceClaimNote:
        'A changelog prices the whole product; the Contacts rates specifically are covered by the windowed "not billed yet" disclosure above.',
    },
    {
      path: 'docs/workspace-and-billing/billing-and-plans/overview.md',
      disclosure: 'admonition',
      checkNoPriceClaim: false,
      priceClaimNote:
        'The billing page IS the price list — the plan table and audience bands are real numbers matching plan-entitlements.ts. The Rolling out admonition carries the qualification that paid audience overage is not billed while the page is dark.',
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
  // (a released-off feature 404s), so the one page about it is a page about
  // something nobody can open yet — the admonition treatment, whole-file.
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

/** Every flag whose in-repo default (and seeded Remote Config value) is OFF. */
export const OFF_BY_DEFAULT_FLAG_KEYS: readonly ReleaseFlagKey[] =
  RELEASE_FLAGS.filter((flag) => !flag.defaultEnabled).map((flag) => flag.key)
