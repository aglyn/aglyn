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
 * AGL-2486 — a secondary email address NEVER reaches SSO.
 *
 * ## The escalation this suite exists to make impossible
 *
 * `/api/auth/sso-jit` writes org membership. It decides which org by the GCIP
 * tenant on a re-verified token, and it decides whether the person belongs
 * there by taking the DOMAIN OF THE EMAIL THE IdP ASSERTED and requiring it
 * to be one the org DNS-verified.
 *
 * Multiple addresses per account (this issue) introduces, for the first time,
 * a set of addresses on an account that the ACCOUNT HOLDER chose. If any of
 * them could satisfy that domain check, then adding an address to your own
 * settings page would provision you into the matching organization. A
 * convenience feature would have become a self-service membership grant, and
 * the org would have no record of anyone doing anything.
 *
 * Verifying `secondary@acme.test` proves one thing: you can read mail at that
 * mailbox. That is enough to be a sign-in identifier for your OWN account and
 * enough to receive an invitation somebody chose to send you. It is not, and
 * must never become, a statement that Acme employs you.
 *
 * ## Why these tests are written the way they are
 *
 * A happy-path test would be worthless here — the route already returns 403
 * for an ungoverned domain, and it will keep doing so right up until someone
 * "helpfully" widens the lookup. So every case below is driven with the
 * account's secondary addresses PRESENT and CONFIRMED, and asserts on the
 * WRITE (`upsertOrgMember`) rather than on a status code alone: a route that
 * answered 403 and provisioned anyway would pass the weaker check.
 *
 * `describe('the mutation')` at the bottom records exactly what was patched
 * into the route to prove each assertion can fail. Both were confirmed RED
 * in a throwaway git worktree before this file was committed.
 */

const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockUpsertOrgMember = jest.fn()
/**
 * The account-emails store, mocked whole. Nothing in the SSO path imports it
 * today, and `expect(...).not.toHaveBeenCalled()` below is the tripwire that
 * makes wiring it in later a failing test rather than a quiet regression.
 */
const mockVerifiedAccountEmails = jest.fn()
const mockFindAccountByVerifiedAlias = jest.fn()

let mockOrg: Record<string, unknown> = {}
/** Pending invites on the org, as the route's query sees them. */
let mockInvites: Array<Record<string, unknown>> = []
/** Invites the route actually queried for, by address. */
const invitesQueriedFor: string[] = []
const mockInviteAccept = jest.fn()

const inviteDoc = (invite: Record<string, unknown>) => ({
  id: 'invite-1',
  get: (field: string) => invite[field],
  data: () => invite,
  ref: { set: (...args: unknown[]) => mockInviteAccept(...args) },
})

const mockOrgDoc = {
  id: 'org-1',
  data: () => mockOrg,
  ref: {
    collection: (name: string) => {
      if (name === 'invites') {
        return {
          // The email the route matches on is captured here — that single
          // recorded string IS the security property under test.
          // Models `in` as well as `==`. A double that only understood `==`
          // would throw — or worse, silently match nothing — the moment
          // somebody widened this query, and a mutation that should have
          // been caught as a WIDENING would read as an unrelated crash.
          // The double has to be able to express the bug.
          where: (_field: string, _op: string, value: string | string[]) => {
            const wanted = Array.isArray(value) ? value : [value]
            invitesQueriedFor.push(...wanted)
            const matched = mockInvites.filter((invite) =>
              wanted.includes(invite['email'] as string),
            )
            return {
              where: () => ({
                limit: () => ({
                  get: async () => ({ docs: matched.map(inviteDoc) }),
                }),
              }),
            }
          },
        }
      }
      // `members` — the roster the seat count is taken from.
      return { get: async () => ({ docs: [] }) }
    },
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
          // The audit row a successful provision writes. Without it the
          // handler throws inside its own try/catch and every success reads
          // as a 500 — a false RED indistinguishable from the gate refusing.
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
  verifiedAccountEmails: (...args: unknown[]) => mockVerifiedAccountEmails(...args),
  findAccountByVerifiedAlias: (...args: unknown[]) =>
    mockFindAccountByVerifiedAlias(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL seat arithmetic and the REAL manager predicate — stubbing either
  // would make the assertions statements about the stub.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  resolveIdpDisplayName: () => 'Ada',
  resolveIdpPhotoUrl: () => '',
  resolveIdpPhone: () => '',
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

import { POST } from '../app/api/auth/sso-jit/route'

const signIn = () =>
  POST(
    new Request('https://app.aglyn.com/api/auth/sso-jit', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
    }),
  )

/** Acme, whose SSO tenant is `tenant-1` and whose proven domain is acme.test. */
const acme = () => ({
  plan: 'enterprise',
  slug: 'acme',
  sso: {
    tenantId: 'tenant-1',
    status: 'active',
    domainVerified: true,
    domains: ['acme.test'],
    defaultRole: 'viewer',
  },
})

/**
 * The account holds a CONFIRMED secondary at acme.test. Everything below runs
 * with this true — that is the point. In the real store these are rows under
 * `users/{uid}/emails`; here they are what the mocked store would hand back
 * to anything that asked, and the assertions are that nothing asks.
 */
const CONFIRMED_SECONDARIES = ['ada@acme.test', 'ada.lovelace@acme.test']

beforeEach(() => {
  jest.clearAllMocks()
  mockOrg = acme()
  mockInvites = []
  invitesQueriedFor.length = 0
  mockResolveOrgMembership.mockResolvedValue(null)
  mockUpsertOrgMember.mockResolvedValue(undefined)
  mockInviteAccept.mockResolvedValue(undefined)
  mockVerifiedAccountEmails.mockResolvedValue(CONFIRMED_SECONDARIES)
  mockFindAccountByVerifiedAlias.mockResolvedValue({
    uid: 'user-ada',
    address: 'ada@acme.test',
  })
  // The IdP asserted a PERSONAL address. Acme's IdP would never do this; the
  // shape being modelled is any route that reaches sso-jit carrying an
  // identity whose domain Acme has not proven.
  mockVerifyIdToken.mockResolvedValue({
    uid: 'user-ada',
    email: 'ada@personal.test',
    email_verified: true,
    firebase: { tenant: 'tenant-1' },
  })
})

describe('NEGATIVE CONTROL: the route provisions when the IdP asserts a governed address', () => {
  // Leads, so that every refusal below is this suite's guard biting and not a
  // fixture that could never have succeeded in the first place.
  it('grants membership for an IdP-asserted acme.test address', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-ada',
      email: 'ada@acme.test',
      email_verified: true,
      firebase: { tenant: 'tenant-1' },
    })
    const response = await signIn()
    expect(response.status).toBe(200)
    expect(mockUpsertOrgMember).toHaveBeenCalledTimes(1)
  })

  it('consumes an invite addressed to the IdP-asserted address', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-ada',
      email: 'ada@acme.test',
      email_verified: true,
      firebase: { tenant: 'tenant-1' },
    })
    mockInvites = [{ email: 'ada@acme.test', role: 'admin', allHosts: true }]
    expect((await signIn()).status).toBe(200)
    expect(mockUpsertOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
    )
    expect(mockInviteAccept).toHaveBeenCalledTimes(1)
  })
})

describe('a CONFIRMED secondary address does not satisfy the SSO domain check', () => {
  it('refuses, and writes no membership', async () => {
    const response = await signIn()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: expect.stringContaining('not verified for SSO'),
      }),
    )
    // The assertion that matters. A route that refused with a 403 body and
    // provisioned anyway would satisfy the status check above.
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })

  it('refuses even when EVERY confirmed secondary is on the governed domain', async () => {
    mockVerifiedAccountEmails.mockResolvedValue([
      'ada@acme.test',
      'ada.lovelace@acme.test',
      'a.lovelace@acme.test',
    ])
    expect((await signIn()).status).toBe(403)
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })

  it('never consults the account-emails store at all', async () => {
    await signIn()
    // The tripwire. These two functions are the ONLY way to get an account's
    // other addresses, and the SSO path must never call either. If a future
    // change imports one, this fails — which is the whole point of mocking a
    // module the route does not currently import.
    expect(mockVerifiedAccountEmails).not.toHaveBeenCalled()
    expect(mockFindAccountByVerifiedAlias).not.toHaveBeenCalled()
  })
})

describe('the invite lookup matches ONLY the address the IdP asserted', () => {
  /**
   * The deliberate asymmetry, and the reason it is not an inconsistency.
   *
   * The console's own accept flow (`/api/orgs/invites`) DOES match an
   * invitation against any confirmed address on the account — GitHub's
   * behaviour, and safe, because an invitation is an explicit grant the org
   * made to a person it chose.
   *
   * This path is different in kind. Here the org is not choosing anything:
   * the IdP is asserting an identity, and the assertion is the org's
   * statement about who this is. Widening the match to addresses the ACCOUNT
   * HOLDER added would let them pull in an invitation sent to a mailbox the
   * IdP never vouched for, inside the one flow whose entire premise is that
   * the IdP is the authority. So the SSO path stays narrow.
   */
  it('does not consume an invite sent to a confirmed secondary', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-ada',
      email: 'ada@acme.test',
      email_verified: true,
      firebase: { tenant: 'tenant-1' },
    })
    // The invite grants ADMIN and is addressed to a mailbox this account has
    // confirmed — but not to the address the IdP asserted.
    mockInvites = [{ email: 'ada.lovelace@acme.test', role: 'admin', allHosts: true }]

    expect((await signIn()).status).toBe(200)
    // Provisioned at the org's DEFAULT role, not the invite's admin.
    expect(mockUpsertOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'viewer', invitedBy: 'sso' }),
    )
    expect(mockInviteAccept).not.toHaveBeenCalled()
  })

  it('queries the invites collection for the asserted address and nothing else', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-ada',
      email: 'ada@acme.test',
      email_verified: true,
      firebase: { tenant: 'tenant-1' },
    })
    await signIn()
    expect(invitesQueriedFor).toEqual(['ada@acme.test'])
  })
})

describe('the mutation', () => {
  /**
   * How the guards were proven able to fail — run in a throwaway git worktree
   * so the shared checkout was never patched.
   *
   * MUTATION 1 — the domain check reads the account's addresses.
   * In `apps/console/app/api/auth/sso-jit/route.ts`, replacing
   *
   *     if (!sso.domainVerified || !domains.includes(domain)) {
   *
   * with a version that also accepts a confirmed secondary:
   *
   *     const alts = await verifiedAccountEmails(decoded.uid)
   *     const anyDomain = [email, ...alts].map(
   *       (a) => a.slice(a.lastIndexOf('@') + 1))
   *     if (!sso.domainVerified || !anyDomain.some((d) => domains.includes(d))) {
   *
   * turns both cases in "a CONFIRMED secondary address does not satisfy the
   * SSO domain check" GREEN-to-RED: the route answers 200 and calls
   * `upsertOrgMember`, and the store tripwire fires too. That is the
   * escalation, reproduced — an account whose IdP asserted `@personal.test`
   * lands inside Acme.
   *
   * MUTATION 2 — the invite lookup widens.
   * Replacing the invite query's `.where('email', '==', email)` with an `in`
   * over `[email, ...await verifiedAccountEmails(decoded.uid)]` turns both
   * cases in "the invite lookup matches ONLY the address the IdP asserted"
   * RED: the admin invite is consumed and `role: 'admin'` is provisioned.
   */
  it('is documented above, not executed here', () => {
    expect(true).toBe(true)
  })
})
