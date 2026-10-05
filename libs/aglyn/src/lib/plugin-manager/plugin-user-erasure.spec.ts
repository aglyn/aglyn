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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  listPluginUserErasers,
  registerPluginUserEraser,
  resetPluginUserErasersForTests,
  runPluginUserErasers,
} from './plugin-user-erasure'

const REQUEST = { uid: 'person-1', orgIds: ['org-a', 'org-b'] }

beforeEach(() => {
  resetPluginUserErasersForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('plugin user erasers', () => {
  it('runs two unrelated plugins\' erasers in order, each report under its plugin', async () => {
    const seen: string[] = []
    setRegisteringPluginId('ai')
    registerPluginUserEraser(async ({ uid, orgIds }) => {
      seen.push(`ai:${uid}:${orgIds.join('+')}`)
      return { orgs: orgIds.length, sweptMonths: 3 }
    })
    setRegisteringPluginId(undefined)
    registerPluginUserEraser(
      async ({ uid }) => {
        seen.push(`backups:${uid}`)
        return { snapshots: 2, offsite: true }
      },
      { pluginId: 'acme-backups' },
    )

    const reports = await runPluginUserErasers(REQUEST)

    expect(seen).toEqual(['ai:person-1:org-a+org-b', 'backups:person-1'])
    expect(reports).toEqual({
      ai: { orgs: 2, sweptMonths: 3 },
      'acme-backups': { snapshots: 2, offsite: true },
    })
    expect(listPluginUserErasers()).toEqual(['ai', 'acme-backups'])
  })

  it('records a failing eraser as null, logs it, and still runs the next', async () => {
    registerPluginUserEraser(
      async () => {
        throw new Error('index missing')
      },
      { pluginId: 'ai' },
    )
    const backups = jest.fn(async () => ({ snapshots: 0 }))
    registerPluginUserEraser(backups, { pluginId: 'acme-backups' })

    const reports = await runPluginUserErasers(REQUEST)

    expect(reports).toEqual({ ai: null, 'acme-backups': { snapshots: 0 } })
    expect(backups).toHaveBeenCalledWith(REQUEST)
    expect(console.error).toHaveBeenCalledWith(
      '[plugins] ai failed to erase user person-1',
      expect.any(Error),
    )
  })

  it('replaces a plugin\'s eraser in place when it registers again', async () => {
    registerPluginUserEraser(async () => ({ run: 1 }), { pluginId: 'ai' })
    registerPluginUserEraser(async () => ({ snapshots: 1 }), { pluginId: 'acme-backups' })
    registerPluginUserEraser(async () => ({ run: 2 }), { pluginId: 'ai' })

    expect(listPluginUserErasers()).toEqual(['ai', 'acme-backups'])
    expect(await runPluginUserErasers(REQUEST)).toEqual({
      ai: { run: 2 },
      'acme-backups': { snapshots: 1 },
    })
  })

  it('refuses an eraser with no owner', () => {
    expect(() => registerPluginUserEraser(async () => ({}))).toThrow(/no owner/)
    expect(() => registerPluginUserEraser(async () => ({}), { pluginId: ' ' })).toThrow(
      /no owner/,
    )
  })

  it('answers an empty record when no plugin registered one', async () => {
    expect(await runPluginUserErasers(REQUEST)).toEqual({})
  })
})

describe('one user eraser list per process (AGL-3464)', () => {
  it('an eraser registered in one copy of the module runs from another', async () => {
    // The shape of Next's boot file and the route that runs the erasure: two
    // evaluations of this module in one process. What boot registers, the
    // route must run.
    type Erasers = typeof import('./plugin-user-erasure')
    let boot!: Erasers
    let route!: Erasers
    jest.isolateModules(() => {
      boot = jest.requireActual('./plugin-user-erasure')
    })
    jest.isolateModules(() => {
      route = jest.requireActual('./plugin-user-erasure')
    })
    expect(route).not.toBe(boot)
    boot.registerPluginUserEraser(async () => ({ removed: 1 }), { pluginId: 'boot-plugin' })
    expect(await route.runPluginUserErasers(REQUEST)).toEqual({ 'boot-plugin': { removed: 1 } })
    route.resetPluginUserErasersForTests()
    expect(boot.listPluginUserErasers()).toEqual([])
  })
})
