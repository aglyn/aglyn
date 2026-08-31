/**
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
 * AGL-1888 — enforcement must refuse to lock an organization out of itself,
 * and it must refuse BEFORE it changes anything.
 *
 * `sso-enforcement.spec.ts` drives `planAccount` and `assessSsoLockoutRisk`,
 * which are pure and hold the decision. This drives the SWEEP, because the
 * property that matters here is not what the plan says — it is that a refused
 * sweep performs zero writes.
 *
 * Half a sweep is the worst outcome available. The accounts already stripped
 * are stripped, their refresh tokens are already revoked, and the org is
 * locked out with no record of how far it got. A guard that ran per-account,
 * or after the loop, would produce exactly that while still reading as a
 * guard — so `updateUser` and `revokeRefreshTokens` call counts are asserted,
 * not just the throw.
 *
 * The doubles model only what the sweep touches. They are narrow on purpose:
 * an elaborate fake here would be one more thing that can be wrong in a way
 * that fabricates a green.
 */

const updateUser = jest.fn(async () => undefined)
const revokeRefreshTokens = jest.fn(async () => undefined)
const notifyUsers = jest.fn(async () => undefined)
const auditAdd = jest.fn(async () => undefined)

/** Accounts in the org's GCIP pool for one test. */
let poolUsers: Array<{ uid: string; email: string; providerData: Array<{ providerId: string }> }> = []
/** The `sso` map on the org document for one test. */
let orgSso: Record<string, unknown> = {}
/**
 * What the owner resolver answers (AGL-1888 option (a)). BOTH worlds are
 * arranged below — a double that reported an owner unconditionally could not
 * prove the refusal path, which is the assertion that matters most here. The
 * resolver's own seven conditions are driven for real in
 * `sso-break-glass-owners.spec.ts`; this file is about what the SWEEP does
 * with the answer.
 */
let ownerLookup: {
  owners: Array<{ uid: string; email: string; providers: string[] }>
  unavailable: boolean
} = { owners: [], unavailable: false }

jest.mock('./sso-break-glass-owners', () => ({
  findBreakGlassOrgOwners: async () => ownerLookup,
}))

jest.mock('./auth-pools', () => ({
  authForPool: () => ({
    listUsers: async () => ({ users: poolUsers, pageToken: undefined }),
    updateUser,
    revokeRefreshTokens,
  }),
}))

jest.mock('./notifications', () => ({ notifyUsers }))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      auth: () => ({}),
      firestore: () => ({
        collection: (name: string) =>
          name === 'adminAudit'
            ? { add: auditAdd }
            : {
                doc: () => ({
                  get: async () => ({
                    exists: true,
                    get: (field: string) => (field === 'sso' ? orgSso : undefined),
                  }),
                }),
              },
      }),
    }),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))

import {
  SSO_LOCKOUT_REFUSAL,
  SsoEnforcementError,
  enforceSsoSignInMethods,
} from './sso-enforcement'

const SAML = 'saml.aglyn-workspace'
const ORG = 'aglyn-org'

const account = (uid: string, providers: string[]) => ({
  uid,
  email: `${uid}@aglyn.com`,
  providerData: providers.map((providerId) => ({ providerId })),
})

const baseSso = {
  tenantId: 'aglyn-org-y5v14',
  providerId: SAML,
  status: 'active',
  enforced: true,
}

/** The founding admin: an org owner in the PROJECT pool, not in the tenant. */
const OUTSIDE_OWNER = {
  uid: 'founder',
  email: 'founder@aglyn.com',
  providers: ['password'],
}

beforeEach(() => {
  jest.clearAllMocks()
  orgSso = { ...baseSso }
  poolUsers = []
  // The default is the world where NOBODY qualifies, so every existing case
  // below still proves what it claims to prove.
  ownerLookup = { owners: [], unavailable: false }
})

describe('the SSO enforcement pre-flight', () => {
  it('THE DEFECT: refuses when nobody would keep a non-IdP way in', async () => {
    // The `staff@aglyn.com` shape. Two accounts, both with a password today;
    // enforcing would leave both holding nothing but the SAML link, and a
    // lapsed certificate then locks the organization out permanently.
    poolUsers = [
      account('owner', [SAML, 'password']),
      account('member', [SAML, 'google.com']),
    ]
    await expect(enforceSsoSignInMethods(ORG)).rejects.toBeInstanceOf(
      SsoEnforcementError,
    )
    await expect(enforceSsoSignInMethods(ORG)).rejects.toThrow(
      SSO_LOCKOUT_REFUSAL,
    )
  })

  it('and it refuses BEFORE touching a single account', async () => {
    // The property the throw alone does not prove. A guard evaluated inside
    // the loop would strip `a` and then refuse, leaving the org half-enforced
    // and still locked out.
    poolUsers = [
      account('a', [SAML, 'password']),
      account('b', [SAML, 'password']),
      account('c', [SAML, 'password']),
    ]
    await expect(enforceSsoSignInMethods(ORG)).rejects.toThrow()
    expect(updateUser).not.toHaveBeenCalled()
    expect(revokeRefreshTokens).not.toHaveBeenCalled()
    expect(auditAdd).not.toHaveBeenCalled()
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('proceeds once a break-glass account is designated', async () => {
    orgSso = { ...baseSso, breakGlassUids: ['owner'] }
    poolUsers = [
      account('owner', [SAML, 'password']),
      account('member', [SAML, 'google.com']),
    ]
    const result = await enforceSsoSignInMethods(ORG)

    // The designated account keeps everything; everybody else is enforced.
    expect(updateUser).toHaveBeenCalledTimes(1)
    expect(updateUser).toHaveBeenCalledWith('member', {
      providersToUnlink: ['google.com'],
    })
    expect(revokeRefreshTokens).toHaveBeenCalledWith('member')
    expect(result.lockout).toMatchObject({ safe: true, retainedBy: ['owner'] })
    expect(
      result.accounts.find((a) => a.uid === 'owner')?.skipped,
    ).toBe('break-glass')
  })

  it('refuses a designation that holds nothing but the IdP', async () => {
    // Designating an account whose only credential is the SAML link is the
    // natural way to satisfy this requirement without gaining anything: it
    // fails in exactly the situation it exists for.
    orgSso = { ...baseSso, breakGlassUids: ['owner'] }
    poolUsers = [account('owner', [SAML]), account('member', [SAML, 'password'])]
    await expect(enforceSsoSignInMethods(ORG)).rejects.toThrow(
      SSO_LOCKOUT_REFUSAL,
    )
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('lets the REHEARSAL run, and reports the risk instead of throwing', async () => {
    // The rehearsal is how an org discovers it needs a break-glass account.
    // Refusing to rehearse would leave them guessing at the requirement they
    // are being held to — and the dry run writes nothing anyway.
    poolUsers = [account('owner', [SAML, 'password'])]
    const preview = await enforceSsoSignInMethods(ORG, {
      dryRun: true,
      force: true,
    })
    expect(preview.lockout).toMatchObject({ safe: false, retainedBy: [] })
    expect(preview.accounts[0].unlinked).toEqual(['password'])
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('names an ineffective designation in the rehearsal', async () => {
    orgSso = { ...baseSso, breakGlassUids: ['ghost'] }
    poolUsers = [account('owner', [SAML, 'password'])]
    const preview = await enforceSsoSignInMethods(ORG, { dryRun: true })
    expect(preview.lockout).toMatchObject({
      safe: false,
      ineffective: ['ghost'],
    })
  })

  /**
   * AGL-1888 option (a), at the sweep. The pure assessment is covered in
   * `sso-enforcement.spec.ts`; what is proved here is that the sweep actually
   * ASKS, and that the answer reaches the guard rather than a field nobody
   * reads.
   */
  describe('an org owner outside the pool', () => {
    it('THE FIX: enforcement proceeds with nobody designated', async () => {
      // The state every self-serve org is in: `provisionSsoPool` disables
      // password sign-in in the pool, so no account inside it can ever
      // qualify. The founding admin signs in at project level, where the
      // sweep below cannot reach them.
      ownerLookup = { owners: [OUTSIDE_OWNER], unavailable: false }
      poolUsers = [
        account('member-a', [SAML, 'password']),
        account('member-b', [SAML, 'google.com']),
      ]
      const result = await enforceSsoSignInMethods(ORG)

      expect(result.lockout).toMatchObject({
        safe: true,
        retainedBy: [],
        ownersOutsidePool: [OUTSIDE_OWNER],
      })
      // And it really enforced — an org that is allowed through must still
      // lose its bypasses, or the fix has quietly turned enforcement off.
      expect(updateUser).toHaveBeenCalledWith('member-a', {
        providersToUnlink: ['password'],
      })
      expect(updateUser).toHaveBeenCalledWith('member-b', {
        providersToUnlink: ['google.com'],
      })
      expect(result.changed).toBe(2)
    })

    it('THE NEGATIVE: the identical org with NO such owner is refused', async () => {
      // Same pool, same absent designation — only the owner world differs.
      // This is the assertion that proves the guard is still a guard, and the
      // one that would go quiet if the lookup were stubbed to always answer.
      ownerLookup = { owners: [], unavailable: false }
      poolUsers = [
        account('member-a', [SAML, 'password']),
        account('member-b', [SAML, 'google.com']),
      ]
      await expect(enforceSsoSignInMethods(ORG)).rejects.toThrow(
        SSO_LOCKOUT_REFUSAL,
      )
      expect(updateUser).not.toHaveBeenCalled()
      expect(revokeRefreshTokens).not.toHaveBeenCalled()
      expect(auditAdd).not.toHaveBeenCalled()
    })

    it('a FAILED owner lookup refuses, and says the check did not complete', async () => {
      // An outage must not read as "this org has nobody", and must never be
      // a way past the guard.
      ownerLookup = { owners: [], unavailable: true }
      poolUsers = [account('member-a', [SAML, 'password'])]
      await expect(enforceSsoSignInMethods(ORG)).rejects.toThrow(
        SSO_LOCKOUT_REFUSAL,
      )
      const preview = await enforceSsoSignInMethods(ORG, { dryRun: true })
      expect(preview.lockout).toMatchObject({
        safe: false,
        ownerLookupFailed: true,
      })
    })

    it('the REHEARSAL reports the owner, so the card can name them', async () => {
      // The rehearsal is where an org finds out whether it may enforce. If it
      // skipped the lookup it would report a risk the real run disagrees
      // with, and the card would keep telling a protected org it is stranded.
      ownerLookup = { owners: [OUTSIDE_OWNER], unavailable: false }
      poolUsers = [account('member-a', [SAML, 'password'])]
      const preview = await enforceSsoSignInMethods(ORG, {
        dryRun: true,
        force: true,
      })
      expect(preview.lockout.safe).toBe(true)
      expect(preview.lockout.ownersOutsidePool).toEqual([OUTSIDE_OWNER])
      expect(updateUser).not.toHaveBeenCalled()
    })
  })

  it('is idempotent once converged, and stays safe', async () => {
    // The second run must be a no-op rather than a second round of
    // revocations — and must not start refusing just because the accounts it
    // already enforced now hold only the IdP.
    orgSso = { ...baseSso, breakGlassUids: ['owner'] }
    poolUsers = [account('owner', [SAML, 'password']), account('member', [SAML])]
    const result = await enforceSsoSignInMethods(ORG)
    expect(result.changed).toBe(0)
    expect(updateUser).not.toHaveBeenCalled()
    expect(result.lockout.safe).toBe(true)
  })
})
