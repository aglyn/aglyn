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
import { BUNDLE_ID } from './constants/bundle-common'
import { registerMarketplaceConsole } from './plugin'

describe('marketplace plugin', () => {
  it('owns the org marketplace as a surface, and no per-site nav tab', () => {
    /*
     * The marketplace moved to org scope (AGL-772/775) — no per-SITE nav tab
     * — and to a declaration (AGL-3080): the hub, the listing, the publisher
     * storefront and the publish form were seventeen hand-written console
     * routes, and are one `orgNavItems` entry the shell's generic org plugin
     * route serves.
     *
     * `ownsSubtree` is what keeps every URL: a segment naming a section
     * resolves as that section, and anything else beneath `/marketplace` is
     * handed to the page as `segments`. Without it, every listing's page is
     * a 404 — which is exactly the kind of thing that would ship quietly,
     * since the hub itself would go on working.
     */
    registerMarketplaceConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(extension).toBeDefined()
    expect(extension?.navItems ?? []).toHaveLength(0)

    const hub = (extension?.orgNavItems ?? []).find(
      (item) => item.href === '/marketplace',
    )
    expect(hub).toBeDefined()
    expect(hub?.Component).toBeDefined()
    expect(hub?.ownsSubtree).toBe(true)
    expect((hub?.sections ?? []).map((section) => section.id)).toEqual([
      'browse',
      'installed',
      'licences',
      'upload',
      'profile',
      'listings',
      'payouts',
      'sales',
    ])

    /*
     * What is left in the zones, and what is NOT. Four went with the routes
     * that drew them — a zone exists so a console page can show marketplace
     * UI without importing this plugin, and the hub is this plugin. These two
     * are drawn by console pages that are not the marketplace: the
     * installation detail page, and a site's layouts list.
     */
    const slots = (extension?.widgets ?? []).map((widget) => widget.slot)
    expect(slots.sort()).toEqual(['hostArtifactPublish', 'pluginSiteSet'])
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeUndefined()
  })

  it('is the last plugin tab on the org strip, beside Plugins (AGL-3294)', () => {
    /*
     * The strip draws plugin tabs as one block between the CRM and the
     * shell's Plugins tab, in `tabOrder` and then registration order. An org
     * surface registered AFTER the marketplace with no order still sorts
     * before it, which is what puts Marketplace next to Plugins.
     */
    registerMarketplaceConsole()
    Aglyn.registerConsoleExtension({
      pluginId: 'outreach',
      displayName: 'Sequences',
      orgNavItems: [{ label: 'Sequences', href: '/outreach', Component: () => null }],
    })
    const hrefs = Aglyn.listConsoleOrgNavItems().map((entry) => entry.navItem.href)
    expect(hrefs.indexOf('/marketplace')).toBe(hrefs.length - 1)
    expect(hrefs).toContain('/outreach')
    Aglyn.unregisterConsoleExtension('outreach')
  })
})
