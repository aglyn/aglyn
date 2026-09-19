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
  CONSOLE_STAFF_WIDGET_SLOTS,
  CONSOLE_WIDGET_SLOTS,
  defineUiFeatureBundle,
  isConsoleStaffWidgetSlot,
  listConsoleExtensions,
  listConsoleNavItems,
  listConsoleOrgNavItems,
  listConsoleProviders,
  listConsoleStaffPages,
  listConsoleWidgets,
  MUI_BUNDLE_ID,
  registerConsoleExtension,
  resolveConsoleOrgPluginPage,
  resolveConsolePluginPage,
  resolveConsoleStaffPage,
  unregisterConsoleExtension,
  type ComponentRegistrar,
  type ConsoleHostSeoZoneProps,
  type ConsoleHostThemeZoneProps,
  type ConsoleSeoFieldsZoneProps,
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
   * AGL-2595: a nav item that moved keeps answering to its old address, and
   * says so, so the shell can put the current one in the bar.
   */
  it('resolves a legacy href to the same page, flagged legacy', () => {
    const Page = (): null => null
    registerConsoleExtension({
      pluginId: 'events-calendar',
      displayName: 'Events',
      featureFlag: 'eventCalendar',
      navItems: [
        {
          label: 'CRM',
          href: '/crm',
          legacyHrefs: ['/contacts'],
          sections: [
            { id: 'contacts', label: 'Contacts' },
            { id: 'deals', label: 'Deals' },
          ],
          Component: Page,
        },
      ],
    })
    const current = resolveConsolePluginPage('/crm/deals/d1')
    expect(current?.legacy).toBeUndefined()
    expect(current?.section?.id).toBe('deals')

    const bare = resolveConsolePluginPage('/contacts')
    expect(bare?.navItem.href).toBe('/crm')
    expect(bare?.legacy).toBe(true)
    expect(bare?.segments).toEqual([])

    const deep = resolveConsolePluginPage('/contacts/deals/d1')
    expect(deep?.legacy).toBe(true)
    expect(deep?.section?.id).toBe('deals')
    expect(deep?.segments).toEqual(['deals', 'd1'])

    // A separator boundary, as for the current href.
    expect(resolveConsolePluginPage('/contacts-archive')).toBeUndefined()
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

  /**
   * AGL-2939: the staff pages name no workspace, so their zones are read
   * from the plugins loaded for the staff area rather than from an org's
   * enabled set. Two unrelated plugins contribute to the same staff zone.
   */
  describe('staff zones', () => {
    const Card = (): null => null

    beforeEach(() => {
      registerConsoleExtension({
        pluginId: 'ai',
        displayName: 'AI',
        widgets: [
          { widgetId: 'ai-org-usage', slot: CONSOLE_WIDGET_SLOTS.staffOrg, Component: Card },
          { widgetId: 'ai-credits', slot: CONSOLE_WIDGET_SLOTS.orgBillingUsage, Component: Card },
        ],
      })
      registerConsoleExtension({
        pluginId: 'acme-backups',
        displayName: 'Backups',
        widgets: [
          { widgetId: 'backups-org', slot: CONSOLE_WIDGET_SLOTS.staffOrg, Component: Card },
          { widgetId: 'backups-user', slot: CONSOLE_WIDGET_SLOTS.staffUser, Component: Card },
        ],
      })
    })

    it('names the staff pages\' zones and no workspace zone', () => {
      expect([...CONSOLE_STAFF_WIDGET_SLOTS].sort()).toEqual([
        'adminOrgDetail',
        'staffOrg',
        'staffOrgUsageColumn',
        'staffOrgsListColumn',
        'staffUser',
      ])
      expect(isConsoleStaffWidgetSlot('staffOrg')).toBe(true)
      expect(isConsoleStaffWidgetSlot('orgBillingUsage')).toBe(false)
      expect(isConsoleStaffWidgetSlot('somewhereElse')).toBe(false)
    })

    it('lists each staff-loaded plugin\'s widgets for the zone', () => {
      const staffPluginIds = ['ai', 'acme-backups']
      expect(
        listConsoleWidgets('staffOrg', staffPluginIds).map((entry) => entry.widget.widgetId),
      ).toEqual(['ai-org-usage', 'backups-org'])
      expect(
        listConsoleWidgets('staffUser', staffPluginIds).map((entry) => entry.widget.widgetId),
      ).toEqual(['backups-user'])
      // A plugin the staff area did not load contributes nothing.
      expect(listConsoleWidgets('staffOrg', ['ai'])).toHaveLength(1)
    })
  })

  /**
   * AGL-2938: the Theme section's zone. A widget there proposes a change to
   * the site's theme and never writes it; the zone hands it the theme, where
   * that theme came from, the editor's own preview and `proposeDraft`. Two
   * unrelated plugins — a brand kit importer and the AI plugin — each
   * contribute one, written against the same typed props.
   */
  describe('the host theme zone', () => {
    const proposals: Array<{ key: string; theme: unknown }> = []
    const props: ConsoleHostThemeZoneProps = {
      hostId: 'host-1',
      orgId: 'org-1',
      orgSlug: 'acme',
      host: 'shop',
      theme: { spacing: 8 },
      themeSource: 'custom',
      ThemePreview: (): null => null,
      proposeDraft: (theme, key) => proposals.push({ key, theme }),
    }
    const BrandKit = (zone: ConsoleHostThemeZoneProps): null => {
      zone.proposeDraft(
        { ...zone.theme, colorSchemes: { light: { primary: { main: '#0f766e' } } } },
        `brand-kit:${zone.hostId}`,
      )
      return null
    }
    const Generator = (): null => null

    beforeEach(() => {
      proposals.length = 0
      registerConsoleExtension({
        pluginId: 'acme-brand-kit',
        displayName: 'Brand kit',
        widgets: [
          { widgetId: 'brand-kit-import', slot: CONSOLE_WIDGET_SLOTS.hostTheme, Component: BrandKit },
        ],
      })
      registerConsoleExtension({
        pluginId: 'ai',
        displayName: 'AI',
        widgets: [
          { widgetId: 'ai-theme-proposal', slot: CONSOLE_WIDGET_SLOTS.hostTheme, Component: Generator },
        ],
      })
    })

    it('is a workspace zone, listing only the plugins the site has enabled', () => {
      expect(CONSOLE_WIDGET_SLOTS.hostTheme).toBe('hostTheme')
      expect(isConsoleStaffWidgetSlot('hostTheme')).toBe(false)
      expect(
        listConsoleWidgets('hostTheme', ['acme-brand-kit', 'ai']).map(
          (entry) => entry.widget.widgetId,
        ),
      ).toEqual(['brand-kit-import', 'ai-theme-proposal'])
      expect(
        listConsoleWidgets('hostTheme', ['acme-brand-kit']).map((entry) => entry.widget.widgetId),
      ).toEqual(['brand-kit-import'])
    })

    it('hands a widget the theme and the one door it proposes through', () => {
      const [entry] = listConsoleWidgets('hostTheme', ['acme-brand-kit'])
      const Widget = entry.widget.Component as (zone: ConsoleHostThemeZoneProps) => null
      Widget(props)
      expect(proposals).toEqual([
        {
          key: 'brand-kit:host-1',
          theme: { spacing: 8, colorSchemes: { light: { primary: { main: '#0f766e' } } } },
        },
      ])
    })
  })

  /**
   * AGL-2939: a plugin adds a page to the staff area — a tab and a page at
   * `/admin/{id}` — and two unrelated plugins each add one.
   */
  describe('staff pages', () => {
    const SignalsPage = (): null => null
    const BackupsPage = (): null => null

    beforeEach(() => {
      registerConsoleExtension({
        pluginId: 'ai',
        displayName: 'AI',
        staffPages: [
          {
            id: 'assist-signals',
            label: 'Assist signal',
            header: { title: 'Assist Signal', docsTopic: 'assistSignals' },
            Component: SignalsPage,
          },
        ],
      })
      registerConsoleExtension({
        pluginId: 'acme-backups',
        displayName: 'Backups',
        staffPages: [{ id: 'backups', label: 'Backups', Component: BackupsPage }],
      })
    })

    it('lists every plugin\'s staff pages in registration order, with the owner', () => {
      expect(
        listConsoleStaffPages().map((page) => [page.pluginId, page.id, page.label]),
      ).toEqual([
        ['ai', 'assist-signals', 'Assist signal'],
        ['acme-backups', 'backups', 'Backups'],
      ])
      expect(listConsoleStaffPages(['acme-backups']).map((page) => page.id)).toEqual([
        'backups',
      ])
    })

    it('resolves a staff page by its id, and nothing for an unknown one', () => {
      expect(resolveConsoleStaffPage('assist-signals')?.Component).toBe(SignalsPage)
      expect(resolveConsoleStaffPage('backups')?.pluginId).toBe('acme-backups')
      expect(resolveConsoleStaffPage('orgs')).toBeUndefined()
      // A plugin outside the given set does not answer for its id.
      expect(resolveConsoleStaffPage('backups', ['ai'])).toBeUndefined()
    })

    it('two plugins claiming one id resolve to nothing, loudly', () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      registerConsoleExtension({
        pluginId: 'acme-archive',
        displayName: 'Archive',
        staffPages: [{ id: 'backups', label: 'Archive', Component: BackupsPage }],
      })
      expect(resolveConsoleStaffPage('backups')).toBeUndefined()
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('"/admin/backups" is claimed by more than one plugin'),
      )
      error.mockRestore()
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
   * A surface whose deeper URLs are ENTITIES rather than sections.
   *
   * `/forms` is a list and `/forms/{formId}` is one of its rows, and the set of
   * ids is a property of the workspace's data — so there is no `sections` list
   * that could name them, and without `ownsSubtree` every row's page is a 404.
   * What the flag buys is exactly one thing: the segments reach the page. It
   * does not widen anything else, and it is opt-in so that no surface acquires
   * a catch-all by accident.
   */
  describe('a nav item that owns its subtree', () => {
    const Forms = (): null => null

    function registerOwnsSubtree() {
      registerConsoleExtension({
        pluginId: 'forms',
        displayName: 'Forms',
        navItems: [
          {
            label: 'Forms',
            href: '/forms',
            Component: Forms,
            ownsSubtree: true,
          },
        ],
      })
    }

    it('hands an entity id down as a segment', () => {
      registerOwnsSubtree()
      const resolved = resolveConsolePluginPage('/forms/form-abc')
      expect(resolved?.navItem.Component).toBe(Forms)
      expect(resolved?.section).toBeUndefined()
      expect(resolved?.segments).toEqual(['form-abc'])
    })

    it("still resolves the surface's own href with no segments", () => {
      registerOwnsSubtree()
      const resolved = resolveConsolePluginPage('/forms')
      expect(resolved?.navItem.Component).toBe(Forms)
      expect(resolved?.segments).toEqual([])
    })

    it('claims only a SEPARATOR boundary, never a sibling path', () => {
      // The property `/products` has against `/products-archive`, kept: a flag
      // that widened matching to any prefix would let this surface swallow a
      // differently-named one registered by another plugin.
      registerOwnsSubtree()
      expect(resolveConsolePluginPage('/forms-archive')).toBeUndefined()
      expect(resolveConsolePluginPage('/formsy/thing')).toBeUndefined()
    })

    it('THE CONTROL: the same nav item WITHOUT the flag refuses the id', () => {
      // Otherwise every assertion above is satisfied by a resolver that
      // prefix-matches unconditionally, which is the behaviour AGL-2501
      // deliberately did not have.
      registerConsoleExtension({
        pluginId: 'forms',
        displayName: 'Forms',
        navItems: [{ label: 'Forms', href: '/forms', Component: Forms }],
      })
      expect(resolveConsolePluginPage('/forms')?.navItem.Component).toBe(Forms)
      expect(resolveConsolePluginPage('/forms/form-abc')).toBeUndefined()
    })

    it('lets a DECLARED section still win over the subtree claim', () => {
      // Both may be declared, and then the section is the more specific
      // answer — a surface that owns its subtree must not lose its rail.
      registerConsoleExtension({
        pluginId: 'forms',
        displayName: 'Forms',
        navItems: [
          {
            label: 'Forms',
            href: '/forms',
            Component: Forms,
            ownsSubtree: true,
            sections: [{ id: 'settings', label: 'Settings' }],
          },
        ],
      })
      expect(resolveConsolePluginPage('/forms/settings')?.section?.id).toBe(
        'settings',
      )
      expect(
        resolveConsolePluginPage('/forms/form-abc')?.section,
      ).toBeUndefined()
      expect(resolveConsolePluginPage('/forms/form-abc')?.segments).toEqual([
        'form-abc',
      ])
    })
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

describe('organization-level surfaces (AGL-2974)', () => {
  const Outreach = (): null => null
  const Events = (): null => null

  afterEach(() => {
    for (const extension of listConsoleExtensions()) {
      unregisterConsoleExtension(extension.pluginId)
    }
  })

  function registerOrgSurface() {
    registerConsoleExtension({
      pluginId: 'outreach',
      displayName: 'Outreach',
      featureFlag: 'outreach',
      permission: 'outreach.use',
      orgNavItems: [
        {
          label: 'Outreach',
          href: '/outreach',
          Component: Outreach,
          sections: [
            { id: 'sequences', label: 'Sequences' },
            { id: 'mailboxes', label: 'Mailboxes' },
          ],
        },
      ],
    })
  }

  it('lists org nav items with the extension that declared them', () => {
    registerOrgSurface()
    const entries = listConsoleOrgNavItems()
    expect(entries).toHaveLength(1)
    expect(entries[0].extension.pluginId).toBe('outreach')
    expect(entries[0].extension.featureFlag).toBe('outreach')
    expect(entries[0].navItem.href).toBe('/outreach')
  })

  it('resolves an org section URL to that section of that page', () => {
    registerOrgSurface()
    const resolved = resolveConsoleOrgPluginPage('/outreach/mailboxes')
    expect(resolved?.navItem.Component).toBe(Outreach)
    expect(resolved?.section?.id).toBe('mailboxes')
    expect(resolved?.segments).toEqual(['mailboxes'])
    expect(resolveConsoleOrgPluginPage('/outreach')?.section).toBeUndefined()
    expect(resolveConsoleOrgPluginPage('/outreach/nope')).toBeUndefined()
  })

  it('keeps the two levels apart: neither resolver reads the other list', () => {
    registerOrgSurface()
    registerConsoleExtension({
      pluginId: 'events-calendar',
      displayName: 'Events',
      navItems: [{ label: 'Events', href: '/events', Component: Events }],
    })
    // An org surface is not a site page, and a site page is not an org one.
    expect(resolveConsolePluginPage('/outreach/sequences')).toBeUndefined()
    expect(resolveConsoleOrgPluginPage('/events')).toBeUndefined()
    // The site strip's list never carries an org item.
    expect(listConsoleNavItems().map((item) => item.href)).toEqual(['/events'])
    expect(
      listConsoleOrgNavItems().map((entry) => entry.navItem.href),
    ).toEqual(['/outreach'])
  })

  it('scopes both the list and the resolver to the enabled plugins', () => {
    registerOrgSurface()
    expect(listConsoleOrgNavItems(['crm'])).toEqual([])
    expect(
      resolveConsoleOrgPluginPage('/outreach/sequences', ['crm']),
    ).toBeUndefined()
    expect(
      resolveConsoleOrgPluginPage('/outreach/sequences', ['outreach'])?.section
        ?.id,
    ).toBe('sequences')
  })

  it('refuses a tie between two plugins on the same org path', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerOrgSurface()
    registerConsoleExtension({
      pluginId: 'outreach-plus',
      displayName: 'Outreach Plus',
      orgNavItems: [{ label: 'Outreach', href: '/outreach', Component: Events }],
    })
    expect(resolveConsoleOrgPluginPage('/outreach')).toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

/**
 * AGL-2910: the two SEO zones. A widget in either proposes values and never
 * writes them; the editor's own Save does. Two unrelated plugins contribute
 * to each — a keyword checker and the AI plugin to the listing editor, a
 * structured-data importer and the AI plugin to the site SEO form — written
 * against the same typed props.
 */
describe('the SEO zones (AGL-2910)', () => {
  afterEach(() => {
    for (const extension of listConsoleExtensions()) {
      unregisterConsoleExtension(extension.pluginId)
    }
  })

  describe('the search listing zone', () => {
    const staged: Array<{ key: string; values: unknown }> = []
    const props: ConsoleSeoFieldsZoneProps = {
      hostId: 'host-1',
      orgId: 'org-1',
      orgSlug: 'acme',
      subject: { kind: 'screen', id: 'screen-1', versionId: 'v1', name: 'Pricing' },
      fields: ['title', 'description', 'breadcrumb', 'imageAlt'],
      values: { title: 'Pricing', description: '' },
      hasImage: false,
      proposeValues: (values, key) => staged.push({ key, values }),
    }
    const KeywordChecker = (zone: ConsoleSeoFieldsZoneProps): null => {
      // A checker that appends the page's own name to a blank description.
      if (!zone.values.description && zone.fields.includes('description')) {
        zone.proposeValues(
          { description: `${zone.subject.name} plans and prices.` },
          `keywords:${zone.subject.kind}:${zone.subject.id}`,
        )
      }
      return null
    }
    const Generator = (): null => null

    beforeEach(() => {
      staged.length = 0
      registerConsoleExtension({
        pluginId: 'acme-keywords',
        displayName: 'Keyword checker',
        widgets: [
          { widgetId: 'keyword-coverage', slot: CONSOLE_WIDGET_SLOTS.seoFields, Component: KeywordChecker },
        ],
      })
      registerConsoleExtension({
        pluginId: 'ai',
        displayName: 'AI',
        widgets: [
          { widgetId: 'ai-seo-fields', slot: CONSOLE_WIDGET_SLOTS.seoFields, Component: Generator },
        ],
      })
    })

    it('is a workspace zone, listing only the plugins the workspace has enabled', () => {
      expect(CONSOLE_WIDGET_SLOTS.seoFields).toBe('seoFields')
      expect(isConsoleStaffWidgetSlot('seoFields')).toBe(false)
      expect(
        listConsoleWidgets('seoFields', ['acme-keywords', 'ai']).map((entry) => entry.widget.widgetId),
      ).toEqual(['keyword-coverage', 'ai-seo-fields'])
      expect(
        listConsoleWidgets('seoFields', ['ai']).map((entry) => entry.widget.widgetId),
      ).toEqual(['ai-seo-fields'])
    })

    it('hands a widget the listing and the one door it proposes through', () => {
      const [entry] = listConsoleWidgets('seoFields', ['acme-keywords'])
      const Widget = entry.widget.Component as (zone: ConsoleSeoFieldsZoneProps) => null
      Widget(props)
      expect(staged).toEqual([
        { key: 'keywords:screen:screen-1', values: { description: 'Pricing plans and prices.' } },
      ])
      // The same widget, in a product's listing editor.
      Widget({
        ...props,
        subject: { kind: 'product', id: null, name: 'Mug', description: 'Stoneware.' },
        fields: ['title', 'description'],
      })
      expect(staged[1]).toEqual({
        key: 'keywords:product:null',
        values: { description: 'Mug plans and prices.' },
      })
    })
  })

  describe('the site SEO zone', () => {
    const drafts: Array<{ key: string; values: Record<string, string> }> = []
    const props: ConsoleHostSeoZoneProps = {
      hostId: 'host-1',
      orgId: 'org-1',
      orgSlug: 'acme',
      host: 'shop',
      seo: { title: 'Acme Widgets' },
      proposeDraft: (values, key) => drafts.push({ key, values }),
    }
    const SchemaImporter = (zone: ConsoleHostSeoZoneProps): null => {
      zone.proposeDraft({ 'seo.entity.name': String(zone.seo?.['title'] ?? '') }, `schema:${zone.hostId}`)
      return null
    }
    const Audit = (): null => null

    beforeEach(() => {
      drafts.length = 0
      registerConsoleExtension({
        pluginId: 'acme-schema',
        displayName: 'Structured data importer',
        widgets: [{ widgetId: 'schema-import', slot: CONSOLE_WIDGET_SLOTS.hostSeo, Component: SchemaImporter }],
      })
      registerConsoleExtension({
        pluginId: 'ai',
        displayName: 'AI',
        widgets: [{ widgetId: 'ai-seo-audit', slot: CONSOLE_WIDGET_SLOTS.hostSeo, Component: Audit }],
      })
    })

    it('is a workspace zone, listing only the plugins the site has enabled', () => {
      expect(CONSOLE_WIDGET_SLOTS.hostSeo).toBe('hostSeo')
      expect(isConsoleStaffWidgetSlot('hostSeo')).toBe(false)
      expect(
        listConsoleWidgets('hostSeo', ['acme-schema', 'ai']).map((entry) => entry.widget.widgetId),
      ).toEqual(['schema-import', 'ai-seo-audit'])
      expect(listConsoleWidgets('hostSeo', ['acme-schema']).map((entry) => entry.widget.widgetId)).toEqual([
        'schema-import',
      ])
    })

    it('hands a widget the stored settings and the draft door, keyed by form field name', () => {
      const [entry] = listConsoleWidgets('hostSeo', ['acme-schema'])
      const Widget = entry.widget.Component as (zone: ConsoleHostSeoZoneProps) => null
      Widget(props)
      expect(drafts).toEqual([{ key: 'schema:host-1', values: { 'seo.entity.name': 'Acme Widgets' } }])
    })
  })
})
