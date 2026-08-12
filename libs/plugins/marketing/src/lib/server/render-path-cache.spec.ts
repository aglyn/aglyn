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
 * AGL-1440: the two marketing reads on the tenant render path go through the
 * render cache.
 *
 * `getOverlays` and `getClientAutomations` fire on EVERY render of EVERY path,
 * and Firestore bills a minimum of one read for a query that returns nothing —
 * so a site with no overlays and no automations still paid two reads per page,
 * per revalidation, forever. They are pure host-scoped published data, which is
 * precisely what `withRenderCache` exists for; everything else in the compose
 * bundle was cached in AGL-1302 and these were missed.
 *
 * What these assertions are actually protecting:
 *
 *  - **the KEY is per-host and per-helper.** `unstable_cache` keys on callback
 *    source text plus the key parts, so two helpers in one file with the same
 *    key would serve each other's data.
 *  - **the TAG is the host's.** Without it the publish path cannot bust the
 *    entry and an author's edit waits out the TTL with no way to hurry it.
 *  - **the ENTITLEMENT decision stays outside the cache.** This is the one that
 *    matters: `compileClientAutomations` trims steps by the org's plan, and a
 *    cached compile would serve a downgraded org the paid steps — or an
 *    upgraded one the trimmed ones — for the life of the entry. So the cached
 *    value must be the RAW documents, with the compile run per render.
 */

const overlayDocs: Array<{ id: string; data: Record<string, unknown> }> = []
const actionDocs: Array<{ id: string; data: Record<string, unknown> }> = []
/** Every collection the helpers actually touched, in order. */
const readPaths: string[] = []

const collectionStub = (
  path: string,
  docs: Array<{ id: string; data: Record<string, unknown> }>,
) => ({
  limit: () => ({
    get: async () => {
      readPaths.push(path)
      return { docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })) }
    },
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) =>
              collectionStub(
                name,
                name === 'overlays' ? overlayDocs : actionDocs,
              ),
          }),
        }),
      }),
    }),
  },
}))

/** Captures what each helper asked the cache for, and runs the read for real. */
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

import getOverlays from './get-overlays'
import { getClientAutomations } from './get-client-automations'

beforeEach(() => {
  cacheCalls.length = 0
  readPaths.length = 0
  overlayDocs.length = 0
  actionDocs.length = 0
})

describe('getOverlays goes through the render cache (AGL-1440)', () => {
  it('caches the overlays read under the host tag', async () => {
    overlayDocs.push({ id: 'o1', kind: 'bar', data: { kind: 'bar' } } as never)
    const overlays = await getOverlays({ hostId: 'host-1' })

    expect(readPaths).toEqual(['overlays'])
    expect(cacheCalls).toHaveLength(1)
    expect(cacheCalls[0].tags).toEqual(['tenant-data:host-1'])
    expect(cacheCalls[0].key).toContain('host-1')
    expect(overlays).toEqual([{ $id: 'o1', kind: 'bar' }])
  })

  it('keys per host, so one site never serves another its overlays', async () => {
    await getOverlays({ hostId: 'host-1' })
    await getOverlays({ hostId: 'host-2' })

    expect(cacheCalls[0].key).not.toEqual(cacheCalls[1].key)
  })
})

describe('getClientAutomations goes through the render cache (AGL-1440)', () => {
  const call = (overrides: Record<string, unknown> = {}) =>
    getClientAutomations({
      hostId: 'host-1',
      path: '/',
      actionsEntitled: true,
      allowJs: true,
      ...overrides,
    } as never)

  it('caches the actions read under the host tag', async () => {
    await call()

    expect(readPaths).toEqual(['actions'])
    expect(cacheCalls).toHaveLength(1)
    expect(cacheCalls[0].tags).toEqual(['tenant-data:host-1'])
    expect(cacheCalls[0].key).toContain('host-1')
  })

  it('does not collide with the overlays cache key', async () => {
    // Same host, same file, same wrapper — only the key prefix keeps these two
    // reads apart, and getting it wrong serves overlay documents as actions.
    await getOverlays({ hostId: 'host-1' })
    await call()

    expect(cacheCalls[0].key).not.toEqual(cacheCalls[1].key)
  })

  it('NEVER varies its cache key by entitlement or path', async () => {
    // The cached value is the raw `actions` documents, which do not depend on
    // either. If a key ever picked these up it would mean the compile had moved
    // inside the cache — see the entitlement test below for why that is unsafe.
    await call({ path: '/', actionsEntitled: true, allowJs: true })
    await call({ path: '/pricing', actionsEntitled: false, allowJs: false })

    expect(cacheCalls[0].key).toEqual(cacheCalls[1].key)
  })

  it('re-trims by entitlement on every call, cache or no cache', async () => {
    // The stale-entitlement failure this guards: an advanced client step that
    // only paid plans get. Both calls read the same cached documents; only the
    // entitled one may come back with the step.
    // A basic step alongside the advanced one, so the automation survives the
    // un-entitled compile and the assertion is about the STEP being trimmed
    // rather than the whole automation disappearing.
    actionDocs.push({
      id: 'a1',
      data: {
        name: 'a1',
        trigger: { event: 'pageVisit' },
        steps: [
          { type: 'openMenu', menuNodeId: 'menu-1' },
          { type: 'trackGaEvent', event: 'seen' },
        ],
      },
    })

    const entitled = await call({ actionsEntitled: true })
    const notEntitled = await call({ actionsEntitled: false })

    const steps = (list: unknown) =>
      (list as Array<{ steps: Array<{ type: string }> }>)
        .flatMap((automation) => automation.steps)
        .map((step) => step.type)

    expect(steps(entitled)).toContain('trackGaEvent')
    expect(steps(notEntitled)).not.toContain('trackGaEvent')
  })
})
