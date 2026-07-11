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
  component: () => null,
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
    const Page = () => null
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
})
