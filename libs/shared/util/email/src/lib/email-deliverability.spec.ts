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

import {
  assessEmailDeliverability,
  decidingDeliverabilityFinding,
  deliverabilityExclusionSummary,
  emailAddressDomain,
  isDisposableEmailDomain,
  isMailDomainIntelFresh,
  isRoleEmailAddress,
  type MailDnsResolver,
  type MailDomainIntel,
  normalizeDeliverabilityEmail,
  readStoredMailDomainIntel,
  resolveMailDomain,
  suggestEmailDomain,
} from './email-deliverability'
import { MAIL_DOMAIN_INTEL_TTL_MS, MAIL_DOMAIN_NEGATIVE_TTL_MS, type MailGatewayStanding } from './mail-gateway'

const NOW = Date.parse('2026-09-24T15:00:00Z')

const noRecord = (code: string) => Object.assign(new Error(`query ${code}`), { code })

/** A resolver answering from a table: `null` is "no such record", `'down'` is nobody answering. */
function tableResolver(
  mx: Record<string, Array<{ exchange: string; priority: number }> | null | 'down'>,
  addresses: Record<string, boolean | 'down'> = {},
): MailDnsResolver {
  return {
    async resolveMx(domain) {
      const answer = mx[domain]
      if (answer === 'down') throw new Error('queryMx ETIMEOUT')
      if (!answer) throw noRecord('ENODATA')
      return answer
    },
    async resolveAddress(domain) {
      const answer = addresses[domain]
      if (answer === 'down') throw new Error('queryA ETIMEOUT')
      return answer === true
    },
  }
}

const intel = (status: MailDomainIntel['status'], overrides: Partial<MailDomainIntel> = {}): MailDomainIntel => ({
  domain: 'acme.example',
  status,
  mx: status === 'mx' ? ['mx.acme.example'] : [],
  gateway: status === 'mx' ? 'other' : status === 'implicit_mx' ? 'other' : 'none',
  resolvedAtMs: NOW,
  ...overrides,
})

const heldStanding: MailGatewayStanding = {
  gateway: 'barracuda',
  blocked7: 2,
  delivered7: 0,
  blocked30: 2,
  delivered30: 0,
}

describe('the address', () => {
  it('normalizes an address and refuses what is not one', () => {
    expect(normalizeDeliverabilityEmail('  Casey@Example.ORG ')).toBe('casey@example.org')
    expect(normalizeDeliverabilityEmail('casey@example')).toBeNull()
    expect(normalizeDeliverabilityEmail('casey@@example.org')).toBeNull()
    expect(normalizeDeliverabilityEmail('casey..x@example.org')).toBeNull()
    expect(normalizeDeliverabilityEmail('casey@example.123')).toBeNull()
    expect(emailAddressDomain('casey+tag@Mail.Example.org')).toBe('mail.example.org')
  })

  it('suggests the provider a slip meant, and never "corrects" a real provider', () => {
    expect(suggestEmailDomain('gmial.com')).toBe('gmail.com')
    expect(suggestEmailDomain('gmai.com')).toBe('gmail.com')
    expect(suggestEmailDomain('gmail.con')).toBe('gmail.com')
    expect(suggestEmailDomain('hotmial.com')).toBe('hotmail.com')
    expect(suggestEmailDomain('yahooo.com')).toBe('yahoo.com')
    expect(suggestEmailDomain('outlok.com')).toBe('outlook.com')
    expect(suggestEmailDomain('comcast.ne')).toBe('comcast.net')
    for (const real of ['gmail.com', 'mail.com', 'gmx.com', 'ymail.com', 'aol.com', 'acme.com', 'yahoo.co.uk']) {
      expect([real, suggestEmailDomain(real)]).toEqual([real, null])
    }
  })

  it('knows the disposable providers and the role inboxes', () => {
    expect(isDisposableEmailDomain('Mailinator.com')).toBe(true)
    expect(isDisposableEmailDomain('acme.example')).toBe(false)
    expect(isRoleEmailAddress('info@acme.example')).toBe(true)
    expect(isRoleEmailAddress('sales+west@acme.example')).toBe(true)
    expect(isRoleEmailAddress('casey@acme.example')).toBe(false)
  })
})

describe('resolveMailDomain', () => {
  const resolver = tableResolver(
    {
      'workspace.example': [
        { exchange: 'alt1.aspmx.l.google.com.', priority: 5 },
        { exchange: 'ASPMX.L.GOOGLE.COM', priority: 1 },
      ],
      'nullmx.example': [{ exchange: '', priority: 0 }],
      'dotmx.example': [{ exchange: '.', priority: 0 }],
      'webonly.example': null,
      'nothing.example': null,
      'down.example': 'down',
      'half.example': null,
    },
    { 'webonly.example': true, 'half.example': 'down' },
  )

  it('orders and classifies the exchanges of a domain with MX', async () => {
    await expect(resolveMailDomain(resolver, 'workspace.example', NOW)).resolves.toEqual({
      domain: 'workspace.example',
      status: 'mx',
      mx: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'],
      gateway: 'google',
      resolvedAtMs: NOW,
    })
  })

  it('reads RFC 7505’s null MX as taking no mail, however the resolver spells it', async () => {
    await expect(resolveMailDomain(resolver, 'nullmx.example', NOW)).resolves.toMatchObject({ status: 'null_mx', gateway: 'none' })
    await expect(resolveMailDomain(resolver, 'dotmx.example', NOW)).resolves.toMatchObject({ status: 'null_mx' })
  })

  it('reads no MX with an address record as the implicit MX, and neither as no MX', async () => {
    await expect(resolveMailDomain(resolver, 'webonly.example', NOW)).resolves.toMatchObject({
      status: 'implicit_mx',
      gateway: 'other',
    })
    await expect(resolveMailDomain(resolver, 'nothing.example', NOW)).resolves.toMatchObject({ status: 'no_mx', gateway: 'none' })
  })

  it('rejects when nobody answered, for the MX or for the address', async () => {
    await expect(resolveMailDomain(resolver, 'down.example', NOW)).rejects.toThrow('ETIMEOUT')
    await expect(resolveMailDomain(resolver, 'half.example', NOW)).rejects.toThrow('ETIMEOUT')
  })

  it('trusts a domain that takes mail for a week and one that does not for a day', () => {
    expect(isMailDomainIntelFresh(intel('mx', { resolvedAtMs: NOW - MAIL_DOMAIN_INTEL_TTL_MS + 1 }), NOW)).toBe(true)
    expect(isMailDomainIntelFresh(intel('mx', { resolvedAtMs: NOW - MAIL_DOMAIN_INTEL_TTL_MS }), NOW)).toBe(false)
    expect(isMailDomainIntelFresh(intel('no_mx', { resolvedAtMs: NOW - MAIL_DOMAIN_NEGATIVE_TTL_MS + 1 }), NOW)).toBe(true)
    expect(isMailDomainIntelFresh(intel('no_mx', { resolvedAtMs: NOW - MAIL_DOMAIN_NEGATIVE_TTL_MS }), NOW)).toBe(false)
    expect(isMailDomainIntelFresh(null, NOW)).toBe(false)
  })

  it('reads a stored answer back, classifying its gateway from its MX', () => {
    expect(
      readStoredMailDomainIntel('lifespire.example', {
        status: 'mx',
        mx: ['d78608a.ess.barracudanetworks.com'],
        resolvedAtMs: NOW,
      }),
    ).toEqual({
      domain: 'lifespire.example',
      status: 'mx',
      mx: ['d78608a.ess.barracudanetworks.com'],
      gateway: 'barracuda',
      resolvedAtMs: NOW,
    })
    expect(readStoredMailDomainIntel('x.example', { status: 'bogus' })).toBeNull()
    expect(readStoredMailDomainIntel('x.example', undefined)).toBeNull()
  })
})

describe('assessEmailDeliverability', () => {
  it('refuses a domain with no mail server for every purpose, transactional included', () => {
    for (const purpose of ['transactional', 'bulk', 'cold'] as const) {
      const verdict = assessEmailDeliverability({ email: 'nobody@acme.example', purpose, intel: intel('no_mx') })
      expect([purpose, verdict.outcome, decidingDeliverabilityFinding(verdict)?.code]).toEqual([purpose, 'refused', 'no_mx'])
    }
    expect(
      assessEmailDeliverability({ email: 'nobody@acme.example', purpose: 'transactional', intel: intel('null_mx') }).findings[0],
    ).toMatchObject({ code: 'null_mx', severity: 'refuse' })
  })

  it('never refuses a public mailbox provider for its MX', () => {
    const verdict = assessEmailDeliverability({
      email: 'casey@gmail.com',
      purpose: 'bulk',
      intel: intel('no_mx', { domain: 'gmail.com' }),
      publicMailbox: true,
    })
    expect(verdict.outcome).toBe('deliverable')
    expect(verdict.findings).toEqual([])
  })

  it('holds bulk and cold mail behind a gateway that refused the sender twice, and never transactional mail', () => {
    const at = intel('mx', { gateway: 'barracuda' })
    expect(assessEmailDeliverability({ email: 'k@acme.example', purpose: 'bulk', intel: at, gateway: heldStanding }).outcome).toBe('held')
    expect(assessEmailDeliverability({ email: 'k@acme.example', purpose: 'cold', intel: at, gateway: heldStanding }).outcome).toBe('held')
    expect(
      assessEmailDeliverability({ email: 'k@acme.example', purpose: 'transactional', intel: at, gateway: heldStanding }).outcome,
    ).toBe('deliverable')
    expect(
      assessEmailDeliverability({ email: 'k@acme.example', purpose: 'bulk', intel: at, gateway: heldStanding, holdReleased: true })
        .outcome,
    ).toBe('deliverable')
    // One delivery in the window earns the gateway back.
    expect(
      assessEmailDeliverability({
        email: 'k@acme.example',
        purpose: 'bulk',
        intel: at,
        gateway: { ...heldStanding, delivered30: 1 },
      }).outcome,
    ).toBe('deliverable')
    const held = assessEmailDeliverability({ email: 'k@acme.example', purpose: 'bulk', intel: at, gateway: heldStanding })
    expect(decidingDeliverabilityFinding(held)?.message).toBe(
      'Barracuda refused this sender twice in the last 30 days and delivered nothing, so bulk mail to acme.example is held.',
    )
  })

  it('warns — and only warns — for a typo, a disposable domain, the implicit MX and a role inbox in bulk mail', () => {
    const typo = assessEmailDeliverability({ email: 'casey@gmial.com', purpose: 'transactional', intel: intel('mx', { domain: 'gmial.com' }) })
    expect(typo.outcome).toBe('deliverable')
    expect(typo.findings).toEqual([
      {
        code: 'typo_domain',
        severity: 'warn',
        message: 'Did you mean casey@gmail.com? gmial.com looks like a typo.',
        suggestion: 'casey@gmail.com',
      },
    ])
    expect(
      assessEmailDeliverability({ email: 'x@mailinator.com', purpose: 'bulk', intel: intel('mx') }).findings.map((f) => f.code),
    ).toEqual(['disposable_domain'])
    expect(
      assessEmailDeliverability({ email: 'x@acme.example', purpose: 'bulk', intel: intel('implicit_mx') }).findings.map((f) => f.code),
    ).toEqual(['implicit_mx'])
    expect(
      assessEmailDeliverability({ email: 'info@acme.example', purpose: 'bulk', intel: intel('mx') }).findings.map((f) => f.code),
    ).toEqual(['role_address'])
    expect(assessEmailDeliverability({ email: 'info@acme.example', purpose: 'transactional', intel: intel('mx') }).findings).toEqual([])
  })

  it('says nothing is known when the MX could not be read, and stops nothing', () => {
    expect(assessEmailDeliverability({ email: 'x@acme.example', purpose: 'bulk', intel: null })).toMatchObject({
      outcome: 'unchecked',
      findings: [],
    })
  })

  it('refuses a value that is not an address', () => {
    expect(assessEmailDeliverability({ email: 'not an address', purpose: 'bulk' })).toMatchObject({
      email: null,
      outcome: 'refused',
      findings: [{ code: 'invalid_syntax', severity: 'refuse' }],
    })
  })
})

describe('deliverabilityExclusionSummary', () => {
  it('names what the checks took out, or nothing', () => {
    expect(deliverabilityExclusionSummary({ noMailServer: 3, gatewayHeld: 2 })).toBe(
      '5 recipients excluded: 3 no mail server · 2 behind a gateway that refused this sender',
    )
    expect(deliverabilityExclusionSummary({ noMailServer: 1 })).toBe('1 recipient excluded: 1 no mail server')
    expect(deliverabilityExclusionSummary({ noMailServer: 0, gatewayHeld: 0 })).toBeNull()
  })
})
