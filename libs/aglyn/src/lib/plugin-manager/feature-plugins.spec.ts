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
