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
 * WHERE A BARE HUB URL LANDS, AND WHAT THE RAIL OFFERS (AGL-2630).
 *
 * Two shells mount a plugin hub — the site route and the organization-level
 * CRM route — and both resolve their rail and their redirect through these
 * helpers, so the rule is asserted once here rather than twice through two
 * pages' worth of hooks. What has to hold: a section flagged off is offered
 * to staff and to nobody else; a section the plan lacks is drawn locked and
 * never landed on; and a bare `/crm` goes to the FIRST section this reader
 * may actually open, or nowhere when there is none.
 */

import type { ConsoleNavSection, ReleaseFlagKey } from '@aglyn/aglyn'
import {
  hubLandingHref,
  releaseFlagForNavTab,
  resolveHubSections,
} from '../utils/plugin-hub-sections'

/** An org on the Free plan: nothing under `features` is granted. */
const FREE_ORG = { $id: 'org-1', features: {} }
/** An org whose plan carries the CRM: Starter, the lowest plan that does. */
const CRM_ORG = { $id: 'org-1', plan: 'starter', subscription: { status: 'active' } }

/**
 * A hub with one section on every plan and two on a paid one, for the
 * section-level rule. The CRM declares its flag on the extension instead,
 * which the last describe runs.
 */
const SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'contacts', label: 'Contacts', featureFlag: 'crm' },
  { id: 'leads', label: 'Leads' },
  { id: 'deals', label: 'Deals', featureFlag: 'crm' },
]

/** Every known flag released, unless overridden. */
function flags(overrides: Partial<Record<ReleaseFlagKey, boolean>> = {}) {
  return new Proxy({} as Record<ReleaseFlagKey, { released: boolean }>, {
    get: (_target, key) => ({
      released: overrides[key as ReleaseFlagKey] ?? true,
    }),
  })
}

describe('resolveHubSections', () => {
  it('builds every href under the base path and answers nothing without one', () => {
    const rail = resolveHubSections(SECTIONS, '/acme/crm', {
      flags: flags(),
      isStaff: false,
      org: CRM_ORG,
      orgReady: true,
    })
    expect(rail?.map((section) => section.href)).toEqual([
      '/acme/crm/contacts',
      '/acme/crm/leads',
      '/acme/crm/deals',
    ])
    expect(resolveHubSections(SECTIONS, undefined, {
      flags: flags(),
      isStaff: false,
      org: CRM_ORG,
      orgReady: true,
    })).toBeUndefined()
    expect(resolveHubSections([], '/acme/crm', {
      flags: flags(),
      isStaff: false,
      org: CRM_ORG,
      orgReady: true,
    })).toBeUndefined()
  })

  it('LOCKS the sections the plan lacks, and only once the plan has settled', () => {
    const settled = resolveHubSections(SECTIONS, '/acme/crm', {
      flags: flags(),
      isStaff: false,
      org: FREE_ORG,
      orgReady: true,
    })
    expect(settled?.map((section) => section.locked)).toEqual([true, false, true])
    // An unsettled org draws no lock: a lock is a claim about the plan.
    const pending = resolveHubSections(SECTIONS, '/acme/crm', {
      flags: flags(),
      isStaff: false,
      org: undefined,
      orgReady: false,
    })
    expect(pending?.every((section) => !section.locked)).toBe(true)
  })

  it('offers a flagged-off section to staff and hides it from everyone else', () => {
    const flagged: ConsoleNavSection[] = [
      ...SECTIONS,
      { id: 'reports', label: 'Reports', navTabId: 'nav-tab-contacts' },
    ]
    const flagKey = releaseFlagForNavTab('nav-tab-contacts')
    expect(flagKey).toBeDefined()
    const off = flags({ [flagKey as ReleaseFlagKey]: false })
    const customer = resolveHubSections(flagged, '/acme/crm', {
      flags: off,
      isStaff: false,
      org: CRM_ORG,
      orgReady: true,
    })
    expect(customer?.find((section) => section.id === 'reports')?.visible).toBe(false)
    const staff = resolveHubSections(flagged, '/acme/crm', {
      flags: off,
      isStaff: true,
      org: CRM_ORG,
      orgReady: true,
    })
    expect(staff?.find((section) => section.id === 'reports')?.visible).toBe(true)
    // A section with no tab id answers to no flag at all.
    expect(releaseFlagForNavTab(undefined)).toBeUndefined()
  })
})

describe('hubLandingHref', () => {
  it('lands a bare hub on the first section the reader may OPEN', () => {
    const rail = resolveHubSections(SECTIONS, '/acme/crm', {
      flags: flags(),
      isStaff: false,
      org: CRM_ORG,
      orgReady: true,
    })
    expect(hubLandingHref(rail)).toBe('/acme/crm/contacts')
  })

  it('skips a locked first section rather than landing on an upgrade notice', () => {
    const rail = resolveHubSections(
      [{ id: 'deals', label: 'Deals', featureFlag: 'crm' }, ...SECTIONS],
      '/acme/crm',
      { flags: flags(), isStaff: false, org: FREE_ORG, orgReady: true },
    )
    expect(rail?.[0]).toMatchObject({ id: 'deals', locked: true })
    expect(hubLandingHref(rail)).toBe('/acme/crm/leads')
  })

  it('skips a hidden first section rather than landing on a coming-soon notice', () => {
    const flagKey = releaseFlagForNavTab('nav-tab-contacts') as ReleaseFlagKey
    const rail = resolveHubSections(
      [{ id: 'reports', label: 'Reports', navTabId: 'nav-tab-contacts' }, ...SECTIONS],
      '/acme/crm',
      { flags: flags({ [flagKey]: false }), isStaff: false, org: CRM_ORG, orgReady: true },
    )
    expect(hubLandingHref(rail)).toBe('/acme/crm/contacts')
  })

  it('answers nowhere when nothing is open to this reader', () => {
    const rail = resolveHubSections(
      [{ id: 'deals', label: 'Deals', featureFlag: 'crm' }],
      '/acme/crm',
      { flags: flags(), isStaff: false, org: FREE_ORG, orgReady: true },
    )
    expect(hubLandingHref(rail)).toBeUndefined()
    expect(hubLandingHref(undefined)).toBeUndefined()
  })
})

/**
 * A HUB WHOSE EXTENSION THE PLAN LACKS — the CRM on Free (AGL-2851).
 *
 * The CRM declares `features.crm` once, on its extension, and no section
 * declares a flag. On a plan without it every section is locked whatever it
 * declares itself, Leads included, so a bare `/crm` lands nowhere and the
 * shell answers it with the upgrade notice beside the rail. A lock is the
 * plan's verdict and nothing else, so staff inside a Free workspace draw the
 * locks its members draw. The plan read is the effective one: a dead
 * subscription reads as Free, and a per-org grant on Free as the CRM.
 */
describe('a hub whose extension the plan lacks (AGL-2851)', () => {
  const CRM_RAIL: readonly ConsoleNavSection[] = [
    { id: 'contacts', label: 'Contacts' },
    { id: 'leads', label: 'Leads' },
    { id: 'deals', label: 'Deals' },
  ]
  const rail = (org: unknown, isStaff = false, orgReady = true) =>
    resolveHubSections(CRM_RAIL, '/acme/crm', {
      flags: flags(),
      isStaff,
      org,
      orgReady,
      featureFlag: 'crm',
    })
  const lockedIds = (sections: ReturnType<typeof rail>) =>
    (sections ?? []).filter((section) => section.locked).map((section) => section.id)

  it('locks every section on Free, Leads included, and lands nowhere', () => {
    const free = rail({ $id: 'org-1', plan: 'free' })
    expect(lockedIds(free)).toEqual(['contacts', 'leads', 'deals'])
    // Locked, not hidden: each links to its own notice.
    expect(free?.every((section) => section.visible)).toBe(true)
    expect(hubLandingHref(free)).toBeUndefined()
  })

  it('locks the same sections for staff inside a Free workspace', () => {
    const staff = rail({ $id: 'org-1', plan: 'free' }, true)
    expect(lockedIds(staff)).toEqual(['contacts', 'leads', 'deals'])
    expect(hubLandingHref(staff)).toBeUndefined()
  })

  it('opens every section on Starter and lands a bare /crm on Contacts', () => {
    const starter = rail(CRM_ORG)
    expect(lockedIds(starter)).toEqual([])
    expect(hubLandingHref(starter)).toBe('/acme/crm/contacts')
  })

  it('reads a dead subscription as Free and a per-org grant on Free as the CRM', () => {
    expect(hubLandingHref(rail({ plan: 'pro', billingStatus: 'canceled' }))).toBeUndefined()
    expect(
      hubLandingHref(rail({ plan: 'free', entitlements: { features: { crm: true } } })),
    ).toBe('/acme/crm/contacts')
  })

  it('draws no lock while the org has not settled', () => {
    expect(lockedIds(rail(undefined, false, false))).toEqual([])
  })
})
