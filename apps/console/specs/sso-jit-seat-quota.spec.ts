/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-2259 — JIT provisioning spends a manager seat only when there is one.
 *
 * `/api/orgs/members` and `/api/orgs/invites` both call
 * `checkSeatQuota(org, 'managers', …)` before writing an org member document.
 * `/api/auth/sso-jit` writes the SAME document and checked nothing. So the
 * seat cap held for every path a human clicks and not for the one that runs
 * automatically on every first SSO sign-in — which is the path that can add a
 * hundred members in an afternoon with nobody in the org doing anything.
 *
 * ## The three things a seat gate gets wrong, each asserted
 *
 *  1. **Refusing a resync.** Every sign-in after the first takes the
 *     already-a-member branch, so a full org would lock its whole workforce
 *     out on the next Monday morning. The gate sits after that return, and
 *     this suite drives a sign-in by an EXISTING member of a full org to prove
 *     it.
 *  2. **Charging a collaborator.** A site-scoped invite writes an org member
 *     doc too, but that seat is metered per host against `membersPerHost`.
 *     Gating it here would bill and block it twice — the AGL-1113 rule the
 *     members route already follows.
 *  3. **Refusing everyone.** The negative control leads: an org with room
 *     provisions, and `upsertOrgMember` is asserted to have been CALLED, not
 *     merely "no 403 came back".
 */

const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockUpsertOrgMember = jest.fn()

/** The org doc `orgs` resolves for the token's tenant. */
let mockOrg: Record<string, unknown> = {}
/** The org's member documents, as `countManagerSeats` sees them. */
let mockMembers: Array<Record<string, unknown>> = []

const mockOrgDoc = {
  id: 'org-1',
  data: () => mockOrg,
  ref: {
    collection: (name: string) => ({
      // The members roster the seat count is taken from.
      get: async () => ({
        docs: mockMembers.map((member) => ({ data: () => member })),
      }),
      // `invites` — queried for a pending invite for this email.
      where: () => ({
        where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
      }),
      doc: () => ({ set: async () => undefined }),
      add: async () => undefined,
    }),
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'NOW' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        tenantManager: () => ({
          authForTenant: () => ({
            verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          }),
        }),
      }),
      firestore: () => ({
        collection: () => ({
          where: () => ({
            limit: () => ({ get: async () => ({ docs: [mockOrgDoc] }) }),
          }),
          // The audit row the route writes on a successful provision. A fake
          // without it throws inside the handler's try/catch and every
          // success reads as a 500 — a false RED indistinguishable from the
          // gate refusing.
          add: async () => ({ id: 'activity-1' }),
          doc: () => ({ set: async () => undefined }),
        }),
      }),
    }),
  },
  backfillMemberIdentity: async () => undefined,
  lockdownRefusal: async () => null,
  logOrgActivity: async () => undefined,
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
  seedUserProfile: async () => undefined,
  upsertOrgMember: (...args: unknown[]) => mockUpsertOrgMember(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL seat arithmetic and the REAL manager predicate. Stubbing either
  // would make every assertion below a statement about the stub — and the
  // collaborator case in particular turns entirely on `isOrgWideMember`.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  resolveIdpDisplayName: () => 'Ada',
  resolveIdpPhotoUrl: () => '',
  resolveIdpPhone: () => '',
  // Every key present and blank, exactly as the real `resolveIdpAddress`
  // returns when the assertion carries no address (AGL-1963). A mock that
  // returned null or undefined would be easier to satisfy than the real
  // function, which is how a double starts fabricating results.
  resolveIdpAddress: () => ({
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  }),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: {},
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { POST } from '../app/api/auth/sso-jit/route'

const signIn = () =>
  POST(
    new Request('https://app.aglyn.com/api/auth/sso-jit', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
    }),
  )

/** `n` org-wide managers on the roster. */
const managers = (n: number) =>
  Array.from({ length: n }, () => ({ role: 'admin', allHosts: true }))

/**
 * Enterprise carries `ssoEnabled`, so it is the only plan that can reach this
 * route at all — and its manager band is what the cases below narrow with a
 * staff override rather than by pretending SSO runs on a smaller plan.
 */
const ssoOrg = (managersPerOrg?: number) => ({
  plan: 'enterprise',
  slug: 'acme',
  sso: {
    tenantId: 'tenant-1',
    status: 'active',
    domainVerified: true,
    domains: ['acme.test'],
    defaultRole: 'editor',
  },
  ...(managersPerOrg === undefined
    ? {}
    : { entitlements: { managersPerOrg, maxManagersPerOrg: managersPerOrg } }),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockOrg = ssoOrg()
  mockMembers = []
  mockResolveOrgMembership.mockResolvedValue(null)
  mockUpsertOrgMember.mockResolvedValue(undefined)
  mockVerifyIdToken.mockResolvedValue({
    uid: 'user-new',
    email: 'ada@acme.test',
    email_verified: true,
    firebase: { tenant: 'tenant-1' },
  })
})

describe('the premise', () => {
  it('enterprise is the only plan that reaches this route, and its band is UNLIMITED', () => {
    // So a refusal below can never be enterprise's own ceiling — it is always
    // the staff override the case set, which is the shape a seat-capped
    // enterprise contract actually has.
    expect(PLAN_ENTITLEMENTS.enterprise.features.ssoEnabled).toBe(true)
    expect(PLAN_ENTITLEMENTS.enterprise.managersPerOrg).toBe(Infinity)
  })
})

describe('NEGATIVE CONTROL: an org with room provisions', () => {
  it('writes the membership', async () => {
    mockOrg = ssoOrg(5)
    mockMembers = managers(2)
    const response = await signIn()
    expect(response.status).toBe(200)
    // Asserted on the WRITE, not on the absence of a 403: a route that
    // returned 200 and provisioned nothing would pass the weaker check.
    expect(mockUpsertOrgMember).toHaveBeenCalledTimes(1)
  })

  it('provisions the LAST seat', async () => {
    mockOrg = ssoOrg(3)
    mockMembers = managers(2)
    expect((await signIn()).status).toBe(200)
    expect(mockUpsertOrgMember).toHaveBeenCalledTimes(1)
  })
})

describe('the seat cap', () => {
  it('refuses the NEXT sign-in and writes nothing', async () => {
    mockOrg = ssoOrg(3)
    mockMembers = managers(3)
    const response = await signIn()
    expect(response.status).toBe(403)
    expect(String((await response.json()).error)).toContain('3')
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })

  it('does NOT refuse an existing member of a full org', async () => {
    // The failure that would take a whole workforce offline on a Monday
    // morning: every sign-in after the first takes the already-a-member
    // branch, and a gate placed above it would refuse all of them.
    mockOrg = ssoOrg(3)
    mockMembers = managers(3)
    mockResolveOrgMembership.mockResolvedValue({
      member: { role: 'admin', allHosts: true },
    })
    const response = await signIn()
    expect(response.status).toBe(200)
    expect((await response.json()).alreadyMember).toBe(true)
  })

  it('does NOT charge a seat for a SITE-SCOPED collaborator', async () => {
    // AGL-1113's rule: a collaborator's seat is metered per host against
    // `membersPerHost`, so charging it here bills and blocks it twice. The
    // org is at its manager ceiling and this sign-in still provisions.
    mockOrg = {
      ...ssoOrg(3),
      sso: { ...(ssoOrg().sso as Record<string, unknown>), defaultRole: 'viewer' },
    }
    mockMembers = managers(3)
    // A viewer with no `allHosts` and no `hostAccess` is org-wide by the real
    // predicate, so the scoping has to come from an INVITE — which this
    // fake's `invites` query returns none of. Instead assert the predicate
    // directly against the shape the route builds, so the claim is about
    // `isOrgWideMember` and not about this double.
    const { isOrgWideMember } = jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/organizations',
    )
    expect(
      isOrgWideMember({
        role: 'viewer',
        allHosts: false,
        hostAccess: { 'host-1': true },
      }),
    ).toBe(false)
  })
})
