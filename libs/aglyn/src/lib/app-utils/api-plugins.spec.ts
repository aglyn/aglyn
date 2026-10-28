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
  isPluginImagesRoute,
  isPluginMachineRoute,
  listPluginApiRoutes,
  PLUGIN_IMAGES_API_PREFIX,
  registerPluginApiRoute,
  resolvePluginApiRoute,
  unregisterPluginApiRoute,
} from './api-plugins'

describe('plugin API registry', () => {
  afterEach(() => {
    for (const path of listPluginApiRoutes()) unregisterPluginApiRoute(path)
  })

  it('registers and resolves a handler, ignoring leading/trailing slashes', () => {
    const handler = jest.fn()
    registerPluginApiRoute('/events/list/', handler)
    // Same handler regardless of how the path is slashed.
    expect(resolvePluginApiRoute('events/list')).toBe(handler)
    expect(resolvePluginApiRoute('/events/list')).toBe(handler)
    expect(listPluginApiRoutes()).toEqual(['events/list'])
  })

  it('replaces by path and resolves undefined for unregistered paths', () => {
    const first = jest.fn()
    const second = jest.fn()
    registerPluginApiRoute('campaigns/send', first)
    registerPluginApiRoute('campaigns/send', second)
    expect(resolvePluginApiRoute('campaigns/send')).toBe(second)
    expect(resolvePluginApiRoute('nope/missing')).toBeUndefined()
  })

  it('answers a route that draws images only when it is also a machine’s door (AGL-4048)', () => {
    registerPluginApiRoute('acme/draw', jest.fn(), { machine: true, images: true })
    // Served by a function with no member gates, so a member's door never is.
    registerPluginApiRoute('acme/member-draw', jest.fn(), { images: true })
    registerPluginApiRoute('acme/sweep', jest.fn(), { machine: true })
    expect(isPluginImagesRoute('acme/draw')).toBe(true)
    expect(isPluginMachineRoute('acme/draw')).toBe(true)
    expect(isPluginImagesRoute('acme/member-draw')).toBe(false)
    expect(isPluginImagesRoute('acme/sweep')).toBe(false)
    expect(isPluginImagesRoute('nope/missing')).toBe(false)
    expect(PLUGIN_IMAGES_API_PREFIX).toBe('plugin-images')
  })
})
