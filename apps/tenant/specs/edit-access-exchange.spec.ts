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
          doc: (uid: string) => ({
            get: async () =>
              snapshotOf(sub === 'members' ? (mockMembers[uid] ?? null) : null),
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
  const authz = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-access-authz',
  )
  return {
    __esModule: true,
    ...hint,
    ...access,
    editAccessMintRefusal: authz.editAccessMintRefusal,
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

function hintCookie(uid = UID): string {
  return `aglyn_edit_hint=${mintEditHintToken('cookie', uid).token}`
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
})
