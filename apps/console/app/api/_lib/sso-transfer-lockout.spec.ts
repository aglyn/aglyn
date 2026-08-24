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
 * AGL-1888 — an ownership transfer must not undo the enforcement pre-flight.
 *
 * This is a security control, so the REFUSALS are the subject and the single
 * allowed case exists to prove the harness can tell them apart. Every refusal
 * below is paired with the nearest allowed case that differs in exactly one
 * fact, because a guard that refuses everything passes a suite made only of
 * refusals.
 *
 * The doubles are the two engine entry points, spied rather than reimplemented
 * — what is under test is the COMPOSITION (which question is asked, about
 * whom, in which order, and what an unanswerable one means), not the seven
 * conditions, which `sso-break-glass-owners.spec.ts` owns.
 */

const mockEnforceSweep = jest.fn()
const mockQualifiesAsOwner = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  enforceSsoSignInMethods: (...args: unknown[]) =>
    mockEnforceSweep(...args),
  qualifiesAsBreakGlassOwner: (...args: unknown[]) =>
    mockQualifiesAsOwner(...args),
}))

import {
  SSO_TRANSFER_LOCKOUT_REFUSAL,
  SSO_TRANSFER_LOCKOUT_UNKNOWN,
  assessOwnershipTransferLockout,
} from './sso-transfer-lockout'

const ORG = 'acme-org'
const TENANT = 'acme-org-ab12'
const SAML = 'saml.acme-okta'
/** The account about to become the org's only owner. */
const TARGET = 'target-uid'
/** The account holding the seat today. Must never be the one asked about. */
const CURRENT_OWNER = 'current-owner-uid'

/** An org doc with SSO live and enforcement on — the dangerous state. */
const enforcedOrg = (over: Record<string, unknown> = {}) => ({
  ownerUid: CURRENT_OWNER,
  sso: { tenantId: TENANT, providerId: SAML, enforced: true, ...over },
})

/** What the engine returns when no in-pool designation protects the org. */
const noInPoolProtection = { lockout: { retainedBy: [] as string[] } }

/** A verdict from the shared per-uid predicate. */
const qualifies = { owner: { uid: TARGET, email: 'a@b.c', providers: ['password'] }, unavailable: false }
const doesNotQualify = { owner: null, unavailable: false }
const couldNotCheck = { owner: null, unavailable: true }

let errorLog: jest.SpyInstance

beforeEach(() => {
  mockEnforceSweep.mockReset()
  mockQualifiesAsOwner.mockReset()
  // The refusals log; swallowing it keeps the run readable without hiding
  // that they happen — the assertions below are what prove they did.
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => errorLog.mockRestore())

describe('an ownership transfer that would strand the org', () => {
  it('THE REFUSAL: the new owner signs in through the org’s own IdP', async () => {
    mockEnforceSweep.mockResolvedValue(noInPoolProtection)
    mockQualifiesAsOwner.mockResolvedValue(doesNotQualify)

    expect(
      await assessOwnershipTransferLockout(ORG, TARGET, enforcedOrg()),
    ).toEqual({
      refused: true,
      reason: SSO_TRANSFER_LOCKOUT_REFUSAL,
      verdict: 'would-strand',
    })
  })

  it('THE POSITIVE BESIDE IT: the same org, an owner who qualifies', async () => {
    // Identical to the case above in every fact except the one the control is
    // about. Without this, a guard that refused unconditionally would pass.
    mockEnforceSweep.mockResolvedValue(noInPoolProtection)
    mockQualifiesAsOwner.mockResolvedValue(qualifies)

    expect(
      await assessOwnershipTransferLockout(ORG, TARGET, enforcedOrg()),
    ).toEqual({ refused: false, reason: null, verdict: 'allowed' })
  })

  it('asks about the NEW owner, not the one holding the seat today', async () => {
    // The whole point is the post-transfer state. Asking about the current
    // owner would answer "yes, safe" for every transfer ever made — the
    // control would be inert and would look like it was working.
    mockEnforceSweep.mockResolvedValue(noInPoolProtection)
    mockQualifiesAsOwner.mockResolvedValue(doesNotQualify)

    await assessOwnershipTransferLockout(ORG, TARGET, enforcedOrg())

    expect(mockQualifiesAsOwner).toHaveBeenCalledWith(
      TARGET,
      SAML,
      TENANT,
    )
    expect(mockQualifiesAsOwner).not.toHaveBeenCalledWith(
      CURRENT_OWNER,
      expect.anything(),
      expect.anything(),
    )
  })

  it('rehearses WITHOUT writing — dry run, and forced past the flag', async () => {
    // A check that swept the pool as a side effect of asking whether a
    // transfer is safe would be the worst possible bug in this file.
    mockEnforceSweep.mockResolvedValue(noInPoolProtection)
    mockQualifiesAsOwner.mockResolvedValue(qualifies)

    await assessOwnershipTransferLockout(ORG, TARGET, enforcedOrg())

    expect(mockEnforceSweep).toHaveBeenCalledWith(ORG, {
      dryRun: true,
      force: true,
    })
  })
})

describe('when the transfer endangers nobody', () => {
  it('an org with no SSO at all is not checked', async () => {
    expect(
      await assessOwnershipTransferLockout(ORG, TARGET, {
        ownerUid: CURRENT_OWNER,
      }),
    ).toEqual({ refused: false, reason: null, verdict: 'allowed' })
    // Asserted at ZERO rather than merely "allowed": the overwhelming
    // majority of transfers are these, and making each one sweep a pool it
    // does not have would be a real cost for no protection.
    expect(mockEnforceSweep).not.toHaveBeenCalled()
    expect(mockQualifiesAsOwner).not.toHaveBeenCalled()
  })

  it('SSO live but NOT enforced is not checked either', async () => {
    // The accounts in the pool still hold their own credentials, and
    // enforcement's own pre-flight runs before any of them is stripped.
    expect(
      await assessOwnershipTransferLockout(
        ORG,
        TARGET,
        enforcedOrg({ enforced: false }),
      ),
    ).toEqual({ refused: false, reason: null, verdict: 'allowed' })
    expect(mockEnforceSweep).not.toHaveBeenCalled()
  })

  it('an absent org document does not invent a second refusal', async () => {
    // `transferOrgOwnership` throws "Unknown org" in its own transaction.
    // Reporting it here too would just say it twice, in a worse voice.
    expect(
      await assessOwnershipTransferLockout(ORG, TARGET, undefined),
    ).toEqual({ refused: false, reason: null, verdict: 'allowed' })
  })

  it('an in-pool break-glass designation survives the transfer', async () => {
    // `retainedBy` protection belongs to `sso.breakGlassUids` — org state, not
    // owner state — so this transfer cannot take it away. Refusing here would
    // block a legacy-pool org from a transfer that endangers nothing.
    mockEnforceSweep.mockResolvedValue({
      lockout: { retainedBy: ['legacy-account-uid'] },
    })

    expect(
      await assessOwnershipTransferLockout(ORG, TARGET, enforcedOrg()),
    ).toEqual({ refused: false, reason: null, verdict: 'allowed' })
    // And the candidate is never even consulted, which is what proves the
    // short circuit is the reason rather than a coincidence.
    expect(mockQualifiesAsOwner).not.toHaveBeenCalled()
  })
})

describe('failing closed', () => {
  it('refuses — and says it could not CHECK — when the candidate lookup is unavailable', async () => {
    // The distinction that matters. An outage is not a finding about the org;
    // telling them "your new owner would strand you" on the strength of a
    // failed Auth call is a false accusation, and telling them nothing is a
    // silent lockout. Both refuse; only one of them is a claim.
    mockEnforceSweep.mockResolvedValue(noInPoolProtection)
    mockQualifiesAsOwner.mockResolvedValue(couldNotCheck)

    expect(
      await assessOwnershipTransferLockout(ORG, TARGET, enforcedOrg()),
    ).toEqual({
      refused: true,
      reason: SSO_TRANSFER_LOCKOUT_UNKNOWN,
      verdict: 'could-not-check',
    })
  })

  it('refuses when the rehearsal itself throws', async () => {
    mockEnforceSweep.mockRejectedValue(new Error('firestore down'))

    expect(
      await assessOwnershipTransferLockout(ORG, TARGET, enforcedOrg()),
    ).toMatchObject({ refused: true, verdict: 'could-not-check' })
    // The throw must not be swallowed into a measured "safe".
    expect(mockQualifiesAsOwner).not.toHaveBeenCalled()
  })

  it('refuses when enforcement is on but the SSO config is incomplete', async () => {
    // Not reachable through the product's own routes. It is reachable by a
    // hand edit, a partial write, or a converter default — and the answer to
    // "which pool does this org enforce" being unknown is not a reason to
    // allow the seat to move.
    for (const broken of [
      enforcedOrg({ tenantId: undefined }),
      enforcedOrg({ providerId: undefined }),
    ]) {
      expect(
        await assessOwnershipTransferLockout(ORG, TARGET, broken),
      ).toMatchObject({ refused: true, verdict: 'could-not-check' })
    }
    expect(mockEnforceSweep).not.toHaveBeenCalled()
  })
})
