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
import { CRM_CONSOLE_SECTIONS } from '@aglyn/plugins-crm/components/crm-console-sections'
import {
  hubLandingHref,
  releaseFlagForNavTab,
  resolveHubSections,
} from '../utils/plugin-hub-sections'

/** An org on the Free plan: nothing under `features` is granted. */
const FREE_ORG = { $id: 'org-1', features: {} }
/** An org holding the CRM suite: Starter, the lowest plan that carries it. */
const CRM_ORG = { $id: 'org-1', plan: 'starter', subscription: { status: 'active' } }

/** The CRM's shape (AGL-2790): Leads on every plan, Contacts and Deals the suite's. */
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
 * THE CRM RAIL AS IT SHIPS, BY PLAN (AGL-2790).
 *
 * The cases above run a fixture; these run `CRM_CONSOLE_SECTIONS` itself,
 * the list both shells mount. On a plan without the CRM suite Contacts is
 * locked with the rest of the suite, Leads is the one section open, and a
 * bare `/crm` lands there; on Starter nothing is locked and the landing is
 * Contacts, as it always was. The plan read is the effective one, so a dead
 * subscription reads as Free and a per-org grant as the suite.
 */
describe('the CRM rail as it ships, by plan (AGL-2790)', () => {
  const rail = (org: unknown, isStaff = false) =>
    resolveHubSections(CRM_CONSOLE_SECTIONS, '/acme/crm', {
      flags: flags(),
      isStaff,
      org,
      orgReady: true,
    })
  const lockedIds = (sections: ReturnType<typeof rail>) =>
    (sections ?? []).filter((section) => section.locked).map((section) => section.id)

  it('locks Contacts with the rest of the suite on Free, opens Leads, and lands there', () => {
    const free = rail({ $id: 'org-1', plan: 'free' })
    expect(lockedIds(free)).toEqual([
      'contacts',
      'companies',
      'deals',
      'tasks',
      'reports',
      'fields',
      'settings',
    ])
    expect(free?.find((section) => section.id === 'leads')).toMatchObject({
      visible: true,
      locked: false,
    })
    expect(hubLandingHref(free)).toBe('/acme/crm/leads')
  })

  it('locks the same sections for staff inside a Free workspace', () => {
    const staff = rail({ $id: 'org-1', plan: 'free' }, true)
    expect(lockedIds(staff)).toContain('contacts')
    expect(hubLandingHref(staff)).toBe('/acme/crm/leads')
  })

  it('opens every section on Starter and lands a bare /crm on Contacts', () => {
    const starter = rail({ $id: 'org-1', plan: 'starter', subscription: { status: 'active' } })
    expect(lockedIds(starter)).toEqual([])
    expect(hubLandingHref(starter)).toBe('/acme/crm/contacts')
  })

  it('reads a dead subscription as Free and a per-org grant on Free as the suite', () => {
    expect(hubLandingHref(rail({ plan: 'pro', billingStatus: 'canceled' }))).toBe(
      '/acme/crm/leads',
    )
    expect(
      hubLandingHref(rail({ plan: 'free', entitlements: { features: { crm: true } } })),
    ).toBe('/acme/crm/contacts')
  })
})
