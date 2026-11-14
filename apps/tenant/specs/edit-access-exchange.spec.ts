/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * `/api/edit-access/exchange` (AGL-1842): the same-site hint→token trade.
 *
 * The hint verification, the minted token, and the WHOLE authorization gate
 * (`editAccessMintRefusal` — the code the console's token mint runs) are the
 * REAL implementations; only Firestore, Firebase Auth, and the gate's leaf
 * dependencies (release flag, lockdown, org doc) are faked — so a pass here
 * is the real membership predicate discriminating, not a mock echoing.
 * Red-measured on purpose: the viewer case and the non-member case hold the
 * whole fixture fixed and flip ONE fact, so the 403s below can only come
 * from the gate actually reading it.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'exchange-spec-secret'

let mockHostData: Record<string, unknown> | null
let mockMembers: Record<string, Record<string, unknown>>
let mockUsers: Record<string, { disabled?: boolean; email?: string }>
let mockFlagOn: boolean
let mockLockdownResponse: Response | null
/** `users/{uid}/editHintEnds/{did}` → endedAt, keyed `${uid}/${did}`. */
let mockHintEnds: Record<string, number>

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ? data[field] : undefined),
})

function mockFirestore() {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () =>
          snapshotOf(name === 'hosts' ? mockHostData : null),
        collection: (sub: string) => ({
          doc: (key: string) => ({
            get: async () => {
              if (sub === 'members') {
                return snapshotOf(mockMembers[key] ?? null)
              }
              if (name === 'users' && sub === 'editHintEnds') {
                const endedAt = mockHintEnds[`${id}/${key}`]
                return snapshotOf(endedAt ? { endedAt } : null)
              }
              return snapshotOf(null)
            },
          }),
        }),
      }),
    }),
  }
}

function mockAuth() {
  return {
    getUser: async (uid: string) => {
      const user = mockUsers[uid]
      if (!user) throw new Error('no such user')
      return user
    },
  }
}

// The authorization gate's LEAF dependencies, faked at the same resolved
// modules `edit-access-authz.ts` itself requires — the gate in between runs
// for real.
jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/release-flags',
  () => ({
    __esModule: true,
    isServerReleaseFlagOnForOrg: jest.fn(async () => mockFlagOn),
  }),
)
jest.mock('../../../libs/tenant/data/admin/src/lib/server/lockdown', () => ({
  __esModule: true,
  lockdownRefusal: jest.fn(async () => mockLockdownResponse),
}))
jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/organizations',
  () => ({
    __esModule: true,
    getOrgDoc: jest.fn(async () => ({})),
  }),
)

jest.mock('@aglyn/tenant-data-admin', () => {
  const hint = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-hint-token',
  )
  const access = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-access-token',
  )
  const ends = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-hint-end',
  )
  const authz = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-access-authz',
  )
  return {
    __esModule: true,
    ...hint,
    ...access,
    ...ends,
    editAccessMintRefusal: authz.editAccessMintRefusal,
    // AGL-2005 moved this route off a project-level `getUser` and onto the
    // cross-pool resolver, because an SSO user's uid lives in their org's GCIP
    // tenant and the project lookup THROWS for them. A wholesale module mock is
    // a closed world, so omitting this export made it `undefined` and every
    // request read as "no account" — a 403 that looks like a permission
    // decision rather than a lookup that never happened.
    //
    // Modelled on the real contract: `null` when no pool knows the uid, and
    // `{ record, tenantId }` when one does. Backed by the same `mockUsers`
    // fixture the deleted- and disabled-account cases drive, so those keep
    // measuring what they claim to.
    findUserByUidAcrossPools: async (uid: string) => {
      const record = mockUsers[uid]
      if (!record) return null
      return { record: { uid, ...record }, tenantId: null }
    },
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore(), auth: () => mockAuth() }),
    },
  }
})

import {
  mintEditHintToken,
  verifyEditAccessToken,
} from '@aglyn/tenant-data-admin'
import { POST } from '../app/api/edit-access/exchange/route'

const HOST_ID = 'host-northwind'
const UID = 'uid-editor'

function exchangeRequest(options?: {
  cookie?: string
  hostId?: string
  host?: string
}): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    host: options?.host ?? 'northwind-coffee.aglyn.app',
  }
  if (options?.cookie !== undefined) headers['cookie'] = options.cookie
  return new Request('https://northwind-coffee.aglyn.app/api/edit-access/exchange', {
    method: 'POST',
    headers,
    body: JSON.stringify({ hostId: options?.hostId ?? HOST_ID }),
  })
}

/** The console browser the hint was planted from (`aglyn_device`). */
const BROWSER_A = 'device-browser-a-0001'
const BROWSER_B = 'device-browser-b-0002'

/**
 * A hint as the sign-in bounce plants it: bound to the browser it came from
 * and dated when that console session was proven live.
 */
function hintCookie(
  uid = UID,
  binding: { did: string; iat: number } = {
    did: BROWSER_A,
    iat: Date.now() - 60_000,
  },
): string {
  return `aglyn_edit_hint=${mintEditHintToken('cookie', uid, Date.now(), binding).token}`
}

/** What the response did to the two hint cookies, by name. */
function clearedCookies(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .filter((cookie) => /Max-Age=0/.test(cookie))
    .map((cookie) => cookie.split('=')[0])
    .sort()
}

describe('/api/edit-access/exchange (AGL-1842)', () => {
  beforeEach(() => {
    mockHostData = {
      orgId: 'org-1',
      subdomain: 'northwind-coffee',
      displayName: 'Northwind Coffee',
      memberRoles: {},
    }
    mockMembers = { [UID]: { role: 'editor' } }
    mockUsers = { [UID]: { disabled: false, email: 'editor@aglyn.com' } }
    mockFlagOn = true
    mockLockdownResponse = null
    mockHintEnds = {}
  })

  it('trades a valid hint for a REAL edit-access token, host-scoped to this site', async () => {
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(200)
    const payload = await response.json()
    // The token is verified by the real verifier — the same one
    // /api/edit-context runs — not merely echoed back.
    const claims = verifyEditAccessToken(payload.token)
    expect(claims?.hostId).toBe(HOST_ID)
    expect(claims?.uid).toBe(UID)
    expect(payload.siteName).toBe('Northwind Coffee')
    expect(payload.userEmail).toBe('editor@aglyn.com')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('403s a VIEWER — same fixture, one role flipped (red-measure)', async () => {
    mockMembers = { [UID]: { role: 'viewer' } }
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(403)
  })

  it('admits a viewer promoted by a host-level memberRole — the other gate arm', async () => {
    mockMembers = { [UID]: { role: 'viewer' } }
    mockHostData = { ...mockHostData, memberRoles: { [UID]: 'editor' } }
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(200)
  })

  it('403s a uid with NO membership at all', async () => {
    mockMembers = {}
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(403)
  })

  it('401s with no hint cookie', async () => {
    const response = await POST(exchangeRequest({}))
    expect(response.status).toBe(401)
  })

  it('401s a tampered hint', async () => {
    const good = mintEditHintToken('cookie', UID).token
    const response = await POST(
      exchangeRequest({ cookie: `aglyn_edit_hint=${good.slice(0, -4)}AAAA` }),
    )
    expect(response.status).toBe(401)
  })

  it('401s a BOUNCE-kind token smuggled into the cookie — the kind wall', async () => {
    const bounce = mintEditHintToken('bounce', UID).token
    const response = await POST(
      exchangeRequest({ cookie: `aglyn_edit_hint=${bounce}` }),
    )
    expect(response.status).toBe(401)
  })

  it('404s when the release flag is off — the kill switch reaches here too', async () => {
    mockFlagOn = false
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(404)
  })

  it('403s a request whose domain the host does not answer to (production rule)', async () => {
    const previous = process.env.NODE_ENV
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    try {
      const response = await POST(
        exchangeRequest({ cookie: hintCookie(), host: 'someone-else.aglyn.app' }),
      )
      expect(response.status).toBe(403)
    } finally {
      ;(process.env as Record<string, string>).NODE_ENV = previous as string
    }
  })

  it('403s a disabled account — the fail-closed half of sign-out', async () => {
    mockUsers = { [UID]: { disabled: true, email: 'editor@aglyn.com' } }
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(403)
  })

  it('403s a deleted account', async () => {
    mockUsers = {}
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(403)
  })

  it('propagates a lockdown refusal untouched', async () => {
    mockLockdownResponse = Response.json({ error: 'locked' }, { status: 423 })
    const response = await POST(exchangeRequest({ cookie: hintCookie() }))
    expect(response.status).toBe(423)
  })

  /*
   * Signing out of the console ends the bar in THAT browser (AGL-1842
   * follow-on). The sign-out writes `users/{uid}/editHintEnds/{did}`; the
   * cookie it cannot reach is refused here instead, and cleared on the way
   * out. Each case below flips ONE fact against the passing fixture above.
   */
  describe('console sign-out ends the hint in that browser', () => {
    it('refuses a hint this browser signed out after, and clears both cookies', async () => {
      mockHintEnds = { [`${UID}/${BROWSER_A}`]: Date.now() - 1_000 }
      const response = await POST(exchangeRequest({ cookie: hintCookie() }))
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ ended: true })
      expect(clearedCookies(response)).toEqual(['aglyn_edit_hint', 'aglyn_editor'])
      for (const cookie of response.headers.getSetCookie()) {
        expect(cookie).toContain('Domain=.aglyn.app')
      }
    })

    it('still exchanges ANOTHER browser’s hint for the same person', async () => {
      mockHintEnds = { [`${UID}/${BROWSER_A}`]: Date.now() - 1_000 }
      const response = await POST(
        exchangeRequest({
          cookie: hintCookie(UID, { did: BROWSER_B, iat: Date.now() - 60_000 }),
        }),
      )
      expect(response.status).toBe(200)
      expect(response.headers.getSetCookie()).toHaveLength(0)
    })

    it('exchanges again once this browser signs back in (a newer hint)', async () => {
      mockHintEnds = { [`${UID}/${BROWSER_A}`]: Date.now() - 60_000 }
      const response = await POST(
        exchangeRequest({
          cookie: hintCookie(UID, { did: BROWSER_A, iat: Date.now() - 1_000 }),
        }),
      )
      expect(response.status).toBe(200)
    })

    it('refuses a bounce that landed AFTER the sign-out but was minted before it', async () => {
      // `iat` is the bounce's mint time, carried through `set` unchanged, so
      // a blob fetched before signing out and planted after is still dated
      // before the sign-out.
      const signedOutAt = Date.now() - 5_000
      mockHintEnds = { [`${UID}/${BROWSER_A}`]: signedOutAt }
      const response = await POST(
        exchangeRequest({
          cookie: hintCookie(UID, { did: BROWSER_A, iat: signedOutAt - 1 }),
        }),
      )
      expect(response.status).toBe(401)
    })

    it('refuses a hint that names no browser (planted before sign-out could end one)', async () => {
      const unbound = `aglyn_edit_hint=${mintEditHintToken('cookie', UID).token}`
      const response = await POST(exchangeRequest({ cookie: unbound }))
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ ended: true })
      expect(clearedCookies(response)).toEqual(['aglyn_edit_hint', 'aglyn_editor'])
    })

    it('names the browser in the minted token, dated by the hint, not by now', async () => {
      const iat = Date.now() - 120_000
      const response = await POST(
        exchangeRequest({ cookie: hintCookie(UID, { did: BROWSER_A, iat }) }),
      )
      const claims = verifyEditAccessToken((await response.json()).token)
      expect(claims).toMatchObject({ did: BROWSER_A, since: iat })
    })

    it('leaves the lockdown verdict where it was: an un-ended hint still meets it', async () => {
      mockHintEnds = { [`${UID}/${BROWSER_B}`]: Date.now() }
      mockLockdownResponse = Response.json({ error: 'locked' }, { status: 423 })
      const response = await POST(exchangeRequest({ cookie: hintCookie() }))
      expect(response.status).toBe(423)
    })
  })
})
