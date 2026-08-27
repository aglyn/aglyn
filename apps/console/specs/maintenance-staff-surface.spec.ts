/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Request` is not a constructor.
 *
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
 * The three curl-only maintenance routes became reachable from the console,
 * and the two destructive ones got harder to fire than the curl they replace
 * (AGL-1949).
 *
 * `audit-archive`, `reap-plugin-artifacts` and `reverify-plugin-versions`
 * accepted the shared cron secret and nothing else, so a browser could not
 * call them at all. The claims, each given the input that makes it fail:
 *
 * 1. **A staff ID token authorizes**, and the cron secret still does — the
 *    scheduler has no user and must keep working.
 * 2. **A non-staff token does not**, and neither does no credential, an
 *    unverifiable token, or an unverified email. Fails closed at every step.
 * 3. **A staff REAL run is refused without a reason**, on all three.
 * 4. **A staff REAL run on a DESTRUCTIVE job is refused without the exact
 *    typed phrase** — the control that makes a one-click irreversible sweep
 *    impossible. A near-miss (wrong case, padded) is refused too: a
 *    confirmation that accepts an approximation of itself can be fired by
 *    accident.
 * 5. **A refused run does no work.** The dangerous failure is not the status
 *    code, it is a 400 that deleted first — so refusals assert that nothing
 *    was written or deleted.
 * 6. **A staff run is audited BEFORE it acts**, with the actor and reason.
 * 7. **A staff dry run needs neither**, and stays a dry run — the preview has
 *    to be free to read or nobody reads it before arming.
 * 8. **The cron beat is stamped only by the SCHEDULER**, never by a staff
 *    run: a person pressing the button must not make a job that stopped being
 *    scheduled look alive on the health board.
 */

// A module, not a script.
export {}

const mockVerifyIdToken = jest.fn()
let mockAudit: Record<string, unknown>[] = []
let mockCronBeats: string[] = []
let mockDeleted: string[] = []
let mockSaved: string[] = []
let mockBatchDeletes = 0

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/server'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    body:
      request.method === 'POST'
        ? await request.json().catch(() => undefined)
        : undefined,
    headers: Object.fromEntries(request.headers),
  }),
}))

jest.mock('../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: async (jobId: string) => {
    mockCronBeats.push(jobId)
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

/** An empty query that answers every shape these routes ask for. */
function mockEmptyQuery() {
  const self: Record<string, unknown> = {
    where: () => self,
    orderBy: () => self,
    startAfter: () => self,
    limit: () => self,
    get: async () => ({ empty: true, size: 0, docs: [] }),
  }
  return self
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  meterPlatformEmail: async () => undefined,
  notifyStaff: async () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      storage: () => ({
        bucket: () => ({
          getFiles: async () => [[]],
          file: (name: string) => ({
            delete: async () => {
              mockDeleted.push(name)
            },
            save: async () => {
              mockSaved.push(name)
            },
            download: async () => [Buffer.from('')],
          }),
        }),
      }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'adminAudit') {
            return {
              ...mockEmptyQuery(),
              add: async (data: Record<string, unknown>) => {
                mockAudit.push(data)
                return { id: `audit-${mockAudit.length}` }
              },
            }
          }
          return mockEmptyQuery()
        },
        /*
         * The claim walk, modelled rather than stubbed. The reaper pages the
         * collection group and deletes exactly the objects nothing claims, so
         * a double that answered `get()` without the ordering and cursor the
         * real walk uses would let a change that stopped walking pass.
         */
        collectionGroup: () => {
          const page = () => ({
            orderBy: () => page(),
            select: () => page(),
            limit: () => page(),
            startAfter: () => page(),
            get: async () => ({ empty: true, docs: [] }),
          })
          return page()
        },
        getAll: async () => [],
        batch: () => ({
          delete: () => {
            mockBatchDeletes += 1
          },
          commit: async () => undefined,
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
}))

const ORIGINAL_ENV = process.env
const CRON_SECRET = 'cron-fake'

/** The three routes, with the descriptor facts the contract turns on. */
const ROUTES = [
  {
    id: 'audit-archive',
    module: '../app/api/admin/audit-archive/route',
    path: '/api/admin/audit-archive',
    destructive: true,
    phrase: 'ARCHIVE AUDIT ROWS',
  },
  {
    id: 'reap-plugin-artifacts',
    module: '../app/api/admin/reap-plugin-artifacts/route',
    path: '/api/admin/reap-plugin-artifacts',
    destructive: true,
    phrase: 'DELETE ORPHANED BUNDLES',
  },
  {
    id: 'reverify-plugin-versions',
    module: '../app/api/admin/reverify-plugin-versions/route',
    path: '/api/admin/reverify-plugin-versions',
    destructive: false,
    phrase: null,
  },
] as const

function load(module: string) {
  jest.resetModules()
  return require(module) as {
    GET: (request: Request) => Promise<Response>
    POST: (request: Request) => Promise<Response>
  }
}

function req(
  path: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown,
) {
  return new Request(`https://app.aglyn.com${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const STAFF = { authorization: 'Bearer staff-id-token' }
const CRON = { 'x-cron-secret': CRON_SECRET }

/** Did this run destroy or write anything? */
function didWork(): boolean {
  return (
    mockDeleted.length > 0 || mockSaved.length > 0 || mockBatchDeletes > 0
  )
}

describe('staff maintenance surface (AGL-1949)', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      CRON_SECRET,
      PLUGIN_ARTIFACTS_BUCKET: 'artifacts-bucket',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'media-bucket',
    } as NodeJS.ProcessEnv
    mockAudit = []
    mockCronBeats = []
    mockDeleted = []
    mockSaved = []
    mockBatchDeletes = 0
    mockVerifyIdToken.mockReset().mockResolvedValue({
      uid: 'uid-staff',
      email_verified: true,
      staff: true,
    })
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  for (const route of ROUTES) {
    describe(route.id, () => {
      describe('the gate', () => {
        it('refuses a request with no credential at all', async () => {
          const response = await load(route.module).GET(
            req(route.path, 'GET', {}),
          )
          expect(response.status).toBe(401)
          expect(didWork()).toBe(false)
        })

        it('refuses a verified token with NO staff claim', async () => {
          // AGL-1993: the claim is minted correctly and was read wrong on the
          // client. The route keys on the decoded claim and nothing else.
          mockVerifyIdToken.mockResolvedValue({
            uid: 'uid-customer',
            email_verified: true,
          })
          const response = await load(route.module).GET(
            req(route.path, 'GET', STAFF),
          )
          expect(response.status).toBe(401)
          expect(didWork()).toBe(false)
        })

        it('refuses a staff token whose email is unverified', async () => {
          mockVerifyIdToken.mockResolvedValue({
            uid: 'uid-staff',
            email_verified: false,
            staff: true,
          })
          const response = await load(route.module).GET(
            req(route.path, 'GET', STAFF),
          )
          expect(response.status).toBe(401)
        })

        it('refuses a token that will not verify', async () => {
          mockVerifyIdToken.mockRejectedValue(new Error('expired'))
          const response = await load(route.module).GET(
            req(route.path, 'GET', STAFF),
          )
          expect(response.status).toBe(401)
        })

        it('ACCEPTS a staff token for a dry run', async () => {
          const response = await load(route.module).GET(
            req(route.path, 'GET', STAFF),
          )
          expect(response.status).toBe(200)
          expect((await response.json()).dryRun).toBe(true)
          // A preview must be free to read, or nobody reads one before arming.
          expect(mockAudit).toHaveLength(0)
          expect(didWork()).toBe(false)
        })

        it('still accepts the scheduler', async () => {
          const response = await load(route.module).POST(
            req(route.path, 'POST', CRON),
          )
          expect(response.status).toBe(200)
        })
      })

      describe('a staff-triggered REAL run', () => {
        const real = (body: Record<string, unknown>) =>
          load(route.module).POST(
            req(route.path, 'POST', STAFF, { dryRun: false, ...body }),
          )

        it('is refused with no reason, and does nothing', async () => {
          const response = await real({ confirm: route.phrase ?? '' })
          expect(response.status).toBe(400)
          expect(String((await response.json()).error)).toContain('reason')
          expect(mockAudit).toHaveLength(0)
          expect(didWork()).toBe(false)
        })

        it('is refused with a too-short reason', async () => {
          const response = await real({
            reason: 'x',
            confirm: route.phrase ?? '',
          })
          expect(response.status).toBe(400)
          expect(didWork()).toBe(false)
        })

        if (route.destructive) {
          it('is refused with NO typed phrase, and does nothing', async () => {
            const response = await real({ reason: 'clearing backlog' })
            expect(response.status).toBe(400)
            expect(String((await response.json()).error)).toContain(
              route.phrase as string,
            )
            expect(mockAudit).toHaveLength(0)
            expect(didWork()).toBe(false)
          })

          it('is refused for a near-miss phrase', async () => {
            for (const near of [
              (route.phrase as string).toLowerCase(),
              ` ${route.phrase} `,
              (route.phrase as string).slice(0, -1),
            ]) {
              mockAudit = []
              const response = await real({
                reason: 'clearing backlog',
                confirm: near,
              })
              expect(response.status).toBe(400)
              expect(mockAudit).toHaveLength(0)
            }
          })
        }

        it('is AUDITED with the actor and reason before it acts', async () => {
          const response = await real({
            reason: 'clearing the backlog by hand',
            ...(route.phrase ? { confirm: route.phrase } : {}),
          })
          expect(response.status).toBe(200)
          expect(mockAudit).toHaveLength(1)
          expect(mockAudit[0]).toMatchObject({
            actorUid: 'uid-staff',
            target: route.path,
          })
          expect(
            (mockAudit[0].after as Record<string, unknown>).reason,
          ).toBe('clearing the backlog by hand')
          // Said out loud that a person did this, not the schedule.
          expect(
            (mockAudit[0].after as Record<string, unknown>).triggeredBy,
          ).toBe('staff-console')
        })

        it('does NOT stamp the cron beat', async () => {
          // A person pressing the button must never make a job that stopped
          // being scheduled read as alive on the health board (AGL-1955).
          await real({
            reason: 'clearing the backlog by hand',
            ...(route.phrase ? { confirm: route.phrase } : {}),
          })
          expect(mockCronBeats).toHaveLength(0)
        })
      })

      it('the SCHEDULER stamps the beat and needs no confirmation', async () => {
        const response = await load(route.module).POST(
          req(route.path, 'POST', CRON),
        )
        expect(response.status).toBe(200)
        expect(mockCronBeats).toEqual([route.id])
        // The cron is not a person and leaves no staff-run audit row.
        expect(mockAudit).toHaveLength(0)
      })
    })
  }
})
