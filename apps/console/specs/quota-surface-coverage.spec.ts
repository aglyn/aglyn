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

const REPO = join(__dirname, '..', '..', '..')

/**
 * Files a customer can actually reach. Feature cards from `libs/plugins/*`
 * are included because AGL-2113 put five quota readouts there rather than on
 * the billing page, and a guard that only read `apps/console` would call
 * those five uncovered.
 */
const SURFACES = [
  'apps/console/components/billing/billing-usage.component.tsx',
  'apps/console/components/billing/billing-plan-cards.component.tsx',
  'apps/console/components/billing/billing-metered-estimate.component.tsx',
  'apps/console/components/billing/billing-register-allocations-card.component.tsx',
  'apps/console/components/quota-warnings-banner.component.tsx',
  'apps/console/components/templates/host-templates-card.component.tsx',
  'apps/console/components/org-publish-panel.component.tsx',
  'apps/console/app/(app)/[orgSlug]/billing/page.tsx',
  'libs/plugins/commerce/src/lib/components/console/locations-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/registers-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/products-hub-card.component.tsx',
  'libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx',
  'libs/plugins/workflows/src/lib/components/run-quota-line.component.tsx',
  'libs/plugins/redirects/src/lib/components/redirects-console-page.tsx',
  'libs/plugins/bookings/src/lib/components/bookings-console-page.tsx',
  'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx',
  'libs/plugins/contacts/src/lib/components/contacts-console-page.tsx',
  'libs/plugins/logic/src/lib/components/host-variables-card.component.tsx',
  'libs/plugins/logic/src/lib/components/host-functions-card.component.tsx',
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

const QUOTA_KEYS = Object.keys(PLAN_ENTITLEMENTS.free).filter(
  (key) => typeof (PLAN_ENTITLEMENTS.free as never as Record<string, unknown>)[key] === 'number',
)

const SURFACE_TEXT = SURFACES.map((file) => ({
  file,
  text: readFileSync(join(REPO, file), 'utf8'),
}))

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

  it('templatesPerHost is surfaced on its own card AND on the plan grid', () => {
    // The specific regression this file was written for, pinned twice: the
    // card is where an operator hits the cap, the grid is where a shopper
    // compares plans. Either alone leaves half the gap.
    const card = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('host-templates-card.component.tsx'),
    )
    const grid = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('billing-plan-cards.component.tsx'),
    )
    expect(card?.text).toContain('templatesPerHost')
    expect(card?.text).toContain('<QuotaReadoutComponent')
    // `entitlements.` and not the bare key: the grid also carries a COMMENT
    // naming `templatesPerHost`, and asserting the bare name passed while the
    // rendered row was deleted. Proven by mutating exactly that way.
    expect(grid?.text).toContain('quotaLabel(entitlements.templatesPerHost)')
  })

  it('the templates readout waits for the plan before naming a limit', () => {
    // `checkQuota(undefined, …)` resolves the FREE tier, so a readout that
    // rendered a denominator before the org doc landed would tell a Business
    // customer their cap is 10.
    const card = SURFACE_TEXT.find(({ file }) =>
      file.endsWith('host-templates-card.component.tsx'),
    )?.text
    expect(card).toMatch(/<QuotaReadoutComponent[\s\S]*?ready=\{orgReady\}/)
  })
})
