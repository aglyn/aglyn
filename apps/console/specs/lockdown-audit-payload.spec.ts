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
 * /api/admin/lockdown driven in-process on all five scopes — what the
 * `adminAudit` row REMEMBERS about a lockdown (AGL-1572), and what the route
 * TELLS THE OPERATOR about the state afterwards (AGL-1571).
 *
 * The drill (2026-08-14) armed both of its locks with a 15-minute dead-man
 * expiry, the expiry was genuinely applied to the carrier docs, and the audit
 * row recorded `{ locked: true, reason: 'security' }` — nothing about the
 * expiry at all. An auditor reading that trail weeks later cannot tell a
 * deliberate time-boxed lock from an indefinite one somebody forgot, which is
 * the one distinction the trail exists to settle.
 *
 * So the assertions here are about the ROW, not the lock: every scope, both
 * directions, `untilMs`/`message`/`reason` present in `after` on a lock and in
 * `before` on a lift, plus the top-level `scope` that makes the log filterable
 * without prefix-matching a path (`lockdowns/` alone covers three scopes).
 *
 * Only Firestore, the auth pools and the org/host apply-helpers are mocked —
 * the route's own validation (reason codes, past-expiry refusal, message
 * bounding) runs for real, because a lock whose expiry the route rejected
 * must never reach the trail claiming to have one.
 */

import {
  featureLockdownDocId,
  LOCKDOWNS_COLLECTION,
  PLATFORM_LOCKDOWN_DOC_ID,
  userLockdownDocId,
} from '@aglyn/aglyn/server'

/** Docs seeded as already present, keyed `collection/doc`. */
let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, unknown>[] = []
const mockDecodedToken: Record<string, unknown> = {}

const mockServerTimestamp = Symbol('serverTimestamp')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => mockServerTimestamp },
}))

const mockDocHandle = (path: string) => ({
  // A real DocumentSnapshot is IMMUTABLE — it is the doc as of the read, not
  // a live view. The route depends on that: it captures `before` from a
  // snapshot taken ahead of the write and reads it again when it audits.
  get: async () => {
    const data = mockStore[path] ? { ...mockStore[path] } : undefined
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (data: Record<string, unknown>) => {
    mockStore[path] = data
  },
  delete: async () => {
    delete mockStore[path]
  },
})

const mockFirestore = {
  collection: (collection: string) => ({
    add: async (data: Record<string, unknown>) => {
      if (collection !== 'adminAudit') throw new Error(`unexpected add: ${collection}`)
      mockAuditRows.push(data)
      return { id: `audit-${mockAuditRows.length}` }
    },
    doc: (id: string) => mockDocHandle(`${collection}/${id}`),
    limit: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  authForPool: () => ({
    updateUser: async () => undefined,
    revokeRefreshTokens: async () => undefined,
  }),
  findUserByUidAcrossPools: async (uid: string) => ({
    tenantId: null,
    record: { uid, customClaims: {} },
  }),
  invalidateFeatureLockdownCache: () => undefined,
  invalidatePlatformLockdownCache: () => undefined,
  invalidateUserLockdownCache: () => undefined,
}))

/** The `suspended*` half of what the real org/host helpers write. */
const mockApplySuspension = (path: string, action: string) => {
  const doc = { ...(mockStore[path] ?? {}) }
  if (action === 'lock') doc['suspendedAt'] = Date.now()
  else delete doc['suspendedAt']
  mockStore[path] = doc
}

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  // These stand in for the real four-effect helpers, but they DO move the
  // carrier doc: the route's post-write read-back is under test, and a mock
  // that wrote nothing would make every verification fail for a reason that
  // has nothing to do with the route.
  applyOrgLockdown: async ({ orgId, action }: { orgId: string; action: string }) => {
    mockApplySuspension(`orgs/${orgId}`, action)
    return {
      orgId,
      action,
      membersUpdated: 1,
      tokensRevoked: action === 'lock' ? 1 : 0,
      revokeTruncated: false,
      revalidated: [],
    }
  },
  applyHostLockdown: async ({ hostId, action }: { hostId: string; action: string }) => {
    mockApplySuspension(`hosts/${hostId}`, action)
    return { hostId, action, revalidated: { ok: true, reason: 'ok' } }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/lockdown/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

/** Fifteen minutes out — the drill's own dead-man interval. */
const untilMs = () => Date.now() + 15 * 60_000
const NOTICE = 'Uploads are paused while we investigate. Back shortly.'

async function post(body: Record<string, unknown>): Promise<Response> {
  return route.POST(
    new Request('https://app.aglyn.com/api/admin/lockdown', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

async function get(query: string): Promise<Response> {
  return route.GET(
    new Request(`https://app.aglyn.com/api/admin/lockdown${query}`, {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
}

/** The single row the request under test wrote. */
const onlyRow = () => {
  expect(mockAuditRows).toHaveLength(1)
  return mockAuditRows[0]
}

beforeEach(() => {
  mockStore = {}
  mockAuditRows = []
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('AGL-1572 · adminAudit remembers the expiry, the notice and the scope', () => {
  it('a time-boxed FEATURE lock records its expiry — the drill regression', async () => {
    const until = untilMs()
    const response = await post({
      action: 'lock',
      scope: 'feature',
      targetId: 'uploads',
      reason: 'security',
      message: NOTICE,
      untilMs: until,
    })
    expect(response.status).toBe(200)

    const row = onlyRow()
    expect(row.action).toBe('lockdown.lock')
    expect(row.scope).toBe('feature')
    expect(row.target).toBe(`${LOCKDOWNS_COLLECTION}/${featureLockdownDocId('uploads')}`)
    expect(row.after).toEqual({
      locked: true,
      feature: 'uploads',
      reason: 'security',
      message: NOTICE,
      untilMs: until,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })
    // The carrier really did get the expiry too — otherwise this spec would
    // happily pin a trail that describes a lock nobody armed.
    expect(mockStore[`${LOCKDOWNS_COLLECTION}/feature--uploads`]).toMatchObject({
      untilMs: until,
    })
  })

  it('lifting a time-boxed lock records what was lifted, expiry included', async () => {
    const until = untilMs()
    mockStore[`${LOCKDOWNS_COLLECTION}/feature--uploads`] = {
      scope: 'feature',
      feature: 'uploads',
      reason: 'security',
      message: NOTICE,
      untilMs: until,
      atMs: Date.now(),
    }
    await post({ action: 'unlock', scope: 'feature', targetId: 'uploads' })

    const row = onlyRow()
    expect(row.action).toBe('lockdown.unlock')
    // `before` is the whole point of a lift row: it is the only place that
    // says whether the operator released a lock with 12 minutes left on it
    // or cleaned up an indefinite one from three weeks ago.
    expect(row.before).toEqual({
      locked: true,
      reason: 'security',
      message: NOTICE,
      untilMs: until,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })
    expect(row.after).toEqual({ locked: false, feature: 'uploads' })
  })

  it('a PLATFORM lock records the expiry and the customer-facing notice', async () => {
    const until = untilMs()
    const response = await post({
      action: 'lock',
      scope: 'platform',
      reason: 'maintenance',
      message: NOTICE,
      untilMs: until,
      confirm: 'LOCK PLATFORM',
    })
    expect(response.status).toBe(200)

    const row = onlyRow()
    expect(row.scope).toBe('platform')
    expect(row.target).toBe(`${LOCKDOWNS_COLLECTION}/${PLATFORM_LOCKDOWN_DOC_ID}`)
    expect(row.after).toEqual({
      locked: true,
      reason: 'maintenance',
      message: NOTICE,
      untilMs: until,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })
    expect(row.before).toEqual({
      locked: false,
      reason: null,
      message: null,
      untilMs: null,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })
  })

  it('a USER lock records the expiry alongside the disable + revoke', async () => {
    const until = untilMs()
    await post({
      action: 'lock',
      scope: 'user',
      targetId: 'uid-9',
      reason: 'security',
      untilMs: until,
    })

    const row = onlyRow()
    expect(row.scope).toBe('user')
    expect(row.target).toBe('users/uid-9')
    expect(row.after).toEqual({
      locked: true,
      reason: 'security',
      message: null,
      untilMs: until,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })
    expect(mockStore[`${LOCKDOWNS_COLLECTION}/${userLockdownDocId('uid-9')}`]).toBeDefined()
  })

  it('an ORG lock records the expiry, and its lift reads the org doc carrier', async () => {
    const until = untilMs()
    mockStore['orgs/hz_KgetqSq'] = { name: 'Acme' }
    await post({
      action: 'lock',
      scope: 'org',
      targetId: 'hz_KgetqSq',
      reason: 'security',
      message: NOTICE,
      untilMs: until,
    })
    const lockRow = onlyRow()
    expect(lockRow.scope).toBe('org')
    expect(lockRow.after).toEqual({
      locked: true,
      reason: 'security',
      message: NOTICE,
      untilMs: until,
      tokensRevoked: 1,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })

    // The org scope keeps its lock on the org doc's `suspended*` family, not
    // in `lockdowns/*` — the lift row has to map those other names back, or
    // an org lift would be the one blind spot left in the trail.
    mockAuditRows = []
    mockStore['orgs/hz_KgetqSq'] = {
      name: 'Acme',
      suspendedAt: new Date(),
      suspendedReasonCode: 'security',
      suspendedMessage: NOTICE,
      suspendedUntilMs: until,
    }
    await post({ action: 'unlock', scope: 'org', targetId: 'hz_KgetqSq' })
    expect(onlyRow().before).toEqual({
      locked: true,
      reason: 'security',
      message: NOTICE,
      untilMs: until,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })
  })

  it('a HOST lock records the expiry, and its lift reads the host doc carrier', async () => {
    const until = untilMs()
    mockStore['hosts/host-7'] = { subdomain: 'acme' }
    await post({
      action: 'lock',
      scope: 'host',
      targetId: 'host-7',
      reason: 'manual',
      untilMs: until,
    })
    const lockRow = onlyRow()
    expect(lockRow.scope).toBe('host')
    expect(lockRow.target).toBe('hosts/host-7')
    expect(lockRow.after).toEqual({
      locked: true,
      reason: 'manual',
      message: null,
      untilMs: until,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })

    mockAuditRows = []
    mockStore['hosts/host-7'] = {
      subdomain: 'acme',
      suspendedAt: Date.now(),
      suspendedReasonCode: 'manual',
      suspendedUntilMs: until,
    }
    await post({ action: 'unlock', scope: 'host', targetId: 'host-7' })
    expect(onlyRow().before).toEqual({
      locked: true,
      reason: 'manual',
      message: null,
      untilMs: until,
      // AGL-1511: full vs read-only is on every row, both sides.
      mode: 'full',
    })
  })

  it('an INDEFINITE lock is recorded as an explicit null, never a missing key', async () => {
    // The distinction the issue is about only exists if "no expiry" is
    // stated. An absent `untilMs` reads as "this trail never captured
    // expiry", which is exactly the ambiguity that made the drill rows
    // unusable — so absence must be impossible, not merely unlikely.
    await post({
      action: 'lock',
      scope: 'feature',
      targetId: 'signups',
      reason: 'security',
    })
    const after = onlyRow().after as Record<string, unknown>
    expect(Object.keys(after).sort()).toEqual([
      'feature',
      'locked',
      'message',
      // AGL-1511 joins the same rule: absence is impossible, so `full` is
      // stated rather than inferred from a missing key.
      'mode',
      'reason',
      'untilMs',
    ])
    expect(after.untilMs).toBeNull()
    expect(after.message).toBeNull()
  })

  it('no audit value is ever undefined — Firestore rejects the whole write', async () => {
    // `add()` throws on an undefined value unless the app opted into
    // `ignoreUndefinedProperties`. A row that fails to write is worse than a
    // thin one: the action still happened and nothing recorded it.
    await post({
      action: 'lock',
      scope: 'platform',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    const row = onlyRow()
    const undefinedPaths: string[] = []
    const walk = (value: unknown, path: string) => {
      if (value === undefined) undefinedPaths.push(path)
      else if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const [key, child] of Object.entries(value)) {
          walk(child, `${path}.${key}`)
        }
      }
    }
    walk(row, 'row')
    expect(undefinedPaths).toEqual([])
  })

  it('a rejected expiry never reaches the trail', async () => {
    // The route refuses an expiry already in the past. If that refusal ever
    // stopped short of the audit call, the log would carry a lock that was
    // never applied — a phantom entry is worse than a missing field.
    const response = await post({
      action: 'lock',
      scope: 'feature',
      targetId: 'uploads',
      reason: 'security',
      untilMs: Date.now() - 1000,
    })
    expect(response.status).toBe(400)
    expect(mockAuditRows).toEqual([])
  })
})

describe('AGL-1571 · a write answers with what the server reads back', () => {
  it('a lock returns the post-write state, confirmed', async () => {
    const until = untilMs()
    const response = await post({
      action: 'lock',
      scope: 'feature',
      targetId: 'uploads',
      reason: 'security',
      untilMs: until,
      message: NOTICE,
    })
    const payload = await response.json()
    // `ok` only says the request was accepted. `confirmed` says the target
    // was re-read afterwards and actually agrees — the two are different
    // claims, and the drill turned on exactly that difference.
    expect(payload.confirmed).toBe(true)
    expect(payload.verified).toMatchObject({
      scope: 'feature',
      targetId: 'uploads',
      exists: true,
      locked: true,
      reason: 'security',
      message: NOTICE,
      untilMs: until,
    })
    expect(typeof payload.verified.readAtMs).toBe('number')
  })

  it('a lift returns NOT locked — read back, not assumed', async () => {
    mockStore[`${LOCKDOWNS_COLLECTION}/feature--uploads`] = {
      scope: 'feature',
      feature: 'uploads',
      reason: 'security',
      atMs: Date.now(),
    }
    const payload = await (
      await post({ action: 'unlock', scope: 'feature', targetId: 'uploads' })
    ).json()
    expect(payload.confirmed).toBe(true)
    expect(payload.verified).toMatchObject({ locked: false, reason: null })
  })

  it('an ORG lock reads the org doc carrier back, not the request it just got', async () => {
    mockStore['orgs/hz_KgetqSq'] = { name: 'Acme' }
    const payload = await (
      await post({
        action: 'lock',
        scope: 'org',
        targetId: 'hz_KgetqSq',
        reason: 'security',
      })
    ).json()
    expect(payload.confirmed).toBe(true)
    expect(payload.verified).toMatchObject({
      scope: 'org',
      targetId: 'hz_KgetqSq',
      exists: true,
      locked: true,
    })
  })

  it('a write that did not take comes back NOT confirmed', async () => {
    // The failure the console must never render as a success: the request
    // was accepted, and the target still disagrees. Simulated by an org
    // helper that reports success without moving the carrier.
    const orgLockdown = require('../utils/server/org-lockdown')
    const real = orgLockdown.applyOrgLockdown
    orgLockdown.applyOrgLockdown = async ({ orgId }: { orgId: string }) => ({
      orgId,
      action: 'lock',
      membersUpdated: 0,
      tokensRevoked: 0,
      revokeTruncated: false,
      revalidated: [],
    })
    try {
      mockStore['orgs/hz_KgetqSq'] = { name: 'Acme' }
      const payload = await (
        await post({
          action: 'lock',
          scope: 'org',
          targetId: 'hz_KgetqSq',
          reason: 'security',
        })
      ).json()
      expect(payload.ok).toBe(true)
      expect(payload.confirmed).toBe(false)
      expect(payload.verified.locked).toBe(false)
    } finally {
      orgLockdown.applyOrgLockdown = real
    }
  })

  it('the scoped GET probe reads one target and writes nothing', async () => {
    const until = untilMs()
    mockStore['orgs/hz_KgetqSq'] = {
      name: 'Acme',
      // Orgs carry `suspendedAt` as a Timestamp, hosts as epoch ms; the
      // probe has to answer in one currency or the page cannot render it.
      suspendedAt: { toMillis: () => 1_700_000_000_000 },
      suspendedReasonCode: 'security',
      suspendedMessage: NOTICE,
      suspendedUntilMs: until,
    }
    const payload = await (
      await get('?scope=org&targetId=hz_KgetqSq')
    ).json()
    expect(payload.state).toMatchObject({
      scope: 'org',
      targetId: 'hz_KgetqSq',
      exists: true,
      locked: true,
      reason: 'security',
      message: NOTICE,
      untilMs: until,
      atMs: 1_700_000_000_000,
    })
    // A read-only probe. If checking state could change it, an operator
    // would learn not to check.
    expect(mockAuditRows).toEqual([])
  })

  it('a mistyped org id reads as NO SUCH TARGET, not as unlocked', async () => {
    // The dangerous conflation: "this org is fine" and "you are asking
    // about an org that does not exist" must never render the same.
    const payload = await (await get('?scope=org&targetId=typo')).json()
    expect(payload.state).toMatchObject({ exists: false, locked: false })
  })

  it('the probe is open to a non-super staff role, unlike a write', async () => {
    // Reading state is how an operator avoids the belief this issue is
    // about; gating it behind the write role would push them back to
    // trusting the click.
    mockDecodedToken['staffRole'] = 'support'
    expect((await get('?scope=platform')).status).toBe(200)
    expect(
      (await post({ action: 'lock', scope: 'platform', reason: 'manual' })).status,
    ).toBe(403)
  })

  it('the probe validates its target like a write does', async () => {
    expect((await get('?scope=nonsense&targetId=x')).status).toBe(400)
    expect((await get('?scope=org')).status).toBe(400)
    expect((await get('?scope=feature&targetId=not-a-feature')).status).toBe(400)
    // No scope at all is still the collection listing, unchanged.
    expect((await get('')).status).toBe(200)
  })
})
