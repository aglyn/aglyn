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
 * AGL-2486 — the address policy, and the one refusal that is a security
 * control rather than a usability nicety.
 *
 * The primary IS the Firebase Auth record's email, so it is the string
 * `decoded.email` carries, so it is what `evaluateSsoDomainPolicy` reads at
 * the session mint. Re-designating the primary therefore CHANGES an
 * authorization input — which is the one genuinely dangerous write this
 * feature adds, and `sso-governed-escape` is what stops it.
 */

import {
  ACCOUNT_EMAIL_PATTERN,
  MAX_ACCOUNT_EMAILS,
  canRemoveAccountEmail,
  evaluatePrimaryChange,
  normalizeAccountEmail,
  type AccountEmail,
} from './account-emails'

const verified = (address: string, primary = false): AccountEmail => ({
  address,
  verified: true,
  primary,
})

/** aglyn.com must sign in through the Workspace SAML tenant. */
const GOVERNED = { 'aglyn.com': 'aglyn-staff-tenant' }

describe('normalizeAccountEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeAccountEmail('  Ada@Acme.TEST ')).toBe('ada@acme.test')
  })

  it('rejects what it cannot store', () => {
    for (const bad of [
      '',
      'not-an-email',
      'ada@',
      '@acme.test',
      'ada@acme',
      'a'.repeat(250) + '@acme.test',
      null,
      undefined,
    ]) {
      expect(normalizeAccountEmail(bad)).toBeNull()
    }
  })

  it('rejects every string a Firestore document id may not be', () => {
    // The normalized address is used verbatim as a document id in BOTH
    // `users/{uid}/emails/{address}` and `emailIdentityIndex/{address}`, so
    // this is not pedantry — a slash would make the write land in a
    // subcollection, and `.`/`..`/`__x__` are rejected outright by Firestore.
    expect(normalizeAccountEmail('a/b@acme.test')).toBeNull()
    expect(normalizeAccountEmail('.ada@acme.test')).toBeNull()
    expect(normalizeAccountEmail('ada.@acme.test')).toBeNull()
    expect(normalizeAccountEmail('ada..lovelace@acme.test')).toBeNull()
    expect(normalizeAccountEmail('.')).toBeNull()
    expect(normalizeAccountEmail('..')).toBeNull()
    expect(normalizeAccountEmail('__proto__')).toBeNull()
    // And the pattern can never match a reserved id, because it demands an @.
    expect(ACCOUNT_EMAIL_PATTERN.test('__anything__')).toBe(false)
  })

  it('keeps plus-addressing and dots, which are DIFFERENT mailboxes', () => {
    // Collapsing these would refuse an address the user legitimately owns at
    // every provider that is not Gmail.
    expect(normalizeAccountEmail('ada+work@acme.test')).toBe('ada+work@acme.test')
    expect(normalizeAccountEmail('ada.lovelace@acme.test')).toBe('ada.lovelace@acme.test')
  })
})

describe('evaluatePrimaryChange: the ordinary rules', () => {
  it('refuses an address that is not on the account', () => {
    expect(
      evaluatePrimaryChange({
        current: verified('ada@personal.test', true),
        next: null,
        requiredDomains: {},
        tenantId: null,
        enforcementEnabled: false,
      }).verdict,
    ).toBe('unknown-address')
  })

  it('refuses an UNVERIFIED address — the round-trip is the whole proof', () => {
    expect(
      evaluatePrimaryChange({
        current: verified('ada@personal.test', true),
        next: { address: 'ada@acme.test', verified: false, primary: false },
        requiredDomains: {},
        tenantId: null,
        enforcementEnabled: false,
      }).verdict,
    ).toBe('unverified')
  })

  it('allows an ordinary swap between two ungoverned addresses', () => {
    const decision = evaluatePrimaryChange({
      current: verified('ada@personal.test', true),
      next: verified('ada@acme.test'),
      requiredDomains: GOVERNED,
      tenantId: null,
      enforcementEnabled: true,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.verdict).toBe('ok')
  })
})

describe('THE ESCAPE: a governed primary cannot be demoted', () => {
  /**
   * The attack, concretely. `staff@aglyn.com` is required to sign in through
   * the Workspace SAML tenant — that is what `ssoRequiredDomains` says, and
   * the session mint enforces it by reading `decoded.email`.
   *
   * Add `staff@personal.test`, confirm it, promote it, and `decoded.email` is
   * now an ungoverned address. `evaluateSsoDomainPolicy` returns
   * `allow-ungoverned` and the account is outside Workspace MFA and
   * offboarding for good — with no IdP involved, and nothing in the org's
   * control plane recording that anything happened.
   */
  it('refuses moving the primary off a governed domain', () => {
    const decision = evaluatePrimaryChange({
      current: verified('staff@aglyn.com', true),
      next: verified('staff@personal.test'),
      requiredDomains: GOVERNED,
      tenantId: 'aglyn-staff-tenant',
      enforcementEnabled: true,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.verdict).toBe('sso-governed-escape')
  })

  it('refuses EVEN WITH THE ENFORCEMENT SWITCH OFF', () => {
    // The switch exists so an inert period can build an audit trail before
    // the rule turns anyone away. That reasoning does not transfer to a
    // PERSISTENT change: promote the personal address while the switch is
    // off and, when the switch is later flipped, the account is simply not
    // on a governed domain any more. The escape would already have happened,
    // and the audit trail would record nothing, because from the policy's
    // point of view there is no longer anything to record.
    const decision = evaluatePrimaryChange({
      current: verified('staff@aglyn.com', true),
      next: verified('staff@personal.test'),
      requiredDomains: GOVERNED,
      tenantId: 'aglyn-staff-tenant',
      enforcementEnabled: false,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.verdict).toBe('sso-governed-escape')
  })

  it('allows a swap between two domains governed by the SAME tenant', () => {
    // The rule compares the REQUIREMENT, not the domain. Moving inside one
    // org's governed set changes nothing about who governs the account, and
    // refusing it would be the policy misfiring on its own customers.
    const decision = evaluatePrimaryChange({
      current: verified('staff@aglyn.com', true),
      next: verified('zach@aglyn.dev'),
      requiredDomains: { 'aglyn.com': 'tenant-a', 'aglyn.dev': 'tenant-a' },
      tenantId: 'tenant-a',
      enforcementEnabled: true,
    })
    expect(decision.allowed).toBe(true)
  })

  it('is INERT where no domains are configured — every self-host install', () => {
    // `requiredDomains` empty is the default everywhere, and a security
    // control that fired on an unconfigured deployment would lock self-host
    // users out of their own settings page.
    const decision = evaluatePrimaryChange({
      current: verified('staff@aglyn.com', true),
      next: verified('staff@personal.test'),
      requiredDomains: {},
      tenantId: null,
      enforcementEnabled: true,
    })
    expect(decision.allowed).toBe(true)
  })

  it('does not fire on a SUFFIX match', () => {
    // `notaglyn.com` ends with `aglyn.com`. A suffix test here would govern
    // an unrelated company's staff — the same trap `sso-domain-policy`
    // documents at its own lookup.
    const decision = evaluatePrimaryChange({
      current: verified('someone@notaglyn.com', true),
      next: verified('someone@personal.test'),
      requiredDomains: GOVERNED,
      tenantId: null,
      enforcementEnabled: true,
    })
    expect(decision.allowed).toBe(true)
  })
})

describe('THE LOCKOUT: promoting onto a governed domain you cannot satisfy', () => {
  it('refuses when the account is not in the required tenant', () => {
    const decision = evaluatePrimaryChange({
      current: verified('ada@personal.test', true),
      next: verified('ada@aglyn.com'),
      requiredDomains: GOVERNED,
      tenantId: null,
      enforcementEnabled: true,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.verdict).toBe('sso-governed-lockout')
  })

  it('allows it when the account DID sign in through that tenant', () => {
    const decision = evaluatePrimaryChange({
      current: verified('ada@personal.test', true),
      next: verified('ada@aglyn.com'),
      requiredDomains: GOVERNED,
      tenantId: 'aglyn-staff-tenant',
      enforcementEnabled: true,
    })
    expect(decision.allowed).toBe(true)
  })

  it('is gated on the switch — with it off, nobody is locked out', () => {
    const decision = evaluatePrimaryChange({
      current: verified('ada@personal.test', true),
      next: verified('ada@aglyn.com'),
      requiredDomains: GOVERNED,
      tenantId: null,
      enforcementEnabled: false,
    })
    expect(decision.allowed).toBe(true)
  })
})

describe('canRemoveAccountEmail', () => {
  it('refuses the primary', () => {
    const emails = [verified('ada@acme.test', true), verified('ada@personal.test')]
    expect(canRemoveAccountEmail('ada@acme.test', emails).allowed).toBe(false)
  })

  it('refuses the LAST verified address', () => {
    // An account with no verified address cannot receive a password reset,
    // which is an account nobody can recover.
    const emails = [
      verified('ada@acme.test', true),
      { address: 'ada@personal.test', verified: false, primary: false },
    ]
    expect(canRemoveAccountEmail('ada@personal.test', emails).allowed).toBe(true)
    // ...and the verified one is refused for BOTH reasons; primary wins.
    expect(canRemoveAccountEmail('ada@acme.test', emails).allowed).toBe(false)
  })

  it('allows removing a spare verified address', () => {
    const emails = [verified('ada@acme.test', true), verified('ada@personal.test')]
    expect(canRemoveAccountEmail('ada@personal.test', emails).allowed).toBe(true)
  })

  it('refuses an address that is not on the account', () => {
    expect(canRemoveAccountEmail('nobody@acme.test', []).allowed).toBe(false)
  })
})

describe('the cap', () => {
  it('is a real number the add path can count against', () => {
    // `users/{uid}/emails` is a new subcollection, and this repo has a
    // recorded hole from shipping one with no ceiling (AGL-2266).
    expect(MAX_ACCOUNT_EMAILS).toBeGreaterThan(1)
    expect(MAX_ACCOUNT_EMAILS).toBeLessThanOrEqual(30)
  })
})
