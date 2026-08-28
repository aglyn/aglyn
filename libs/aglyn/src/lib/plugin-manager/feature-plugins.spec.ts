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
  defineUiFeatureBundle,
  listConsoleExtensions,
  listConsoleNavItems,
  listConsoleProviders,
  listConsoleWidgets,
  MUI_BUNDLE_ID,
  registerConsoleExtension,
  resolveConsolePluginPage,
  unregisterConsoleExtension,
  type ComponentRegistrar,
} from './feature-plugins'

function fakeRegistrar() {
  const calls: string[] = []
  const registrar: ComponentRegistrar = {
    registerComponent: (_component, schema) =>
      calls.push(`+c:${schema.$id}`),
    registerPreset: (presets) =>
      calls.push(...presets.map((preset) => `+p:${preset.$id}`)),
    unregisterComponent: (componentId) => calls.push(`-c:${componentId}`),
    unregisterPreset: (presetIds) =>
      calls.push(...presetIds.map((id) => `-p:${id}`)),
  }
  return { calls, registrar }
}

const entry = {
  component: (): null => null,
  schema: { $id: 'event-list' } as any,
  presets: [{ $id: 'preset-event-list' } as any],
}

describe('defineUiFeatureBundle', () => {
  it('always depends on the mui bundle plus declared extras', () => {
    const bundle = defineUiFeatureBundle(
      {
        bundleId: 'events-calendar',
        displayName: 'Events Calendar',
        dependsOn: ['commerce'],
        components: [entry],
      },
      fakeRegistrar().registrar,
    )
    expect(bundle.$id).toBe('events-calendar')
    expect(bundle.dependencies).toEqual({
      [MUI_BUNDLE_ID]: true,
      commerce: true,
    })
  })

  it('registers on load and unregisters symmetrically on destroy', () => {
    const { calls, registrar } = fakeRegistrar()
    const bundle = defineUiFeatureBundle(
      {
        bundleId: 'events-calendar',
        displayName: 'Events Calendar',
        components: [entry],
      },
      registrar,
    )
    bundle.load?.()
    bundle.destroy?.()
    expect(calls).toEqual([
      '+c:event-list',
      '+p:preset-event-list',
      '-p:preset-event-list',
      '-c:event-list',
    ])
  })
})

describe('console extension registry', () => {
  afterEach(() => {
    for (const extension of listConsoleExtensions()) {
      unregisterConsoleExtension(extension.pluginId)
    }
  })

  it('registers, replaces by pluginId, and lists in order', () => {
    registerConsoleExtension({
      pluginId: 'events-calendar',
      displayName: 'Events',
      featureFlag: 'eventCalendar',
      navItems: [{ label: 'Events', href: '/manage/events' }],
    })
    registerConsoleExtension({
      pluginId: 'commerce',
      displayName: 'Store',
      featureFlag: 'commerce',
    })
    // Re-registration replaces, not duplicates.
    registerConsoleExtension({
      pluginId: 'events-calendar',
      displayName: 'Events Calendar',
    })
    const extensions = listConsoleExtensions()
    expect(extensions).toHaveLength(2)
    expect(extensions[0].displayName).toBe('Events Calendar')
    expect(extensions[1].pluginId).toBe('commerce')
  })

  it('unregisters cleanly', () => {
    registerConsoleExtension({ pluginId: 'x', displayName: 'X' })
    unregisterConsoleExtension('x')
    expect(listConsoleExtensions()).toHaveLength(0)
  })

  it('flattens nav items with their owning plugin id and flag', () => {
    registerConsoleExtension({
      pluginId: 'events-calendar',
      displayName: 'Events',
      featureFlag: 'eventCalendar',
      navItems: [
        { label: 'Events', href: '/events', navTabId: 'nav-tab-events' },
      ],
    })
    const [navItem] = listConsoleNavItems()
    expect(navItem).toMatchObject({
      label: 'Events',
      href: '/events',
      pluginId: 'events-calendar',
      featureFlag: 'eventCalendar',
    })
  })

  it('resolves a page only for a nav item that has a Component', () => {
    const Page = (): null => null
    registerConsoleExtension({
      pluginId: 'events-calendar',
      displayName: 'Events',
      featureFlag: 'eventCalendar',
      navItems: [
        { label: 'No page', href: '/no-page' },
        { label: 'Events', href: '/events', Component: Page },
      ],
    })
    expect(resolveConsolePluginPage('/no-page')).toBeUndefined()
    expect(resolveConsolePluginPage('/missing')).toBeUndefined()
    const resolved = resolveConsolePluginPage('/events')
    expect(resolved?.extension.pluginId).toBe('events-calendar')
    expect(resolved?.navItem.Component).toBe(Page)
  })

  /**
   * AGL-758: the registry only ever grows within a session, so after
   * visiting two workspaces it holds the union of both plugin sets. Every
   * read takes the caller's effective enabled ids so one workspace never
   * serves another's contributions.
   */
  describe('scoping reads to a workspace', () => {
    const Widget = (): null => null
    const Provider = (): null => null
    const Page = (): null => null

    beforeEach(() => {
      registerConsoleExtension({
        pluginId: 'events-calendar',
        displayName: 'Events',
        navItems: [{ label: 'Events', href: '/events', Component: Page }],
        widgets: [{ widgetId: 'events-glance', slot: 'dashboard', Component: Widget }],
        providers: [Provider],
      })
      registerConsoleExtension({
        pluginId: 'commerce',
        displayName: 'Commerce',
        navItems: [{ label: 'Products', href: '/products', Component: Page }],
        widgets: [{ widgetId: 'commerce-glance', slot: 'dashboard', Component: Widget }],
        providers: [Provider],
      })
    })

    it('lists only the enabled extensions and their nav items', () => {
      expect(listConsoleExtensions(['commerce']).map((e) => e.pluginId)).toEqual([
        'commerce',
      ])
      expect(listConsoleNavItems(['commerce']).map((i) => i.label)).toEqual([
        'Products',
      ])
    })

    it('does not resolve a page from a plugin the workspace has not enabled', () => {
      expect(resolveConsolePluginPage('/events', ['commerce'])).toBeUndefined()
      expect(
        resolveConsolePluginPage('/events', ['events-calendar'])?.extension
          .pluginId,
      ).toBe('events-calendar')
    })

    it('scopes widgets and providers too', () => {
      expect(listConsoleWidgets('dashboard', ['commerce'])).toHaveLength(1)
      expect(listConsoleProviders(['commerce'])).toHaveLength(1)
    })

    it('keeps the unfiltered union when no ids are given', () => {
      expect(listConsoleExtensions()).toHaveLength(2)
      expect(listConsoleNavItems()).toHaveLength(2)
      expect(listConsoleWidgets('dashboard')).toHaveLength(2)
      expect(listConsoleProviders()).toHaveLength(2)
    })
  })
})

/**
 * Routed sections on a plugin console page (AGL-2501).
 *
 * Every assertion here is about the RESOLVED nav item and section — the
 * objects the shell mounts and gates from — rather than about anything
 * rendered. A resolver is exactly the layer where "which page opens for this
 * URL" is decided, and a spec that rendered instead would pass on a page that
 * merely looked right.
 */
describe('resolveConsolePluginPage sections', () => {
  const Products = (): null => null
  const Events = (): null => null

  afterEach(() => {
    for (const extension of listConsoleExtensions()) {
      unregisterConsoleExtension(extension.pluginId)
    }
  })

  /** Commerce-shaped: one surface with declared sections beneath it. */
  function registerSectioned() {
    registerConsoleExtension({
      pluginId: 'commerce',
      displayName: 'Commerce',
      navItems: [
        {
          label: 'Products',
          href: '/products',
          Component: Products,
          sections: [
            { id: 'catalog', label: 'Catalog' },
            { id: 'orders', label: 'Orders' },
          ],
        },
      ],
    })
  }

  /**
   * The CONTROL for the refusals below.
   *
   * Every other assertion in this block is of the form "this URL resolves to
   * nothing", and a resolver that answered `undefined` for everything would
   * satisfy all of them. This is the reading that proves it resolves at all —
   * and resolves to the section named, not merely to the page.
   */
  it('CONTROL: a section URL resolves to that section of that page', () => {
    registerSectioned()
    const resolved = resolveConsolePluginPage('/products/orders')
    expect(resolved?.navItem.Component).toBe(Products)
    expect(resolved?.section?.id).toBe('orders')
    expect(resolved?.segments).toEqual(['orders'])
  })

  it("the surface's own href still resolves, with no section", () => {
    registerSectioned()
    const resolved = resolveConsolePluginPage('/products')
    expect(resolved?.navItem.Component).toBe(Products)
    expect(resolved?.section).toBeUndefined()
    expect(resolved?.segments).toEqual([])
  })

  /*
   * A typo'd section is nothing, not the page's first section. The failure
   * this prevents is not a crash — it is the dashboard opening under a URL
   * that names Orders, which gets reported as "it opened the wrong page".
   */
  it('an undeclared section id resolves to nothing', () => {
    registerSectioned()
    expect(resolveConsolePluginPage('/products/ordrs')).toBeUndefined()
    expect(resolveConsolePluginPage('/products/settings')).toBeUndefined()
  })

  /** A section may own deeper routes; the first segment still names it. */
  it('keeps the segments beneath a section', () => {
    registerSectioned()
    const resolved = resolveConsolePluginPage('/products/orders/ord_123')
    expect(resolved?.section?.id).toBe('orders')
    expect(resolved?.segments).toEqual(['orders', 'ord_123'])
  })

  /*
   * The whole "existing plugins keep working untouched" claim, as an
   * assertion rather than an inspection. A nav item that declares no sections
   * matches its own href and nothing beneath it — so prefix matching did not
   * quietly widen every surface written before AGL-2501 into a catch-all.
   */
  it('a plugin that declares no sections is matched exactly, as before', () => {
    registerConsoleExtension({
      pluginId: 'events-calendar',
      displayName: 'Events',
      navItems: [{ label: 'Events', href: '/events', Component: Events }],
    })
    expect(resolveConsolePluginPage('/events')?.navItem.Component).toBe(Events)
    expect(resolveConsolePluginPage('/events/anything')).toBeUndefined()
    expect(resolveConsolePluginPage('/events/2026/june')).toBeUndefined()
  })

  /**
   * Which registration owns a path when two could (AGL-2501).
   *
   * The registry is a session-wide union across plugins from different
   * authors (AGL-758), so this is a cross-tenant correctness question: the
   * same URL must resolve to the same page in every workspace that has both
   * plugins, or to nothing at all.
   */
  describe('overlap', () => {
    it('an exact registration beats a section of a shorter one', () => {
      registerSectioned()
      registerConsoleExtension({
        pluginId: 'orders-pro',
        displayName: 'Orders Pro',
        navItems: [
          { label: 'Orders', href: '/products/orders', Component: Events },
        ],
      })
      // `/products/orders` is `orders-pro`'s whole href and only a section of
      // commerce's — longest wins, so the exact registration takes it.
      const resolved = resolveConsolePluginPage('/products/orders')
      expect(resolved?.extension.pluginId).toBe('orders-pro')
      expect(resolved?.section).toBeUndefined()
      // …and commerce keeps everything the longer href does not claim.
      expect(
        resolveConsolePluginPage('/products/catalog')?.extension.pluginId,
      ).toBe('commerce')
    })

    it('matches only on a segment boundary', () => {
      registerSectioned()
      /*
       * `/products-orders` is the case a plain `startsWith` gets wrong, and
       * the only one that discriminates. Dropping the separator makes the
       * remainder-after-the-prefix land exactly on `orders`, so `/products`
       * would claim a DIFFERENT surface with a similar name and serve its own
       * Orders section there. `/products-archive` looks like the same test and
       * is not: its remainder is `archive`, which no section declares, so it
       * is refused either way.
       */
      expect(resolveConsolePluginPage('/products-orders')).toBeUndefined()
      expect(resolveConsolePluginPage('/products-archive')).toBeUndefined()
      expect(
        resolveConsolePluginPage('/products-archive/orders'),
      ).toBeUndefined()
    })

    /*
     * A tie REFUSES. Registry insertion order is an accident of which chunk
     * loaded first, so resolving by it means one workspace serves plugin A's
     * page where another serves plugin B's — silently, and differently per
     * session. Nobody can debug that from the symptom.
     */
    it('two plugins claiming one path resolve to nothing, loudly', () => {
      const error = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      registerConsoleExtension({
        pluginId: 'commerce',
        displayName: 'Commerce',
        navItems: [{ label: 'Shop', href: '/shop', Component: Products }],
      })
      registerConsoleExtension({
        pluginId: 'store-plus',
        displayName: 'Store Plus',
        navItems: [{ label: 'Shop', href: '/shop', Component: Events }],
      })
      expect(resolveConsolePluginPage('/shop')).toBeUndefined()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('/shop'))
      expect(error).toHaveBeenCalledWith(expect.stringContaining('commerce'))
      expect(error).toHaveBeenCalledWith(expect.stringContaining('store-plus'))
      error.mockRestore()
    })

    /*
     * Two nav items of ONE extension are not a collision: that order is
     * authored by one person in one file, not an accident of load order.
     */
    it('does not refuse two nav items of the same extension', () => {
      registerConsoleExtension({
        pluginId: 'commerce',
        displayName: 'Commerce',
        navItems: [
          { label: 'Shop', href: '/shop', Component: Products },
          { label: 'Shop (old)', href: '/shop', Component: Events },
        ],
      })
      expect(resolveConsolePluginPage('/shop')?.navItem.Component).toBe(
        Products,
      )
    })

    /*
     * The collision is between the plugins this WORKSPACE has enabled — the
     * scoping AGL-758 added, still load-bearing. Two plugins that never run
     * in the same org must not refuse each other, or one workspace's install
     * would 404 a page in another's.
     */
    it('a disabled plugin neither wins a path nor collides on one', () => {
      registerConsoleExtension({
        pluginId: 'commerce',
        displayName: 'Commerce',
        navItems: [{ label: 'Shop', href: '/shop', Component: Products }],
      })
      registerConsoleExtension({
        pluginId: 'store-plus',
        displayName: 'Store Plus',
        navItems: [{ label: 'Shop', href: '/shop', Component: Events }],
      })
      expect(
        resolveConsolePluginPage('/shop', ['commerce'])?.navItem.Component,
      ).toBe(Products)
      expect(
        resolveConsolePluginPage('/shop', ['store-plus'])?.navItem.Component,
      ).toBe(Events)
    })

    it('scoping applies to section URLs too', () => {
      registerSectioned()
      expect(
        resolveConsolePluginPage('/products/orders', ['events-calendar']),
      ).toBeUndefined()
      expect(
        resolveConsolePluginPage('/products/orders', ['commerce'])?.section?.id,
      ).toBe('orders')
    })
  })
})
