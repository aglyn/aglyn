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
 * Operator identity as configuration (AGL-2016).
 *
 * Every test here is written in BOTH directions on purpose, and the reason is
 * the failure mode this issue exists to close. A guard that only exercises the
 * default passes on a module that ignores configuration entirely — which is
 * exactly what `ABUSE_REPORT_CONTACT_EMAIL` was, and it had a spec.
 * `abuse-report.spec.ts:214` asserted `toBe('support@aglyn.com')`, went green
 * every run, and pinned the bug.
 *
 * So: a SELF-HOST shape (ours absent, theirs present) must never produce an
 * Aglyn value, an AGLYN-OPERATED shape must still produce ours, and an
 * UNCONFIGURED shape must produce an honest marker rather than a blank. Only
 * the asymmetry proves this reads config; either half alone does not.
 */

import {
  OPERATOR_CONTACT_UNSET,
  operatorContactLine,
  operatorDisplayName,
  operatorDmcaAgent,
  operatorIdentity,
} from './operator-identity'

/** The keys this module reads. Cleared between tests so nothing leaks across. */
const OPERATOR_ENV_KEYS = [
  'NEXT_PUBLIC_OPERATOR_NAME',
  'NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL',
  'NEXT_PUBLIC_OPERATOR_LEGAL_EMAIL',
  'NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN',
  'NEXT_PUBLIC_OPERATOR_DMCA_AGENT_NAME',
  'NEXT_PUBLIC_OPERATOR_DMCA_AGENT_ADDRESS',
  'NEXT_PUBLIC_OPERATOR_DMCA_AGENT_EMAIL',
  'NEXT_PUBLIC_OPERATOR_DMCA_AGENT_PHONE',
  'NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED',
] as const

/**
 * Aglyn's real configuration, as production must set it.
 *
 * Hardcoded here deliberately: this fixture is the assertion that our own
 * deployment still produces our values, so it has to name them. It is also
 * the thing that would have to be edited if someone "simplified" the module
 * back to a literal — and editing it makes the self-host case below fail,
 * which is the point.
 */
const AGLYN_OPERATED = {
  NEXT_PUBLIC_OPERATOR_NAME: 'Aglyn LLC',
  NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'support@aglyn.com',
  NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN: 'https://aglyn.com',
}

/** A plausible self-hoster. Nothing about it resembles ours. */
const SELF_HOSTED = {
  NEXT_PUBLIC_OPERATOR_NAME: 'Bramble Studio GmbH',
  NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'hello@bramble.example',
  NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN: 'https://bramble.example',
}

const applyEnv = (values: Record<string, string>): void => {
  for (const key of OPERATOR_ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(values)) process.env[key] = value
}

describe('operator identity', () => {
  const original = { ...process.env }

  afterEach(() => {
    for (const key of OPERATOR_ENV_KEYS) delete process.env[key]
    for (const [key, value] of Object.entries(original)) {
      if (OPERATOR_ENV_KEYS.includes(key as never)) process.env[key] = value
    }
  })

  describe('SELF-HOST shape — ours absent, theirs present', () => {
    beforeEach(() => applyEnv(SELF_HOSTED))

    it('resolves the operator to the self-hoster', () => {
      const identity = operatorIdentity()
      expect(identity.name).toBe('Bramble Studio GmbH')
      expect(identity.supportEmail).toBe('hello@bramble.example')
      expect(identity.configured).toBe(true)
    })

    it('never renders an Aglyn address anywhere it resolves', () => {
      // The negative half. `toBe('hello@…')` alone would pass on a module
      // that returned a hardcoded self-host value; asserting our address is
      // ABSENT is what proves ours is not being carried alongside.
      const surfaces = [
        operatorIdentity().name,
        operatorIdentity().supportEmail,
        operatorIdentity().legalEmail,
        operatorIdentity().legalOrigin,
        operatorContactLine('support').text,
        operatorContactLine('legal').text,
        operatorDisplayName(),
      ].join(' | ')
      expect(surfaces).not.toContain('aglyn')
      expect(surfaces).not.toContain('Aglyn')
    })

    it('falls the legal address back to support, not to ours', () => {
      // No NEXT_PUBLIC_OPERATOR_LEGAL_EMAIL is set. A missing legal mailbox
      // must become the operator's support mailbox — never a default that
      // reaches out of this deployment.
      expect(operatorContactLine('legal').address).toBe('hello@bramble.example')
    })

    it('honours a separate legal mailbox when one is configured', () => {
      process.env.NEXT_PUBLIC_OPERATOR_LEGAL_EMAIL = 'dmca@bramble.example'
      expect(operatorContactLine('legal').address).toBe('dmca@bramble.example')
      expect(operatorContactLine('support').address).toBe(
        'hello@bramble.example',
      )
    })
  })

  describe('AGLYN-OPERATED shape — our configuration, unchanged behaviour', () => {
    beforeEach(() => applyEnv(AGLYN_OPERATED))

    it('still produces our values', () => {
      expect(operatorIdentity().name).toBe('Aglyn LLC')
      expect(operatorContactLine('support').address).toBe('support@aglyn.com')
      expect(operatorContactLine('legal').address).toBe('support@aglyn.com')
      expect(operatorDisplayName()).toBe('Aglyn LLC')
    })

    it('strips a trailing slash from the legal origin', () => {
      process.env.NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN = 'https://aglyn.com/'
      expect(operatorIdentity().legalOrigin).toBe('https://aglyn.com')
    })
  })

  describe('UNCONFIGURED shape — honest, not blank', () => {
    beforeEach(() => applyEnv({}))

    it('reports itself unconfigured rather than half-identified', () => {
      const identity = operatorIdentity()
      expect(identity.name).toBeNull()
      expect(identity.supportEmail).toBeNull()
      expect(identity.legalEmail).toBeNull()
      expect(identity.configured).toBe(false)
    })

    it('prints a marker that cannot be mistaken for an address', () => {
      const { address, text } = operatorContactLine('support')
      expect(address).toBeNull()
      expect(text).toBe(OPERATOR_CONTACT_UNSET)
      // The failure this replaces: `${null}` interpolates as the four
      // characters `null`, and an empty string renders as a mailto with
      // nothing behind it. Neither may be what a contact slot shows.
      expect(text).not.toBe('')
      expect(text).not.toContain('null')
      expect(text).not.toContain('@')
    })

    it('names nobody rather than naming us', () => {
      expect(operatorDisplayName()).toBe('the operator of this site')
      expect(operatorDisplayName()).not.toContain('Aglyn')
    })

    it('treats a whitespace-only value as absent', () => {
      // The shape a half-finished `.env` actually takes. It satisfies a
      // truthiness check, so an untrimmed read would render `mailto:   `.
      applyEnv({
        NEXT_PUBLIC_OPERATOR_NAME: '   ',
        NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: '\t\n ',
      })
      expect(operatorIdentity().configured).toBe(false)
      expect(operatorContactLine('support').text).toBe(OPERATOR_CONTACT_UNSET)
    })

    it('refuses to call a name-only deployment configured', () => {
      // Half an identity is not an identity: a form that names an operator
      // but offers no way to reach them is not a usable notice channel.
      applyEnv({ NEXT_PUBLIC_OPERATOR_NAME: 'Bramble Studio GmbH' })
      expect(operatorIdentity().configured).toBe(false)
    })
  })

  describe('the DMCA designation is never inferred', () => {
    it('is absent for an operator who has only set a support address', () => {
      // The whole point. Configuring a contact address is not making a
      // Copyright Office filing, and the product must not upgrade one into
      // the other on the operator's behalf.
      applyEnv(SELF_HOSTED)
      expect(operatorDmcaAgent()).toBeNull()
    })

    it('is absent when only half the agent block is configured', () => {
      applyEnv({
        ...SELF_HOSTED,
        NEXT_PUBLIC_OPERATOR_DMCA_AGENT_NAME: 'Legal Department',
      })
      expect(operatorDmcaAgent()).toBeNull()
    })

    it('does not claim registration merely because an agent is named', () => {
      applyEnv({
        ...SELF_HOSTED,
        NEXT_PUBLIC_OPERATOR_DMCA_AGENT_NAME: 'Legal Department',
        NEXT_PUBLIC_OPERATOR_DMCA_AGENT_ADDRESS: '1 Example Way, Berlin',
      })
      const agent = operatorDmcaAgent()
      expect(agent).not.toBeNull()
      expect(agent.name).toBe('Legal Department')
      expect(agent.registered).toBe(false)
    })

    it('claims registration only on an explicit `true`', () => {
      const base = {
        ...AGLYN_OPERATED,
        NEXT_PUBLIC_OPERATOR_DMCA_AGENT_NAME: 'Aglyn LLC, Attn: Legal',
        NEXT_PUBLIC_OPERATOR_DMCA_AGENT_ADDRESS: '5900 Balcones Drive STE 100',
      }
      // Everything a well-meaning `.env` might contain that is NOT consent.
      for (const value of ['1', 'yes', 'TRUE ', 'false', '', 'maybe']) {
        applyEnv({
          ...base,
          NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED: value,
        })
        expect(operatorDmcaAgent().registered).toBe(value === 'TRUE ')
      }
    })
  })
})
