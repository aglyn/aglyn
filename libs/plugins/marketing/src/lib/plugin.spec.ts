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

import * as Aglyn from '@aglyn/aglyn'
import { pluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerMarketingConsole } from './plugin'

describe('marketing plugin', () => {
  it('registers a console-only, always-on Marketing page', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(extension?.featureFlag).toBeUndefined()
    expect(extension?.navItems?.[0]?.href).toBe('/marketing')
    expect(extension?.navItems?.[0]?.Component).toBeDefined()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeUndefined()
  })

  /**
   * The registry is what makes a section a ROUTE.
   *
   * The shell resolves `/marketing/{id}` against this declaration and 404s an
   * id it does not find, so a page that switches on `campaigns` is reachable
   * only if `campaigns` is declared here. The page's own specs pass the
   * section id in directly — they are testing the body, not the routing — and
   * would go on passing with the section removed from the rail, which is a
   * surface nobody can navigate to.
   */
  it('declares campaigns as a routed section', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    const sections = extension?.navItems?.[0]?.sections ?? []
    expect(sections.map((section) => section.id)).toContain('campaigns')
    expect(
      sections.find((section) => section.id === 'campaigns')?.label,
    ).toBe('Campaigns')
  })

  /*
   * ANTI-VACUITY. The reading above is "the list contains an id", which an
   * empty list cannot satisfy but a list of one could be gamed into — this is
   * the reading that says the rail is the whole rail.
   */
  it('CONTROL: the rail is the surface’s own, in its own order', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(
      (extension?.navItems?.[0]?.sections ?? []).map((section) => section.id),
    ).toEqual([
      'overview',
      'campaigns',
      'conversions',
      'overlays',
      'experiments',
    ])
  })

  /*
   * THE ORGANIZATION'S HUB. The same page is declared at
   * `/[orgSlug]/marketing` with the site rail's sections, in the site rail's
   * order, so a bare org URL lands where a site's does — and it carries the
   * SITE tab's id, so `release_marketing` holds both halves behind one flag.
   */
  it('declares an org-level Marketing hub behind the same release flag', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    const orgItem = extension?.orgNavItems?.[0]
    expect(orgItem?.href).toBe('/marketing')
    expect(orgItem?.Component).toBe(extension?.navItems?.[0]?.Component)
    expect((orgItem?.sections ?? []).map((section) => section.id)).toEqual(
      (extension?.navItems?.[0]?.sections ?? []).map((section) => section.id),
    )
    expect(orgItem?.navTabId).toBe(extension?.navItems?.[0]?.navTabId)
    expect(
      Aglyn.RELEASE_FLAGS.find((flag) => flag.navTabId === orgItem?.navTabId)
        ?.key,
    ).toBe('release_marketing')
  })

  /*
   * ANTI-VACUITY for the equality above, which two empty rails satisfy: the
   * org rail is the whole rail, and the organization's messages are not in
   * it — they are the org Emails page's, as a site's are its own.
   */
  it('CONTROL: the org rail is the five sections, and no emails', () => {
    registerMarketingConsole()
    const orgItem = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )?.orgNavItems?.[0]
    expect((orgItem?.sections ?? []).map((section) => section.id)).toEqual([
      'overview',
      'campaigns',
      'conversions',
      'overlays',
      'experiments',
    ])
  })

  /*
   * An org section is a fan-out over sites, so the two paid ones are gated by
   * the SHELL, before the page mounts a read per site. The site rail leaves
   * the same checks to its cards, which read one site.
   */
  it('gates the org hub’s overlays and A/B testing on their plan flags', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    const gate = (id: string) =>
      extension?.orgNavItems?.[0]?.sections?.find((section) => section.id === id)
        ?.featureFlag
    expect(gate('overlays')).toBe('marketingOverlays')
    expect(gate('experiments')).toBe('abTesting')
    // The landing and the campaign sections are on every plan the hub is.
    expect(gate('overview')).toBeUndefined()
    expect(gate('campaigns')).toBeUndefined()
    expect(gate('conversions')).toBeUndefined()
  })

  it('publishes a campaign’s address at both levels', () => {
    registerMarketingConsole()
    const route = pluginRecordRoute('campaign')?.route
    expect(route?.record({ orgSlug: 'acme', host: 'shop' }, 'camp-1')).toBe(
      '/acme/hosts/shop/marketing/campaigns/camp-1',
    )
    expect(route?.record({ orgSlug: 'acme', host: null }, 'camp-1')).toBe(
      '/acme/marketing/campaigns/camp-1',
    )
    expect(route?.list({ orgSlug: 'acme', host: null })).toBe(
      '/acme/marketing/campaigns',
    )
  })
})
