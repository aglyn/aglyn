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
 * EVERY PUBLISH PATH ANNOUNCES ITSELF TO THE LIVE SITE (AGL-2573).
 *
 * The reliability of the announcement was fixed first — it retries a
 * transient refusal and logs one telemetry line per outcome. None of that
 * helped the paths that never announced at all, which was most of them: the
 * one-click Publish button ("the publish button people actually use", by its
 * own comment), route publish and unpublish, the screens list, screen delete,
 * every slug rename, and four server routes. A person hit Publish, the
 * pointer moved, and nothing dropped the tenant's cache — so the page kept
 * serving its old HTML until the window lapsed on its own.
 *
 * Two properties, and they fail differently:
 *
 * - THAT each path announces is a wiring failure. It renders perfectly and is
 *   invisible until somebody watches a live URL not change, so it is asserted
 *   by executing the seam every path goes through.
 * - THAT a failed announcement cannot fail the publish is a correctness
 *   property with the opposite risk: wiring a cache hint into a write path is
 *   exactly how a successful publish starts reporting an error. Every path
 *   below is exercised with an announcement that rejects.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// `mock`-prefixed so jest's hoisted factories may close over them.
const mockRevalidateLivePages = jest.fn<
  Promise<null>,
  [{ hostId?: string; paths?: string[] }]
>(async () => null)
jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: (...args: unknown[]) => (mockRevalidateLivePages as any)(...args),
  revalidateLivePages: (...args: unknown[]) =>
    (mockRevalidateLivePages as any)(...args),
  describeRevalidateShortfall: () => null,
}))

const mockGetDoc = jest.fn()
const mockDeleteDoc = jest.fn(async () => undefined)
/*
 * The publish is ONE BATCH since AGL-2575 — the routing-map write, the screen
 * document and the outbox entry commit together or not at all — so the double
 * is a batch rather than a pair of loose writes.
 */
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockCommit = jest.fn(async () => undefined)
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, name: string) => ({ collectionPath: name }),
  // `doc(firestore, 'hosts', id)` addresses a known document; `doc(collection)`
  // mints an auto id, which is how the outbox entry is created.
  doc: (...segments: any[]) =>
    segments.length === 1 && segments[0]?.collectionPath
      ? { path: `${segments[0].collectionPath}/auto-id` }
      : { path: segments.slice(1).join('/') },
  getDoc: (...args: unknown[]) => (mockGetDoc as any)(...args),
  deleteDoc: (...args: unknown[]) => (mockDeleteDoc as any)(...args),
  serverTimestamp: () => '__server_time__',
  writeBatch: () => ({
    set: mockBatchSet,
    update: mockBatchUpdate,
    commit: mockCommit,
  }),
  deleteField: () => '__deleted__',
}))

const mockTrackEvent = jest.fn()
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  // The real predicate: `first_publish` over the placeholder home page is part
  // of what AGL-3478 changes, and it is a pure function of the map.
  isFirstPublishedRoute: jest.requireActual(
    '@aglyn/aglyn/app-utils/analytics-events',
  ).isFirstPublishedRoute,
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

import {
  publishScreenRoute,
  releaseDefaultHomeRoot,
  RouteRemovalRefusedError,
  syncScreenRouteEntries,
  unpublishScreenRoute,
} from '../constants/screen-publishing'

const user = { getIdToken: async () => 'token' }
const firestore = {} as never

/** A host document whose routing map is `routes`. */
const hostDoc = (routes: Record<string, string>) => ({
  get: (field: string) => (field === 'screens' ? routes : undefined),
})

/** The single `revalidateLivePages` call this test made. */
const announced = () => mockRevalidateLivePages.mock.calls[0]?.[0]

beforeEach(() => {
  jest.clearAllMocks()
  mockGetDoc.mockResolvedValue(hostDoc({}) as never)
})

describe('publishing a route announces the address it just created', () => {
  it('names the new path', async () => {
    await publishScreenRoute(firestore, { hostId: 'host', screenId: 's', user }, 'about')
    expect(announced()?.hostId).toBe('host')
    expect(announced()?.paths).toEqual(['/about'])
  })

  it('drops the OLD address too when a re-publish moves the page', async () => {
    // The case a `screenId` alone cannot express: the map now points at
    // `/pricing`, so nothing downstream can still name `/plans` — and the
    // page cached there would go on being served at a URL the owner believes
    // they moved away from.
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'plans' }) as never)
    await publishScreenRoute(
      firestore,
      { hostId: 'host', screenId: 's', user },
      'pricing',
    )
    expect(announced()?.paths).toEqual(['/plans', '/pricing'])
  })

  it('still publishes when the announcement fails', async () => {
    mockRevalidateLivePages.mockRejectedValue(new Error('tenant refused') as never)
    await expect(
      publishScreenRoute(firestore, { hostId: 'host', screenId: 's', user }, 'about'),
    ).resolves.toBeUndefined()
    // The write itself landed — the hint is the only thing that did not.
    expect(mockCommit).toHaveBeenCalled()
  })
})

describe('unpublishing announces the address that is going away', () => {
  it('names the path the routing map is about to lose', async () => {
    /*
      THE REGRESSION THIS FILE EXISTS FOR. `/api/screens/revalidate` resolves
      a screen id through the routing map; by the time an unpublish is
      announced the entry is gone, so a `screenId`-only call finds nothing and
      answers `not-routed` — a reported success over a retired page that is
      still cached and still being served. Reading the address BEFORE the
      write is what makes the drop possible at all.
    */
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'old-page' }) as never)
    await unpublishScreenRoute(firestore, { hostId: 'host', screenId: 's', user })
    expect(announced()?.paths).toEqual(['/old-page'])
  })

  it('says nothing for a screen that was never routed', async () => {
    // No live page ever existed at an address, so there is none to drop, and
    // a call carrying no paths is one the tenant refuses.
    await unpublishScreenRoute(firestore, { hostId: 'host', screenId: 's', user })
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('still unpublishes when the announcement fails', async () => {
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'old-page' }) as never)
    mockRevalidateLivePages.mockRejectedValue(new Error('tenant refused') as never)
    await expect(
      unpublishScreenRoute(firestore, { hostId: 'host', screenId: 's', user }),
    ).resolves.toBeUndefined()
    expect(mockCommit).toHaveBeenCalled()
  })

  it('removes THIS screen’s entry and leaves the live pages under it routed (AGL-3463)', async () => {
    mockGetDoc.mockResolvedValue(
      hostDoc({ s: 'company', child: 'company/about' }) as never,
    )
    await unpublishScreenRoute(firestore, { hostId: 'host', screenId: 's', user })
    const hostWrites = mockBatchUpdate.mock.calls.filter(
      ([ref]) => (ref as { path: string }).path === 'hosts/host',
    )
    expect(hostWrites).toHaveLength(1)
    expect(hostWrites[0][1]).toEqual({ 'screens.s': '__deleted__' })
    expect(announced()?.paths).toEqual(['/company'])
  })
})

describe('a starter taking the root from the placeholder home page (AGL-3408)', () => {
  /** A host created with its placeholder home page still on `/`. */
  const newSite = (routes: Record<string, string>, defaultHome?: string) => ({
    get: (field: string) =>
      field === 'screens'
        ? routes
        : field === 'defaultHomeScreenId'
          ? defaultHome
          : undefined,
  })

  it('unpublishes the placeholder, clears the marker in the same write, and announces `/`', async () => {
    mockGetDoc.mockResolvedValue(newSite({ home: '/' }, 'home') as never)
    await expect(
      releaseDefaultHomeRoot(firestore, { hostId: 'host', user }),
    ).resolves.toBe(true)
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { path: 'hosts/host' },
      { 'screens.home': '__deleted__', defaultHomeScreenId: '__deleted__' },
    )
    // Unpublished, never deleted: whatever the owner typed into it is kept.
    expect(mockBatchSet).toHaveBeenCalledWith(
      { path: 'hosts/host/screens/home' },
      { publishedAt: '__deleted__' },
      { merge: true },
    )
    expect(announced()?.paths).toEqual(['/'])
  })

  it('NEVER moves a home page the owner made — a site with no marker', async () => {
    mockGetDoc.mockResolvedValue(newSite({ mine: '/' }) as never)
    await expect(
      releaseDefaultHomeRoot(firestore, { hostId: 'host', user }),
    ).resolves.toBe(false)
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('leaves the root alone once the placeholder no longer holds it', async () => {
    mockGetDoc.mockResolvedValue(
      newSite({ home: 'welcome', mine: '/' }, 'home') as never,
    )
    await expect(
      releaseDefaultHomeRoot(firestore, { hostId: 'host', user }),
    ).resolves.toBe(false)
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('a page published at `/` replaces the placeholder in the SAME host update', async () => {
    mockGetDoc.mockResolvedValue(newSite({ ph: '/' }, 'ph') as never)
    await publishScreenRoute(
      firestore,
      { hostId: 'host', screenId: 'real', user },
      '/',
    )
    // One update of the host document, so `/` is never held by two screens.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { path: 'hosts/host' },
      {
        'screens.real': '/',
        'screens.ph': '__deleted__',
        defaultHomeScreenId: '__deleted__',
      },
    )
    expect(mockBatchSet).toHaveBeenCalledWith(
      { path: 'hosts/host/screens/ph' },
      { publishedAt: '__deleted__' },
      { merge: true },
    )
    expect(announced()?.paths).toEqual(['/'])
  })

  it('a route sync that gives `/` to a real page replaces the placeholder too', async () => {
    mockGetDoc.mockResolvedValue(newSite({ ph: '/' }, 'ph') as never)
    await syncScreenRouteEntries(firestore, 'host', { real: '/' }, { user })
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { path: 'hosts/host' },
      {
        'screens.real': '/',
        'screens.ph': '__deleted__',
        defaultHomeScreenId: '__deleted__',
      },
    )
  })

  it('publishing anywhere else leaves it alone', async () => {
    mockGetDoc.mockResolvedValue(newSite({ ph: '/' }, 'ph') as never)
    await publishScreenRoute(firestore, { hostId: 'host', screenId: 'real', user }, 'about')
    await syncScreenRouteEntries(firestore, 'host', { real: 'company' }, { user })
    for (const [, updates] of mockBatchUpdate.mock.calls) {
      expect(Object.keys(updates)).not.toContain('defaultHomeScreenId')
      expect(Object.keys(updates)).not.toContain('screens.ph')
    }
  })

  it('releases nothing when the host cannot be read', async () => {
    mockGetDoc.mockRejectedValue(new Error('offline') as never)
    await expect(
      releaseDefaultHomeRoot(firestore, { hostId: 'host', user }),
    ).resolves.toBe(false)
    expect(mockCommit).not.toHaveBeenCalled()
  })
})

/**
 * AGL-3478 — THE OWNER PUBLISHING THE PLACEHOLDER MAKES IT THEIR HOME PAGE.
 *
 * AGL-3408 handed `/` over when ANOTHER page was published there. The obvious
 * move — editing the placeholder itself and publishing it — left the marker
 * behind, so the next starter would unpublish the page the owner made, the
 * guided start still read the site as blank, and `first_publish` never
 * counted the publish.
 */
describe('publishing the placeholder home page itself (AGL-3478)', () => {
  const newSite = (routes: Record<string, string>, defaultHome?: string) => ({
    get: (field: string) =>
      field === 'screens'
        ? routes
        : field === 'defaultHomeScreenId'
          ? defaultHome
          : undefined,
  })

  /*
   * A host document the seam's writes actually change, so a publish and the
   * starter that follows it read one history rather than two fixtures.
   */
  let host: { screens: Record<string, string>; defaultHomeScreenId?: string }
  const liveHost = () => {
    mockGetDoc.mockImplementation(async () =>
      newSite({ ...host.screens }, host.defaultHomeScreenId),
    )
    mockBatchUpdate.mockImplementation(
      (ref: { path: string }, updates: Record<string, unknown>) => {
        if (ref.path !== 'hosts/host') return
        for (const [key, value] of Object.entries(updates)) {
          if (key === 'defaultHomeScreenId') {
            if (value === '__deleted__') delete host.defaultHomeScreenId
            continue
          }
          const id = key.replace(/^screens\./, '')
          if (value === '__deleted__') delete host.screens[id]
          else host.screens[id] = value as string
        }
      },
    )
  }

  beforeEach(() => {
    host = { screens: { ph: '/' }, defaultHomeScreenId: 'ph' }
  })
  afterEach(() => {
    mockGetDoc.mockReset()
    mockBatchUpdate.mockReset()
  })

  it('clears the marker in the same host update and keeps the route where it is', async () => {
    mockGetDoc.mockResolvedValue(newSite({ ph: '/' }, 'ph') as never)
    await publishScreenRoute(
      firestore,
      { hostId: 'host', screenId: 'ph', versionId: 'v-mine', user },
      '/',
    )
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { path: 'hosts/host' },
      { 'screens.ph': '/', defaultHomeScreenId: '__deleted__' },
    )
    // The pointer rides the same batch — the owner's version goes live in the
    // write that makes the page theirs, never one without the other.
    expect(mockBatchSet).toHaveBeenCalledWith(
      { path: 'hosts/host/screens/ph' },
      expect.objectContaining({ slug: '/', versionId: 'v-mine' }),
      { merge: true },
    )
    expect(mockBatchSet).not.toHaveBeenCalledWith(
      expect.anything(),
      { publishedAt: '__deleted__' },
      expect.anything(),
    )
    expect(mockCommit).toHaveBeenCalledTimes(1)
    // No address changed, so there is nothing to announce or to outbox.
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('counts it as the site’s first publish', async () => {
    mockGetDoc.mockResolvedValue(newSite({ ph: '/' }, 'ph') as never)
    await publishScreenRoute(firestore, { hostId: 'host', screenId: 'ph', user }, '/')
    expect(mockTrackEvent).toHaveBeenCalledWith('site_published', {
      first_publish: true,
    })
  })

  it('clears it from a Publish that syncs the placeholder’s routes', async () => {
    mockGetDoc.mockResolvedValue(newSite({}, 'ph') as never)
    await syncScreenRouteEntries(
      firestore,
      'host',
      { ph: '/' },
      { user },
      { published: 'ph' },
    )
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { path: 'hosts/host' },
      { 'screens.ph': '/', defaultHomeScreenId: '__deleted__' },
    )
  })

  it('does NOT clear it for a move or a rename that only carries the placeholder along', async () => {
    mockGetDoc.mockResolvedValue(newSite({ ph: '/' }, 'ph') as never)
    await syncScreenRouteEntries(firestore, 'host', { ph: 'welcome' }, { user })
    await syncScreenRouteEntries(
      firestore,
      'host',
      { parent: 'company', ph: 'company/home' },
      { user },
      { published: 'parent' },
    )
    for (const [, updates] of mockBatchUpdate.mock.calls) {
      expect(Object.keys(updates)).not.toContain('defaultHomeScreenId')
    }
  })

  it('a starter applied after the owner published it no longer unpublishes it', async () => {
    liveHost()
    await publishScreenRoute(firestore, { hostId: 'host', screenId: 'ph', user }, '/')
    mockCommit.mockClear()
    await expect(
      releaseDefaultHomeRoot(firestore, { hostId: 'host', user }),
    ).resolves.toBe(false)
    expect(mockCommit).not.toHaveBeenCalled()
    expect(host).toEqual({ screens: { ph: '/' } })
  })

  it('a site whose placeholder was never touched still hands `/` to the starter', async () => {
    liveHost()
    await publishScreenRoute(firestore, { hostId: 'host', screenId: 'real', user }, 'about')
    await expect(
      releaseDefaultHomeRoot(firestore, { hostId: 'host', user }),
    ).resolves.toBe(true)
    expect(host).toEqual({ screens: { real: 'about' } })
  })
})

describe('a routing-map sync announces both sides of every move', () => {
  it('drops the address a rename left behind and the one it arrived at', async () => {
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'docs/old' }) as never)
    await syncScreenRouteEntries(firestore, 'host', { s: 'docs/new' }, { user })
    expect(announced()?.paths).toEqual(['/docs/old', '/docs/new'])
  })

  it('refuses a removal before reading or writing anything (AGL-3463)', async () => {
    // A sync is what a move, a rename or a parent's publish writes for a
    // whole subtree, so a removal in it would take down a page nobody pointed
    // at. Every unpublish surface calls `unpublishScreenRoute` instead.
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'gone', t: 'kept' }) as never)
    await expect(
      syncScreenRouteEntries(
        firestore,
        'host',
        { s: null, t: 'kept' } as unknown as Record<string, string>,
        { user },
      ),
    ).rejects.toBeInstanceOf(RouteRemovalRefusedError)
    expect(mockGetDoc).not.toHaveBeenCalled()
    expect(mockBatchUpdate).not.toHaveBeenCalled()
    expect(mockCommit).not.toHaveBeenCalled()
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('refuses an empty path as a removal too', async () => {
    await expect(
      syncScreenRouteEntries(firestore, 'host', { s: '' }, { user }),
    ).rejects.toMatchObject({ screenIds: ['s'] })
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('ignores entries rewritten to the address they already had', async () => {
    /*
      A sync rewrites the whole subtree, so most entries in a rename carry the
      value they already held. Announcing those would spend the tenant's path
      cap on pages nothing changed and could push the two that DID move out of
      the request.
    */
    mockGetDoc.mockResolvedValue(
      hostDoc({ a: 'a', b: 'b', c: 'c' }) as never,
    )
    await syncScreenRouteEntries(
      firestore,
      'host',
      { a: 'a', b: 'b', c: 'c-moved' },
      { user },
    )
    expect(announced()?.paths).toEqual(['/c', '/c-moved'])
  })

  it('says nothing when a sync changes no address', async () => {
    mockGetDoc.mockResolvedValue(hostDoc({ a: 'a' }) as never)
    await syncScreenRouteEntries(firestore, 'host', { a: 'a' }, { user })
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('still writes the routing map when the announcement fails', async () => {
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'old' }) as never)
    mockRevalidateLivePages.mockRejectedValue(new Error('tenant refused') as never)
    await expect(
      syncScreenRouteEntries(firestore, 'host', { s: 'new' }, { user }),
    ).resolves.toBeUndefined()
    expect(mockCommit).toHaveBeenCalled()
  })

  it('publishes even when the routing map cannot be read', async () => {
    // The read is for the announcement's benefit, not the write's. A host
    // document that will not load must not stop somebody publishing.
    mockGetDoc.mockRejectedValue(new Error('offline') as never)
    await expect(
      syncScreenRouteEntries(firestore, 'host', { s: 'new' }, { user }),
    ).resolves.toBeUndefined()
    expect(mockCommit).toHaveBeenCalled()
    expect(announced()?.paths).toEqual(['/new'])
  })
})

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const BESIGNER =
  'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx'
const VIEW =
  'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx'
const SCREENS_LIST = 'apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx'
const HELPER = 'apps/console/utils/revalidate-live-pages.ts'
const ROUTE = 'apps/console/app/api/screens/revalidate/route.ts'

/**
 * The seam only covers a surface that goes THROUGH it, and the type checker
 * proves that much: `user` is required, so a call site that does not pass one
 * does not compile. What it cannot prove is that these particular surfaces
 * still route their publishes through the seam rather than writing the map
 * themselves, which is the shape the next regression would take.
 */
describe('every editor publish surface reaches the seam', () => {
  it('the one-click Publish button announces on both branches', () => {
    const source = readRepo(BESIGNER)
    // Publish syncs the subtree's entries with the announcer…
    expect(source).toMatch(/buildRouteEntries\(candidateById\),\s*\{ user \},/)
    // …and Unpublish goes through the seam that removes this page's entry
    // alone and announces its address (AGL-3463) — never a sync with a
    // removal in it, which the sync now refuses.
    expect(source).toMatch(
      /await unpublishScreenRoute\(firestore, \{ hostId, screenId, user \}\)/,
    )
    expect(source).toMatch(
      /unpublishScreenRoute\(\s*firestore,\s*\{ hostId, screenId, user \},\s*\{ clearSlug: true \},?\s*\)/,
    )
  })

  it('route publish and unpublish both announce', () => {
    const source = readRepo(VIEW)
    expect(source).toMatch(/publishScreenRoute\(\s*firestore,\s*\{ hostId, screenId, user \},/)
    expect(source).toMatch(
      /await unpublishScreenRoute\(firestore, \{ hostId, screenId, user \}\)/,
    )
  })

  /*
   * The placeholder home page stops being one when its owner publishes it
   * (AGL-3478), and the seam can only clear the marker on a write it sees.
   * A version publish of an already-routed page never reaches the seam on
   * its own, so the two that can publish the placeholder are pinned here.
   */
  it('a version publish of the placeholder goes through the seam', () => {
    expect(readRepo(VIEW)).toMatch(
      /publishScreenRoute\(\s*firestore,\s*\{ hostId, screenId, versionId: id, user \},/,
    )
    const besigner = readRepo(BESIGNER)
    expect(besigner).toMatch(
      /publishScreenRoute\(\s*firestore,\s*\{ hostId, screenId, versionId, user \},/,
    )
    // Both besigner Publish buttons name the screen they put on the site.
    expect(besigner.match(/\{ published: screenId \}/g)).toHaveLength(2)
  })

  /*
   * CREATE IS NO LONGER ON THIS LIST (AGL-3021).
   *
   * It used to be: creating a screen published its route in the same chain,
   * so the announce had to ride along. That was the defect — a blank page
   * went live because somebody clicked *create* — and creating now writes
   * the screen and its first version and nothing else. A path that publishes
   * nothing has nothing to announce, so the assertion that used to live here
   * (`{ hostId, screenId: newId, user }`) would now pin the bug rather than
   * the seam. `create-screen-is-a-draft.spec.ts` holds the other side of it.
   *
   * The two routing-map writes the list still makes are below, and the new
   * row-menu Unpublish shares the delete path's call shape.
   */
  it('the screens list announces on unpublish, delete and move', () => {
    const source = readRepo(SCREENS_LIST)
    expect(source).not.toMatch(/\{ hostId, screenId: newId, user \}/)
    expect(source).toMatch(/unpublishScreenRoute\(firestore, \{ hostId, screenId: id, user \}\)/)
    // The move path, asserted by the CALL rather than by what sits next to
    // it. This read `publish: false, }), { user },` — the entries object and
    // the announce adjacent in the source — which held only while the
    // composition was built inline at the call. AGL-2588 lifted it above the
    // write batch so a reserved address can be refused before anything is
    // written, and the assertion broke on formatting while the behaviour it
    // names was untouched.
    expect(source).toMatch(
      /syncScreenRouteEntries\(\s*firestore,\s*hostId,\s*[A-Za-z]+,\s*\{\s*user,?\s*\}/,
    )
  })

  it('the client helper forwards explicit paths', () => {
    const source = readRepo(HELPER)
    expect(source).toMatch(/paths\?: string\[\]/)
    expect(source).toMatch(/\.\.\.\(paths\?\.length \? \{ paths \} : \{\}\)/)
  })

  it('the console route accepts them and validates them like a redirect', () => {
    const source = readRepo(ROUTE)
    expect(source).toMatch(/const namedPaths = Array\.isArray\(/)
    expect(source).toMatch(/path\.startsWith\('\/'\) && !path\.includes\('\.\.'\)/)
    // The 400 has to name the new key, or a caller sending one is told the
    // field it just sent is not a field.
    expect(source).toMatch(/redirectPath or paths/)
    expect(source).toMatch(/\.\.\.namedPaths,/)
  })
})
