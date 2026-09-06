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
 * AGL-2246: every QUOTA key has a customer-facing surface, or a written
 * exclusion.
 *
 * The flag half of this question already has a guard —
 * `billing-plan-feature-rows.spec.ts` (AGL-2079) derives the expected set
 * from `PLAN_ENTITLEMENTS.free.features` and fails on any flag that is
 * neither a row nor an excluded key. The NUMBER half had none, and it had
 * exactly the decay that guard was written to stop: `templatesPerHost` was
 * enforced by `/api/hosts/resources`, refused saves on Free and Starter, and
 * appeared in no console surface whatsoever — not the templates card, not the
 * plan grid, not the usage meters. One of 31 keys, invisible, for as long as
 * it has existed.
 *
 * Derived, never hand-listed. A guard carrying its own copy of the quota
 * names decays in the same commit as the thing it guards; the key set comes
 * from `PLAN_ENTITLEMENTS` on every run, so a new quota is unsurfaced-and-red
 * rather than unsurfaced-and-silent.
 *
 * What counts as a surface is deliberately generous — a meter, a plan-grid
 * row, a `QuotaReadout` on the feature's own card. The bar is "a paying
 * customer can find this number without being refused first", not a
 * particular component.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'
import { DOCS_HELP_ANCHORS } from '../constants/docs-help.generated'

const REPO = join(__dirname, '..', '..', '..')

/**
 * Files that render a MEASURED figure — a meter, a `QuotaReadout`, a
 * usage caption. Appearing here means the customer can read how much of the
 * quota they have spent, not merely what the ceiling is.
 *
 * The split below (usage vs limit-only) is the second version of this guard,
 * and it exists because the first version could not tell those apart.
 * `emailSendsPerMonth` passed the original check the whole time it had no
 * usage readout anywhere: the key name appears in `billing/page.tsx` as the
 * plan bullet `5,000 campaign emails/mo`, a substring match satisfied the
 * "is it surfaced" test, and a merchant still learned their cap by having a
 * campaign refused. A ceiling with no odometer is exactly the defect this
 * file was written to stop, one level down — the guard was reading for the
 * key, not for the number.
 *
 * Feature cards from `libs/plugins/*` are included because AGL-2113 put five
 * quota readouts there rather than on the billing page, and a guard that only
 * read `apps/console` would call those five uncovered.
 */
const USAGE_SURFACES = [
  'apps/console/components/billing/billing-usage.component.tsx',
  'apps/console/components/billing/billing-metered-estimate.component.tsx',
  'apps/console/components/billing/billing-register-allocations-card.component.tsx',
  'apps/console/components/quota-warnings-banner.component.tsx',
  'apps/console/components/templates/host-templates-card.component.tsx',
  // The readout moved OUT of the card and into the page header (AGL-2501),
  // so the page is now a surface. The card stays on the list: it still owns
  // the count and the `templatesPerHost` check the readout is derived from.
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/templates/page.tsx',
  // AGL-2501 gave these two keys their first standing readout.
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx',
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/page.tsx',
  'libs/plugins/commerce/src/lib/components/console/locations-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/registers-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/products-hub-card.component.tsx',
  'libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx',
  'libs/plugins/workflows/src/lib/components/run-quota-line.component.tsx',
  'libs/plugins/redirects/src/lib/components/redirects-console-page.tsx',
  'libs/plugins/bookings/src/lib/components/bookings-console-page.tsx',
  'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx',
  'libs/plugins/crm/src/lib/components/contacts-section.tsx',
  'libs/plugins/email/src/lib/components/campaign-composer.tsx',
]

/**
 * Files that show the CEILING and no usage — the plan-comparison grid, the
 * current-plan bullets, the marketplace fee line. Real customer surfaces, and
 * they still satisfy "is this key mentioned anywhere", but on their own they
 * are the state this guard now refuses for an operating quota.
 */
const LIMIT_ONLY_SURFACES = [
  'apps/console/components/billing/billing-plan-cards.component.tsx',
  'apps/console/components/org-publish-panel.component.tsx',
  'apps/console/app/(app)/[orgSlug]/billing/(sections)/page.tsx',
  'libs/plugins/commerce/src/lib/components/console/payments-settings-card.component.tsx',
]

/**
 * Cards that name a quota ONLY in the refusal it raises — a snackbar at the
 * moment the click is denied. Deliberately neither of the above: a message
 * that appears once you are already blocked is the thing AGL-2113 set out to
 * replace, so counting it as a usage surface would let this guard bless the
 * defect. Both keys below are metered on the billing page regardless, which
 * is why classifying these honestly costs nothing.
 */
const REFUSAL_ONLY_SURFACES = [
  'libs/plugins/logic/src/lib/components/host-variables-card.component.tsx',
  'libs/plugins/logic/src/lib/components/host-functions-card.component.tsx',
]

const SURFACES = [
  ...USAGE_SURFACES,
  ...LIMIT_ONLY_SURFACES,
  ...REFUSAL_ONLY_SURFACES,
]

/**
 * Keys the customer DOES see, but whose name never appears in a component —
 * the value is computed in a helper and rendered under a hardcoded label.
 *
 * Declared rather than solved by adding the helper to `SURFACES`, because
 * that would let any key merely READ in a utility count as surfaced, which
 * is the proxy-that-stopped-tracking-its-target shape. Each entry pins both
 * ends: the helper that resolves the entitlement, and the literal label the
 * customer actually reads.
 */
const INDIRECT_SURFACES: Record<string, { via: string; renderedIn: string; label: string }> = {
  formSubmissionsPerMonth: {
    via: 'apps/console/utils/usage-metering.ts',
    renderedIn: 'apps/console/components/billing/billing-metered-estimate.component.tsx',
    label: "'Form submissions'",
  },
  /*
   * Metered twice over — the "Team seats" meter on the billing page and
   * `4 of 5 manager seats used` on the org members card — but never by this
   * name. `checkSeatQuota(org, 'managers', …)` is the only way anything asks
   * for it, and that helper resolves the key internally, so the string
   * `managersPerOrg` legitimately appears in no component.
   *
   * Surfaced by the seat helper rather than added to a surface list, for the
   * reason the block above gives: letting any file that merely READS a
   * quota count as a surface is the proxy-that-stopped-tracking-its-target
   * shape. Both ends are pinned — the helper must still map the kind to this
   * key, and the card must still render the seat line.
   */
  managersPerOrg: {
    via: 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
    renderedIn: 'apps/console/components/org-members-card.component.tsx',
    label: 'manager seats used',
  },
}

/**
 * Keys with no standing customer surface, each with the reason it is a
 * decision rather than an oversight. Anything not here must be surfaced.
 */
const SURFACE_EXCLUSIONS: Record<string, string> = {
  // Purchase CEILINGS, not operating caps. They bound how many add-on seats
  // the store will sell — the plan grid prints them as "(max N)" beside the
  // included figure, and a usage-vs-ceiling meter would be a meter of a
  // number the customer never operates against.
  maxManagersPerOrg: 'add-on purchase ceiling; shown as "(max N)" on the plan grid',
  maxMembersPerHost: 'add-on purchase ceiling; shown as "(max N)" on the plan grid',
  maxDatasetsPerOrg:
    'add-on purchase ceiling; surfaces in the downgrade-impact summary',
}

/**
 * Keys exempt from the USAGE half alone — they are surfaced, but there is no
 * "used" figure for them to show.
 *
 * The three percentages are RATES, not counters. `2% physical` is the whole
 * fact; there is no numerator, and inventing one ("$412 of fees paid this
 * month") would be a new figure to compute and reconcile against Stripe
 * rather than a readout of an existing meter. The rate itself IS shown — on
 * the plan grid, on the commerce payments settings card, and on the
 * marketplace publish panel — so the customer can always see what they are
 * charged before they are charged it.
 *
 * The three `max*` ceilings are already excluded outright above; they are not
 * repeated here.
 *
 * A cumulative fees-paid figure would be a genuine addition and is NOT
 * claimed by this exemption. What is claimed is narrower: a percentage has no
 * usage denominator, so the absence of a meter for it is not the
 * learn-your-cap-by-refusal defect.
 */
const USAGE_EXCLUSIONS: Record<string, string> = {
  transactionFeePhysicalPct:
    'a rate, not a counter — shown on the plan grid and the payments settings card',
  transactionFeeDigitalPct:
    'a rate, not a counter — shown on the plan grid and the payments settings card',
  marketplaceFeePct:
    'a rate, not a counter — shown on the plan grid and the marketplace publish panel',
}

const QUOTA_KEYS = Object.keys(PLAN_ENTITLEMENTS.free).filter(
  (key) => typeof (PLAN_ENTITLEMENTS.free as never as Record<string, unknown>)[key] === 'number',
)

const SURFACE_TEXT = SURFACES.map((file) => ({
  file,
  text: readFileSync(join(REPO, file), 'utf8'),
}))

const USAGE_TEXT = SURFACE_TEXT.filter(({ file }) =>
  USAGE_SURFACES.includes(file),
)

describe('AGL-2246 · every quota key is visible somewhere', () => {
  it('reads a real quota-key set from PLAN_ENTITLEMENTS', () => {
    // Assert the derivation produced something BEFORE asserting over it. A
    // rename of the record, or a shape change that made every value
    // non-numeric, would leave this empty and every check below would pass
    // by iterating nothing.
    expect(QUOTA_KEYS.length).toBeGreaterThanOrEqual(28)
    expect(QUOTA_KEYS).toContain('templatesPerHost')
    expect(QUOTA_KEYS).toContain('hostLimit')
    // The retired key must NOT be back (AGL-2133).
    expect(QUOTA_KEYS).not.toContain('totalSiteSizeMb')
  })

  it('reads real, non-empty surface files', () => {
    // Every path must exist and have content — a typo'd path would otherwise
    // silently remove a surface from the search and could only ever make the
    // coverage check FAIL, but a whole-list mistake would be invisible.
    expect(SURFACE_TEXT.length).toBe(SURFACES.length)
    for (const { file, text } of SURFACE_TEXT) {
      expect({ file, length: text.length > 400 }).toEqual({ file, length: true })
    }
  })

  it('every indirectly-surfaced key really reaches a rendered label', () => {
    // Both ends, so this cannot become a licence: the helper must name the
    // entitlement key, and the component must render the literal label the
    // customer reads. Losing either is the same invisibility as never having
    // built it.
    for (const [key, entry] of Object.entries(INDIRECT_SURFACES)) {
      expect(QUOTA_KEYS).toContain(key)
      expect(readFileSync(join(REPO, entry.via), 'utf8')).toContain(key)
      const rendered = readFileSync(join(REPO, entry.renderedIn), 'utf8')
      expect(rendered).toContain(entry.label)
    }
  })

  it('every exclusion names a real quota key', () => {
    // An exclusion for a key that no longer exists is a licence nobody
    // revoked; it would keep a renamed quota permanently exempt.
    for (const key of Object.keys(SURFACE_EXCLUSIONS)) {
      expect(QUOTA_KEYS).toContain(key)
      expect(SURFACE_EXCLUSIONS[key].length).toBeGreaterThan(20)
    }
  })

  it('has no quota key that is neither surfaced nor excluded', () => {
    const orphans = QUOTA_KEYS.filter(
      (key) =>
        !(key in SURFACE_EXCLUSIONS) &&
        !(key in INDIRECT_SURFACES) &&
        !SURFACE_TEXT.some(({ text }) => text.includes(key)),
    )
    expect(orphans).toEqual([])
  })

  it('the three surface buckets are disjoint and each is populated', () => {
    // The whole strength of the check below is the classification. If a file
    // drifted into both lists, or a list emptied, the usage test would go
    // quietly permissive rather than red.
    const all = [
      ...USAGE_SURFACES,
      ...LIMIT_ONLY_SURFACES,
      ...REFUSAL_ONLY_SURFACES,
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(USAGE_SURFACES.length).toBeGreaterThanOrEqual(12)
    expect(LIMIT_ONLY_SURFACES.length).toBeGreaterThanOrEqual(3)
    expect(USAGE_TEXT.length).toBe(USAGE_SURFACES.length)
  })

  it('every usage exemption names a real quota key and gives a reason', () => {
    for (const key of Object.keys(USAGE_EXCLUSIONS)) {
      expect(QUOTA_KEYS).toContain(key)
      expect(USAGE_EXCLUSIONS[key].length).toBeGreaterThan(20)
      // An exemption from the usage half is not an exemption from being
      // surfaced at all — a rate still has to be printed somewhere.
      expect(
        SURFACE_TEXT.some(({ text }) => text.includes(key)),
      ).toBe(true)
    }
  })

  it('no operating quota is limit-only — a ceiling without an odometer', () => {
    // THE REGRESSION THIS BUCKET SPLIT EXISTS FOR. `emailSendsPerMonth` was
    // enforced in `campaign-send.ts` against `campaignEmailSends`, warned
    // about by the usage-alerts cron at 80%, printed as a plan bullet — and
    // never once shown to the customer as a number they had spent. It
    // satisfied the "is it mentioned" test for as long as it existed.
    const limitOnly = QUOTA_KEYS.filter(
      (key) =>
        !(key in SURFACE_EXCLUSIONS) &&
        !(key in USAGE_EXCLUSIONS) &&
        !(key in INDIRECT_SURFACES) &&
        !USAGE_TEXT.some(({ text }) => text.includes(key)),
    )
    expect(limitOnly).toEqual([])
  })

  it('the campaign cap is metered against the ENFORCEABLE counter', () => {
    // `emailSends` beside it counts every receipt and password reset the
    // site sent (AGL-1438). Metering the cap against that total would show a
    // busy store most of its campaign allowance spent on order
    // confirmations, so the counter name is load-bearing, not cosmetic.
    const meter = USAGE_TEXT.find(({ file }) =>
      file.endsWith('billing-usage.component.tsx'),
    )?.text
    expect(meter).toContain("'campaignEmailSends'")
    expect(meter).toContain('limit={entitlements.emailSendsPerMonth}')

    const composer = USAGE_TEXT.find(({ file }) =>
      file.endsWith('campaign-composer.tsx'),
    )?.text
    expect(composer).toContain("'campaignEmailSends'")
    // Both halves of the wire, not the word: a card that destructured
    // `orgReady` away and passed `false` would still match a bare /ready/.
    expect(composer).toContain('const { org, ready: orgReady } = useOrgPlan(')
    expect(composer).toMatch(
      /<QuotaReadoutComponent[\s\S]*?ready=\{orgReady\}/,
    )
    // A monthly allowance must not be rendered as a lifetime one.
    expect(composer).toMatch(
      /<QuotaReadoutComponent[\s\S]*?period="this month"/,
    )
  })

  it('the meter help lands on the heading that explains the cap', () => {
    // Presence is not correctness: every panel pointing at the same topic
    // root passes a "has a help affordance" check. This pins the heading,
    // and pins that the heading is one the docs actually publish — the
    // anchor is compile-checked too, but a spec that reads the registry
    // fails on a docs restructure without waiting for a typecheck.
    const meter = USAGE_TEXT.find(({ file }) =>
      file.endsWith('billing-usage.component.tsx'),
    )?.text
    expect(meter).toContain(
      "docsHelp('emailCampaigns', { anchor: '#monthly-send-cap' })",
    )
    expect(DOCS_HELP_ANCHORS.emailCampaigns).toContain('#monthly-send-cap')
  })

  it('templatesPerHost is surfaced in the console AND on the plan grid', () => {
    // The specific regression this file was written for, pinned twice: the
    // console is where an operator hits the cap, the grid is where a shopper
    // compares plans. Either alone leaves half the gap.
    //
    // The two halves live in two files since AGL-2501 — the CARD owns the count
    // and the `templatesPerHost` check, the PAGE renders the readout in its
    // header beside the create button (the Sites-page arrangement). Asserted
    // separately rather than against a concatenation, so moving the readout
    // somewhere that renders nothing still reddens.
    const card = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('host-templates-card.component.tsx'),
    )
    const page = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('hosts/[host]/templates/page.tsx'),
    )
    const grid = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('billing-plan-cards.component.tsx'),
    )
    expect(card?.text).toContain('templatesPerHost')
    expect(page?.text).toContain('<QuotaReadoutComponent')
    // `entitlements.` and not the bare key: the grid also carries a COMMENT
    // naming `templatesPerHost`, and asserting the bare name passed while the
    // rendered row was deleted. Proven by mutating exactly that way.
    expect(grid?.text).toContain('quotaLabel(entitlements.templatesPerHost)')
  })

  it('the templates readout waits for the plan before naming a limit', () => {
    // `checkQuota(undefined, …)` resolves the FREE tier, so a readout that
    // rendered a denominator before the org doc landed would tell a Business
    // customer their cap is 10.
    //
    // The page reads `quota.ready`, which is the card's `orgReady` published
    // through `onQuota` — so the rule is unchanged and only the wire is new.
    // Both halves are pinned: the card must still SEND the flag, and the page
    // must still HONOUR it. Asserting only the page would pass on a card that
    // had started publishing `ready: true` unconditionally.
    const card = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('host-templates-card.component.tsx'),
    )?.text
    const page = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('hosts/[host]/templates/page.tsx'),
    )?.text
    expect(card).toMatch(/onQuota\?\.\(\{\s*ready: orgReady/)
    expect(page).toMatch(/<QuotaReadoutComponent[\s\S]*?ready=\{quota\.ready\}/)
  })

  /**
   * The two quota keys AGL-2501 gave a standing surface for the first time.
   *
   * `screensPerHost` and `sharedLayoutsPerHost` were both enforced on create
   * and readable nowhere — an author learned the cap by being refused, which
   * is the exact failure this file exists to end. They are asserted with the
   * same two-part rule as templates: the key is checked, and the readout is
   * gated on the plan having resolved.
   */
  it('screensPerHost and sharedLayoutsPerHost have standing readouts', () => {
    const screens = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('hosts/[host]/screens/page.tsx'),
    )?.text
    const layouts = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('hosts/[host]/layouts/page.tsx'),
    )?.text
    expect(screens).toContain("'screensPerHost'")
    expect(screens).toMatch(/<QuotaReadoutComponent[\s\S]*?ready=\{orgReady\}/)
    expect(layouts).toContain("'sharedLayoutsPerHost'")
    expect(layouts).toMatch(/<QuotaReadoutComponent[\s\S]*?ready=\{orgReady\}/)
  })
})
