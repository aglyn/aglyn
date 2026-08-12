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
 * AGL-1440: the redirect-rule query goes through the render cache — and only
 * the query.
 *
 * `resolveRedirect` runs before route resolution on every render of every
 * path, and Firestore bills a minimum of one read for a query that returns
 * nothing, so a site that has never written a redirect rule still paid a read
 * per page per revalidation. The rules are pure host-scoped published config,
 * which is what `withRenderCache` is for.
 *
 * The three things that must NOT move inside the cache, each with a test:
 *
 *  - **the paid gate.** `checkEntitlement(org, 'redirects')` is what stops a
 *    downgraded org's leftover rules from firing. Caching the org read here
 *    would keep a cancelled plan's redirects alive for the life of the entry —
 *    the stale-entitlement failure, on the one code path that can take a page
 *    off the internet.
 *  - **the hit counters.** They are sampled per render; a cached function
 *    would stop counting entirely rather than counting less often.
 *  - **the match.** It depends on the request path, which the cache key does
 *    not carry, and must not.
 */

const ruleDocs: Array<{ id: string; data: Record<string, unknown> }> = []
const reads: string[] = []
const writes: string[] = []
let orgPlan: Record<string, unknown> = { plan: 'business' }
let orgReads = 0

const docStub = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => ({ ...data, id }),
  ref: {
    set: async () => {
      writes.push(`rule:${id}`)
    },
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => {
              if (name === 'analytics') {
                return {
                  doc: () => ({
                    set: async () => {
                      writes.push('analytics')
                    },
                  }),
                }
              }
              return {
                // The rule's own document, for the `lastHitAt` stamp — the
                // ref is rebuilt from the id because a DocumentReference
                // cannot survive the cache's JSON round trip.
                doc: (id: string) => docStub(id, {}).ref,
                where: () => ({
                  limit: () => ({
                    get: async () => {
                      reads.push(name)
                      return {
                        empty: ruleDocs.length === 0,
                        docs: ruleDocs.map((rule) =>
                          docStub(rule.id, rule.data),
                        ),
                      }
                    },
                  }),
                }),
              }
            },
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => {
    orgReads += 1
    return { orgId: 'org-1', org: orgPlan }
  },
}))

const cacheCalls: Array<{
  key: readonly string[]
  revalidate: number
  tags: readonly string[]
}> = []
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: {
    key: readonly string[]
    revalidate: number
    tags: readonly string[]
    read: () => Promise<unknown>
  }) => {
    cacheCalls.push({
      key: options.key,
      revalidate: options.revalidate,
      tags: options.tags,
    })
    return options.read()
  },
}))

import { resolveRedirect } from './resolve-redirect'

const HOST = { $id: 'host-1' }

beforeEach(() => {
  cacheCalls.length = 0
  reads.length = 0
  writes.length = 0
  ruleDocs.length = 0
  orgReads = 0
  orgPlan = { plan: 'business' }
  ruleDocs.push({
    id: 'r1',
    data: {
      enabled: true,
      source: '/old',
      destination: '/new',
      statusCode: 301,
      matchType: 'exact',
    },
  })
})

describe('resolveRedirect caches its rule query (AGL-1440)', () => {
  it('reads the rules through the render cache, tagged for the host', async () => {
    await resolveRedirect(HOST, 'old')

    expect(reads).toEqual(['redirects'])
    expect(cacheCalls).toHaveLength(1)
    expect(cacheCalls[0].tags).toEqual(['tenant-data:host-1'])
    expect(cacheCalls[0].key).toContain('host-1')
  })

  it('keys per host and NOT per path', async () => {
    // The rule set is the same for every URL on the site. A path in the key
    // would give a busy site one cache entry per route and cache nothing.
    await resolveRedirect(HOST, 'old')
    await resolveRedirect(HOST, 'somewhere/else')
    expect(cacheCalls[0].key).toEqual(cacheCalls[1].key)

    await resolveRedirect({ $id: 'host-2' }, 'old')
    expect(cacheCalls[2].key).not.toEqual(cacheCalls[0].key)
  })

  it('still redirects', async () => {
    // The cache must not change the answer. Without this the rest of the file
    // would happily pass against a function that returns null every time.
    expect(await resolveRedirect(HOST, 'old')).toEqual({
      destination: '/new',
      statusCode: 301,
    })
  })

  it('re-checks the paid gate on every call, never from the cache', async () => {
    // A downgraded org's leftover rules must stop firing at once. If the
    // entitlement ever rode along inside the cached value, this second call
    // would still redirect.
    expect(await resolveRedirect(HOST, 'old')).not.toBeNull()
    orgPlan = { plan: 'free' }
    expect(await resolveRedirect(HOST, 'old')).toBeNull()
    expect(orgReads).toBe(2)
  })

  it('still records a sampled hit, so the counters do not go dark', async () => {
    await resolveRedirect(HOST, 'old')
    expect(writes).toEqual(expect.arrayContaining(['analytics', 'rule:r1']))
  })

  it('CONTROL — an unmatched path redirects nowhere and writes nothing', async () => {
    expect(await resolveRedirect(HOST, 'not-a-rule')).toBeNull()
    expect(writes).toEqual([])
  })
})
