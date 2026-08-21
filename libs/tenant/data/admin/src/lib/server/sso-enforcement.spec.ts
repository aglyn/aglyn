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

import type { UserRecord } from 'firebase-admin/auth'
import { assessSsoLockoutRisk, planAccount } from './sso-enforcement'

/**
 * AGL-1129. `planAccount` is the whole decision — the sweep around it only
 * carries it out — so the failure modes worth pinning are the ones that
 * cannot be undone: orphaning an account, or leaving a bypass in place.
 *
 * The tenant this ships against has exactly one account with exactly one
 * provider, so a live run proves nothing about any of these.
 */
const user = (uid: string, providers: string[]): UserRecord =>
  ({
    uid,
    email: `${uid}@aglyn.com`,
    providerData: providers.map((providerId) => ({ providerId })),
  }) as UserRecord

const SAML = 'saml.aglyn-workspace'

describe('planAccount', () => {
  it('removes a social provider and keeps the org IdP', () => {
    const plan = planAccount(user('u1', [SAML, 'google.com']), SAML)
    expect(plan).toMatchObject({ unlinked: ['google.com'], kept: [SAML] })
    expect(plan.skipped).toBeUndefined()
  })

  it('removes a password credential too', () => {
    // A standing email/password credential on a governed account is exactly
    // the bypass enforcement is bought to close — it is not the org's IdP.
    expect(planAccount(user('u2', [SAML, 'password']), SAML).unlinked).toEqual([
      'password',
    ])
  })

  it('NEVER unlinks an account down to zero providers', () => {
    // The unrecoverable one. An account whose only provider is removable is
    // misconfigured, not a bypass to close: stripping it leaves an account
    // nobody — not even the IdP — can reach.
    const plan = planAccount(user('u3', ['google.com']), SAML)
    expect(plan.unlinked).toEqual([])
    expect(plan.skipped).toBe('would-orphan')
    expect(plan.kept).toEqual(['google.com'])
  })

  it('reports an account that is already clean as no change', () => {
    // Idempotence: the second run of a sweep must be a no-op, or it fires a
    // second round of token revocations at people who are already compliant.
    const plan = planAccount(user('u4', [SAML]), SAML)
    expect(plan.unlinked).toEqual([])
    expect(plan.skipped).toBeUndefined()
  })

  it('strips every non-IdP provider, not just the first', () => {
    expect(
      planAccount(user('u5', ['google.com', SAML, 'password']), SAML).unlinked,
    ).toEqual(['google.com', 'password'])
  })

  it('leaves an account with no providers at all alone', () => {
    const plan = planAccount(user('u6', []), SAML)
    expect(plan.unlinked).toEqual([])
    expect(plan.skipped).toBeUndefined()
  })

  it('keys off the org’s OWN provider id, not the saml. prefix', () => {
    // Two SAML providers can exist in one tenant. Only the org's configured
    // one is the sanctioned way in; treating any `saml.*` as sanctioned
    // would leave a second IdP as a bypass.
    const plan = planAccount(user('u7', [SAML, 'saml.other-idp']), SAML)
    expect(plan.unlinked).toEqual(['saml.other-idp'])
    expect(plan.kept).toEqual([SAML])
  })
})

/**
 * AGL-1888 — the org-level failure property 1 is blind to.
 *
 * `planAccount`'s orphan rule protects ONE ACCOUNT AT A TIME: it refuses to
 * strip an account down to zero providers. It says nothing about the state
 * enforcement is designed to produce, which is every account holding exactly
 * one provider — the org's SAML link. That pool is perfectly consistent right
 * up until the IdP stops answering, and then nobody can sign in and we cannot
 * let them back in either.
 *
 * That is not hypothetical. `zach@aglyn.com` is in it now: present only in
 * GCIP tenant `aglyn-org-y5v14`, `auth/user-not-found` at project level, no
 * password. A lapsed certificate or a deleted SAML app reaches the same place
 * from any org, which is why this is a control and not a one-off repair.
 *
 * The break-glass account is a STANDING BYPASS of SSO enforcement and is meant
 * to be — that is what makes it a way back in. What these pin is that it only
 * counts when it is real: designated on purpose, present, and holding
 * something other than the IdP.
 */
describe('break-glass accounts', () => {
  const glass = (...uids: string[]) => new Set(uids)

  it('keeps every sign-in method on a designated account', () => {
    const plan = planAccount(user('u1', [SAML, 'password']), SAML, glass('u1'))
    expect(plan.unlinked).toEqual([])
    expect(plan.kept).toEqual([SAML, 'password'])
    expect(plan.skipped).toBe('break-glass')
  })

  it('strips a NON-designated account as before', () => {
    // The designation is per-uid. A sweep that spared everybody once one
    // account was designated would quietly stop enforcing at all.
    const plan = planAccount(user('u2', [SAML, 'password']), SAML, glass('u1'))
    expect(plan.unlinked).toEqual(['password'])
    expect(plan.skipped).toBeUndefined()
  })

  it('does not mark a designated account that had nothing to strip', () => {
    // `skipped` records a DECISION. Marking an account that was already clean
    // would make a converged re-run look like it spared something.
    const plan = planAccount(user('u3', [SAML]), SAML, glass('u3'))
    expect(plan.skipped).toBeUndefined()
    expect(plan.unlinked).toEqual([])
  })

  it('leaves the orphan rule in charge when an account is both', () => {
    // An account with no IdP link at all is `would-orphan`, designated or not.
    // Both branches keep every provider, so the outcome is identical and only
    // the REASON differs — but the reason is what the assessment reads.
    const plan = planAccount(user('u4', ['password']), SAML, glass('u4'))
    expect(plan.skipped).toBe('would-orphan')
    expect(plan.kept).toEqual(['password'])
  })
})

describe('assessSsoLockoutRisk', () => {
  const planned = (records: UserRecord[], breakGlass: string[]) =>
    records.map((record) => planAccount(record, SAML, new Set(breakGlass)))

  it('is UNSAFE when every account keeps only the IdP', () => {
    // The `zach@aglyn.com` shape, and the default outcome of enforcing without
    // designating anybody.
    const accounts = planned([user('u1', [SAML]), user('u2', [SAML])], [])
    expect(assessSsoLockoutRisk(accounts, SAML, [])).toEqual({
      safe: false,
      retainedBy: [],
      ineffective: [],
    })
  })

  it('is SAFE when a designated account keeps a password', () => {
    const accounts = planned([user('u1', [SAML, 'password']), user('u2', [SAML])], ['u1'])
    expect(assessSsoLockoutRisk(accounts, SAML, ['u1'])).toEqual({
      safe: true,
      retainedBy: ['u1'],
      ineffective: [],
    })
  })

  it('THE TRAP: designating an account that holds only the IdP protects nobody', () => {
    // The most natural way to get this wrong. It looks exactly like a
    // break-glass account and provides nothing, because it fails in precisely
    // the situation it exists for — the IdP being unavailable.
    const accounts = planned([user('u1', [SAML])], ['u1'])
    const verdict = assessSsoLockoutRisk(accounts, SAML, ['u1'])
    expect(verdict.safe).toBe(false)
    expect(verdict.ineffective).toEqual(['u1'])
  })

  it('names a designated uid that is not in the pool at all', () => {
    // A typo, or an account deleted from the tenant since. Reported rather
    // than ignored: a designation that protects nothing is worse than none,
    // because it reads as protection.
    const accounts = planned([user('u1', [SAML])], ['ghost'])
    const verdict = assessSsoLockoutRisk(accounts, SAML, ['ghost'])
    expect(verdict.safe).toBe(false)
    expect(verdict.ineffective).toEqual(['ghost'])
  })

  it('does NOT count an undesignated account that happens to keep a password', () => {
    // A `would-orphan` account retains a password, so it is a way into the
    // pool — but nobody chose it. It may be a stale record or a service
    // account, and an org protected by an accident it does not know about is
    // not protected. Requiring the designation is what makes this a control
    // rather than a coincidence.
    const accounts = planned([user('u1', [SAML]), user('stale', ['password'])], [])
    expect(accounts[1].skipped).toBe('would-orphan')
    expect(assessSsoLockoutRisk(accounts, SAML, []).safe).toBe(false)
  })

  it('does not let a BYSTANDER account rescue an ineffective designation', () => {
    // ADDED BECAUSE A MUTATION SURVIVED WITHOUT IT. Rewriting the per-uid
    // check as "does ANY account keep a non-IdP provider" passed every other
    // case here, and this is the shape where the two answers diverge: a
    // designation that protects nothing, plus an undesignated leftover that
    // happens to hold a password.
    //
    // The loose version calls that org SAFE and attributes the protection to
    // the designated account, which is precisely the false assurance this
    // assessment exists to prevent — the org believes it has a spare key held
    // by a named person, and the only real one is a stale record nobody knows
    // about or can sign in as.
    const accounts = planned(
      [user('owner', [SAML]), user('stale', ['password'])],
      ['owner'],
    )
    expect(accounts[1].skipped).toBe('would-orphan')
    expect(accounts[1].kept).toEqual(['password'])
    expect(assessSsoLockoutRisk(accounts, SAML, ['owner'])).toEqual({
      safe: false,
      retainedBy: [],
      ineffective: ['owner'],
    })
  })

  it('counts a designated orphan, because it is both chosen and reachable', () => {
    // Same account as above, now named by the org. The designation is the
    // whole difference.
    const accounts = planned([user('u1', [SAML]), user('spare', ['password'])], ['spare'])
    expect(assessSsoLockoutRisk(accounts, SAML, ['spare'])).toMatchObject({
      safe: true,
      retainedBy: ['spare'],
    })
  })

  it('ignores duplicate and blank designations', () => {
    const accounts = planned([user('u1', [SAML, 'password'])], ['u1'])
    expect(
      assessSsoLockoutRisk(accounts, SAML, ['u1', 'u1', '']),
    ).toMatchObject({ safe: true, retainedBy: ['u1'] })
  })

  it('is unsafe for an empty pool', () => {
    // Nothing to protect and nothing protecting it. Answering "safe" for the
    // degenerate case is how a guard gets skipped on the path that matters.
    expect(assessSsoLockoutRisk([], SAML, ['u1']).safe).toBe(false)
  })
})
