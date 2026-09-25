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
 * A SCHEDULED ENTRY GOES OUT ON ITS BEAT, AND THE PAGES THAT LIST IT FOLLOW
 * (AGL-3340).
 *
 * The render-time flip published a due entry only when some page's cached
 * copy expired and a visitor asked for it, and dropped nothing else — so a
 * 09:00 post reached `/blog`, its category listings, the home page's rail and
 * the sitemap each on its own clock, up to an hour and more late. The beat
 * exists to make that one event at the entry's time.
 *
 * Asserted here, in the order they fail:
 *
 * - a publish DROPS the collection's pages, once per collection, with every
 *   entry it published there — and a refusal, a no-op or a failed write drops
 *   nothing, because nothing a visitor sees changed;
 * - a lockdown stops the publish and leaves the schedule to the next beat,
 *   per host (AGL-1621's shape, for the reason `publish-schedule-job` has);
 * - only a SITE's content entries are touched: the query is a collection
 *   group, and it reaches every collection named `entries`;
 * - the wiring that renders nothing when it is missing — the runner's import
 *   and the index the query needs.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Outcome = 'published' | 'refused' | 'unchanged' | 'failed'

let mockRegistered: (() => Promise<void>) | undefined
let mockDueDocs: unknown[] = []
let mockSiteLockdown: unknown = null
let mockLockdownCalls: string[] = []
let mockOutcomes: Record<string, Outcome> = {}
const mockApply = jest.fn(
  async (options: { hostId: string; entry: { id: string } }) =>
    mockOutcomes[options.entry.id] ?? 'published',
)
let mockTarget: unknown = null
const mockTargetFor = jest.fn<Promise<unknown>, [unknown]>(
  async () => mockTarget,
)
const mockDrop = jest.fn<Promise<boolean>, [unknown]>(async () => true)
const mockRevalidateTag = jest.fn()

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginJob: (job: { handler: () => Promise<void> }) => {
    mockRegistered = job.handler
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
  getSiteLockdown: async (hostId: string) => {
    mockLockdownCalls.push(hostId)
    const answer = mockSiteLockdown
    return typeof answer === 'function' ? await answer(hostId) : answer
  },
}))

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
}))

jest.mock('@aglyn/tenant-data-admin/server/collection-live-pages', () => ({
  __esModule: true,
  collectionLivePageTarget: (options: unknown) => mockTargetFor(options),
}))

jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  applyDueEntrySchedule: (options: { hostId: string; entry: { id: string } }) =>
    mockApply(options),
  entryScheduleDueAtMs: () => 0,
}))

jest.mock('next/cache', () => ({
  __esModule: true,
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}))

jest.mock('../utils/live-page-dropper', () => ({
  __esModule: true,
  dropLivePagesInProcess: (target: unknown) => mockDrop(target),
}))

jest.mock('../utils/publish-schedule-next-due', () => ({
  __esModule: true,
  createNextDueMemo: () => ({
    readDueSchedules: async () => mockDueDocs,
    reset: () => undefined,
  }),
}))

/** One due entry at `hosts/{hostId}/collections/{collectionId}/entries/{id}`. */
function dueEntry(
  id: string,
  options: { hostId?: string; collectionId?: string; slug?: string } = {},
) {
  const hostId = options.hostId ?? 'host-1'
  const collectionId = options.collectionId ?? 'blog-id'
  return {
    id,
    ref: { path: `hosts/${hostId}/collections/${collectionId}/entries/${id}` },
    get: (field: string) =>
      field === 'slug' ? (options.slug ?? id) : undefined,
  }
}

const TARGET = {
  hostId: 'host-1',
  subdomain: 'demo',
  paths: ['/blog/post-a', '/blog', '/'],
  truncated: false,
}

beforeAll(async () => {
  await import('../utils/entry-schedule-job')
})

beforeEach(() => {
  mockApply.mockClear()
  mockTargetFor.mockClear()
  mockDrop.mockClear()
  mockRevalidateTag.mockClear()
  mockLockdownCalls = []
  mockSiteLockdown = null
  mockOutcomes = {}
  mockTarget = TARGET
  mockDueDocs = [dueEntry('post-a')]
})

describe('a scheduled entry that goes out drops the pages that list it', () => {
  it('CONTROL — publishes the due entry and drops its collection', async () => {
    await mockRegistered?.()
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockTargetFor).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: 'host-1',
        collectionId: 'blog-id',
        entrySlugs: ['post-a'],
      }),
    )
    expect(mockDrop).toHaveBeenCalledWith(TARGET)
  })

  it('drops ONCE per collection, naming every entry it published there', async () => {
    mockDueDocs = [
      dueEntry('post-a'),
      dueEntry('post-b'),
      dueEntry('note-1', { collectionId: 'changelog-id' }),
    ]
    await mockRegistered?.()
    expect(mockTargetFor).toHaveBeenCalledTimes(2)
    expect(mockTargetFor.mock.calls.map(([options]) => options)).toEqual([
      expect.objectContaining({
        collectionId: 'blog-id',
        entrySlugs: ['post-a', 'post-b'],
      }),
      expect.objectContaining({
        collectionId: 'changelog-id',
        entrySlugs: ['note-1'],
      }),
    ])
    expect(mockDrop).toHaveBeenCalledTimes(2)
  })

  it.each(['refused', 'unchanged', 'failed'] as const)(
    'drops nothing when the flip was %s — nothing a visitor sees changed',
    async (outcome) => {
      mockOutcomes = { 'post-a': outcome }
      await mockRegistered?.()
      expect(mockApply).toHaveBeenCalledTimes(1)
      expect(mockTargetFor).not.toHaveBeenCalled()
      expect(mockDrop).not.toHaveBeenCalled()
    },
  )

  it('still refreshes the cached rows when there is no page to name', async () => {
    // A site with no subdomain has no deployment holding its pages, but its
    // document tag still holds the rows from before the flip.
    mockTarget = null
    await mockRegistered?.()
    expect(mockDrop).not.toHaveBeenCalled()
    expect(mockRevalidateTag).toHaveBeenCalledWith('tenant-data:host-1', 'max')
  })

  it('does nothing at all when nothing is due', async () => {
    mockDueDocs = []
    await mockRegistered?.()
    expect(mockApply).not.toHaveBeenCalled()
    expect(mockTargetFor).not.toHaveBeenCalled()
  })
})

describe('the entry beat honors a lockdown', () => {
  it('a lock stops the publish, and the schedule is left for the next beat', async () => {
    mockSiteLockdown = { scope: 'host', reason: 'security' }
    await mockRegistered?.()
    expect(mockLockdownCalls).toEqual(['host-1'])
    expect(mockApply).not.toHaveBeenCalled()
    expect(mockDrop).not.toHaveBeenCalled()

    mockSiteLockdown = null
    await mockRegistered?.()
    expect(mockApply).toHaveBeenCalledTimes(1)
  })

  it('locks are evaluated PER HOST, not once for the batch', async () => {
    mockDueDocs = [
      dueEntry('post-a', { hostId: 'locked-host' }),
      dueEntry('post-b', { hostId: 'healthy-host' }),
    ]
    mockSiteLockdown = (hostId: string) =>
      hostId === 'locked-host' ? { scope: 'host', reason: 'security' } : null
    await mockRegistered?.()
    expect(mockLockdownCalls).toEqual(['locked-host', 'healthy-host'])
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply.mock.calls[0][0].hostId).toBe('healthy-host')
  })
})

describe('only a site content entry is ever touched', () => {
  it('skips an `entries` document outside hosts/{h}/collections/{c}', async () => {
    mockDueDocs = [
      {
        id: 'row-1',
        ref: { path: 'orgs/org-1/ledgers/l-1/entries/row-1' },
        get: () => undefined,
      },
      {
        id: 'row-2',
        ref: { path: 'hosts/h/collections/c/entries/row-2/entries/row-3' },
        get: () => undefined,
      },
    ]
    await mockRegistered?.()
    expect(mockLockdownCalls).toEqual([])
    expect(mockApply).not.toHaveBeenCalled()
  })
})

describe('the wiring nothing renders when it is missing', () => {
  const repo = (relative: string) =>
    readFileSync(join(__dirname, '../../..', relative), 'utf8')

  it('the job runner imports the beat — nothing else registers it', () => {
    expect(repo('apps/tenant/app/api/plugins/run-jobs/route.ts')).toMatch(
      /^import '\.\.\/\.\.\/\.\.\/\.\.\/utils\/entry-schedule-job'$/m,
    )
  })

  it('declares the COLLECTION_GROUP index its query needs', () => {
    // A collection group gets no automatic index, and a missing one is
    // FAILED_PRECONDITION in production and a silent pass on the emulator.
    const { indexes } = JSON.parse(
      repo('cloud/firebase-firestore.indexes.json'),
    ) as {
      indexes: Array<{
        collectionGroup: string
        queryScope: string
        fields: Array<{ fieldPath: string; order?: string }>
      }>
    }
    const signatures = indexes
      .filter(
        (index) =>
          index.collectionGroup === 'entries' &&
          index.queryScope === 'COLLECTION_GROUP',
      )
      .map((index) =>
        index.fields
          .map((field) => `${field.fieldPath}:${field.order}`)
          .join(' > '),
      )
    expect(signatures).toContain('status:ASCENDING > publishAt:ASCENDING')
  })
})
