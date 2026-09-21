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

/**
 * Every way this can be wrong points at publishing a file somebody paid for
 * (AGL-3080).
 *
 * So the shape is the opposite of a usual contract's: the interesting tests
 * are the ones where nothing worked. A guard that throws, a guard that read
 * only half the catalog, and a guard that answered nothing are three
 * different situations and only the last one is permission.
 */

import {
  listPluginMediaPublishGuards,
  registerPluginMediaPublishGuard,
  resolvePluginMediaPublishRefusal,
  type PluginMediaPublishRefusal,
} from './plugin-media-publish'
import { resetPluginServicesForTests } from './plugin-services'

const ASSET = { base: 'orgs/org-1', mediaId: 'film-1', bucket: 'b' }

const SELLS_IT: PluginMediaPublishRefusal = {
  reason: 'This file is sold on “Training program”.',
  blockers: [{ label: 'Training program', refId: 'prod-1', hostId: 'host-1' }],
  complete: true,
}

/** A guard that answers `answer`, and records that it was asked. */
function guard(
  pluginId: string,
  answer: PluginMediaPublishRefusal | null,
  asked: string[],
): void {
  registerPluginMediaPublishGuard(
    {
      check: async () => {
        asked.push(pluginId)
        return answer
      },
    },
    { pluginId },
  )
}

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('asking whether an asset may be made public', () => {
  it('answers nothing when every guard ran and none objected', async () => {
    const asked: string[] = []
    guard('commerce', null, asked)
    guard('bookings', null, asked)

    expect(await resolvePluginMediaPublishRefusal(ASSET)).toBeNull()
    // Non-vacuous: both were actually asked.
    expect(asked).toEqual(['commerce', 'bookings'])
  })

  it('answers nothing when no plugin guards anything', async () => {
    // A workspace with no store is the ordinary case, not a degraded one.
    // ⛔ It is ALSO what a process that has not loaded its plugins looks
    // like, which is why the CALLER loads them first — see the module
    // docblock and `media-set-private-raw-url-revocation.spec.ts`, which
    // drives the real route through the real loader.
    expect(await resolvePluginMediaPublishRefusal(ASSET)).toBeNull()
    expect(listPluginMediaPublishGuards()).toEqual([])
  })

  it('returns the first refusal and stops asking', async () => {
    const asked: string[] = []
    guard('commerce', SELLS_IT, asked)
    guard('bookings', null, asked)

    expect(await resolvePluginMediaPublishRefusal(ASSET)).toEqual(SELLS_IT)
    // One sentence is what the person needs; a second reason changes nothing
    // about what they have to do next.
    expect(asked).toEqual(['commerce'])
  })

  it('REFUSES on a guard that could not read everything, with no blocker to name', async () => {
    const asked: string[] = []
    guard(
      'commerce',
      {
        reason: 'We could not check every product.',
        blockers: [],
        complete: false,
      },
      asked,
    )

    // "We did not find one" is not "there is none". An incomplete scan with
    // an empty blocker list is the shape that would read as a pass to a
    // caller checking `blockers.length` alone.
    const verdict = await resolvePluginMediaPublishRefusal(ASSET)
    expect(verdict).not.toBeNull()
    expect(verdict?.complete).toBe(false)
    expect(verdict?.blockers).toEqual([])
  })

  it('REFUSES on a guard that throws, and says so in the log', async () => {
    registerPluginMediaPublishGuard(
      {
        check: async () => {
          throw new Error('firestore is unhappy')
        },
      },
      { pluginId: 'commerce' },
    )

    const verdict = await resolvePluginMediaPublishRefusal(ASSET)

    expect(verdict?.complete).toBe(false)
    expect(verdict?.reason).toContain('could not check')
    // Loud: the asset stays private and somebody can find out why.
    expect(console.error).toHaveBeenCalled()
  })

  it('does not let a later guard clear an earlier refusal', async () => {
    const asked: string[] = []
    registerPluginMediaPublishGuard(
      {
        check: async () => {
          throw new Error('firestore is unhappy')
        },
      },
      { pluginId: 'commerce' },
    )
    guard('bookings', null, asked)

    expect((await resolvePluginMediaPublishRefusal(ASSET))?.complete).toBe(false)
    expect(asked).toEqual([])
  })

  it('lets a plugin replace its own guard rather than being asked twice', async () => {
    const asked: string[] = []
    guard('commerce', null, asked)
    guard('commerce', SELLS_IT, asked)

    expect(listPluginMediaPublishGuards()).toHaveLength(1)
    expect(await resolvePluginMediaPublishRefusal(ASSET)).toEqual(SELLS_IT)
    expect(asked).toEqual(['commerce'])
  })

  it('refuses a registration that cannot check anything', () => {
    expect(() =>
      registerPluginMediaPublishGuard(undefined as never, {
        pluginId: 'commerce',
      }),
    ).toThrow('needs a check function')
  })
})
