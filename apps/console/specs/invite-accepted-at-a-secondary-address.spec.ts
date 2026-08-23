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
 * AGL-2486 — an invitation may be accepted at any CONFIRMED address on the
 * account, and at nothing else.
 *
 * ## The decision, and why it is the safe half of the pair
 *
 * GitHub lets an invitation sent to any of your verified addresses be
 * accepted by your account, and this repo now does the same. The reason it is
 * safe is that an invitation is an EXPLICIT GRANT the organization made:
 * somebody with `org.settings` typed that address and chose that role.
 * Matching it against the recipient's other confirmed mailboxes decides only
 * which inbox the org's own grant may arrive at — it cannot manufacture a
 * grant, and adding an address to your account still gives you access to
 * nothing.
 *
 * That is exactly the property `/api/auth/sso-jit` does NOT have, which is
 * why the sibling suite `account-emails-never-reach-sso.spec.ts` proves the
 * SSO path stays narrow. The two are a matched pair and should be read
 * together: the org may choose to reach you at a second address; you may not
 * choose to reach an org.
 *
 * ## The refusal still has to bite
 *
 * Widening a comparison is the classic way to delete a guard by accident.
 * `email !== invite.email` became `acceptable.includes(invite.email)`, and if
 * `acceptable` were ever over-filled — with unverified rows, or with every
 * address in the index — the check would pass for invitations addressed to
 * strangers. So the refusal cases below outnumber the acceptance case.
 */

const mockVerifyIdToken = jest.fn()
const mockIsImpersonationSession = jest.fn()
const mockVerifiedAccountEmails = jest.fn()
const mockUpsertOrgMember = jest.fn()
const mockInviteSet = jest.fn()

/** The stored invite `accept` reads. */
let mockInvite: Record<string, unknown> = {}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'NOW' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  consumeRateLimit: async () => ({ allowed: true }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  collaboratorSeatRefusalResponse: () => null,
  collaboratorSeatRefusal: () => null,
  isImpersonationSession: (...args: unknown[]) => mockIsImpersonationSession(...args),
  lockdownRefusal: async () => null,
  logOrgActivity: async () => undefined,
  memberHasOrgPermission: async () => true,
  meterOrgEmail: async () => undefined,
  notifyOrgAdmins: async () => undefined,
  resolveOrgMembership: async () => ({ member: { role: 'admin' } }),
  getOrgDoc: async () => ({ slug: 'acme', name: 'Acme' }),
  upsertOrgMember: (...args: unknown[]) => mockUpsertOrgMember(...args),
  verifiedAccountEmails: (...args: unknown[]) => mockVerifiedAccountEmails(...args),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            // The org doc, and the caller's existing member doc (absent).
            get: async () => ({
              exists: false,
              data: () => ({ name: 'Acme', slug: 'acme', plan: 'enterprise' }),
              get: (field: string) =>
                ({ name: 'Acme', slug: 'acme' })[field as 'name' | 'slug'],
            }),
            collection: (name: string) =>
              name === 'invites'
                ? {
                    doc: () => ({
                      get: async () => ({
                        exists: true,
                        data: () => mockInvite,
                      }),
                      set: (...args: unknown[]) => mockInviteSet(...args),
                    }),
                    where: () => ({
                      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
                    }),
                  }
                : {
                    // `members`: the caller's own member doc (absent — they
                    // are joining) AND the roster the seat count walks. A
                    // double missing either shape throws inside the route's
                    // try/catch and every success reads as a 500, which is a
                    // false RED indistinguishable from the guard refusing.
                    doc: () => ({ get: async () => ({ exists: false }) }),
                    get: async () => ({ docs: [] }),
                  },
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL seat arithmetic and the REAL manager predicate.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  // The REAL routes too: the success path builds a notification link with
  // `buildRoute(Route.MANAGE_TEAM, …)`, and a mock without them throws on
  // the way OUT of a successful accept — turning the case this suite exists
  // to prove into a 500.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/console-routes'),
  resolveIdpDisplayName: () => 'Ada',
  resolveIdpPhotoUrl: () => '',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from '../app/api/orgs/invites/route'

const accept = () =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/invites', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'accept', orgId: 'org-1', inviteId: 'invite-1' }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockInvite = {
    email: 'ada@work.test',
    role: 'editor',
    allHosts: true,
    acceptedAt: null,
    invitedBy: 'admin-1',
  }
  mockIsImpersonationSession.mockReturnValue(false)
  mockUpsertOrgMember.mockResolvedValue(undefined)
  mockInviteSet.mockResolvedValue(undefined)
  // The account's PRIMARY is a personal address; the work address is a
  // confirmed secondary.
  mockVerifiedAccountEmails.mockResolvedValue(['ada@personal.test', 'ada@work.test'])
  mockVerifyIdToken.mockResolvedValue({
    uid: 'user-ada',
    email: 'ada@personal.test',
    email_verified: true,
  })
})

describe('an invitation addressed to a confirmed secondary is accepted', () => {
  it('materializes the membership', async () => {
    const response = await accept()
    expect(response.status).toBe(200)
    // Asserted on the WRITE. A route that answered 200 and joined nobody
    // would satisfy a status-only check.
    expect(mockUpsertOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-ada', role: 'editor' }),
    )
    expect(mockInviteSet).toHaveBeenCalledTimes(1)
  })

  it('hands the seat count every address, so it does not bill its own invitee', async () => {
    /*
     * WIRING, not arithmetic — `countCollaboratorSeats` is unit-tested in
     * `libs/aglyn/.../organizations.spec.ts`. What this pins is that the
     * accept path actually SUPPLIES the aliases.
     *
     * The collaborator seat count reads pending invites, and the invite being
     * consumed is still pending at the moment `upsertOrgMember` runs its cap
     * check. Keyed by the secondary, it is not the primary the exclusion
     * carries — so without this argument an org sitting exactly on its cap
     * refuses the very person it invited. Dropping `seatAliasEmails` from the
     * call turns this case red and nothing else.
     */
    await accept()
    expect(mockUpsertOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({
        seatAliasEmails: expect.arrayContaining(['ada@work.test']),
      }),
    )
  })

  it('still works for the PRIMARY address — the ordinary case is untouched', async () => {
    mockInvite = { ...mockInvite, email: 'ada@personal.test' }
    expect((await accept()).status).toBe(200)
    expect(mockUpsertOrgMember).toHaveBeenCalledTimes(1)
  })
})

describe('the refusal still bites', () => {
  it('refuses an invitation addressed to somebody else entirely', async () => {
    mockInvite = { ...mockInvite, email: 'stranger@elsewhere.test' }
    const response = await accept()
    expect(response.status).toBe(403)
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })

  it('refuses when the account has NO confirmed secondaries', async () => {
    // The widening must add nothing when there is nothing to add.
    mockVerifiedAccountEmails.mockResolvedValue([])
    mockInvite = { ...mockInvite, email: 'ada@work.test' }
    expect((await accept()).status).toBe(403)
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })

  it('refuses when the TOKEN is unverified, however many addresses are confirmed', async () => {
    // `email_verified` on the token is a separate floor and stays. An
    // account that has not confirmed its own primary accepts nothing.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-ada',
      email: 'ada@personal.test',
      email_verified: false,
    })
    const response = await accept()
    expect(response.status).toBe(403)
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })

  it('refuses an unverified token on a staff IMPERSONATION session too', async () => {
    /*
     * The route-wide email gate at the top of the handler is written
     * `!decoded.email_verified && !isImpersonationSession(decoded)`, so an
     * impersonation token walks straight past it. On THAT path the accept
     * branch's own `email_verified` floor is the only one left.
     *
     * Without this case the floor is untestable: every other case in this
     * file is refused by the route-wide gate first, so deleting the accept
     * branch's check leaves the whole suite green. Proven by deleting it —
     * six green before this case, this case red after.
     */
    mockIsImpersonationSession.mockReturnValue(true)
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-ada',
      email: 'ada@personal.test',
      email_verified: false,
      impersonatedBy: 'staff-1',
    })
    const response = await accept()
    expect(response.status).toBe(403)
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })

  it('refuses an already-accepted invitation', async () => {
    mockInvite = { ...mockInvite, acceptedAt: 'NOW' }
    expect((await accept()).status).toBe(409)
    expect(mockUpsertOrgMember).not.toHaveBeenCalled()
  })
})
