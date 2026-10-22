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
 * The Marketplace hub's sections are ROUTES (AGL-2501), served by a
 * DECLARATION (AGL-3080).
 *
 * Three things follow from being routes and none of them followed from
 * `?tab=`: a section is reachable by typing its URL, the back button walks
 * sections because each one is a navigation, and the breadcrumb can name the
 * section the reader is on because the URL says which that is.
 *
 * The fourth is the one that bites if it is got wrong. As panels, the four
 * seller sections were simply not rendered for a member without
 * `publishToMarketplace`; as routes each has a URL that can be typed, so the
 * rail no longer decides what is reachable and the refusal has to sit above
 * the pages. Payouts and Sales render the organization's revenue.
 *
 * ## What changed here, and why the subject moved
 *
 * This used to render the marketplace's own `(sections)/layout.tsx` and read
 * the rail out of the DOM, because that layout was where all four properties
 * were implemented. There is no such layout now: the hub is an `orgNavItems`
 * declaration and the shell's generic org plugin route implements all four
 * for every plugin surface at once. The shell's half is held by
 * `plugin-hub-sections.spec.ts` and the route's own specs; what is left —
 * and what could still silently change — is the DECLARATION: eight sections,
 * in this order, with the seller four naming the permission.
 *
 * So the assertions below run the declaration through the same resolver the
 * rail and the page body both read, which is what keeps a hidden tab and a
 * refused deep link one verdict rather than two.
 *
 * ⛔ It registers NOTHING itself. The plugin is reached through the generated
 * manifest, so a declaration that stopped being registered — or a plugin
 * dropped from the manifest — fails here rather than resolving to an empty
 * rail that every "does not offer" assertion below would happily satisfy.
 */

import {
  listConsoleOrgNavItems,
  resolveConsoleOrgPluginPage,
  resetPluginServicesForTests,
  type ReleaseFlagKey,
} from '@aglyn/aglyn'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'
import { resolveHubSections } from '../utils/plugin-hub-sections'

const BASE = '/acme/marketplace'

/** Every known flag released, unless overridden. */
function flags(overrides: Partial<Record<ReleaseFlagKey, boolean>> = {}) {
  return new Proxy({} as Record<ReleaseFlagKey, { released: boolean }>, {
    get: (_target, key) => ({
      released: overrides[key as ReleaseFlagKey] ?? true,
    }),
  })
}

/** An org on a paid plan, so no entitlement branch is in play here. */
const ORG = { $id: 'org-1', plan: 'starter', subscription: { status: 'active' } }

function rail(publishToMarketplace: boolean | undefined, loaded = true) {
  const navItem = listConsoleOrgNavItems().find(
    (entry) => entry.navItem.href === '/marketplace',
  )?.navItem
  expect(navItem).toBeDefined()
  return resolveHubSections(navItem?.sections, BASE, {
    flags: flags(),
    isStaff: false,
    org: ORG,
    orgReady: true,
    permission: {
      can: () => Boolean(publishToMarketplace),
      permissions: { publishToMarketplace },
      loaded,
    },
  })
}

beforeAll(async () => {
  resetPluginServicesForTests()
  const entry = CONSOLE_PLUGIN_MANIFEST.find((row) => row.id === 'marketplace')
  expect(entry).toBeDefined()
  const loaded = (await entry?.load()) as Record<string, () => void>
  loaded[String(entry?.register?.console)]()
})

describe('the Marketplace hub declares its sections', () => {
  /**
   * CONTROL, and it is load-bearing.
   *
   * Several assertions below are of the form "the rail does NOT offer X", and
   * a rail that resolved to nothing at all would satisfy every one. This is
   * the reading that proves the rail is drawn and drawn completely, so that
   * an absence measured later is a real absence.
   */
  it('CONTROL: the rail offers every section, as links', () => {
    expect(rail(true)?.map((section) => section.href)).toEqual([
      `${BASE}/browse`,
      `${BASE}/installed`,
      `${BASE}/licences`,
      `${BASE}/upload`,
      `${BASE}/profile`,
      `${BASE}/listings`,
      `${BASE}/payouts`,
      `${BASE}/sales`,
    ])
  })

  it('a section is reachable by URL, and resolves to itself', () => {
    for (const id of [
      'browse',
      'installed',
      'licences',
      'upload',
      'profile',
      'listings',
      'payouts',
      'sales',
    ]) {
      const resolved = resolveConsoleOrgPluginPage(`/marketplace/${id}`)
      expect(resolved?.section?.id).toBe(id)
    }
  })

  it('the rail labels each section the way the breadcrumb will name it', () => {
    // The shell builds the trail's last crumb from the resolved section's
    // label, so these two cannot drift: a section listed under one name and
    // trailed under another is the defect four earlier hubs were corrected
    // for.
    expect(rail(true)?.map((section) => section.label)).toEqual([
      'Browse All',
      'Installed',
      'Licenses',
      'Upload / Publish',
      'Publisher Profile',
      'Listings',
      'Payouts',
      'Sales',
    ])
  })

  describe('the seller sections are gated above the pages', () => {
    it('a member without publish permission is not offered them', () => {
      expect(
        rail(false)
          ?.filter((section) => section.visible)
          .map((section) => section.id),
      ).toEqual(['browse', 'installed', 'licences'])
    })

    it('and the fail-open permission window offers none of them either', () => {
      /*
       * `useOrgPermissions` answers as an ADMIN until the member read lands.
       * Offering the rail during that window puts Payouts and Sales — which
       * render the org's revenue — in front of a member about to be refused
       * them.
       */
      expect(
        rail(true, false)
          ?.filter((section) => section.visible)
          .map((section) => section.id),
      ).toEqual(['browse', 'installed', 'licences'])
    })

    it('and each seller section names the permission, so a typed URL is refused too', () => {
      // The rail hiding an entry is not a gate: a route is reachable whether
      // or not a tab was offered. The shell refuses the body from this same
      // key, which is what makes the two one verdict.
      for (const id of ['upload', 'profile', 'listings', 'payouts', 'sales']) {
        expect(
          resolveConsoleOrgPluginPage(`/marketplace/${id}`)?.section?.permission,
        ).toBe('publishToMarketplace')
      }
      // …and the buyer-side three do not, deliberately (AGL-2331): the person
      // who needs Licenses is often not a publisher at all.
      for (const id of ['browse', 'installed', 'licences']) {
        expect(
          resolveConsoleOrgPluginPage(`/marketplace/${id}`)?.section?.permission,
        ).toBeUndefined()
      }
    })
  })
})
