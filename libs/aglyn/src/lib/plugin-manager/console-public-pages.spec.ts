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
  listConsolePublicPages,
  normalizeConsolePublicPath,
  registerConsoleExtension,
  resolveConsolePublicPage,
  unregisterConsoleExtension,
} from './feature-plugins'
import { sanitizePluginContributions } from './plugin-contributions'

/**
 * The public-page seam (AGL-3608): a plugin's full-screen page with no staff
 * session, served at `/kiosk/{pluginId}{path}`.
 */
describe('console public pages (AGL-3608)', () => {
  const Display = (): null => null
  const Other = (): null => null

  afterEach(() => {
    unregisterConsoleExtension('alpha')
    unregisterConsoleExtension('beta')
    jest.restoreAllMocks()
  })

  it('resolves a page by its plugin and path, however the path is written', () => {
    registerConsoleExtension({
      pluginId: 'alpha',
      displayName: 'Alpha',
      publicPages: [{ path: '/display', title: 'Display', Component: Display }],
    })
    for (const path of ['/display', 'display', 'display/', '//display']) {
      const page = resolveConsolePublicPage('alpha', path)
      expect(page?.Component).toBe(Display)
      expect(page?.pluginId).toBe('alpha')
      expect(page?.path).toBe('/display')
    }
  })

  it('matches exactly, so a deeper or a different path is not the page', () => {
    registerConsoleExtension({
      pluginId: 'alpha',
      displayName: 'Alpha',
      publicPages: [{ path: '/display', title: 'Display', Component: Display }],
    })
    expect(resolveConsolePublicPage('alpha', '/display/extra')).toBeUndefined()
    expect(resolveConsolePublicPage('alpha', '/displays')).toBeUndefined()
    expect(resolveConsolePublicPage('alpha', '/')).toBeUndefined()
    expect(resolveConsolePublicPage('alpha', '')).toBeUndefined()
  })

  it('answers only in the namespace of the plugin the URL names', () => {
    // The registry is a session-wide union: another plugin loaded earlier
    // must not serve a path under this one's id.
    registerConsoleExtension({
      pluginId: 'beta',
      displayName: 'Beta',
      publicPages: [{ path: '/display', title: 'Beta display', Component: Other }],
    })
    expect(resolveConsolePublicPage('alpha', '/display')).toBeUndefined()
    expect(resolveConsolePublicPage('beta', '/display')?.Component).toBe(Other)
    expect(resolveConsolePublicPage('', '/display')).toBeUndefined()
  })

  it('refuses a path registered twice rather than guessing', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerConsoleExtension({
      pluginId: 'alpha',
      displayName: 'Alpha',
      publicPages: [
        { path: '/display', title: 'One', Component: Display },
        { path: 'display', title: 'Two', Component: Other },
      ],
    })
    expect(resolveConsolePublicPage('alpha', '/display')).toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })

  it('lists pages with their owner and a normalized path', () => {
    registerConsoleExtension({
      pluginId: 'alpha',
      displayName: 'Alpha',
      publicPages: [{ path: 'display', title: 'Display', Component: Display }],
    })
    expect(
      listConsolePublicPages(['alpha']).map(({ pluginId, path, title }) => ({
        pluginId,
        path,
        title,
      })),
    ).toEqual([{ pluginId: 'alpha', path: '/display', title: 'Display' }])
    expect(listConsolePublicPages(['beta'])).toEqual([])
  })

  it('normalizes paths to one leading slash and no trailing one', () => {
    expect(normalizeConsolePublicPath('a/b/')).toBe('/a/b')
    expect(normalizeConsolePublicPath('')).toBe('/')
  })

  it('accepts publicRoutes in a manifest declaration, as routes', () => {
    const verdict = sanitizePluginContributions({
      console: { publicRoutes: ['/display'] },
    })
    expect(verdict).toEqual({
      ok: true,
      contributions: { console: { publicRoutes: ['/display'] } },
    })
    expect(
      sanitizePluginContributions({ console: { publicRoutes: ['display'] } }).ok,
    ).toBe(false)
  })
})
