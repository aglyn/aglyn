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

import type { ConsoleOrgNavEntry, OrgPermission } from '@aglyn/aglyn'
import {
  orgPluginNavTabItems,
  orgPluginRefusalSellsSomething,
  resolveOrgPluginReach,
  type OrgPluginTabAnswers,
} from './org-plugin-surfaces'

/**
 * The organization strip's plugin tabs and the org route's reach gate
 * (AGL-2974), pinned without mounting either.
 *
 * The Sequences-shaped fixture is the case the rules exist for: an
 * entitlement no plan carries, and a permission only owners and admins hold
 * by default. The CONTROLS beside each refusal are the entitled, permitted
 * reader, so a function that dropped every tab cannot pass.
 */

const Page = (): null => null

const outreach: ConsoleOrgNavEntry = {
  extension: {
    pluginId: 'outreach',
    displayName: 'Sequences',
    featureFlag: 'outreach',
    permission: 'outreach.use',
    upgradeNotice: { message: "Sequences isn't available to this workspace yet." },
  },
  navItem: {
    label: 'Sequences',
    href: '/outreach',
    navTabId: 'nav-tab-org-outreach',
    sections: [
      { id: 'sequences', label: 'All sequences' },
      { id: 'mailboxes', label: 'Mailboxes' },
    ],
    Component: Page,
  },
}

/** An org surface whose entitlement a plan DOES sell (the CRM's, from Starter). */
const sold: ConsoleOrgNavEntry = {
  extension: { pluginId: 'sold', displayName: 'Sold', featureFlag: 'crm' },
  navItem: { label: 'Sold', href: '/sold', Component: Page },
}

/** The dotted catalog grants nothing here; the plugin key answers from `permissions`. */
const never: (permission: OrgPermission) => boolean = () => false

function answers(overrides: Partial<OrgPluginTabAnswers> = {}): OrgPluginTabAnswers {
  return {
    can: never,
    permissions: { 'outreach.use': true },
    permissionsLoaded: true,
    org: { plan: 'free', entitlements: { features: { outreach: true } } },
    orgReady: true,
    ...overrides,
  }
}

describe('resolveOrgPluginReach', () => {
  it('holds while memberships load, because orgWide fails open', () => {
    expect(resolveOrgPluginReach({ orgWide: true, reachReady: false })).toBe(
      'pending',
    )
  })

  it('refuses a scoped collaborator and admits an org-wide member', () => {
    expect(resolveOrgPluginReach({ orgWide: false, reachReady: true })).toBe(
      'refused',
    )
    expect(resolveOrgPluginReach({ orgWide: true, reachReady: true })).toBe(
      'granted',
    )
  })
})

describe('orgPluginRefusalSellsSomething', () => {
  it('says nothing is sold for an entitlement no plan carries and no card names', () => {
    expect(orgPluginRefusalSellsSomething(outreach.extension)).toBe(false)
  })

  it('CONTROL: a plan that carries the feature is something to sell', () => {
    expect(orgPluginRefusalSellsSomething(sold.extension)).toBe(true)
  })

  it('an add-on card the extension names is something to sell', () => {
    expect(
      orgPluginRefusalSellsSomething({
        ...outreach.extension,
        upgradeNotice: { message: 'Buy it', billingAnchor: 'addons' },
      }),
    ).toBe(true)
  })
})

describe('orgPluginNavTabItems', () => {
  it('CONTROL: an entitled org and a permitted reader get the tab, at the landing section', () => {
    expect(orgPluginNavTabItems('acme', [outreach], answers())).toEqual([
      {
        id: 'nav-tab-org-outreach',
        label: 'Sequences',
        href: '/acme/outreach/sequences',
      },
    ])
  })

  it('drops the tab for a reader without the permission', () => {
    expect(
      orgPluginNavTabItems(
        'acme',
        [outreach],
        answers({ permissions: { 'outreach.use': false } }),
      ),
    ).toEqual([])
  })

  it('drops the tab for an org without the entitlement, when the refusal sells nothing', () => {
    expect(
      orgPluginNavTabItems(
        'acme',
        [outreach],
        answers({ org: { plan: 'enterprise' } }),
      ),
    ).toEqual([])
  })

  it('keeps a locked tab whose refusal sells the feature, as the site strip does', () => {
    const tabs = orgPluginNavTabItems('acme', [sold], answers({ org: { plan: 'free' } }))
    expect(tabs.map((tab) => tab.href)).toEqual(['/acme/sold'])
  })

  it('holds the tab back until the org read has settled', () => {
    expect(
      orgPluginNavTabItems('acme', [outreach], answers({ orgReady: false })),
    ).toEqual([])
    expect(
      orgPluginNavTabItems(
        'acme',
        [outreach],
        answers({ orgReady: false, permissionsLoaded: false }),
      ),
    ).toEqual([])
  })

  it('keeps the tab in its place, disabled, while only the member read is unsettled (AGL-3337)', () => {
    expect(
      orgPluginNavTabItems('acme', [outreach], answers({ permissionsLoaded: false })),
    ).toEqual([
      {
        id: 'nav-tab-org-outreach',
        label: 'Sequences',
        href: '/acme/outreach/sequences',
        disabled: true,
      },
    ])
  })

  it('CONTROL: the placeholder never outlives a settled refusal or a plan that sells nothing', () => {
    expect(
      orgPluginNavTabItems(
        'acme',
        [outreach],
        answers({ permissions: { 'outreach.use': false } }),
      ),
    ).toEqual([])
    expect(
      orgPluginNavTabItems(
        'acme',
        [outreach],
        answers({ permissionsLoaded: false, org: { plan: 'enterprise' } }),
      ),
    ).toEqual([])
  })
})
