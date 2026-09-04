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
 * A CLOSED TAB NO LONGER STRANDS A PUBLISH (AGL-2575).
 *
 * AGL-2573 gave the cache-drop announce a bounded retry and a telemetry line
 * on every outcome. Both only run while the tab does. The write lands in
 * Firestore, the tab goes away, the announce lands nowhere, and the live page
 * serves its old HTML for the hour-long document TTL with nothing recording
 * that it happened.
 *
 * ## What these assertions are careful about
 *
 * The property is not "an outbox entry is written". It is that the entry is
 * written IN THE SAME BATCH as the routing-map change and INDEPENDENTLY of
 * whether the announce ever ran — so every test here drives the publish with
 * an announce that NEVER SETTLES, which is what a closed tab looks like from
 * inside this module. An assertion that let the announce resolve would prove
 * the happy path and say nothing about the failure the issue is about.
 */

export {}

/**
 * The announce, as a promise this test controls.
 *
 * Left unsettled by default: the tab is gone, so nothing after the `await`
 * inside `revalidateLivePages` ever happens. `resolveAnnounce` is how a test
 * plays the tab staying open.
 */
let settleAnnounce: (value: { reason: string } | null) => void = () => undefined
const mockRevalidateLivePages = jest.fn(
  () =>
    new Promise<{ reason: string } | null>((resolve) => {
      settleAnnounce = resolve
    }),
)
jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: (...args: unknown[]) => (mockRevalidateLivePages as any)(...args),
  revalidateLivePages: (...args: unknown[]) =>
    (mockRevalidateLivePages as any)(...args),
  describeRevalidateShortfall: () => null,
}))

/** Every write mockStaged onto a batch, in order, with the batch it went onto. */
interface StagedWrite {
  batch: number
  op: 'set' | 'update'
  path: string
  data: Record<string, unknown>
}
const mockStaged: StagedWrite[] = []
const mockCommits: number[] = []
let mockBatchCount = 0

const mockGetDoc = jest.fn()
const mockDeleteDoc = jest.fn(async (_ref: { path: string }) => undefined)
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, name: string) => ({ collectionPath: name }),
  doc: (...segments: any[]) =>
    segments.length === 1 && segments[0]?.collectionPath
      ? { path: `${segments[0].collectionPath}/generated-id` }
      : { path: segments.slice(1).join('/') },
  getDoc: (...args: unknown[]) => (mockGetDoc as any)(...args),
  deleteDoc: (...args: unknown[]) => (mockDeleteDoc as any)(...args),
  serverTimestamp: () => '__server_time__',
  deleteField: () => '__deleted__',
  writeBatch: () => {
    mockBatchCount += 1
    const id = mockBatchCount
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        mockStaged.push({ batch: id, op: 'set', path: ref.path, data })
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        mockStaged.push({ batch: id, op: 'update', path: ref.path, data })
      },
      commit: async () => {
        mockCommits.push(id)
      },
    }
  },
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  isFirstPublishedRoute: () => false,
  trackEvent: () => undefined,
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PUBLISH_OUTBOX_COLLECTION,
  PUBLISH_OUTBOX_FIELDS,
  PUBLISH_OUTBOX_MAX_PATHS,
  sanitizePublishOutboxPaths,
} from '../constants/publish-outbox'
import {
  publishScreenRoute,
  syncScreenRouteEntries,
  unpublishScreenRoute,
} from '../constants/screen-publishing'

const user = { getIdToken: async () => 'token' }
const firestore = {} as never

const hostDoc = (routes: Record<string, string>) => ({
  get: (field: string) => (field === 'screens' ? routes : undefined),
})

/** The outbox writes this test produced. */
const outboxWrites = () =>
  mockStaged.filter((write) => write.path.startsWith(`${PUBLISH_OUTBOX_COLLECTION}/`))

/** The routing-map writes this test produced. */
const routingWrites = () =>
  mockStaged.filter(
    (write) =>
      write.path === 'hosts/host' &&
      Object.keys(write.data).some((key) => key.startsWith('screens.')),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockStaged.length = 0
  mockCommits.length = 0
  mockBatchCount = 0
  settleAnnounce = () => undefined
  mockGetDoc.mockResolvedValue(hostDoc({}) as never)
})

describe('the entry exists after the write, whether or not the announce ran', () => {
  it('records a one-click publish whose tab never comes back', async () => {
    // `handleTogglePublish` reaches the routing map through this function —
    // the publish button people actually use, by its own comment.
    await syncScreenRouteEntries(firestore, 'host', { s: 'pricing' }, { user })
    // The announce was STARTED and has not answered, which is every closed
    // tab, every slept laptop and every dropped connection.
    expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1)
    const entries = outboxWrites()
    expect(entries).toHaveLength(1)
    expect(entries[0].data).toMatchObject({
      hostId: 'host',
      paths: ['/pricing'],
      attempts: 0,
      createdAt: '__server_time__',
    })
    // Nothing released it, because nothing said the cache was dropped.
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('records a route publish the same way', async () => {
    await publishScreenRoute(
      firestore,
      { hostId: 'host', screenId: 's', user },
      'about',
    )
    expect(outboxWrites()[0]?.data).toMatchObject({
      hostId: 'host',
      paths: ['/about'],
    })
  })

  it('records an UNPUBLISH, whose address nothing else can still name', async () => {
    // The case the routing map cannot answer afterwards: the entry is removed
    // first, so by the time a drain runs there is nothing to resolve. The
    // address is read before the write and written down here.
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'retired' }) as never)
    await unpublishScreenRoute(firestore, { hostId: 'host', screenId: 's', user })
    expect(outboxWrites()[0]?.data).toMatchObject({ paths: ['/retired'] })
  })

  it('records both sides of a rename', async () => {
    mockGetDoc.mockResolvedValue(hostDoc({ s: 'docs/old' }) as never)
    await syncScreenRouteEntries(firestore, 'host', { s: 'docs/new' }, { user })
    expect(outboxWrites()[0]?.data).toMatchObject({
      paths: ['/docs/old', '/docs/new'],
    })
  })

  it('writes nothing when no address changed', async () => {
    // An entry the drain would read, resolve to nothing and delete is a
    // document written for no reason on every no-op sync.
    mockGetDoc.mockResolvedValue(hostDoc({ a: 'a' }) as never)
    await syncScreenRouteEntries(firestore, 'host', { a: 'a' }, { user })
    expect(outboxWrites()).toHaveLength(0)
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })
})

describe('the entry cannot be lost independently of the publish it describes', () => {
  it('rides the SAME batch as the routing-map write, committed once', async () => {
    /*
      THE PROPERTY THIS WHOLE CHANGE RESTS ON.

      An outbox entry written AFTER the routing map is an entry a closed tab
      loses exactly like the fetch it replaces. One written BEFORE it can
      order a cache drop for a publish that never happened. In one batch it is
      neither — so a pending entry always describes a live publish, and a live
      publish always has something behind it.
    */
    await syncScreenRouteEntries(firestore, 'host', { s: 'pricing' }, { user })
    expect(routingWrites()).toHaveLength(1)
    expect(outboxWrites()).toHaveLength(1)
    expect(outboxWrites()[0].batch).toBe(routingWrites()[0].batch)
    expect(mockCommits).toEqual([routingWrites()[0].batch])
  })

  it('carries the screen document in that batch too, on a route publish', async () => {
    await publishScreenRoute(
      firestore,
      { hostId: 'host', screenId: 's', user },
      'about',
    )
    const batches = new Set(mockStaged.map((write) => write.batch))
    expect(batches.size).toBe(1)
    expect(mockStaged.map((write) => write.path)).toEqual([
      'hosts/host/screens/s',
      'hosts/host',
      `${PUBLISH_OUTBOX_COLLECTION}/generated-id`,
    ])
    expect(mockCommits).toHaveLength(1)
  })

  it('leaves the publish itself alone when the announce rejects outright', async () => {
    mockRevalidateLivePages.mockRejectedValueOnce(new Error('offline') as never)
    await expect(
      syncScreenRouteEntries(firestore, 'host', { s: 'pricing' }, { user }),
    ).resolves.toBeUndefined()
    expect(mockCommits).toHaveLength(1)
    expect(outboxWrites()).toHaveLength(1)
  })
})

describe('the tab releases its own entry only when the cache really dropped', () => {
  it('deletes it on a plain ok', async () => {
    await syncScreenRouteEntries(firestore, 'host', { s: 'pricing' }, { user })
    settleAnnounce({ reason: 'ok' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1)
    expect(mockDeleteDoc.mock.calls[0][0]).toMatchObject({
      path: `${PUBLISH_OUTBOX_COLLECTION}/generated-id`,
    })
  })

  it('keeps it when the tenant refused, which is when it is needed', async () => {
    await syncScreenRouteEntries(firestore, 'host', { s: 'pricing' }, { user })
    settleAnnounce({ reason: 'tenant-429' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('keeps it when the helper answered nothing at all', async () => {
    // `revalidateLivePages` swallows its own failures and answers null. That
    // is an unknown, not a success, and an unknown must not release the only
    // record that the page may still be stale.
    await syncScreenRouteEntries(firestore, 'host', { s: 'pricing' }, { user })
    settleAnnounce(null)
    await Promise.resolve()
    await Promise.resolve()
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })
})

describe('the paths an entry may carry are bounded before they are written', () => {
  it('drops anything that is not a site-absolute address', () => {
    expect(
      sanitizePublishOutboxPaths(['/ok', 'no-slash', '/../escape', '', null]),
    ).toEqual(['/ok'])
  })

  it('caps at the tenant’s own MAX_PATHS, which would drop the rest anyway', () => {
    const many = Array.from({ length: 400 }, (_, index) => `/p${index}`)
    expect(sanitizePublishOutboxPaths(many)).toHaveLength(PUBLISH_OUTBOX_MAX_PATHS)
  })

  it('de-duplicates, so a whole-map sync cannot name one page twice', () => {
    expect(sanitizePublishOutboxPaths(['/a', '/a', '/b'])).toEqual(['/a', '/b'])
  })
})

describe('the writer and the rule are held to ONE field list', () => {
  /*
   * The rules pin the document to an exact key set, and the writer decides
   * what those keys are. Two hand-kept copies of the same list is how a field
   * gets added on one side and refused on the other — which fails as a
   * PERMISSION_DENIED on somebody's publish, not as a red test.
   */
  const rules = readFileSync(
    join(process.cwd(), 'cloud', 'firebase-firestore.rules'),
    'utf8',
  )

  it('the rule allows exactly the keys the writer writes', () => {
    /*
     * Anchored on the MATCH BLOCK, not on the word. `publishOutbox` appears
     * in prose above the block it names — `canPublishHostContent`'s docstring
     * cites it (AGL-2589) — and a bare-name anchor took the first `hasOnly`
     * after that mention instead, which belongs to a different collection
     * entirely. The comparison then held this rule against another rule's
     * field list: green or red for reasons that have nothing to do with the
     * coupling this test exists to keep.
     */
    const clause =
      /match \/publishOutbox\/[\s\S]*?hasOnly\(\s*\[([^\]]*)\]/.exec(rules)?.[1]
    // A regex that matched nothing would make the comparison below vacuous.
    expect(clause).toBeDefined()
    const allowed = [...(clause as string).matchAll(/'([\w]+)'/g)].map(
      (match) => match[1],
    )
    expect(allowed.sort()).toEqual([...PUBLISH_OUTBOX_FIELDS].sort())
  })

  it('the writer writes exactly the keys the rule allows', async () => {
    await syncScreenRouteEntries(firestore, 'host', { s: 'pricing' }, { user })
    expect(Object.keys(outboxWrites()[0].data).sort()).toEqual(
      [...PUBLISH_OUTBOX_FIELDS].sort(),
    )
  })
})
