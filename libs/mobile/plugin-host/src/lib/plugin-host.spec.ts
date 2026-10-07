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

import { resolveMobileLink, consolePathOf, splitConsoleScope } from './deep-links'
import { loadMobilePlugins } from './loader'
import {
  getMobileDashboardWidgets,
  getMobileDeepLinks,
  getMobileScreen,
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
  registerMobileTab,
  resetMobileRegistry,
} from './registry'
import type { MobilePluginManifest } from './types'

const screen = (pluginId: string, id: string) => ({
  pluginId,
  id,
  title: id,
  load: async () => ({ default: () => null }),
})

describe('mobile registry', () => {
  beforeEach(() => resetMobileRegistry())

  it('refuses a second registration of the same id', () => {
    registerMobileScreen(screen('a', 'a.list'))
    expect(() => registerMobileScreen(screen('b', 'a.list'))).toThrow(/already registered/)
  })

  it('holds a quick action to exactly one target', () => {
    const base = { pluginId: 'a', id: 'a.go', title: 'Go', icon: 'add', order: 1 }
    expect(() => registerMobileQuickAction(base)).toThrow(/exactly one/)
    expect(() => registerMobileQuickAction({ ...base, screen: 'a.list', consolePath: '/a' })).toThrow(/exactly one/)
    registerMobileQuickAction({ ...base, screen: 'a.list' })
  })

  it('refuses a deep link that is not a console path', () => {
    expect(() => registerMobileDeepLink({ pluginId: 'a', id: 'a.link', path: 'a', screen: 'a.list' })).toThrow(/starts with/)
  })
})

describe('loadMobilePlugins', () => {
  beforeEach(() => resetMobileRegistry())

  const entry = (over: Partial<MobilePluginManifest[number]>) => ({
    id: 'a',
    register: 'registerA',
    contributes: { screens: ['a.list'] },
    load: async () => ({ registerA: () => registerMobileScreen(screen('a', 'a.list')) }),
    ...over,
  })

  it('loads a plugin whose registrar matches its declaration', async () => {
    await expect(loadMobilePlugins([entry({})])).resolves.toEqual({ loaded: ['a'], failed: [] })
    expect(getMobileScreen('a.list')?.pluginId).toBe('a')
  })

  it('refuses an undeclared registration and keeps loading the others', async () => {
    const result = await loadMobilePlugins([
      entry({ load: async () => ({ registerA: () => registerMobileTab({ pluginId: 'a', id: 'a.tab', title: 'A', icon: 'x', screen: 'a.list', order: 1 }) }) }),
      entry({ id: 'b', register: 'registerB', contributes: { screens: ['b.list'] }, load: async () => ({ registerB: () => registerMobileScreen(screen('b', 'b.list')) }) }),
    ])
    expect(result.loaded).toEqual(['b'])
    expect(result.failed[0]).toMatchObject({ pluginId: 'a' })
    expect(result.failed[0].error).toMatch(/does not declare/)
  })

  it('refuses a registration under another plugin id', async () => {
    const result = await loadMobilePlugins([
      entry({ load: async () => ({ registerA: () => registerMobileScreen(screen('b', 'a.list')) }) }),
    ])
    expect(result.failed[0].error).toMatch(/registers only its own/)
  })

  it('reports a declared id the registrar never registered', async () => {
    const result = await loadMobilePlugins([entry({ contributes: { screens: ['a.list'], widgets: ['a.card'] } })])
    expect(result.failed[0].error).toMatch(/never registers widgets "a.card"/)
    expect(getMobileDashboardWidgets()).toEqual([])
    // A plugin that failed halfway leaves nothing behind.
    expect(getMobileScreen('a.list')).toBeUndefined()
  })

  it('reports a missing registrar and a module that fails to load', async () => {
    const result = await loadMobilePlugins([
      entry({ register: 'registerNope' }),
      entry({ id: 'c', load: async () => Promise.reject(new Error('offline')) }),
    ])
    expect(result.failed.map((failure) => failure.error)).toEqual([
      'its ./mobile entry exports no function named registerNope',
      'offline',
    ])
  })
})

describe('resolveMobileLink', () => {
  beforeEach(() => {
    resetMobileRegistry()
    registerMobileDeepLink({ pluginId: 'r', id: 'r.page', path: '/redirects', screen: 'r.list' })
    registerMobileDeepLink({ pluginId: 'r', id: 'r.one', path: '/redirects/:id', screen: 'r.detail' })
  })

  it('opens a site page a plugin answers natively, with the scope as params', () => {
    expect(resolveMobileLink('https://app.aglyn.com/acme/hosts/shop/redirects/r%201?tab=x', getMobileDeepLinks())).toEqual({
      kind: 'screen',
      screen: 'r.detail',
      params: { tab: 'x', orgSlug: 'acme', hostSlug: 'shop', id: 'r 1' },
    })
    expect(resolveMobileLink('aglyn://acme/hosts/shop/redirects', getMobileDeepLinks())).toMatchObject({ screen: 'r.list' })
  })

  it('opens every other console path in the WebView, and refuses what is not a console link', () => {
    expect(resolveMobileLink('/acme/hosts/shop/besigner', getMobileDeepLinks())).toEqual({ kind: 'console', path: '/acme/hosts/shop/besigner' })
    expect(resolveMobileLink('//evil.example/x', getMobileDeepLinks())).toBeNull()
    expect(resolveMobileLink('javascript:alert(1)', getMobileDeepLinks())).toBeNull()
    expect(consolePathOf('')).toBeNull()
  })

  it('treats the console top-level sections as unscoped', () => {
    expect(splitConsoleScope('/billing/plans')).toEqual({ rest: '/billing/plans' })
    expect(splitConsoleScope('/acme/crm')).toEqual({ orgSlug: 'acme', rest: '/crm' })
  })
})
