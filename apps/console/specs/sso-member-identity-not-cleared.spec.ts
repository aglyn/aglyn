/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and this runs on jsdom, which has no Response.
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
 * AGL-1961: changing an SSO member's role must not erase their roster
 * identity.
 *
 * `POST /api/orgs/members {action:'upsert'}` is BOTH "add a member" and
 * "change this member's role". It mirrors `displayName`/`photoURL` from the
 * auth record onto the roster (AGL-1126), because no member surface can read
 * a tenant-pool auth record itself (AGL-1122) — and it used to resolve them
 * with `?? null`.
 *
 * `upsertOrgMember` documents `undefined` as "leave the stored value alone"
 * and `null` as "clear it". An SSO member's tenant auth record carries
 * neither field — measured on `zach@aglyn.com` 2026-08-18: `displayName:
 * null`, `photoURL: undefined`, sole provider `saml.aglyn-workspace` with
 * `photoURL: null` — so the mirror resolved to `null` and a role change wrote
 * `null` over the very fields `backfillMemberIdentity` had filled in for them
 * (AGL-1131). Silent: the write succeeds, the role change is applied, and the
 * roster row goes nameless and faceless.
 *
 * The double below models the two `upsertOrgMember` branches exactly, because
 * an unfaithful one would let `null` look harmless: `undefined` must be
 * ABSENT from the merge, and `null` must survive into it as a clear.
 */

const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockFindUserByUidAcrossPools = jest.fn()
const mockUpsertOrgMember = jest.fn()
const mockMemberExists = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            // The org doc for the POST branch.
            get: async () => ({
              exists: true,
              data: () => ({ ownerUid: 'owner-uid', plan: 'agency' }),
              get: (field: string) =>
                ({ slug: 'aglyn-org', name: 'Aglyn' })[field],
            }),
            collection: () => ({
              doc: () => ({
                // The already-a-member probe.
                get: async () => ({ exists: mockMemberExists() }),
              }),
              get: async () => ({ docs: [] }),
            }),
          }),
          _name: name,
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  findUserByEmailAcrossPools: jest.fn(),
  findUserByUidAcrossPools: (...a: unknown[]) => mockFindUserByUidAcrossPools(...a),
  isImpersonationSession: () => false,
  getOrgDoc: async () => null,
  lockdownRefusal: async () => null,
  listOrgMembers: jest.fn(async () => []),
  logOrgActivity: jest.fn(),
  memberHasOrgPermission: jest.fn(async () => true),
  meterOrgEmail: jest.fn(),
  notifyUsers: jest.fn(),
  removeOrgMember: jest.fn(),
  resolveOrgMembership: (...a: unknown[]) => mockResolveOrgMembership(...a),
  upsertOrgMember: (...a: unknown[]) => mockUpsertOrgMember(...a),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: jest.fn(),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: jest.fn(),
}))

import { POST } from '../app/api/orgs/members/route'

/**
 * What `upsertOrgMember` actually does with the mirror fields, modelled from
 * `organizations.ts`: spread-if-defined into a `merge: true` set. Anything
 * else here would fabricate a green.
 */
function applyUpsert(
  stored: Record<string, unknown>,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { role: options['role'] }
  for (const field of ['email', 'displayName', 'photoURL', 'title'] as const) {
    if (options[field] !== undefined) patch[field] = options[field]
  }
  return { ...stored, ...patch }
}

/** The roster row AGL-1131's backfill left for the one live SSO account. */
const SSO_ROSTER_ROW = {
  role: 'viewer',
  email: 'zach@aglyn.com',
  displayName: 'Zach Gover',
  photoURL: 'https://cdn.example/zach.png',
}

/**
 * The tenant auth record for that same account, as measured. Both fields are
 * genuinely missing — this is not a lookup failure.
 */
const SSO_AUTH_RECORD = {
  uid: 'QQ7fixtureUid0000000000000001',
  email: 'zach@aglyn.com',
  displayName: null,
  photoURL: undefined,
}

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/members', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: 'jWmGooWE3L', ...body }),
    }),
  )

describe('POST /api/orgs/members upsert — SSO roster identity (AGL-1961)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyIdToken.mockResolvedValue({ uid: 'actor', email_verified: true })
    mockResolveOrgMembership.mockResolvedValue({ role: 'admin', member: {} })
    mockUpsertOrgMember.mockResolvedValue(undefined)
    // A role change, so the seat gate is skipped and the destructive write is
    // the only thing left to observe.
    mockMemberExists.mockReturnValue(true)
    mockFindUserByUidAcrossPools.mockResolvedValue({ record: SSO_AUTH_RECORD })
  })

  it('does not clear a name and photo the auth record simply lacks', async () => {
    const response = await post({
      action: 'upsert',
      uid: SSO_AUTH_RECORD.uid,
      role: 'editor',
    })
    expect(response.status).toBe(200)

    const options = mockUpsertOrgMember.mock.calls[0][0]
    // The assertion that fails against `?? null`: absent, not null.
    expect(options.displayName).toBeUndefined()
    expect(options.photoURL).toBeUndefined()

    // …and what that means on the stored row, through the real merge rule.
    expect(applyUpsert(SSO_ROSTER_ROW, options)).toMatchObject({
      role: 'editor',
      displayName: 'Zach Gover',
      photoURL: 'https://cdn.example/zach.png',
    })
  })

  it('CONTROL — a record that HAS a name and photo still mirrors them', async () => {
    // Without this, "never write the mirror fields" would also pass, and
    // AGL-1126 would be undone in the other direction.
    mockFindUserByUidAcrossPools.mockResolvedValue({
      record: {
        uid: 'u-social',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        photoURL: 'https://cdn.example/ada.png',
      },
    })
    await post({ action: 'upsert', uid: 'u-social', role: 'editor' })

    const options = mockUpsertOrgMember.mock.calls[0][0]
    expect(options.displayName).toBe('Ada Lovelace')
    expect(options.photoURL).toBe('https://cdn.example/ada.png')
    expect(applyUpsert({ role: 'viewer' }, options)).toMatchObject({
      displayName: 'Ada Lovelace',
      photoURL: 'https://cdn.example/ada.png',
    })
  })

  it('CONTROL — an empty-string photo is absent too, never a clear', async () => {
    // GCIP hands back `''` as readily as it omits the field, and `'' ?? null`
    // is `''` — a falsy value that would overwrite a real URL with nothing.
    mockFindUserByUidAcrossPools.mockResolvedValue({
      record: {
        uid: SSO_AUTH_RECORD.uid,
        email: SSO_AUTH_RECORD.email,
        displayName: '',
        photoURL: '',
      },
    })
    await post({ action: 'upsert', uid: SSO_AUTH_RECORD.uid, role: 'viewer' })

    const options = mockUpsertOrgMember.mock.calls[0][0]
    expect(options.displayName).toBeUndefined()
    expect(options.photoURL).toBeUndefined()
    expect(applyUpsert(SSO_ROSTER_ROW, options)).toMatchObject(SSO_ROSTER_ROW)
  })

  it('CONTROL — the double really does clear on an explicit null', async () => {
    // Proves the merge model above can fail. If `undefined` and `null` were
    // modelled the same way, every assertion in this file would be vacuous.
    expect(
      applyUpsert(SSO_ROSTER_ROW, { role: 'viewer', photoURL: null }),
    ).toMatchObject({ photoURL: null, displayName: 'Zach Gover' })
  })
})
