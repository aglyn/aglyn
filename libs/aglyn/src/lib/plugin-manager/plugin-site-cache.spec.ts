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
 * The contract's own behaviour (AGL-3080). What matters here is the shape of
 * the answer when the drop did NOT happen, because every caller is a stop
 * path and every one of them reads `complete` to decide what to tell a
 * human.
 */

import {
  dropPluginSiteCache,
  hasPluginSiteCache,
  registerPluginSiteCache,
  type PluginSiteCacheRequest,
} from './plugin-site-cache'
import { resetPluginServicesForTests } from './plugin-services'

const REQUEST: PluginSiteCacheRequest = {
  hostIds: ['host-1', 'host-2'],
  reason: 'marketplace listing revoked',
}

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('an unfilled registry is not "nothing to drop"', () => {
  it('answers complete:false and says so out loud', async () => {
    expect(hasPluginSiteCache()).toBe(false)
    const result = await dropPluginSiteCache(REQUEST)
    expect(result).toEqual({ dropped: 0, skipped: 0, complete: false })
    // The whole AGL-3025 shape is a zero that reads as an answer. This line
    // is the difference between a revoked plugin quietly still serving and
    // somebody being able to find out why.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('no implementation is installed'),
    )
  })

  it('but an EMPTY request is complete, registered or not', async () => {
    // "Nothing was asked for" and "nothing could be done" are different
    // answers, and only the first one is success.
    expect(await dropPluginSiteCache({ hostIds: [], reason: 'nothing' })).toEqual(
      { dropped: 0, skipped: 0, complete: true },
    )
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('with an implementation installed', () => {
  it('hands the request over and returns its answer', async () => {
    const seen: PluginSiteCacheRequest[] = []
    registerPluginSiteCache(
      {
        drop: async (request) => {
          seen.push(request)
          return { dropped: 2, skipped: 0, complete: true }
        },
      },
      { pluginId: 'console' },
    )
    expect(hasPluginSiteCache()).toBe(true)
    expect(await dropPluginSiteCache(REQUEST)).toEqual({
      dropped: 2,
      skipped: 0,
      complete: true,
    })
    expect(seen[0].hostIds).toEqual(['host-1', 'host-2'])
    expect(seen[0].reason).toBe('marketplace listing revoked')
  })

  it('collapses duplicate sites before handing them over', async () => {
    const seen: string[][] = []
    registerPluginSiteCache(
      {
        drop: async (request) => {
          seen.push([...request.hostIds])
          return { dropped: request.hostIds.length, skipped: 0, complete: true }
        },
      },
      { pluginId: 'console' },
    )
    // A site pinned at both org and host tier is two install rows and one
    // site; purging it twice is a second fan-out for nothing.
    await dropPluginSiteCache({
      hostIds: ['host-1', 'host-1', 'host-2', ''],
      reason: 'test',
    })
    expect(seen[0]).toEqual(['host-1', 'host-2'])
  })

  it('turns a throw into complete:false rather than propagating it', async () => {
    registerPluginSiteCache(
      {
        drop: async () => {
          throw new Error('revalidation endpoint refused')
        },
      },
      { pluginId: 'console' },
    )
    // The callers are stop paths: a revoke that threw here would leave the
    // plugin un-revoked, which is strictly worse than a stale cache.
    const result = await dropPluginSiteCache(REQUEST)
    expect(result).toEqual({ dropped: 0, skipped: 0, complete: false })
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('the drop failed'),
      expect.any(Error),
    )
  })

  it('carries a truncated fan-out back as skipped rather than hiding it', async () => {
    registerPluginSiteCache(
      { drop: async () => ({ dropped: 200, skipped: 43, complete: true }) },
      { pluginId: 'console' },
    )
    // Those 43 sites are still serving what was just stopped. Complete, and
    // still worth a caller's attention — which is why it is a number and not
    // a boolean.
    expect(await dropPluginSiteCache(REQUEST)).toEqual({
      dropped: 200,
      skipped: 43,
      complete: true,
    })
  })

  it('refuses a second implementation rather than picking one', async () => {
    registerPluginSiteCache(
      { drop: async () => ({ dropped: 0, skipped: 0, complete: true }) },
      { pluginId: 'console' },
    )
    expect(() =>
      registerPluginSiteCache(
        { drop: async () => ({ dropped: 0, skipped: 0, complete: true }) },
        { pluginId: 'someone-else' },
      ),
    ).toThrow(/single-implementation/)
  })

  it('refuses an implementation that is not one', () => {
    expect(() =>
      registerPluginSiteCache({} as never, { pluginId: 'console' }),
    ).toThrow(/needs a drop function/)
  })
})
