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
 * The policy is a DOMAIN rule, not a staff rule, and it is CONFIGURATION
 * rather than a compiled-in constant (AGL-1993). The cases here are chosen so
 * that two simpler, wrong policies fail them:
 *
 *  - "staff must use SSO" — fails the break-glass and customer-tenant cases.
 *  - "aglyn.com is hardcoded" — fails the self-host case.
 *
 * Every assertion targets the string `verdict`, never a narrowed union arm:
 * `strictNullChecks` is off repo-wide, so a boolean discriminant would let a
 * spec read the wrong arm and pass green on nothing.
 */

import {
  domainOf,
  evaluateSsoDomainPolicy,
  parseSsoRequiredDomains,
  ssoDomainEnforcementEnabled,
  ssoDomainRefusal,
  ssoRequiredDomains,
  SSO_DOMAIN_ENFORCEMENT_ENV,
  SSO_REQUIRED_DOMAINS_ENV,
} from './sso-domain-policy'

const DESIGNATED = 'aglyn-org-y5v14'
const CUSTOMER_TENANT = 'customer-co-8x21p'

/** How Aglyn's own deployment is configured. */
const AGLYN_OPERATED = { 'aglyn.com': DESIGNATED }
/** A fresh self-host install: nothing configured. */
const SELF_HOSTED = {}

/** Env for the Aglyn-operated deployment with the switch ON. */
const AGLYN_ON = {
  [SSO_REQUIRED_DOMAINS_ENV]: `aglyn.com=${DESIGNATED}`,
  [SSO_DOMAIN_ENFORCEMENT_ENV]: 'on',
}
/** Same deployment, switch OFF — how it ships. */
const AGLYN_OFF = { [SSO_REQUIRED_DOMAINS_ENV]: `aglyn.com=${DESIGNATED}` }
/** A self-hoster who turned enforcement on but configured no domains. */
const SELF_HOST_ON = { [SSO_DOMAIN_ENFORCEMENT_ENV]: 'on' }

describe('the five identities that must stay valid', () => {
  it('1. @aglyn.com through the designated tenant is allowed', () => {
    const decision = evaluateSsoDomainPolicy(
      { email: 'zach@aglyn.com', tenantId: DESIGNATED },
      AGLYN_OPERATED,
    )
    expect(decision.verdict).toBe('allow-designated-tenant')
    expect(decision.refused).toBe(false)
  })

  it('2. the permanent break-glass — a personal address, project pool — is allowed', () => {
    const decision = evaluateSsoDomainPolicy(
      { email: 'zachary.w.gover@gmail.com', tenantId: null },
      AGLYN_OPERATED,
    )
    expect(decision.verdict).toBe('allow-ungoverned')
    expect(decision.refused).toBe(false)
  })

  it('3. an ordinary customer in the project pool is allowed', () => {
    const decision = evaluateSsoDomainPolicy(
      { email: 'someone@example.com', tenantId: null },
      AGLYN_OPERATED,
    )
    expect(decision.verdict).toBe('allow-ungoverned')
    expect(decision.refused).toBe(false)
  })

  it('4. an SSO identity in a CUSTOMER org tenant is allowed', () => {
    const decision = evaluateSsoDomainPolicy(
      { email: 'staffer@customer-co.example', tenantId: CUSTOMER_TENANT },
      AGLYN_OPERATED,
    )
    expect(decision.verdict).toBe('allow-ungoverned')
    expect(decision.refused).toBe(false)
  })

  it('5. @aglyn.com with NO tenant is the one refusal', () => {
    const decision = evaluateSsoDomainPolicy(
      { email: 'zachary.gover@aglyn.com', tenantId: null },
      AGLYN_OPERATED,
    )
    expect(decision.verdict).toBe('refuse-sso-required')
    expect(decision.refused).toBe(true)
    expect(decision.requiredTenantId).toBe(DESIGNATED)
  })
})

describe('self-hosting — the rule is policy, not a hardcoded assumption', () => {
  /**
   * The case an open-source reviewer looks for first. Identical identity,
   * identical enforcement switch; only the operator's configuration differs.
   */
  const identity = { email: 'zachary.gover@aglyn.com', tenantId: null }

  it('a self-host install (no configured domains) governs nothing', () => {
    const decision = evaluateSsoDomainPolicy(identity, SELF_HOSTED)
    expect(decision.verdict).toBe('allow-ungoverned')
    expect(decision.refused).toBe(false)
  })

  it('a self-host install admits it even with enforcement ON', () => {
    expect(ssoDomainRefusal(identity, SELF_HOST_ON)).toBeNull()
  })

  it("Aglyn's own configuration refuses the same identity, ON", () => {
    // The paired positive control: the difference is configuration alone.
    expect(ssoDomainRefusal(identity, AGLYN_ON)).not.toBeNull()
  })

  it('the default configuration is empty', () => {
    expect(ssoRequiredDomains({})).toEqual({})
    expect(ssoRequiredDomains({ [SSO_REQUIRED_DOMAINS_ENV]: '' })).toEqual({})
  })

  it('a self-hoster can govern their OWN domain and tenant', () => {
    const decision = evaluateSsoDomainPolicy(
      { email: 'admin@acme.test', tenantId: null },
      parseSsoRequiredDomains('acme.test=acme-tenant-1'),
    )
    expect(decision.verdict).toBe('refuse-sso-required')
    expect(decision.requiredTenantId).toBe('acme-tenant-1')
  })

  it('a malformed configuration governs nothing rather than throwing', () => {
    // Sits on the authentication path: a bad env var must not take sign-in
    // down, and failing OPEN is the safe direction for a rule that only ever
    // refuses.
    for (const raw of ['garbage', '=', 'aglyn.com=', '=tenant', 'a=b=c']) {
      expect(() => parseSsoRequiredDomains(raw)).not.toThrow()
    }
    expect(parseSsoRequiredDomains('garbage')).toEqual({})
    expect(parseSsoRequiredDomains('aglyn.com=')).toEqual({})
  })

  it('parses multiple domains, comma or whitespace separated', () => {
    expect(parseSsoRequiredDomains('a.test=t1, b.test=t2')).toEqual({
      'a.test': 't1',
      'b.test': 't2',
    })
    expect(parseSsoRequiredDomains('A.TEST=t1')).toEqual({ 'a.test': 't1' })
  })
})

describe('the policy never reads the staff claim', () => {
  /**
   * The positive control against this becoming a staff-wide SSO mandate. If
   * someone threads `staff` into the predicate, the permutation whose verdict
   * moves is the one that fails here.
   */
  const identities = [
    { email: 'zach@aglyn.com', tenantId: DESIGNATED },
    { email: 'zachary.w.gover@gmail.com', tenantId: null },
    { email: 'someone@example.com', tenantId: null },
    { email: 'staffer@customer-co.example', tenantId: CUSTOMER_TENANT },
    { email: 'zachary.gover@aglyn.com', tenantId: null },
  ]

  it.each(identities)('verdict for %o ignores every staff permutation', (identity) => {
    const base = evaluateSsoDomainPolicy(identity, AGLYN_OPERATED)
    for (const extra of [
      { staff: true, staffRole: 'super' },
      { staff: true, staffRole: 'support' },
      { staff: false },
      {},
    ]) {
      const withClaims = evaluateSsoDomainPolicy(
        { ...identity, ...extra } as typeof identity,
        AGLYN_OPERATED,
      )
      expect(withClaims.verdict).toBe(base.verdict)
      expect(withClaims.refused).toBe(base.refused)
    }
  })

  it('a super-staff identity outside the governed domains is never refused, ON', () => {
    // Referenced by PROPERTY — an identity whose domain is not governed — not
    // by literal address, so the guard survives the break-glass account
    // changing address. This is what stops a future "staff must use SSO"
    // widening from removing the only recovery path.
    expect(
      ssoDomainRefusal({ email: 'break-glass@personal.example', tenantId: null }, AGLYN_ON),
    ).toBeNull()
    expect(
      ssoDomainRefusal({ email: 'zachary.w.gover@gmail.com', tenantId: null }, AGLYN_ON),
    ).toBeNull()
  })
})

describe('the enforcement switch', () => {
  it('ships OFF — an unset env does not enforce', () => {
    expect(ssoDomainEnforcementEnabled({})).toBe(false)
  })

  it.each(['', 'off', 'false', '0', 'ON', 'On', 'true', 'yes'])(
    'does not switch on for %p',
    (value) => {
      expect(
        ssoDomainEnforcementEnabled({ [SSO_DOMAIN_ENFORCEMENT_ENV]: value }),
      ).toBe(false)
    },
  )

  it('switches on only for the exact string "on"', () => {
    expect(ssoDomainEnforcementEnabled(AGLYN_ON)).toBe(true)
  })

  it('OFF: the refusal is still computed but nobody is turned away', () => {
    const identity = { email: 'zachary.gover@aglyn.com', tenantId: null }
    expect(evaluateSsoDomainPolicy(identity, AGLYN_OPERATED).refused).toBe(true)
    expect(ssoDomainRefusal(identity, AGLYN_OFF)).toBeNull()
  })

  it('ON: refuses the project-pool @aglyn.com identity with a 403', async () => {
    const refusal = ssoDomainRefusal(
      { email: 'zachary.gover@aglyn.com', tenantId: null },
      AGLYN_ON,
    )
    expect(refusal).not.toBeNull()
    expect(refusal?.response.status).toBe(403)
    const body = await refusal?.response.json()
    expect(body.reason).toBe('sso-domain-required')
  })

  it('ON: admits the SAME address once it is in the designated tenant', () => {
    // Positive control for the refusal above — proves the switch keys on the
    // POOL, not the address, so migrating the account is a real fix.
    expect(
      ssoDomainRefusal(
        { email: 'zachary.gover@aglyn.com', tenantId: DESIGNATED },
        AGLYN_ON,
      ),
    ).toBeNull()
  })

  it('ON: admits a customer-tenant SSO identity', () => {
    expect(
      ssoDomainRefusal(
        { email: 'staffer@customer-co.example', tenantId: CUSTOMER_TENANT },
        AGLYN_ON,
      ),
    ).toBeNull()
  })
})

describe('domain parsing', () => {
  it.each([
    ['zach@aglyn.com', 'aglyn.com'],
    ['  ZACH@AGLYN.COM  ', 'aglyn.com'],
    ['zach+e2e-smoke@aglyn.com', 'aglyn.com'],
  ])('%p resolves to %p', (email, expected) => {
    expect(domainOf(email)).toBe(expected)
  })

  it.each([null, undefined, '', 'no-at-sign', 'trailing@'])(
    '%p has no domain and is therefore ungoverned',
    (email) => {
      expect(domainOf(email as string)).toBeNull()
      expect(
        evaluateSsoDomainPolicy({ email: email as string }, AGLYN_OPERATED)
          .verdict,
      ).toBe('allow-ungoverned')
    },
  )

  it('a look-alike domain is NOT governed', () => {
    // `notaglyn.com` ends with `aglyn.com`. A suffix test instead of an exact
    // match would refuse an unrelated company.
    expect(
      evaluateSsoDomainPolicy(
        { email: 'someone@notaglyn.com', tenantId: null },
        AGLYN_OPERATED,
      ).verdict,
    ).toBe('allow-ungoverned')
  })

  it('a subdomain is NOT governed unless listed', () => {
    expect(
      evaluateSsoDomainPolicy(
        { email: 'bot@mail.aglyn.com', tenantId: null },
        AGLYN_OPERATED,
      ).verdict,
    ).toBe('allow-ungoverned')
  })

  it('a prototype-polluting domain key does not match', () => {
    // `domains['constructor']` is truthy on a bare object literal; a plain
    // lookup would govern anyone at `constructor` with a junk tenant id.
    expect(
      evaluateSsoDomainPolicy(
        { email: 'someone@constructor', tenantId: null },
        AGLYN_OPERATED,
      ).verdict,
    ).toBe('allow-ungoverned')
  })
})

describe('foreign-tenant visibility', () => {
  it('flags an @aglyn.com identity in a tenant Aglyn does not control', () => {
    const decision = evaluateSsoDomainPolicy(
      { email: 'zach@aglyn.com', tenantId: CUSTOMER_TENANT },
      AGLYN_OPERATED,
    )
    // Allowed — they DID use SSO — but surfaced, because the IdP governing
    // that identity belongs to the customer, not to Aglyn.
    expect(decision.verdict).toBe('allow-foreign-tenant')
    expect(decision.refused).toBe(false)
    expect(decision.reviewable).toBe(true)
  })

  it('is not refused even with enforcement ON', () => {
    expect(
      ssoDomainRefusal(
        { email: 'zach@aglyn.com', tenantId: CUSTOMER_TENANT },
        AGLYN_ON,
      ),
    ).toBeNull()
  })
})
