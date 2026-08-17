/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * AGL-1790 · signing a PRIVATE media URL is a read, and a read-only lock
 * passes reads — including past the legacy line beside the verdict.
 *
 * `POST /api/media/sign` mints the short-lived URL every private asset in
 * the console is displayed through. It has declared `intent: 'read'` since
 * AGL-1511 and the verdict has always honoured it, so under a read-only
 * lock the verdict returned null — and then the next line 404'd the request
 * anyway:
 *
 *     if (member.orgSuspended === true) return refuse()
 *
 * `applyOrgLockdown` writes that projection onto every member doc for EVERY
 * mode (`apps/console/utils/server/org-lockdown.ts:197`, pinned by
 * `lockdown-revocation-wiring.spec.ts`), so the projection is true under
 * read-only too. A mode-blind gate stood beside a mode-aware one and won,
 * blanking every private image in a console the mode table promises still
 * works.
 *
 * WHAT THIS FILE DOES NOT MOCK, and why that is the point.
 *
 * AGL-1724 found that all three specs asserting the read-only claim mocked
 * `org-lockdown.ts` away, which is how a claim survives without a test. The
 * same trap is available here in a nastier form: the defect is one line
 * BELOW the verdict, and the fix's correctness depends on the route and the
 * verdict agreeing about what "this org is locked, actively, right now"
 * means. A stubbed `lockdownRefusal` that restated "read-only passes reads"
 * would test that restatement, not the wiring — the two could drift and
 * every assertion here would stay green.
 *
 * So the REAL `lockdownRefusal` runs, out of
 * `@aglyn/tenant-data-admin/server/lockdown`, over a fake Firestore
 * installed at `./firebase-admin` — the module it imports the Admin SDK
 * from. Real precedence, real `normalizeOrgLockdown`, real expiry, real
 * platform-doc cache (invalidated per test, through the real invalidator).
 * The org lock in every case below is the document `applyOrgLockdown`
 * actually writes, not a hand-made verdict.
 *
 * The pairs matter more than any single case:
 *
 *  - read-only passes AND a full lock still 423s — so a pass is not the
 *    route having quietly stopped consulting the verdict at all;
 *  - the preview passes AND a genuine WRITE against the same org document
 *    is still refused — so the fix cannot have disabled the control;
 *  - the projection alone no longer refuses, AND a projection that
 *    disagrees with the carrier still does. That second half is the whole
 *    of the pre-AGL-1506 rule the legacy line was written for, and dropping
 *    the line outright would have lost it silently.
 */

import {
  getLockdownVerdict,
  invalidatePlatformLockdownCache,
  invalidateUserLockdownCache,
} from '@aglyn/tenant-data-admin/server/lockdown'

// The real `mintMediaSignature` runs, so the real secret gate applies. Set
// before the route module is imported: `tokenSigningSecret()` THROWS when
// it is missing, which the route would report as a 500 and no assertion
// below would explain.
process.env['TOKEN_SIGNING_SECRET'] = 'media-sign-read-intent-spec-secret'

const ORG_ID = 'org-1'
const MEDIA_ID = 'm-private'
const UID = 'u-admin'

/** Every document the fake Firestore serves, by path. */
let mockStore: Record<string, Record<string, unknown>> = {}
/** Every mutating call the fake Firestore saw. Signing must make none. */
let writes: string[] = []

const mockVerifyIdToken = jest.fn()

const snapshot = (path: string, id: string) => {
  const data = mockStore[path]
  return {
    id,
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}

/**
 * A document handle whose mutators RECORD rather than throw. A throw would
 * surface as the route's catch-all 500 and read as a lock refusal in a
 * status assertion; a recording lets `writes` be asserted empty, which is
 * the claim `intent: 'read'` actually makes.
 */
const docHandle = (path: string, id: string): Record<string, unknown> => ({
  path,
  id,
  get: async () => snapshot(path, id),
  set: async () => {
    writes.push(`set ${path}`)
  },
  update: async () => {
    writes.push(`update ${path}`)
  },
  delete: async () => {
    writes.push(`delete ${path}`)
  },
  collection: (name: string) => collectionHandle(`${path}/${name}`),
})

const collectionHandle = (prefix: string) => ({
  doc: (id: string) => docHandle(`${prefix}/${id}`, id),
})

const mockFirestore = {
  collection: (name: string) => collectionHandle(name),
  batch: () => ({
    set: (ref: { path: string }) => writes.push(`batch.set ${ref.path}`),
    update: (ref: { path: string }) => writes.push(`batch.update ${ref.path}`),
    delete: (ref: { path: string }) => writes.push(`batch.delete ${ref.path}`),
    commit: async () => {
      writes.push('batch.commit')
    },
  }),
}

/**
 * Every reference below is behind an arrow ON PURPOSE. Babel hoists
 * `jest.mock` above the imports and the imports above these `const`s, so a
 * factory that dereferenced one eagerly would throw a temporal-dead-zone
 * ReferenceError before a single test ran.
 */
const mockFirebaseAdmin = {
  app: () => ({
    auth: () => ({
      verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    }),
    firestore: () => mockFirestore,
  }),
}

/**
 * The Admin SDK, replaced at the module the lockdown code imports it from
 * — NOT at the barrel. That is what lets the real verdict read the real
 * `lockdowns/platform` document out of `mockStore` and apply its real cache.
 */
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => mockFirebaseAdmin.app() },
}))

/**
 * The barrel, with the lockdown and signing halves wired through to the
 * REAL modules. Only the two plain Firestore reads the route makes around
 * them are faked, and both are faked to their documented contracts:
 * `getOrgDoc` answers null for a missing document, `resolveOrgMembership`
 * answers the member doc the projection lives on.
 */
jest.mock('@aglyn/tenant-data-admin', () => {
  const lockdown = jest.requireActual(
    '@aglyn/tenant-data-admin/server/lockdown',
  )
  const signing = jest.requireActual(
    '@aglyn/tenant-data-admin/server/media-signing',
  )
  return {
    __esModule: true,
    firebaseAdmin: { app: () => mockFirebaseAdmin.app() },
    isImpersonationSession: () => false,
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    lockdownRefusal: lockdown.lockdownRefusal,
    lockdownJsonResponse: lockdown.lockdownJsonResponse,
    mintMediaSignature: signing.mintMediaSignature,
    mediaSignatureQuery: signing.mediaSignatureQuery,
    getOrgDoc: async (orgId: string) => {
      const data = mockStore[`orgs/${orgId}`]
      return data ? { $id: orgId, ...data } : null
    },
    resolveOrgMembership: async (uid: string, orgId: string) => {
      const data = mockStore[`orgs/${orgId}/members/${uid}`]
      return data ? { orgId, member: { $id: uid, ...data } } : null
    },
  }
})

import { POST } from '../app/api/media/sign/route'

const sign = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/media/sign', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, mediaId: MEDIA_ID, ...body }),
    }),
  )

/**
 * The org carrier exactly as `applyOrgLockdown` writes it: `suspendedAt`
 * always, `suspendedMode` only for read-only (a full lock writes no mode
 * key at all, which is what makes every pre-mode document a full lock).
 */
const orgLock = (
  options: { mode?: 'read-only'; untilMs?: number } = {},
): Record<string, unknown> => ({
  plan: 'pro',
  suspendedAt: Date.now() - 60_000,
  suspendedReasonCode: 'maintenance',
  ...(options.mode ? { suspendedMode: options.mode } : {}),
  ...(options.untilMs !== undefined
    ? { suspendedUntilMs: options.untilMs }
    : {}),
})

/** Locked org doc + the member projection every mode stamps alongside it. */
function lockOrg(options: { mode?: 'read-only'; untilMs?: number } = {}): void {
  mockStore[`orgs/${ORG_ID}`] = orgLock(options)
  mockStore[`orgs/${ORG_ID}/members/${UID}`] = {
    role: 'admin',
    orgSuspended: true,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  // The real platform read is cached for 15 s in-process, and the real
  // invalidator is the only supported way to drop it — a spec that reached
  // into the module's internals would stop testing the thing it ships.
  invalidatePlatformLockdownCache()
  invalidateUserLockdownCache()
  writes = []
  mockStore = {
    [`orgs/${ORG_ID}`]: { plan: 'pro' },
    [`orgs/${ORG_ID}/members/${UID}`]: { role: 'admin' },
    [`orgs/${ORG_ID}/media/${MEDIA_ID}`]: {
      private: true,
      visibleTo: ['org'],
    },
  }
  mockVerifyIdToken.mockResolvedValue({
    uid: UID,
    email_verified: true,
    staff: false,
  })
})

describe('AGL-1790 · a private preview under a read-only lock', () => {
  it('signs the URL instead of 404ing it', async () => {
    lockOrg({ mode: 'read-only' })
    const response = await sign()
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(String(payload['url'])).toMatch(
      new RegExp(`^/api/media/cdn/org:${ORG_ID}/${MEDIA_ID}\\?exp=\\d+&sig=`),
    )
    expect(typeof payload['expiresAtMs']).toBe('number')
  })

  it('writes nothing while signing — the claim the read intent makes', async () => {
    lockOrg({ mode: 'read-only' })
    await sign()
    // No `lastAccessedAt`, no minted document, no Storage object. If this
    // ever fails, signing became a write and the declaration must come out
    // along with the exemption this file argues for.
    expect(writes).toEqual([])
  })

  it('still refuses under a FULL lock on the same document shape', async () => {
    lockOrg()
    const response = await sign()
    // 423 rather than the 404: the verdict answered, so the pass above is
    // the MODE being honoured, not the route having stopped asking.
    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toMatchObject({
      error: 'locked',
      scope: 'org',
      reason: 'maintenance',
    })
  })

  it('still refuses a genuine WRITE against that very org document', async () => {
    // The same carrier the preview passes, put to the verdict as a write —
    // the control the fix must not have disabled. Driven through the real
    // verdict rather than restated, so it is the shipped rule answering.
    lockOrg({ mode: 'read-only' })
    await expect(
      getLockdownVerdict({ org: mockStore[`orgs/${ORG_ID}`], intent: 'write' }),
    ).resolves.toMatchObject({ scope: 'org', mode: 'read-only' })
    // And the read the route declares, for contrast, on the same document.
    await expect(
      getLockdownVerdict({ org: mockStore[`orgs/${ORG_ID}`], intent: 'read' }),
    ).resolves.toBeNull()
  })
})

describe('AGL-1790 · what the projection must still refuse', () => {
  it('refuses when the projection DISAGREES with the carrier', async () => {
    // The pre-AGL-1506 rule, kept: a member doc that says locked while the
    // org document says nothing is a stale projection, and a disagreement
    // never loosens. Dropping the legacy line outright would have served
    // this request — which is why the fix narrows it rather than deleting
    // it.
    mockStore[`orgs/${ORG_ID}/members/${UID}`] = {
      role: 'admin',
      orgSuspended: true,
    }
    const response = await sign()
    expect(response.status).toBe(404)
    expect(writes).toEqual([])
  })

  it('refuses when the carrier lock has EXPIRED under the projection', async () => {
    // `untilMs` in the past deactivates a lock with no write, so the org
    // document is no longer locked while the projection still says it is —
    // the same disagreement, arrived at by the route staff use most.
    lockOrg({ mode: 'read-only', untilMs: Date.now() - 1_000 })
    const response = await sign()
    expect(response.status).toBe(404)
  })

  it('keeps 404ing a non-private asset under a read-only lock', async () => {
    // The lock is not the only gate, and relaxing it must not have relaxed
    // the others: only PRIVATE assets are signed.
    lockOrg({ mode: 'read-only' })
    mockStore[`orgs/${ORG_ID}/media/${MEDIA_ID}`] = { visibleTo: ['org'] }
    const response = await sign()
    expect(response.status).toBe(404)
  })

  it('keeps 404ing a non-member under a read-only lock', async () => {
    lockOrg({ mode: 'read-only' })
    delete mockStore[`orgs/${ORG_ID}/members/${UID}`]
    const response = await sign()
    expect(response.status).toBe(404)
  })
})

describe('AGL-1790 · the other scopes still answer', () => {
  it('refuses a private preview under a FULL platform lock', async () => {
    mockStore['lockdowns/platform'] = {
      scope: 'platform',
      reason: 'security',
      atMs: Date.now(),
    }
    const response = await sign()
    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toMatchObject({ scope: 'platform' })
  })

  it('passes a private preview under a READ-ONLY platform lock', async () => {
    mockStore['lockdowns/platform'] = {
      scope: 'platform',
      mode: 'read-only',
      reason: 'maintenance',
      atMs: Date.now(),
    }
    const response = await sign()
    expect(response.status).toBe(200)
  })

  it('signs for staff under a full org lock — the un-panic invariant', async () => {
    lockOrg()
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-staff',
      email_verified: true,
      staff: true,
    })
    const response = await sign()
    expect(response.status).toBe(200)
  })
})

describe('AGL-1790 · unlocked behaviour is unchanged', () => {
  it('signs a private asset for a member of an unlocked org', async () => {
    const response = await sign()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(writes).toEqual([])
  })

  it('404s an asset that does not exist', async () => {
    const response = await sign({ mediaId: 'nope' })
    expect(response.status).toBe(404)
  })
})
