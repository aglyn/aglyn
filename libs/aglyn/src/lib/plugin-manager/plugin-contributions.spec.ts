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

import {
  consoleLoadPoints,
  isPluginUsedInConsole,
  isPluginUsedOnPage,
  pagePresence,
  PLUGIN_MAX_CONTRIBUTIONS,
  readPluginContributions,
  routeServes,
  sanitizePluginContributions,
} from './plugin-contributions'

describe('sanitizePluginContributions (AGL-3116)', () => {
  it('keeps every surface, deduped, and drops empty lists', () => {
    expect(
      sanitizePluginContributions({
        site: { components: ['a', 'a', 'b'], features: [] },
        console: { slots: ['hostActivity'], routes: ['/x', '/x/y'], shell: true },
      }),
    ).toEqual({
      ok: true,
      contributions: {
        site: { components: ['a', 'b'] },
        console: { slots: ['hostActivity'], routes: ['/x', '/x/y'], shell: true },
      },
    })
  })

  it('drops a false shell, which declares nothing', () => {
    expect(sanitizePluginContributions({ console: { shell: false } })).toEqual({
      ok: true,
      contributions: {},
    })
  })

  it('refuses a list longer than the bound', () => {
    const components = Array.from(
      { length: PLUGIN_MAX_CONTRIBUTIONS + 1 },
      (_, index) => `c${index}`,
    )
    expect(sanitizePluginContributions({ site: { components } }).ok).toBe(false)
  })

  it('refuses unknown surfaces and keys, so a typo is not a silent no-op', () => {
    expect(sanitizePluginContributions({ sites: {} }).ok).toBe(false)
    expect(sanitizePluginContributions({ console: { slot: ['x'] } }).ok).toBe(false)
  })
})

describe('readPluginContributions', () => {
  it('reads an absent or malformed stored block as undeclared', () => {
    expect(readPluginContributions(undefined)).toBeUndefined()
    expect(readPluginContributions(null)).toBeUndefined()
    // A malformed block must never read as "contributes nothing", which would
    // stop a plugin that is in use; the default applies instead.
    expect(readPluginContributions({ site: 'x' })).toBeUndefined()
  })

  it('reads an explicit empty block as declaring nothing', () => {
    expect(readPluginContributions({})).toEqual({})
  })
})

describe('pagePresence', () => {
  it('collects component and plugin ids from every node', () => {
    const page = pagePresence({
      root: { componentId: 'documentRoot', pluginId: 'mui' },
      a: { componentId: 'muiTypography', pluginId: 'mui' },
      b: { componentId: 'promoBanner', pluginId: 'promo-countdown' },
      c: { componentId: 'muiTypography' },
      d: null,
      e: {},
    })
    expect([...page.componentIds].sort()).toEqual([
      'documentRoot',
      'muiTypography',
      'promoBanner',
    ])
    expect([...page.pluginIds].sort()).toEqual(['mui', 'promo-countdown'])
  })

  it('answers empty for no nodes', () => {
    expect(pagePresence(null).componentIds.size).toBe(0)
  })
})

describe('isPluginUsedOnPage', () => {
  const page = pagePresence({
    a: { componentId: 'muiTypography', pluginId: 'mui' },
    b: { componentId: 'officeHours', pluginId: 'ChiOYRKDeI' },
  })

  it('loads a console-only plugin nowhere on a published page', () => {
    expect(
      isPluginUsedOnPage(
        {
          pluginId: 'promo-countdown',
          listingId: 'Tfnrb4wJzF',
          contributes: { console: { slots: ['hostActivity'] } },
        },
        page,
      ),
    ).toBe(false)
  })

  it('loads a declared plugin where a node places one of its components', () => {
    const subject = {
      pluginId: 'weather',
      contributes: { site: { components: ['muiTypography'] } },
    }
    expect(isPluginUsedOnPage(subject, page)).toBe(true)
    expect(isPluginUsedOnPage(subject, pagePresence({}))).toBe(false)
  })

  it('loads a plugin with a site feature on every page', () => {
    expect(
      isPluginUsedOnPage(
        { pluginId: 'bar', contributes: { site: { features: ['bar'] } } },
        pagePresence({}),
      ),
    ).toBe(true)
  })

  it('loads an UNDECLARED plugin only where its element is placed', () => {
    expect(isPluginUsedOnPage({ pluginId: 'promo-countdown' }, page)).toBe(false)
    expect(
      isPluginUsedOnPage({ pluginId: 'office-hours', listingId: 'ChiOYRKDeI' }, page),
    ).toBe(true)
  })
})

describe('consoleLoadPoints', () => {
  it('loads an undeclared plugin with the shell, as it always did', () => {
    expect(consoleLoadPoints(undefined)).toEqual({
      shell: true,
      slots: [],
      routes: [],
      orgRoutes: [],
    })
  })

  it('loads a declared plugin only where it declares', () => {
    expect(consoleLoadPoints({ console: { slots: ['hostActivity'] } })).toEqual({
      shell: false,
      slots: ['hostActivity'],
      routes: [],
      orgRoutes: [],
    })
    expect(consoleLoadPoints({}).shell).toBe(false)
  })
})

describe('routeServes', () => {
  it('matches the route and what lies beneath it, on a segment boundary', () => {
    expect(routeServes('/products', '/products')).toBe(true)
    expect(routeServes('/products', '/products/orders')).toBe(true)
    expect(routeServes('/products', '/products-archive')).toBe(false)
    expect(routeServes('/products/orders', '/products')).toBe(false)
  })
})

describe('isPluginUsedInConsole (AGL-3142)', () => {
  const commerce = {
    console: {
      shell: true,
      slots: ['commerceGlance', 'hostDashboard'],
      routes: ['/pos', '/products'],
    },
  }
  const zonesOnly = { console: { slots: ['orgMarketplace'] } }
  const orgOnly = { console: { orgRoutes: ['/outreach'] } }

  it('puts a plugin on the shell only when it declares the shell', () => {
    expect(isPluginUsedInConsole(commerce, { at: 'shell' })).toBe(true)
    expect(isPluginUsedInConsole(zonesOnly, { at: 'shell' })).toBe(false)
    expect(isPluginUsedInConsole({}, { at: 'shell' })).toBe(false)
  })

  it('loads an undeclared plugin with the shell, and nowhere else', () => {
    expect(isPluginUsedInConsole(undefined, { at: 'shell' })).toBe(true)
    expect(
      isPluginUsedInConsole(undefined, { at: 'slots', slots: ['orgMarketplace'] }),
    ).toBe(false)
    expect(
      isPluginUsedInConsole(undefined, {
        at: 'route',
        href: '/outreach',
        level: 'org',
      }),
    ).toBe(false)
  })

  it('loads a plugin at a zone it declares, and at no other', () => {
    const at = (slots: string[]) =>
      isPluginUsedInConsole(zonesOnly, { at: 'slots', slots })
    expect(at(['orgMarketplace'])).toBe(true)
    // A screen rendering several zones, one of which is the plugin's.
    expect(at(['hostDashboard', 'orgMarketplace'])).toBe(true)
    expect(at(['hostDashboard'])).toBe(false)
    expect(at([])).toBe(false)
  })

  it('serves a declared route and what lies beneath it, never a neighbor', () => {
    const at = (href: string) =>
      isPluginUsedInConsole(commerce, { at: 'route', href, level: 'site' })
    expect(at('/products')).toBe(true)
    expect(at('/products/orders')).toBe(true)
    expect(at('/products-archive')).toBe(false)
    expect(at('/forms')).toBe(false)
  })

  it('never crosses a site route with an organization one', () => {
    const site = { at: 'route' as const, href: '/outreach', level: 'site' as const }
    const org = { at: 'route' as const, href: '/outreach', level: 'org' as const }
    expect(isPluginUsedInConsole(orgOnly, org)).toBe(true)
    expect(isPluginUsedInConsole(orgOnly, site)).toBe(false)
    // And the other way: a site route is not served at the organization level.
    expect(
      isPluginUsedInConsole(commerce, {
        at: 'route',
        href: '/products',
        level: 'org',
      }),
    ).toBe(false)
  })
})
