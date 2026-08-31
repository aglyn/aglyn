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
  sharedIdentityMarketingRefusal,
  validateSendingDomain,
  type SendingDomainSelection,
  type SendingDomainStatus,
} from './sending-domain'
import { isMarketingMessage } from './marketing-send'

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

/*==========================================
  The shared identity, and what it will not carry
==========================================*/

const SHARED_FROM = 'notifications@shared1.mail.aglyn.app'

/**
 * TRANSACTIONAL MAIL IS NEVER BLOCKED, AND MARKETING NEVER POOLS.
 *
 * These two rules are one decision seen from both sides. A receipt has no
 * alternative — a merchant who cannot send one does not have a degraded
 * product, they have no product — so it goes on the pooled identity whatever
 * the tier. A campaign is the merchant's own choice and carries their list
 * quality, so it may only leave on a name whose reputation is theirs to spend;
 * pooling it would charge one merchant's complaint rate against every other
 * site's password resets.
 *
 * Nothing in this block reads a plan. The rule is about reputation and it
 * would hold if the price list changed tomorrow.
 */
describe('the shared identity carries transactional mail only', () => {
  it('sends a site with no domain of its own, on the shared identity', () => {
    const verdict = resolveSendingIdentity({
      selection: null,
      platformFrom: 'noreply@aglyn.com',
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
    })

    expect(verdict.refusal).toBeNull()
    expect(verdict.from).toBe(SHARED_FROM)
    expect(verdict.source).toBe('shared')
    expect(verdict.domain).toBe('shared1.mail.aglyn.app')
  })

  it('defaults an undeclared purpose to transactional, so a receipt always goes', () => {
    // The polarity that matters: a caller who forgets sends a receipt that
    // goes out, rather than dropping one. The forgotten-marketing case is
    // caught structurally at the send path instead.
    const verdict = resolveSendingIdentity({
      selection: null,
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
    })
    expect(verdict.source).toBe('shared')
  })

  it('refuses marketing, and names the remedy rather than a wait', () => {
    const verdict = resolveSendingIdentity({
      selection: null,
      platformFrom: 'noreply@aglyn.com',
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
      purpose: 'marketing',
    })

    expect(verdict.from).toBeNull()
    expect(verdict.source).toBeNull()
    expect(verdict.refusal.code).toBe('shared-identity-marketing')
    expect(verdict.refusal.message).toMatch(/domain of this site/i)
    // NOT "try again shortly". A campaign will never leave on the pool however
    // well provisioned it is, so a message promising a later success would send
    // the merchant to wait for something that is not coming.
    expect(verdict.refusal.message).not.toMatch(/try again/i)
  })

  it('refuses marketing the same way when no pool is configured at all', () => {
    // The marketing check sits ABOVE the "is a shared identity available"
    // check, so the answer does not change with the deployment's plumbing.
    const verdict = resolveSendingIdentity({
      selection: null,
      sharedFrom: '',
      audience: 'tenant',
      purpose: 'marketing',
    })
    expect(verdict.refusal.code).toBe('shared-identity-marketing')
  })

  it('refuses transactional as an OPERATOR fault when no pool is configured', () => {
    const verdict = resolveSendingIdentity({
      selection: null,
      platformFrom: 'noreply@aglyn.com',
      sharedFrom: '',
      audience: 'tenant',
    })

    expect(verdict.from).toBeNull()
    expect(verdict.refusal.code).toBe('tenant-identity-unprovisioned')
    // And it still does not reach the platform's own address to rescue itself.
    expect(String(verdict.from ?? '')).not.toContain('aglyn.com')
  })

  /**
   * THE CONTROL FOR AN INDISCRIMINATE FALLBACK.
   *
   * Every case below has a shared identity available and must NOT use it. If
   * the pool were applied wherever no verified domain was to hand, this is the
   * test that fails — and it is the one that distinguishes "the merchant gave
   * no instruction" from "the merchant gave one we would be ignoring".
   */
  it.each(['requested', 'records-issued', 'failed'] as const)(
    'refuses a SELECTED domain at %s rather than pooling it',
    (status) => {
      const verdict = resolveSendingIdentity({
        selection: selection(status),
        platformFrom: 'noreply@aglyn.com',
        sharedFrom: SHARED_FROM,
        audience: 'tenant',
      })

      expect(verdict.from).toBeNull()
      expect(verdict.source).toBeNull()
      expect(verdict.refusal.domain).toBe(DOMAIN)
      expect(verdict.summary).not.toContain('shared1')
    },
  )

  it('never reaches the shared identity for PLATFORM mail', () => {
    // Aglyn's own billing and account mail stays on `aglyn.com`. The pool is
    // the tenant's side of the split and the platform must not borrow it any
    // more than a tenant may borrow `aglyn.com`.
    const verdict = resolveSendingIdentity({
      selection: null,
      platformFrom: 'noreply@aglyn.com',
      sharedFrom: SHARED_FROM,
    })

    expect(verdict.source).toBe('platform')
    expect(verdict.from).toBe('noreply@aglyn.com')
  })

  it('reports the pooling in the summary a surface prints', () => {
    // The console renders `summary` verbatim, so the reputation disclosure and
    // the resolver cannot drift apart. A surface that composed its own wording
    // would eventually describe an arrangement the send path had left behind.
    const verdict = resolveSendingIdentity({
      selection: null,
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
    })
    expect(verdict.summary).toMatch(/pooled/i)
    expect(verdict.summary).toContain(SHARED_FROM)
  })

  it('refuses a malformed shared address instead of putting it in a From:', () => {
    for (const bad of ['notanaddress', '@shared1.mail.aglyn.app', 'x@', '  ']) {
      const verdict = resolveSendingIdentity({
        selection: null,
        sharedFrom: bad,
        audience: 'tenant',
      })
      expect(verdict.from).toBeNull()
      expect(verdict.refusal.code).toBe('tenant-identity-unprovisioned')
    }
  })
})

/*==========================================
  The dedicated subdomain is an optimization; the pool is the floor
==========================================*/

/**
 * WHOSE DOMAIN IT IS, not whether it is verified, decides what a stalled
 * selection means.
 *
 * A platform subdomain is a name the platform chose, provisioned and pointed
 * the site at, so an unverified one is our unfinished work — a provider at its
 * domain allowance, a zone write that failed, a sweep that has not run. None
 * of that is anything the merchant can act on, and all of it would otherwise
 * refuse their receipts.
 *
 * That property is what makes rationing the dedicated tier safe. Without it,
 * every ceiling on dedicated domains is a ceiling on which paying customers
 * can send at all.
 */
describe('a platform subdomain that has not verified falls back to the pool', () => {
  const ISSUED = 'acme.mail.aglyn.app'

  function issued(
    status: SendingDomainStatus,
  ): SendingDomainSelection {
    return {
      domain: ISSUED,
      status,
      localPart: 'hello',
      platformIssued: true,
    }
  }

  it.each(['requested', 'records-issued', 'failed'] as const)(
    'sends transactional mail on the pool while its subdomain is %s',
    (status) => {
      const verdict = resolveSendingIdentity({
        selection: issued(status),
        platformFrom: 'noreply@aglyn.com',
        sharedFrom: SHARED_FROM,
        audience: 'tenant',
      })

      expect(verdict.refusal).toBeNull()
      expect(verdict.from).toBe(SHARED_FROM)
      expect(verdict.source).toBe('shared')
      // And never onto the platform's own domain, which is the address this
      // whole split exists to keep a tenant's list quality away from.
      expect(verdict.from).not.toContain('aglyn.com')
    },
  )

  it('prefers the subdomain the moment it verifies', () => {
    const verdict = resolveSendingIdentity({
      selection: issued('verified'),
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
    })

    expect(verdict.source).toBe('custom')
    expect(verdict.from).toBe(`hello@${ISSUED}`)
  })

  /**
   * THE CONTROL FOR AN INDISCRIMINATE FALLBACK.
   *
   * The same domain, the same status, the same pool available — and the
   * customer's own name still refuses. A change that pooled every unverified
   * selection would pass every assertion above and fail here, which is the
   * only way that regression ever surfaces: it sends, from a working address,
   * and nothing errors.
   */
  it.each(['requested', 'records-issued', 'failed'] as const)(
    'still refuses a CUSTOMER-owned domain at %s, with the pool right there',
    (status) => {
      const verdict = resolveSendingIdentity({
        selection: { ...selection(status), platformIssued: false },
        platformFrom: 'noreply@aglyn.com',
        sharedFrom: SHARED_FROM,
        audience: 'tenant',
      })

      expect(verdict.from).toBeNull()
      expect(verdict.source).toBeNull()
      expect(verdict.refusal.domain).toBe(DOMAIN)
    },
  )

  /**
   * An absent flag reads as the customer's own domain, so a caller that
   * forgets to set it gets the refusing answer rather than the pooling one.
   */
  it('treats an unset flag as a customer domain', () => {
    const verdict = resolveSendingIdentity({
      selection: selection('records-issued'),
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
    })
    expect(verdict.refusal.code).toBe('domain-unverified')
  })

  /**
   * MARKETING is unchanged by any of this. The reason a campaign may not leave
   * on the pool is one merchant's complaint rate landing on every other site's
   * password resets, which has nothing to do with why this site's subdomain is
   * unfinished.
   */
  it('refuses marketing from a site whose subdomain has not verified', () => {
    const verdict = resolveSendingIdentity({
      selection: issued('records-issued'),
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
      purpose: 'marketing',
    })

    expect(verdict.from).toBeNull()
    expect(verdict.refusal.code).toBe('shared-identity-marketing')
  })

  /**
   * The fallback is a TENANT arm and cannot reach the platform's own identity.
   * A deployment with no pool refuses as an operator fault, exactly as an
   * unprovisioned site does — the subdomain does not become a second route to
   * `aglyn.com`.
   */
  it('refuses rather than borrowing the platform identity when no pool exists', () => {
    const verdict = resolveSendingIdentity({
      selection: issued('requested'),
      platformFrom: 'noreply@aglyn.com',
      sharedFrom: '',
      audience: 'tenant',
    })

    expect(verdict.from).toBeNull()
    expect(verdict.refusal.code).toBe('tenant-identity-unprovisioned')
  })
})

describe('sharedIdentityMarketingRefusal — the backstop at the send', () => {
  /**
   * The half that does not depend on anybody remembering. An identity is
   * resolved once and reused for thousands of messages, so the send path
   * re-examines the verdict with the message in hand.
   */
  it('refuses a marketing message whose identity turned out to be pooled', () => {
    const verdict = resolveSendingIdentity({
      selection: null,
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
    })

    expect(verdict.source).toBe('shared')
    const refusal = sharedIdentityMarketingRefusal(verdict)
    expect(refusal.code).toBe('shared-identity-marketing')
    expect(refusal.domain).toBe('shared1.mail.aglyn.app')
  })

  it('says nothing about a verified custom domain or the platform identity', () => {
    // A merchant on their own domain may send marketing — it is their
    // reputation to spend. This must not become a blanket marketing gate.
    const custom = resolveSendingIdentity({
      selection: selection('verified'),
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
    })
    expect(custom.source).toBe('custom')
    expect(sharedIdentityMarketingRefusal(custom)).toBeNull()

    const platform = resolveSendingIdentity({
      selection: null,
      platformFrom: 'noreply@aglyn.com',
    })
    expect(sharedIdentityMarketingRefusal(platform)).toBeNull()
    expect(sharedIdentityMarketingRefusal(null)).toBeNull()
  })

  it('gives the same message the resolver does', () => {
    // One string, produced from two places. Two copies is how the route comes
    // to explain one rule while the backstop explains another.
    const declared = resolveSendingIdentity({
      selection: null,
      sharedFrom: SHARED_FROM,
      audience: 'tenant',
      purpose: 'marketing',
    })
    const caught = sharedIdentityMarketingRefusal(
      resolveSendingIdentity({
        selection: null,
        sharedFrom: SHARED_FROM,
        audience: 'tenant',
      }),
    )
    expect(caught.message).toBe(declared.refusal.message)
  })
})

describe('isMarketingMessage — derived, never declared', () => {
  /**
   * The classification is read off fields a marketing send is ALREADY obliged
   * to carry. A new `kind:` option would be one more thing for twenty call
   * sites to remember, and the twenty-first would be a campaign on the pool.
   */
  it('recognizes a send that declares a marketing context', () => {
    expect(isMarketingMessage({ marketing: { hostId: 'h', siteBase: 'x' } })).toBe(true)
  })

  it('recognizes the campaign sender, which carries no marketing context', () => {
    // `campaign-send.ts` mints its own unsubscribe headers upstream, so it
    // passes no `marketing` object — but it cannot avoid the campaign
    // priority, because the hourly governor is allowed to refuse it.
    expect(isMarketingMessage({ context: 'campaign' })).toBe(true)
    expect(isMarketingMessage({ priority: 'campaign' })).toBe(true)
  })

  it('leaves every transactional sender alone', () => {
    for (const context of [
      'receipt',
      'cart receipt',
      'booking confirmation',
      'booking reminder',
      'membership recovery',
      'inbox-reply',
      'gift card',
      'seller order notice',
      undefined,
    ]) {
      expect(isMarketingMessage({ context })).toBe(false)
    }
  })

  it('does not treat a resumable bulk sweep as marketing on its own', () => {
    // `priority: 'bulk'` says "a refusal means not this hour", which is about
    // DEFERRABILITY and not about whose reputation is at risk. The bulk
    // marketing sweeps are caught by their `marketing` context instead.
    expect(isMarketingMessage({ priority: 'bulk', context: 'booking reminder' })).toBe(
      false,
    )
    expect(
      isMarketingMessage({
        priority: 'bulk',
        context: 'abandoned cart',
        marketing: { hostId: 'h', siteBase: 'x' },
      }),
    ).toBe(true)
  })
})
