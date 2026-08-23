/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 */

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
 * A SCHEDULED PUBLISH MUST NOT FIRE THROUGH A LOCKDOWN (AGL-1621).
 *
 * Found while re-drilling the panic button. The publish beat runs on a
 * secret-gated route (`api/plugins/run-jobs`) with platform credentials, no
 * visitor and no session — so every gate that covers the visitor-facing write
 * paths sits somewhere this code never goes. It is the same shape as the
 * `api/presence/summary` defect: a privileged path acting outside the lock,
 * which is exactly the drift a coverage guard that only walks
 * `apps/console/app/api` cannot see.
 *
 * The two ways it bites:
 *
 *  - under a **read-only** lock, a publish is the write the mode exists to
 *    freeze — its whole purpose is that nothing races the repair in progress;
 *  - under a **full** takedown, the site is already 503-ing, so the publish
 *    looks harmless — but it flips the version pointer and re-registers the
 *    route, so the content the takedown was answering goes live the instant
 *    the lock lifts.
 *
 * Both directions are asserted. A suite that only ever observed the blocked
 * case would pass just as well on a beat that had stopped publishing at all.
 */

const mockApply = jest.fn(async () => undefined)
let mockSiteLockdown: unknown = null
let mockLockdownCalls: string[] = []

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginJob: (job: { handler: () => Promise<void> }) => {
    mockRegistered = job.handler
  },
  screenRoutePathToUrl: (path: string) => `https://demo.aglyn.app${path}`,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collectionGroup: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({ get: async () => ({ docs: [] }) }),
            }),
          }),
        }),
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) =>
                field === 'screens' ? { 'screen-1': '/news' } : 'demo',
            }),
          }),
        }),
      }),
    }),
  },
  getSiteLockdown: async (hostId: string) => {
    mockLockdownCalls.push(hostId)
    // A function lets one case answer differently per host WITHOUT a
    // `jest.spyOn` on a dynamically imported module — a deferred first-party
    // import here registers a DYNAMIC nx graph edge that then forbids every
    // static import of `@aglyn/tenant-data-admin` in every project that
    // reaches it (AGL-949/1329/2282). A spec is not a code-split boundary.
    const answer = mockSiteLockdown
    return typeof answer === 'function' ? await answer(hostId) : answer
  },
}))

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
}))

jest.mock('@aglyn/tenant-runtime/apply-publish-schedule', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockApply(...(args as [])),
}))

jest.mock('next/cache', () => ({
  __esModule: true,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
}))

jest.mock('../utils/publish-schedule-next-due', () => ({
  __esModule: true,
  readDueSchedules: async () => mockDueDocs,
}))

let mockRegistered: (() => Promise<void>) | undefined
let mockDueDocs: unknown[] = []

/** One due schedule on `hosts/{hostId}/screens/screen-1`. */
function dueScreen(hostId: string) {
  return {
    id: 'screen-1',
    ref: { parent: { parent: { id: hostId } } },
    get: (field: string) =>
      field === 'slug'
        ? '/news'
        : field === 'versionId'
          ? 'v2'
          : { status: 'pending', publishAt: new Date(Date.now() - 1000) },
  }
}

beforeAll(async () => {
  await import('../utils/publish-schedule-job')
})

beforeEach(() => {
  mockApply.mockClear()
  mockLockdownCalls = []
  mockSiteLockdown = null
  mockDueDocs = [dueScreen('demo')]
})

describe('the publish beat honours a lockdown', () => {
  it('CONTROL — with no lock, the due schedule publishes', async () => {
    await mockRegistered?.()
    expect(mockApply).toHaveBeenCalledTimes(1)
    // The gate was consulted, and consulted for the right host.
    expect(mockLockdownCalls).toEqual(['demo'])
  })

  it('a FULL lock stops the publish', async () => {
    mockSiteLockdown = { scope: 'host', reason: 'security' }
    await mockRegistered?.()
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('a READ-ONLY lock stops it too — a publish is a write', async () => {
    mockSiteLockdown = { scope: 'org', reason: 'maintenance', mode: 'read-only' }
    await mockRegistered?.()
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('the skipped schedule is left PENDING, not consumed', async () => {
    // A lockdown is a pause, not a cancellation. Nothing but the executor
    // marks a schedule published, so not calling it IS leaving it pending —
    // asserted here so a future refactor that "tidies up" by marking skipped
    // schedules done has to argue with a test.
    mockSiteLockdown = { scope: 'host', reason: 'security' }
    await mockRegistered?.()
    expect(mockApply).not.toHaveBeenCalled()

    // ...and it publishes on the next beat once the lock lifts.
    mockSiteLockdown = null
    await mockRegistered?.()
    expect(mockApply).toHaveBeenCalledTimes(1)
  })

  it('locks are evaluated PER HOST, not once for the batch', async () => {
    mockDueDocs = [dueScreen('locked-host'), dueScreen('healthy-host')]
    mockSiteLockdown = (hostId: string) =>
      hostId === 'locked-host' ? { scope: 'host', reason: 'security' } : null
    await mockRegistered?.()
    expect(mockLockdownCalls).toEqual(['locked-host', 'healthy-host'])
    // Only the healthy host published; one locked site did not freeze the
    // whole platform's schedules, and one healthy site did not carry the
    // locked one through.
    expect(mockApply).toHaveBeenCalledTimes(1)
  })
})
