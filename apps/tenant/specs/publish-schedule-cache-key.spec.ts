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
 * A SCHEDULED PUBLISH DROPS THE KEY THE PAGE IS ACTUALLY CACHED UNDER
 * (AGL-3163).
 *
 * The beat passed the host DOCUMENT id as the first path segment. The cache
 * key's first segment is the tenant host ALIAS — the subdomain, or the
 * `cname--` sentinel for an attached domain — which `getHost` uses to QUERY
 * the document id, so the two are different values by construction. Every
 * scheduled publish therefore dropped a key nothing holds, and the page went
 * on serving its old version for the rest of its hour.
 *
 * The hard part of noticing it: the `tenant-data:{hostId}` tag bust beside it
 * was always correct, because that tag really is keyed on the document id. So
 * the documents behind the page were fresh and the HTML was not, which reads
 * as a browser cache rather than as a bug.
 *
 * Asserted as the ARGUMENTS the beat passes, not as a source match: the point
 * is the value, and a source assertion would pass on any expression that spelt
 * `subdomain` anywhere near it.
 */

/**
 * A MODULE, not a script. Without an export the declarations below share one
 * global scope with `publish-schedule-job-lockdown.spec.ts`, whose harness
 * names half of them the same way — jest isolates the files, TypeScript does
 * not, and the collision fails `typecheck` rather than the suite.
 */
export {}

const mockApply = jest.fn(async () => undefined)
const mockRevalidatePath = jest.fn()
const mockRevalidateTag = jest.fn()

/** The host document id, which must NOT appear in any cache key. */
const HOST_ID = 'host_9a3f'
/** What the middleware rewrites to. */
const SUBDOMAIN = 'acme'
const CNAME = 'acme.com'

let mockHostFields: Record<string, unknown> = {}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL site time zone (AGL-3237), reached by file path for the same
  // reason as the modules beside it: absent, the loader's
  // `resolveSiteTimeZone` call throws into its catch and 404s every case
  // in this file for a reason unrelated to its subject.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entry-date',
  ),
  registerPluginJob: (job: { handler: () => Promise<void> }) => {
    mockRegistered = job.handler
  },
  // The real rule: a routing-map value is a path without its leading slash.
  screenRoutePathToUrl: (path: string) => (path === '/' ? '/' : `/${path}`),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) => mockHostFields[field],
            }),
          }),
        }),
      }),
    }),
  },
  getSiteLockdown: async () => null,
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
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}))

jest.mock('../utils/publish-schedule-next-due', () => ({
  __esModule: true,
  readDueSchedules: async () => mockDueDocs,
}))

let mockRegistered: (() => Promise<void>) | undefined
let mockDueDocs: unknown[] = []

/** One due schedule on `hosts/{HOST_ID}/screens/screen-1`, routed at /news. */
const dueScreen = () => ({
  id: 'screen-1',
  ref: { parent: { parent: { id: HOST_ID } } },
  get: (field: string) =>
    field === 'slug'
      ? 'news'
      : field === 'versionId'
        ? 'v2'
        : { status: 'pending', publishAt: new Date(Date.now() - 1000) },
})

beforeAll(async () => {
  await import('../utils/publish-schedule-job')
})

beforeEach(() => {
  mockApply.mockClear()
  mockRevalidatePath.mockClear()
  mockRevalidateTag.mockClear()
  mockDueDocs = [dueScreen()]
  mockHostFields = {
    subdomain: SUBDOMAIN,
    screens: { 'screen-1': 'news' },
  }
})

describe('the scheduled publish beat drops the right cache keys', () => {
  it('keys the page on the SUBDOMAIN, never on the host document id', async () => {
    await mockRegistered?.()
    expect(mockApply).toHaveBeenCalledTimes(1)
    const dropped = mockRevalidatePath.mock.calls.map(([path]) => path)
    expect(dropped.sort()).toEqual(['/acme/dark/news', '/acme/light/news'])
    // The failure this exists for: not "a wrong path" but "a path under an
    // id nothing is cached under", which looks like a successful drop.
    expect(dropped.some((path: string) => path.includes(HOST_ID))).toBe(false)
  })

  it('drops the CUSTOM DOMAIN key too, which is the one visitors read', async () => {
    mockHostFields = { ...mockHostFields, cname: CNAME }
    await mockRegistered?.()
    expect(mockRevalidatePath.mock.calls.map(([path]) => path).sort()).toEqual([
      '/acme/dark/news',
      '/acme/light/news',
      '/cname--acme.com/dark/news',
      '/cname--acme.com/light/news',
    ])
  })

  it('still busts the data tag on the host DOCUMENT id, which is its key', async () => {
    // The half that was always right, pinned so the fix above cannot be
    // "tidied" into using the alias here as well.
    await mockRegistered?.()
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      `tenant-data:${HOST_ID}`,
      'max',
    )
  })

  it('drops nothing for a site with no subdomain rather than keying on nothing', async () => {
    mockHostFields = { screens: { 'screen-1': 'news' } }
    await mockRegistered?.()
    // A site never given a name has no tenant cache entries to drop. A
    // leading-empty key (`//light/news`) would name another host's tree.
    expect(mockRevalidatePath).not.toHaveBeenCalled()
    // The publish itself still happened; only the cache hint had nowhere to go.
    expect(mockApply).toHaveBeenCalledTimes(1)
  })
})
