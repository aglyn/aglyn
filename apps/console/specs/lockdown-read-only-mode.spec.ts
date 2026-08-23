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
 * The WRITE side of read-only mode (AGL-1511): /api/admin/lockdown driven
 * in-process, asserting what the staff button actually persists.
 *
 * Four things this pins, each of which is a way the mode could ship looking
 * correct and behaving as a full lockdown:
 *
 *  1. `mode: 'read-only'` reaches the carrier — and a FULL lock still writes
 *     no `mode` key at all, so every document written before this field
 *     existed stays byte-identical and no migration is implied.
 *  2. A read-only ORG lock NEVER revokes member sessions. Revocation is a
 *     full lockdown's effect; delivering "you can keep reading" by signing
 *     everyone out would be the feature failing at its one job.
 *  3. `user` and `feature` scope REFUSE read-only rather than silently
 *     downgrading it — an operator who asked for the gentle lock and got the
 *     hard one is the exact accident this refusal exists to prevent.
 *  4. The audit row carries the mode on both sides, never null: "staff froze
 *     writes" and "staff took the workspace down" are different actions.
 */

import { PLATFORM_LOCKDOWN_DOC_ID } from '@aglyn/aglyn/server'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The scopes the route itself accepts, parsed from its `SCOPES` set. Read
 * from source on purpose: a scope added to the route without a decision
 * about read-only must fail HERE rather than be silently uncovered.
 */
function routeScopes(): string[] {
  const source = readFileSync(
    join(__dirname, '..', 'app', 'api', 'admin', 'lockdown', 'route.ts'),
    'utf8',
  )
  const block = /const SCOPES = new Set\(\[([\s\S]*?)\]\)/.exec(source)
  if (!block) throw new Error('SCOPES set not found in the lockdown route')
  return Array.from(block[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
}

let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, unknown>[] = []
let mockOrgCalls: Record<string, unknown>[] = []
const mockDecodedToken: Record<string, unknown> = {}

const mockServerTimestamp = Symbol('serverTimestamp')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => mockServerTimestamp },
}))

const mockDocHandle = (path: string) => ({
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
      if (collection !== 'adminAudit') {
        throw new Error(`unexpected add: ${collection}`)
      }
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
  getLockdownVerdict: async () => null,
  featureLockdownRefusal: async () => null,
  lockdownJsonResponse: () => Response.json({}, { status: 423 }),
  // AGL-1513. Absent from this mock the DOMAIN branch 500s at its cache
  // invalidation, which would mask what this file is here to assert.
  invalidateDomainLockdownCache: () => undefined,
  invalidateFeatureLockdownCache: () => undefined,
  invalidatePlatformLockdownCache: () => undefined,
  invalidateUserLockdownCache: () => undefined,
}))

/**
 * The org/host appliers, standing in for the real four-effect helpers but
 * RECORDING their options — `mode` and `revokeMemberTokens` are the two
 * arguments this spec is about, and a mock that swallowed them would let the
 * route drop either without a failure.
 */
jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: Record<string, unknown>) => {
    mockOrgCalls.push(options)
    const path = `orgs/${options['orgId']}`
    const doc = { ...(mockStore[path] ?? {}) }
    if (options['action'] === 'lock') {
      doc['suspendedAt'] = Date.now()
      const lock = options['lock'] as { mode?: string } | undefined
      if (lock?.mode === 'read-only') doc['suspendedMode'] = 'read-only'
      else delete doc['suspendedMode']
    } else {
      delete doc['suspendedAt']
      delete doc['suspendedMode']
    }
    mockStore[path] = doc
    return {
      orgId: options['orgId'],
      action: options['action'],
      membersUpdated: 1,
      tokensRevoked: options['revokeMemberTokens'] ? 1 : 0,
      revokeTruncated: false,
      revalidated: [],
    }
  },
  applyHostLockdown: async (options: Record<string, unknown>) => {
    mockOrgCalls.push(options)
    const path = `hosts/${options['hostId']}`
    const doc = { ...(mockStore[path] ?? {}) }
    if (options['action'] === 'lock') {
      doc['suspendedAt'] = Date.now()
      const lock = options['lock'] as { mode?: string } | undefined
      if (lock?.mode === 'read-only') doc['suspendedMode'] = 'read-only'
    } else {
      delete doc['suspendedAt']
      delete doc['suspendedMode']
    }
    mockStore[path] = doc
    return { hostId: options['hostId'], action: options['action'], revalidated: { ok: true, reason: 'ok' } }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/lockdown/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

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

const onlyRow = () => {
  expect(mockAuditRows).toHaveLength(1)
  return mockAuditRows[0]
}

beforeEach(() => {
  mockStore = {}
  mockAuditRows = []
  mockOrgCalls = []
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('AGL-1511 · arming a read-only lock', () => {
  it('writes mode on the platform doc for read-only, and NOTHING for full', async () => {
    const readOnly = await post({
      action: 'lock',
      scope: 'platform',
      mode: 'read-only',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    expect(readOnly.status).toBe(200)
    const doc = mockStore[`lockdowns/${PLATFORM_LOCKDOWN_DOC_ID}`]
    expect(doc['mode']).toBe('read-only')
    // The read-back the route answers with reports it too (AGL-1571), so an
    // operator is told which lock actually landed rather than assuming.
    expect((await readOnly.json()).verified.mode).toBe('read-only')

    mockStore = {}
    await post({
      action: 'lock',
      scope: 'platform',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    // No key at all — identical to every lock written before AGL-1511.
    expect(
      'mode' in mockStore[`lockdowns/${PLATFORM_LOCKDOWN_DOC_ID}`],
    ).toBe(false)
  })

  it('NEVER revokes member sessions for a read-only org lock', async () => {
    mockStore['orgs/org-1'] = { name: 'Acme' }
    // `security` is the reason that DOES revoke on a full lock — so this
    // asserts the mode overrides it, not that the reason happened to be mild.
    await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-1',
      mode: 'read-only',
      reason: 'security',
    })
    expect(mockOrgCalls[0]['revokeMemberTokens']).toBe(false)
    expect((mockOrgCalls[0]['lock'] as { mode?: string }).mode).toBe('read-only')

    mockOrgCalls = []
    mockAuditRows = []
    await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-1',
      reason: 'security',
    })
    expect(mockOrgCalls[0]['revokeMemberTokens']).toBe(true)
  })

  it('carries the mode to the host applier too', async () => {
    mockStore['hosts/host-1'] = { subdomain: 'acme' }
    await post({
      action: 'lock',
      scope: 'host',
      targetId: 'host-1',
      mode: 'read-only',
      reason: 'maintenance',
    })
    expect((mockOrgCalls[0]['lock'] as { mode?: string }).mode).toBe('read-only')
    expect(mockStore['hosts/host-1']['suspendedMode']).toBe('read-only')
  })

  it('refuses read-only where it would be a lie, naming the alternative', async () => {
    for (const scope of ['user', 'feature']) {
      const response = await post({
        action: 'lock',
        scope,
        targetId: scope === 'feature' ? 'checkout' : 'user-1',
        mode: 'read-only',
        reason: 'security',
      })
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('all-or-nothing')
      // Refused BEFORE anything was written or audited.
      expect(mockAuditRows).toHaveLength(0)
      expect(mockStore).toEqual({})
    }
  })

  /*=====================================================================
   * AGL-1621 · every scope either PERSISTS read-only or REFUSES it.
   *
   * The `domain` scope (AGL-1513) landed after AGL-1511 and got neither:
   * it was absent from the refusal list above AND its `ref.set` omitted the
   * `...(mode === 'read-only' ? { mode } : {})` spread that every other
   * carrier writes. So `mode: 'read-only'` returned 200, was dropped on the
   * floor, and `lockdownMode()` read the resulting document back as `full`
   * — the absent-means-full fail-safe doing exactly its job on a value the
   * operator had actually supplied. An operator asked for the lighter
   * action, was told it worked, and a whole custom domain went dark.
   *
   * This is the STRUCTURAL form of that check rather than one more case in
   * the list above: it is quantified over the route's own scope set, so the
   * next scope added is a violation BY EXISTING unless its author does one
   * of the two things. A per-scope test would have had to be remembered.
   *===================================================================*/
  describe('AGL-1621 · no scope may silently upgrade read-only to full', () => {
    /**
     * Where each scope's carrier keeps its strictness. `null` = the scope is
     * expected to refuse read-only outright, so there is no carrier to read.
     */
    const CARRIER: Record<
      string,
      { targetId?: string; seed?: [string, Record<string, unknown>]; doc: string; field: string } | null
    > = {
      platform: {
        doc: `lockdowns/${PLATFORM_LOCKDOWN_DOC_ID}`,
        field: 'mode',
      },
      org: {
        targetId: 'org-1',
        seed: ['orgs/org-1', { name: 'Acme' }],
        doc: 'orgs/org-1',
        field: 'suspendedMode',
      },
      host: {
        targetId: 'host-1',
        seed: ['hosts/host-1', { subdomain: 'acme' }],
        doc: 'hosts/host-1',
        field: 'suspendedMode',
      },
      // REFUSED since AGL-1621, and the reason is stronger than the
      // user/feature one: read-only has no enforcement surface here at all.
      // Every path that resolves the domain scope is a path that SERVES (the
      // edge verdict, the page loader, the locked notice), and neither write
      // gate resolves the domain scope — `getSiteLockdown` and
      // `getLockdownVerdict` are keyed by hostId, a domain lock by HOSTNAME.
      // A stored read-only domain lock would refuse nothing anywhere while
      // the console reported LOCKED.
      domain: null,
      user: null,
      feature: null,
    }

    /** The target each refusing scope is exercised with. */
    const REFUSED_TARGET: Record<string, string> = {
      domain: 'disputed.example.com',
      feature: 'checkout',
      user: 'user-1',
    }

    // Read from the route's own source so a new scope cannot be added
    // without appearing here — the list is DISCOVERED, not restated.
    const ROUTE_SCOPES = routeScopes()

    /**
     * The STAFF PAGE's half of the same decision. The original defect was
     * exactly this drift: `domain` arrived in the route's `SCOPES`, nobody
     * added it to the refusal list, and nobody removed its mode control from
     * the card — so the card offered read-only, sent it, and was told 200.
     * Pinning the two sides against each other means the next scope cannot
     * be half-taught.
     */
    it('the staff card offers the mode control on exactly the scopes the route accepts it on', () => {
      const page = readFileSync(
        join(__dirname, '..', 'app', '(app)', 'admin', 'lockdown', 'page.tsx'),
        'utf8',
      )
      const block = /const READ_ONLY_SCOPES = new Set\(\[([\s\S]*?)\]\)/.exec(page)
      if (!block) throw new Error('READ_ONLY_SCOPES not found on the staff page')
      const offered = Array.from(block[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
      // Anti-vacuity: an empty parse would make the comparison below pass
      // against an empty refusal set.
      expect(offered.length).toBeGreaterThan(0)
      const accepted = ROUTE_SCOPES.filter((scope) => CARRIER[scope] !== null)
      expect(offered.slice().sort()).toEqual(accepted.slice().sort())
    })

    it('the scope set is read from the route, not restated here', () => {
      // Anti-vacuity: a parse returning [] would make every case below
      // vacuously pass. It must find the six shipped scopes exactly.
      expect(ROUTE_SCOPES.slice().sort()).toEqual(
        ['domain', 'feature', 'host', 'org', 'platform', 'user'].sort(),
      )
      expect(Object.keys(CARRIER).slice().sort()).toEqual(
        ROUTE_SCOPES.slice().sort(),
      )
    })

    it.each(ROUTE_SCOPES)(
      'scope %s: read-only is stored as read-only, or refused with a reason',
      async (scope) => {
        const carrier = CARRIER[scope]
        if (carrier?.seed) mockStore[carrier.seed[0]] = { ...carrier.seed[1] }
        const response = await post({
          action: 'lock',
          scope,
          targetId: carrier?.targetId ?? REFUSED_TARGET[scope] ?? '',
          mode: 'read-only',
          reason: 'maintenance',
          ...(scope === 'platform' ? { confirm: 'LOCK PLATFORM' } : {}),
        })
        if (carrier === null) {
          // Refused — and the refusal has to SAY read-only is the thing that
          // cannot apply, not fail for some unrelated validation reason.
          expect(response.status).toBe(400)
          expect(String((await response.json()).error)).toMatch(/read-only/)
          // Refused BEFORE anything was written or audited — the whole point
          // is that no carrier ever holds a strictness nobody asked for.
          expect(mockStore).toEqual({})
          expect(mockAuditRows).toHaveLength(0)
          return
        }
        expect(response.status).toBe(200)
        // The stored value is what the operator asked for. Absent is the
        // failure being guarded: `lockdownMode()` reads absent as `full`.
        expect(mockStore[carrier.doc]?.[carrier.field]).toBe('read-only')
      },
    )
  })

  it('rejects an unrecognised mode rather than defaulting it away', async () => {
    const response = await post({
      action: 'lock',
      scope: 'platform',
      mode: 'kind-of',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('mode must be one of')
  })

  it('records the mode on BOTH sides of the audit row, never null', async () => {
    mockStore['orgs/org-1'] = { name: 'Acme' }
    await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-1',
      mode: 'read-only',
      reason: 'maintenance',
    })
    const locked = onlyRow()
    expect((locked['before'] as Record<string, unknown>)['mode']).toBe('full')
    expect((locked['after'] as Record<string, unknown>)['mode']).toBe('read-only')

    mockAuditRows = []
    await post({ action: 'unlock', scope: 'org', targetId: 'org-1' })
    // The lift's `before` is what says the operator released a WRITE FREEZE
    // rather than a takedown — the question the trail gets asked later.
    expect((onlyRow()['before'] as Record<string, unknown>)['mode']).toBe(
      'read-only',
    )
  })
})
