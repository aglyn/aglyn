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
 * The sending-domain policy.
 *
 * The load-bearing assertions in this file are the ones in "an unverified
 * domain does not send". Everything else here protects a string a customer
 * reads; those protect the property the whole feature exists for — that a
 * tenant who asked to send as their own domain is never quietly sent as
 * somebody else's.
 */

import {
  assessDmarc,
  dmarcRecommendation,
  formatSendingRecord,
  normalizeLocalPart,
  normalizeSendingDomain,
  assessSendingRecords,
  resolveSendingIdentity,
  sendingDnsRecords,
  sendingDomainRequiredRecords,
  sendingRecordKey,
  validateSendingDomain,
  type SendingDomainSelection,
  type SendingDomainStatus,
} from './sending-domain'

const DOMAIN = 'acme.com'
const DKIM_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAexamplekey'

function record(overrides: Record<string, unknown> = {}) {
  return {
    domain: DOMAIN,
    dkimSelector: 'aglyn-org123',
    dkimPublicKey: DKIM_KEY,
    returnPathHost: 'feedback-smtp.us-east-1.amazonses.com',
    ...overrides,
  }
}

function selection(
  status: SendingDomainStatus,
  overrides: Partial<SendingDomainSelection> = {},
): SendingDomainSelection {
  return { domain: DOMAIN, status, localPart: 'hello', ...overrides }
}

/*==========================================
  The refusal — the reason this module exists
==========================================*/

describe('an unverified domain does not send', () => {
  /**
   * The single most important assertion in the feature.
   *
   * The tempting implementation — "use the custom domain if it is verified,
   * otherwise use the platform one" — passes every other test in this file
   * and is exactly the defect. It sends, so nothing errors; it sends from a
   * working address, so nothing bounces; and the tenant's mail carries the
   * shared domain's `From:` and charges the shared domain's reputation, which
   * is the risk the custom domain was bought to move. The only way that
   * failure ever surfaces is a test that names it.
   */
  it.each<SendingDomainStatus>(['requested', 'records-issued', 'failed'])(
    'refuses outright when the selected domain is %s, and never reaches the platform identity',
    (status) => {
      const verdict = resolveSendingIdentity({
        selection: selection(status),
        platformFrom: 'noreply@aglyn.com',
      })

      expect(verdict.refusal).not.toBeNull()
      expect(verdict.from).toBeNull()
      expect(verdict.source).toBeNull()
      // The platform identity was available and was NOT used. Asserted on the
      // value rather than on `source` alone, so an implementation that
      // mislabels a fallback as `custom` still fails here.
      expect(verdict.from).not.toBe('noreply@aglyn.com')
      expect(JSON.stringify(verdict)).not.toContain('aglyn.com')
    },
  )

  it('names the domain and the next action, not just a code', () => {
    const { refusal } = resolveSendingIdentity({
      selection: selection('records-issued'),
      platformFrom: 'noreply@aglyn.com',
    })

    expect(refusal.code).toBe('domain-unverified')
    expect(refusal.domain).toBe(DOMAIN)
    // A reason a person can act on. `USAGE_EMAIL_FROM` being empty for weeks
    // was survivable only because nothing said anything; a refusal that does
    // not name the domain repeats that.
    expect(refusal.message).toContain(DOMAIN)
    expect(refusal.message).toMatch(/verif/i)
  })

  it('distinguishes a domain we checked from one we have not', () => {
    const checked = resolveSendingIdentity({
      selection: selection('failed', { missing: ['TXT:send.acme.com'] }),
      platformFrom: 'noreply@aglyn.com',
    })
    const unchecked = resolveSendingIdentity({
      selection: selection('records-issued'),
      platformFrom: 'noreply@aglyn.com',
    })

    expect(checked.refusal.code).toBe('domain-failed')
    expect(checked.refusal.missing).toEqual(['TXT:send.acme.com'])
    expect(unchecked.refusal.code).toBe('domain-unverified')
  })

  it('refuses a verified domain whose stored address is unusable', () => {
    // A verified record with a corrupt local part is our storage fault, and it
    // is still not a licence to send as the platform.
    const verdict = resolveSendingIdentity({
      selection: selection('verified', { localPart: 'not a mailbox' }),
      platformFrom: 'noreply@aglyn.com',
    })

    expect(verdict.from).toBeNull()
    expect(verdict.refusal).not.toBeNull()
  })
})

/*==========================================
  The ordinary paths
==========================================*/

describe('resolveSendingIdentity — which identity is in use', () => {
  it('uses the verified custom domain and says so', () => {
    const verdict = resolveSendingIdentity({
      selection: selection('verified'),
      platformFrom: 'noreply@aglyn.com',
    })

    expect(verdict.from).toBe('hello@acme.com')
    expect(verdict.source).toBe('custom')
    expect(verdict.domain).toBe(DOMAIN)
    expect(verdict.refusal).toBeNull()
    expect(verdict.summary).toContain('hello@acme.com')
  })

  it('falls back to the platform identity only when nothing is selected', () => {
    const verdict = resolveSendingIdentity({
      selection: null,
      platformFrom: 'noreply@aglyn.com',
    })

    expect(verdict.from).toBe('noreply@aglyn.com')
    expect(verdict.source).toBe('platform')
    expect(verdict.refusal).toBeNull()
  })

  it('always reports which identity is in use, refusal included', () => {
    // The surface requirement: no outcome leaves a caller with nothing to
    // print, so no caller has to invent wording for the blocked case.
    const outcomes = [
      resolveSendingIdentity({ selection: selection('verified'), platformFrom: 'noreply@aglyn.com' }),
      resolveSendingIdentity({ selection: null, platformFrom: 'noreply@aglyn.com' }),
      resolveSendingIdentity({ selection: selection('failed'), platformFrom: 'noreply@aglyn.com' }),
      resolveSendingIdentity({ selection: null, platformFrom: '' }),
    ]

    for (const verdict of outcomes) {
      expect(typeof verdict.summary).toBe('string')
      expect(verdict.summary.length).toBeGreaterThan(0)
    }
    expect(outcomes[0].summary).toMatch(/verified domain/i)
    expect(outcomes[1].summary).toMatch(/shared platform domain/i)
  })

  it('refuses when neither a custom nor a platform identity is configured', () => {
    // The `USAGE_EMAIL_FROM`-empty shape, given a name instead of a shrug.
    const verdict = resolveSendingIdentity({ selection: null, platformFrom: '' })

    expect(verdict.refusal.code).toBe('platform-unconfigured')
    expect(verdict.refusal.message).toContain('USAGE_EMAIL_FROM')
    expect(verdict.from).toBeNull()
  })
})

/*==========================================
  The records the customer publishes
==========================================*/

describe('sendingDnsRecords', () => {
  it('issues SPF, DKIM and a return path, on the send subdomain', () => {
    const records = sendingDnsRecords(record())
    const byPurpose = Object.fromEntries(records.map((r) => [r.purpose, r]))

    expect(byPurpose.spf.type).toBe('TXT')
    expect(byPurpose.spf.name).toBe('send.acme.com')
    expect(byPurpose.spf.value).toBe('v=spf1 include:amazonses.com ~all')

    expect(byPurpose.dkim.type).toBe('TXT')
    // The selector is per-org, so two orgs on one name cannot collide.
    expect(byPurpose.dkim.name).toBe('aglyn-org123._domainkey.acme.com')
    expect(byPurpose.dkim.value).toBe(`p=${DKIM_KEY}`)

    expect(byPurpose['return-path'].type).toBe('MX')
    expect(byPurpose['return-path'].name).toBe('send.acme.com')
    expect(byPurpose['return-path'].priority).toBe(10)
  })

  it('keeps SPF off the root so an existing root record is untouched', () => {
    // The customer's Workspace or Microsoft SPF lives on the root and must keep
    // authenticating; the root's ten-lookup budget fails closed when spent.
    for (const entry of sendingDnsRecords(record())) {
      if (entry.purpose === 'spf' || entry.purpose === 'return-path') {
        expect(entry.name).toBe('send.acme.com')
        expect(entry.name).not.toBe('acme.com')
      }
    }
  })

  it('leaves the DKIM value empty until the provider issues a key', () => {
    const records = sendingDnsRecords(record({ dkimPublicKey: null }))
    const dkim = records.find((entry) => entry.purpose === 'dkim')

    expect(dkim.value).toBe('')
    // And an unpublishable record is not one we ask anybody to publish, so it
    // cannot be counted as a requirement the customer has failed to meet.
    expect(sendingDomainRequiredRecords(record({ dkimPublicKey: null }))).toHaveLength(2)
    expect(sendingDomainRequiredRecords(record())).toHaveLength(3)
  })

  it('gives every record a note aimed at whoever edits the zone', () => {
    for (const entry of sendingDnsRecords(record())) {
      expect(entry.note.length).toBeGreaterThan(20)
    }
  })

  it('formats a record as one line, priority included', () => {
    const records = sendingDnsRecords(record())
    const mx = records.find((entry) => entry.type === 'MX')

    expect(formatSendingRecord(mx)).toBe(
      'MX     send.acme.com  →  10 feedback-smtp.us-east-1.amazonses.com',
    )
  })

  it('keys a record without leaking the DKIM public key', () => {
    const dkim = sendingDnsRecords(record()).find((e) => e.purpose === 'dkim')

    // Keys reach status documents and log lines; a key that embedded the value
    // would put the whole public key in both.
    expect(sendingRecordKey(dkim)).toBe('TXT:aglyn-org123._domainkey.acme.com')
    expect(sendingRecordKey(dkim)).not.toContain(DKIM_KEY)
  })
})

/*==========================================
  DMARC — read, warn, never write
==========================================*/

describe('assessDmarc', () => {
  it('reads p=reject and states the consequence, not the syntax', () => {
    const assessment = assessDmarc(['v=DMARC1; p=reject; rua=mailto:d@acme.com'])

    expect(assessment.policy).toBe('reject')
    // "refused", not "may go to spam" — under p=reject with our DKIM missing,
    // every message hard fails.
    expect(assessment.consequence).toMatch(/refused/i)
  })

  it('reads p=quarantine and p=none', () => {
    expect(assessDmarc(['v=DMARC1; p=quarantine']).policy).toBe('quarantine')
    expect(assessDmarc(['v=DMARC1; p=none']).policy).toBe('none')
    expect(assessDmarc(['v=DMARC1;p=QUARANTINE;']).policy).toBe('quarantine')
  })

  it('reports an absent policy as absent rather than as p=none', () => {
    const assessment = assessDmarc([])

    expect(assessment.policy).toBe('absent')
    expect(assessment.record).toBeNull()
  })

  it('ignores unrelated TXT records at the same name', () => {
    // A zone commonly carries verification tokens at any name. Reading the
    // first string found would report one of those as a DMARC policy.
    const assessment = assessDmarc([
      'google-site-verification=abc123',
      'v=DMARC1; p=reject',
    ])

    expect(assessment.policy).toBe('reject')
    expect(assessDmarc(['google-site-verification=abc123']).policy).toBe('absent')
  })

  it('defaults a malformed DMARC record to none rather than assuming enforcement', () => {
    const assessment = assessDmarc(['v=DMARC1; rua=mailto:d@acme.com'])

    expect(assessment.policy).toBe('none')
    expect(assessment.record).not.toBeNull()
  })

  it('recommends a report-only policy and never blocks on it', () => {
    const suggestion = dmarcRecommendation(DOMAIN)

    expect(suggestion.name).toBe('_dmarc.acme.com')
    expect(suggestion.required).toBe(false)
    // p=none: recommending enforcement to a domain whose other senders we
    // cannot see would break their invoicing and we would never hear about it.
    expect(suggestion.value).toContain('p=none')
    // And it is never part of what verification waits on.
    expect(
      sendingDomainRequiredRecords(record()).some((e) => e.purpose === 'dmarc'),
    ).toBe(false)
  })
})

/*==========================================
  Input handling
==========================================*/

describe('validateSendingDomain', () => {
  it('normalizes case, whitespace, a trailing dot and an address', () => {
    expect(normalizeSendingDomain('  ACME.com.  ')).toBe('acme.com')
    expect(normalizeSendingDomain('hello@Acme.COM')).toBe('acme.com')
    expect(validateSendingDomain(' Acme.Com ').domain).toBe('acme.com')
  })

  it('refuses a mailbox provider with a reason instead of never verifying', () => {
    const check = validateSendingDomain('gmail.com')

    expect(check.domain).toBeNull()
    expect(check.error).toMatch(/never be verified/i)
  })

  it('refuses a malformed domain', () => {
    for (const bad of ['', 'acme', '-acme.com', 'acme-.com', 'acme .com']) {
      expect(validateSendingDomain(bad).domain).toBeNull()
    }
  })

  it('refuses a local part that could smuggle a second address or a header', () => {
    expect(normalizeLocalPart('hello')).toBe('hello')
    expect(normalizeLocalPart('no-reply.team+news')).toBe('no-reply.team+news')
    for (const bad of ['a@b', 'hello world', 'x\nBcc: y', '', '.lead', 'trail.']) {
      expect(normalizeLocalPart(bad)).toBe('')
    }
  })
})

/*==========================================
  Verification
==========================================*/

describe('assessSendingRecords', () => {
  const live = {
    spfTxt: ['v=spf1 include:amazonses.com ~all'],
    dkimTxt: [`p=${DKIM_KEY}`],
    mx: [{ exchange: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 }],
    conclusive: true,
  }

  it('verifies when every required record is live', () => {
    expect(assessSendingRecords(record(), live)).toEqual({
      status: 'verified',
      missing: [],
    })
  })

  it('names each missing record rather than reporting a bare failure', () => {
    const verdict = assessSendingRecords(record(), {
      ...live,
      dkimTxt: [],
      mx: [],
    })

    expect(verdict.status).toBe('failed')
    expect(verdict.missing).toEqual([
      'TXT:aglyn-org123._domainkey.acme.com',
      'MX:send.acme.com',
    ])
  })

  /**
   * The arm that stops a resolver outage from being read as every customer
   * deleting their DNS at the same instant. It must produce neither verdict,
   * so the caller has nothing to write and leaves the stored status alone.
   */
  it('is inconclusive when any lookup failed to get an answer', () => {
    const verdict = assessSendingRecords(record(), {
      spfTxt: [],
      dkimTxt: [],
      mx: [],
      conclusive: false,
    })

    expect(verdict.status).toBe('inconclusive')
    expect(verdict.status).not.toBe('failed')
    expect(verdict.missing).toEqual([])
  })

  it('accepts a longer SPF policy that still authorizes us', () => {
    // A zone may legitimately carry extra mechanisms. Demanding our exact
    // string would fail a configuration that works.
    const verdict = assessSendingRecords(record(), {
      ...live,
      spfTxt: ['v=spf1 include:_spf.google.com include:amazonses.com -all'],
    })

    expect(verdict.status).toBe('verified')
  })

  it('refuses an SPF record that does not authorize us', () => {
    const verdict = assessSendingRecords(record(), {
      ...live,
      spfTxt: ['v=spf1 include:_spf.google.com -all'],
    })

    expect(verdict.missing).toEqual(['TXT:send.acme.com'])
  })

  it('ignores a non-SPF TXT record at the send host', () => {
    const verdict = assessSendingRecords(record(), {
      ...live,
      spfTxt: ['amazonses.com is great', 'v=spf1 include:amazonses.com ~all'],
    })

    expect(verdict.status).toBe('verified')
    // And a record that merely mentions the include is not an SPF policy.
    expect(
      assessSendingRecords(record(), {
        ...live,
        spfTxt: ['include:amazonses.com'],
      }).status,
    ).toBe('failed')
  })

  it('matches a DKIM key split across TXT chunks or wrapped', () => {
    // DNS splits strings over 255 bytes, and registrars wrap long values. A
    // comparison that did not strip whitespace would never match a real key.
    const verdict = assessSendingRecords(record(), {
      ...live,
      dkimTxt: [`p=${DKIM_KEY.slice(0, 20)} ${DKIM_KEY.slice(20)}`],
    })

    expect(verdict.status).toBe('verified')
  })

  it('refuses a DKIM key that is nearly right', () => {
    // A key that is almost correct is a key that does not sign.
    const verdict = assessSendingRecords(record(), {
      ...live,
      dkimTxt: [`p=${DKIM_KEY.slice(0, -4)}XXXX`],
    })

    expect(verdict.status).toBe('failed')
  })

  it('refuses a return path pointed somewhere else', () => {
    const verdict = assessSendingRecords(record(), {
      ...live,
      mx: [{ exchange: 'mail.acme.com', priority: 10 }],
    })

    expect(verdict.missing).toEqual(['MX:send.acme.com'])
  })

  it('never verifies a domain whose DKIM key was never issued', () => {
    // Nothing was asked for, so nothing can have been found. An empty
    // requirement set that returned `verified` would let a record reach the
    // sending state without any proof at all.
    const verdict = assessSendingRecords(record({ dkimPublicKey: null }), live)

    expect(verdict.status).not.toBe('verified')
    expect(verdict.missing).toEqual(['dkim-key-not-issued'])
  })
})
