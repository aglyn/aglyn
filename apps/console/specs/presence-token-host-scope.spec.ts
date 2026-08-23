/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this route needs `Request`/`Response`.
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
 * AGL-1881 — the presence broker mints for the site it proved, not the org.
 *
 * `orgs/{orgId}/members` holds BOTH org managers and site-scoped
 * collaborators: `grantHostAccess` writes a collaborator as
 * `role:'viewer', allHosts:false, hostAccess:{ theirSite }`. The broker used
 * to accept bare EXISTENCE of that document as proof, against a `hostId` the
 * caller supplies — and every org member can read the org doc's `hosts` map,
 * so enumerating the sibling site ids is one read.
 *
 * Two consequences, and this file drives the real handler for both:
 *
 * 1. A collaborator scoped to site A was minted a token for site B.
 * 2. The `canEdit` arm read `orgRole === 'editor'` on its own, and a
 *    collaborator can hold `role:'editor'` with `allHosts:false` — so they
 *    got `coeditHost` for a site whose `memberRoles` does not list them,
 *    which the RTDB rules accept as permission to mutate a live editing
 *    session.
 *
 * The legacy row is asserted too, and it is the reason this is not a one-line
 * `hostRoleFor` call: a pre-`allHosts` membership carries neither the flag nor
 * a `hostAccess` map, `hostRoleFor` reads that as "no reach", and refusing it
 * would lock real members out of their own workspace.
 */

const mockVerifyIdToken = jest.fn()
// Typed with its real arity: the CLAIMS argument is what every assertion in
// this file reads, and a zero-arg `jest.fn` makes `calls[n][1]` a type error.
const mockCreateCustomToken = jest.fn(
  async (_uid: string, _claims?: Record<string, unknown>) => 'presence-token',
)
const mockHostGet = jest.fn()
const mockMemberGet = jest.fn()
const mockDbRefGet = jest.fn(async () => ({ val: () => null }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  getOrgDoc: async () => ({}),
  lockdownRefusal: async () => null,
  authForPool: () => ({
    createCustomToken: (uid: string, claims?: Record<string, unknown>) =>
      mockCreateCustomToken(uid, claims),
  }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            get: name === 'hosts' ? mockHostGet : mockMemberGet,
            collection: () => ({ doc: () => ({ get: mockMemberGet }) }),
          }),
        }),
      }),
    }),
    database: () => ({ ref: () => ({ get: mockDbRefGet, child: () => ({}) }) }),
  },
}))

import { POST } from '../app/api/presence/token/route'

const ORG = 'org_acme'
/** The site the caller is scoped to. */
const MINE = 'host_mine'
/** A sibling site in the same org, which they are not scoped to. */
const THEIRS = 'host_theirs'
const UID = 'u_collaborator'

/** A Firestore-snapshot shape with the two accessors the route uses. */
function snapshot(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
    get: (key: string) => (data ?? {})[key],
  }
}

/**
 * @param member - the caller's `orgs/{org}/members/{uid}` document.
 * @param hostMemberRoles - the target host doc's own `memberRoles` map.
 */
function arrange(
  member: Record<string, unknown> | null,
  hostMemberRoles: Record<string, string> = {},
) {
  mockVerifyIdToken.mockResolvedValue({ uid: UID, email_verified: true })
  mockHostGet.mockResolvedValue(
    snapshot({ orgId: ORG, memberRoles: hostMemberRoles }),
  )
  mockMemberGet.mockResolvedValue(snapshot(member))
}

function request(hostId: string) {
  return new Request('https://app.aglyn.com/api/presence/token', {
    method: 'POST',
    headers: {
      authorization: 'Bearer id-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ hostId }),
  })
}

/** The custom claims the broker actually minted, for the last call. */
function mintedClaims(): Record<string, unknown> {
  expect(mockCreateCustomToken).toHaveBeenCalled()
  return mockCreateCustomToken.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateCustomToken.mockResolvedValue('presence-token')
  mockDbRefGet.mockResolvedValue({ val: () => null })
})

describe('a site-scoped collaborator cannot mint for a sibling site', () => {
  const collaborator = {
    role: 'viewer',
    allHosts: false,
    hostAccess: { [MINE]: 'editor' },
  }

  it('mints for the site they were actually granted', async () => {
    // The control. Without it, a broker that refused EVERYTHING would pass
    // every other assertion in this file.
    arrange(collaborator)
    const response = await POST(request(MINE))
    expect(response.status).toBe(200)
    expect(mintedClaims()['presenceOrg']).toBe(ORG)
  })

  it('refuses a sibling site in the same org', async () => {
    arrange(collaborator)
    const response = await POST(request(THEIRS))
    expect(response.status).toBe(403)
    // The point is that NO token exists, not that a narrow one does: the
    // co-edit read rule keys on `presenceOrg` alone, so any token at all
    // would have read the sibling's unsaved canvas.
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })
})

describe('a scoped org `editor` does not carry write across sites', () => {
  /**
   * Expressible straight from `/api/orgs/members`: an org role of `editor`
   * with `allHosts:false`. This is the row the old `orgRole === 'editor'` arm
   * turned into a co-edit grant on every site in the org.
   */
  const scopedEditor = {
    role: 'editor',
    allHosts: false,
    hostAccess: { [MINE]: 'editor' },
  }

  it('grants coeditHost on their own site', async () => {
    arrange(scopedEditor)
    const response = await POST(request(MINE))
    expect(response.status).toBe(200)
    expect(mintedClaims()['coeditHost']).toBe(MINE)
  })

  it('refuses the sibling site outright', async () => {
    arrange(scopedEditor)
    expect((await POST(request(THEIRS))).status).toBe(403)
  })

  it('withholds coeditHost from a scoped VIEWER on their own site', async () => {
    // The read/write split has to survive the change: a viewer gets presence
    // and no co-edit claim, so the rules refuse their writes rather than the
    // client being trusted to stay read-only.
    arrange({ role: 'viewer', allHosts: false, hostAccess: { [MINE]: 'viewer' } })
    const response = await POST(request(MINE))
    expect(response.status).toBe(200)
    expect(mintedClaims()).not.toHaveProperty('coeditHost')
  })
})

describe('org-wide members keep the reach they have', () => {
  it.each([
    ['an owner', { role: 'owner', allHosts: true }],
    ['an admin', { role: 'admin', allHosts: false }],
    ['an allHosts editor', { role: 'editor', allHosts: true }],
  ])('%s mints coeditHost for any site in the org', async (_label, member) => {
    arrange(member)
    const response = await POST(request(THEIRS))
    expect(response.status).toBe(200)
    expect(mintedClaims()['coeditHost']).toBe(THEIRS)
  })

  it('an allHosts viewer gets presence on any site, and no write', async () => {
    arrange({ role: 'viewer', allHosts: true })
    const response = await POST(request(THEIRS))
    expect(response.status).toBe(200)
    expect(mintedClaims()).not.toHaveProperty('coeditHost')
  })

  /**
   * A membership written before `allHosts` existed carries neither the flag
   * nor a `hostAccess` map. `isOrgWideMember` reads that as org-wide on
   * purpose; `hostRoleFor` reads it as no reach. Asking only the latter would
   * have turned this fix into an outage for every legacy row.
   */
  it('a legacy pre-allHosts row is not locked out', async () => {
    arrange({ role: 'editor' })
    const response = await POST(request(THEIRS))
    expect(response.status).toBe(200)
    expect(mintedClaims()['coeditHost']).toBe(THEIRS)
  })

  /**
   * A host-level grant is its own proof. Someone listed in the host doc's
   * `memberRoles` reaches that host whatever the org roster says.
   */
  it('a host memberRoles grant reaches that host on its own', async () => {
    arrange({ role: 'viewer', allHosts: false, hostAccess: {} }, {
      [UID]: 'editor',
    })
    const response = await POST(request(THEIRS))
    expect(response.status).toBe(200)
    expect(mintedClaims()['coeditHost']).toBe(THEIRS)
  })
})

describe('the token names the host it was minted for', () => {
  it('carries presenceHost so the read rule can be bound to it later', async () => {
    // Inert today and deliberately so — the co-edit READ rule still keys on
    // `presenceOrg` alone. The claim has to be in circulation BEFORE a rule
    // can require it, or live co-editing breaks on the deploy that tightens
    // the rule. This assertion is what makes that ordering checkable.
    arrange({ role: 'admin', allHosts: true })
    await POST(request(MINE))
    expect(mintedClaims()['presenceHost']).toBe(MINE)
  })
})
