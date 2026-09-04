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
 * THE SERVER ROUTES THAT CHANGE WHAT THE LIVE SITE SERVES ANNOUNCE IT
 * (AGL-2573).
 *
 * The browser hops through `/api/screens/revalidate` because the tenant route
 * is secret-authenticated. A route running on the server already holds that
 * secret, so it announces directly — the arrangement `announceFormPublish`
 * established for a form promotion.
 *
 * The "cannot fail the write" half is proved here at the helper rather than
 * at each route, and deliberately: both `announceLivePaths` and
 * `revalidateEntireHost` are contracted never to reject, so a route that
 * `await`s one cannot be made to fail by a refusing tenant. That contract is
 * the thing worth testing, because it is the thing a future edit could break
 * — and if it broke, three routes would start returning 500 for writes that
 * actually succeeded.
 */

const mockPostTenantRevalidate = jest.fn()
jest.mock('../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  postTenantRevalidate: (...args: unknown[]) =>
    (mockPostTenantRevalidate as any)(...args),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { announceLivePaths } from '../utils/server/announce-live-paths'

/** A host document with a subdomain, and optionally an attached domain. */
const hostDoc = (fields: Record<string, unknown>) => ({
  get: (field: string) => fields[field],
})

beforeEach(() => {
  jest.clearAllMocks()
  mockPostTenantRevalidate.mockResolvedValue({
    revalidated: ['/x'],
    reason: 'ok',
    pathsDropped: 0,
  })
})

describe('announceLivePaths', () => {
  it('sends the paths under the site subdomain', async () => {
    await announceLivePaths({
      hostSnapshot: hostDoc({ subdomain: 'acme' }),
      hostId: 'host-1',
      paths: ['/pricing'],
    })
    expect(mockPostTenantRevalidate).toHaveBeenCalledWith({
      subdomain: 'acme',
      hostId: 'host-1',
      paths: ['/pricing'],
    })
  })

  it('carries the custom domain, which is the key visitors read', async () => {
    // AGL-1152: a site with a domain attached caches its pages under a second
    // key, and a drop that names only the subdomain leaves the copy everybody
    // actually loads.
    await announceLivePaths({
      hostSnapshot: hostDoc({ subdomain: 'acme', cname: 'acme.com' }),
      hostId: 'host-1',
      paths: ['/pricing'],
    })
    expect(mockPostTenantRevalidate).toHaveBeenCalledWith(
      expect.objectContaining({ cname: 'acme.com' }),
    )
  })

  it('collapses duplicate addresses', async () => {
    await announceLivePaths({
      hostSnapshot: hostDoc({ subdomain: 'acme' }),
      hostId: 'host-1',
      paths: ['/a', '/a', '/b'],
    })
    expect(mockPostTenantRevalidate).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['/a', '/b'] }),
    )
  })

  it('sends nothing when there is nothing to say', async () => {
    // The tenant refuses a call carrying no paths, so an empty list would
    // spend a round trip to record a failure that is really "no change".
    await announceLivePaths({
      hostSnapshot: hostDoc({ subdomain: 'acme' }),
      hostId: 'host-1',
      paths: [],
    })
    expect(mockPostTenantRevalidate).not.toHaveBeenCalled()
  })

  it('sends nothing for a site with no tenant deployment yet', async () => {
    await announceLivePaths({
      hostSnapshot: hostDoc({}),
      hostId: 'host-1',
      paths: ['/pricing'],
    })
    expect(mockPostTenantRevalidate).not.toHaveBeenCalled()
  })

  it('NEVER REJECTS, which is what keeps it out of the write path', async () => {
    /*
      The property the three calling routes depend on. Each awaits this
      helper after a write that has already succeeded; if a refusing tenant
      could reject here, the route's catch block would turn a completed
      import or promotion into a 500 and the caller would retry a write that
      already landed.
    */
    mockPostTenantRevalidate.mockRejectedValue(new Error('tenant refused'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      announceLivePaths({
        hostSnapshot: hostDoc({ subdomain: 'acme' }),
        hostId: 'host-1',
        paths: ['/pricing'],
      }),
    ).resolves.toBe(false)
    spy.mockRestore()
  })

  it('reports a refusal as false rather than as a success', async () => {
    mockPostTenantRevalidate.mockResolvedValue({
      revalidated: [],
      reason: 'tenant-429',
      pathsDropped: 0,
    })
    await expect(
      announceLivePaths({
        hostSnapshot: hostDoc({ subdomain: 'acme' }),
        hostId: 'host-1',
        paths: ['/pricing'],
      }),
    ).resolves.toBe(false)
  })
})

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const IMPORT_ROUTE = 'apps/console/app/api/hosts/import/route.ts'
const SCREENS_ROUTE = 'apps/console/app/api/hosts/screens/route.ts'
const RESOURCES_ROUTE = 'apps/console/app/api/hosts/resources/route.ts'
const VERSIONS_ROUTE = 'apps/console/app/api/hosts/versions/route.ts'

describe('each server route announces what it changed', () => {
  it('a site restore drops the whole host', () => {
    // An import rewrites the routing map, the screens, their versions, the
    // layouts and the components at once, so "which pages changed" has no
    // answer shorter than all of them.
    const source = readRepo(IMPORT_ROUTE)
    expect(source).toMatch(/await revalidateEntireHost\(firestore, hostId\)/)
    // After the commit, not before it: announcing a write that has not landed
    // drops a cache the tenant would immediately refill from the old data.
    const commit = source.indexOf('await commit()')
    const announce = source.indexOf('await revalidateEntireHost(')
    expect(commit).toBeGreaterThan(-1)
    expect(announce).toBeGreaterThan(commit)
  })

  it('an error-screen change drops the whole host too', () => {
    // An error screen answers addresses the routing map has never heard of,
    // so there is no path list that could name the pages it changes.
    const source = readRepo(SCREENS_ROUTE)
    expect(source).toMatch(
      /if \(response\.ok\) await revalidateEntireHost\(firestore, hostId\)/,
    )
  })

  it('a kind promotion drops the screen own address', () => {
    const source = readRepo(SCREENS_ROUTE)
    expect(source).toMatch(/paths: \[screenRoutePathToUrl\(path\)\]/)
    // Only for a change that landed. Dropping a site's cache because someone
    // was refused is a cost with nothing behind it.
    expect(source).toMatch(/if \(response\.ok\) \{/)
  })

  it('a new redirect drops the address it captures', () => {
    const source = readRepo(RESOURCES_ROUTE)
    expect(source).toMatch(/resourceKey === 'redirect'/)
    expect(source).toMatch(/void announceLivePaths\(\{ hostSnapshot, hostId, paths: \[source\] \}\)/)
  })

  /**
   * THE ONE PATH DELIBERATELY LEFT SILENT.
   *
   * `POST /api/hosts/versions` creates a version, and a version is a DRAFT —
   * the route says so itself, and refuses an author precisely because moving
   * the parent's `versionId` is what publishing means and this is not that.
   * Nothing a visitor can reach changes when a draft is written, so an
   * announcement here would drop a live page's cache on every autosave: a
   * tenant round trip per keystroke-batch, to invalidate HTML that is still
   * correct. The publish that eventually promotes the draft moves the pointer
   * through a path that does announce.
   *
   * Asserted rather than merely omitted, so that "this route does not
   * announce" reads as a decision with a reason instead of the same oversight
   * this issue is about.
   */
  it('a draft version create stays silent, on purpose', () => {
    const source = readRepo(VERSIONS_ROUTE)
    expect(source).not.toMatch(/announceLivePaths|revalidateEntireHost/)
    expect(source).toMatch(/a new version is a DRAFT/)
  })
})
