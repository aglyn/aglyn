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
 * THE NAME A SITE SENDS FROM.
 *
 * Three properties, and each one is a bug that has a shape:
 *
 *  - a tenant's mail never resolves to an address on the platform's own domain
 *  - a hostile slug cannot produce a DNS name that reaches mail infrastructure
 *  - the name does not move when the site is renamed
 */

import {
  DEFAULT_SHARED_POOL_SIZE,
  isPlatformSendingDomain,
  isReservedMailLabel,
  isSharedPoolLabel,
  mailLabelCandidate,
  platformSendingApex,
  platformSendingDomainFor,
  platformSendingLabel,
  platformZoneNamesFor,
  platformZoneRecords,
  PLATFORM_MAIL_RESERVED_LABELS,
  sendingDomainTeardownRefusal,
  sharedSendingDomainFor,
  sharedSendingPool,
  sharedTenantSendingFrom,
  tenantWebApex,
} from './platform-sending-domain'
import {
  resolveSendingIdentity,
  SENDING_SUBDOMAIN,
  sendingDnsRecords,
  sendingDomainRequiredRecords,
} from './sending-domain'

const WEB_APEX = 'aglyn.app'
const MAIL_APEX = 'mail.aglyn.app'
const PLATFORM_FROM = 'Aglyn <noreply@aglyn.com>'

describe('the two apexes', () => {
  it('puts mail one label below the web apex, and never on aglyn.com', () => {
    expect(tenantWebApex()).toBe(WEB_APEX)
    expect(platformSendingApex()).toBe(MAIL_APEX)
    expect(platformSendingApex()).not.toContain('aglyn.com')
  })

  /**
   * The web namespace and the mail namespace must not be the same namespace.
   * If they were, a site claiming a freed web slug would claim a name another
   * site's mail is signed for — the collision this design exists to make
   * impossible rather than merely guarded.
   */
  it('refuses an operator override that collapses mail back onto the web apex', () => {
    process.env.AGLYN_TENANT_MAIL_APEX = WEB_APEX
    try {
      expect(platformSendingApex()).toBe(MAIL_APEX)
    } finally {
      delete process.env.AGLYN_TENANT_MAIL_APEX
    }
  })

  it('honors an override onto a genuinely different zone', () => {
    process.env.AGLYN_TENANT_MAIL_APEX = 'send.example.net'
    try {
      expect(platformSendingApex()).toBe('send.example.net')
      expect(platformSendingDomainFor('acme')).toBe('acme.send.example.net')
    } finally {
      delete process.env.AGLYN_TENANT_MAIL_APEX
    }
  })

  /**
   * `aglyn.app` is a DEFAULT and nothing more. The literal is allowlisted in
   * `selfhost-hardcoded-hosts.spec.ts` on exactly that basis, so the claim has
   * to be enforced somewhere: an operator who sets `NEXT_PUBLIC_TENANT_DOMAIN`
   * and nothing else gets a mail namespace one label inside their OWN zone,
   * because the mail apex is derived from the web apex rather than written
   * down a second time.
   *
   * The failure this refuses is silent in the worst way. A sending domain
   * built inside a zone the operator does not control is a domain they cannot
   * publish DKIM for, so every site stops at `requested` and refuses to send —
   * and the records the console shows them point at Aglyn.
   */
  it('derives both apexes from the operator tenant domain', () => {
    process.env.NEXT_PUBLIC_TENANT_DOMAIN = 'sites.example.com'
    try {
      expect(tenantWebApex()).toBe('sites.example.com')
      expect(platformSendingApex()).toBe('mail.sites.example.com')
      expect(platformSendingDomainFor('acme')).toBe(
        'acme.mail.sites.example.com',
      )
    } finally {
      delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
    }
  })
})

describe('a hostile slug cannot name mail infrastructure', () => {
  /**
   * The hijack the whole reserved list exists for. `send` is the return-path
   * label, so a tenant holding it holds the bounce-routing name of the mail
   * apex itself — a place to publish SPF and MX inside our zone.
   */
  it('refuses the return-path label', () => {
    expect(platformSendingDomainFor('send')).toBe('')
    expect(isReservedMailLabel(SENDING_SUBDOMAIN)).toBe(true)
  })

  /**
   * The list and the constant must not drift. A rename of `SENDING_SUBDOMAIN`
   * that left the blocklist behind would silently re-open the hijack, and
   * nothing else in the tree would notice.
   */
  it('keeps the reserved list in step with the return-path constant', () => {
    expect(PLATFORM_MAIL_RESERVED_LABELS).toContain(SENDING_SUBDOMAIN)
  })

  it.each([
    ['a dot, reaching sideways in the zone', 'evil.send'],
    ['a wildcard, claiming everything below', '*'],
    ['a wildcard inside a label', 'ac*me'],
    ['an underscore, reaching DKIM naming', 'resend_domainkey'],
    ['the DKIM record name itself', 'resend._domainkey'],
    ['the DMARC record name', '_dmarc'],
    ['a leading dash', '-acme'],
    ['a trailing dash', 'acme-'],
    ['a trailing dot', 'acme.'],
    ['an absolute name', 'acme.mail.aglyn.app'],
    ['the mail apex itself', 'mail'],
    ['whitespace', 'ac me'],
    ['an empty label', ''],
    ['a null byte', 'acme\u0000'],
    ['a newline, splitting a zone file', 'acme\nsend'],
    ['uppercase reaching a reserved name', 'SEND'],
  ])('refuses %s', (_why, slug) => {
    expect(platformSendingDomainFor(slug)).toBe('')
  })

  /**
   * The one that matters most, stated as the property rather than as a list:
   * NOTHING a slug can be produces a name at or above the mail apex, and
   * nothing produces a name that is not exactly one label below it.
   */
  it('never produces a name outside its own one label of the apex', () => {
    const hostile = [
      'send',
      '_dmarc',
      'resend._domainkey',
      '*',
      '..',
      'mail',
      'a.b.c',
      'acme.mail.aglyn.app',
      'aglyn.com',
      '',
    ]
    for (const slug of hostile) {
      const domain = platformSendingDomainFor(slug)
      if (!domain) continue
      expect(domain.endsWith(`.${MAIL_APEX}`)).toBe(true)
      expect(domain.slice(0, -(MAIL_APEX.length + 1))).not.toContain('.')
    }
  })

  /**
   * The guard above the grammar check, which the grammar hides on the real
   * apex: `LABEL_PATTERN` already refuses dots, so a dotted apex can never be
   * reproduced by a label. A SINGLE-LABEL apex can be — an operator's internal
   * name, or a test environment — and then a label equal to it would build
   * `acme.acme` and resolve to the apex itself, which sends no mail.
   */
  it('refuses a label that reproduces a single-label apex', () => {
    expect(platformSendingDomainFor('acme', 'acme')).toBe('')
    expect(platformSendingDomainFor('other', 'acme')).toBe('other.acme')
  })

  it('cannot produce a name inside aglyn.com from any slug', () => {
    for (const slug of ['aglyn', 'aglyn.com', 'noreply', 'www', 'billing']) {
      expect(platformSendingDomainFor(slug)).not.toContain('aglyn.com')
    }
  })

  /**
   * Two sites cannot be handed one name by the naming function alone. The
   * uniqueness CLAIM is what enforces this durably; here the point is narrower
   * and still worth pinning — the function is injective, so a collision can
   * only ever come from the claim and never from the derivation.
   */
  it('maps distinct labels to distinct domains', () => {
    const labels = ['acme', 'acme-2', 'acme2', 'northwind', 'a']
    const domains = labels.map((label) => platformSendingDomainFor(label))
    expect(new Set(domains).size).toBe(labels.length)
  })
})

describe('the label is proposed once and then pinned', () => {
  it('proposes the site name on the first attempt', () => {
    expect(mailLabelCandidate('northwind-coffee')).toBe('northwind-coffee')
  })

  it('de-collides with a numbered suffix, the way a taken web slug does', () => {
    expect(mailLabelCandidate('northwind-coffee', 2)).toBe('northwind-coffee-2')
    expect(mailLabelCandidate('northwind-coffee', 3)).toBe('northwind-coffee-3')
  })

  /** A label cut at 63 octets is a label whose records name a different name. */
  it('keeps a suffixed label inside the DNS label limit', () => {
    const long = 'a'.repeat(70)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const label = mailLabelCandidate(long, attempt)
      expect(label.length).toBeLessThanOrEqual(63)
      expect(platformSendingDomainFor(label)).toBe(`${label}.${MAIL_APEX}`)
    }
  })

  /** A reserved base is escaped by the suffix rather than refused forever. */
  it('routes a reserved base to a legal name on a later attempt', () => {
    expect(mailLabelCandidate('send', 1)).toBe('')
    expect(platformSendingDomainFor(mailLabelCandidate('send', 2))).toBe(
      `send-2.${MAIL_APEX}`,
    )
  })

  it('gives nothing back for a name with no usable characters', () => {
    expect(mailLabelCandidate('!!!')).toBe('')
    expect(mailLabelCandidate('')).toBe('')
    expect(mailLabelCandidate(null)).toBe('')
  })

  /**
   * THE RENAME GUARANTEE, expressed where it can be checked without a
   * database: the sending domain is a function of the PINNED LABEL and
   * nothing else. There is no argument to `platformSendingDomainFor` that a
   * rename changes, so no rename can move the result.
   */
  it('builds the same domain regardless of what the site is now called', () => {
    const pinned = 'northwind-coffee'
    const before = platformSendingDomainFor(pinned)
    // The site renames. The pinned label is untouched by construction.
    const after = platformSendingDomainFor(pinned)
    expect(after).toBe(before)
    expect(after).toBe(`northwind-coffee.${MAIL_APEX}`)
    // And the label the site is renamed TO builds a different domain, which
    // is exactly why the pin has to be the input and the slug must not be.
    expect(platformSendingDomainFor('acme-coffee')).not.toBe(before)
  })
})

describe('reading a domain back', () => {
  it('recovers the label it was built from', () => {
    expect(platformSendingLabel(`acme.${MAIL_APEX}`)).toBe('acme')
  })

  it('recognizes our own names and rejects everything else', () => {
    expect(isPlatformSendingDomain(`acme.${MAIL_APEX}`)).toBe(true)
    expect(isPlatformSendingDomain('acme.com')).toBe(false)
    expect(isPlatformSendingDomain('aglyn.com')).toBe(false)
    // The bare apexes are not sending domains and must never be treated as
    // provisionable ones — the web apex publishes `-all`.
    expect(isPlatformSendingDomain(MAIL_APEX)).toBe(false)
    expect(isPlatformSendingDomain(WEB_APEX)).toBe(false)
  })

  /**
   * A stored domain is data, and data can predate a rule. A cleanup path that
   * merely stripped the suffix would derive a label from a name the current
   * rules would never have issued — and then delete records under it.
   */
  it('refuses to derive a label from a name the rules would not issue', () => {
    expect(platformSendingLabel(`send.${MAIL_APEX}`)).toBe('')
    expect(platformSendingLabel(`a.b.${MAIL_APEX}`)).toBe('')
    expect(platformSendingLabel('acme.attacker.com')).toBe('')
  })
})

describe('the records written into our own zone', () => {
  const record = {
    domain: `acme.${MAIL_APEX}`,
    dkimSelector: 'resend',
    dkimPublicKey: 'MIIBIjANBgkqTESTKEY',
    returnPathHost: 'feedback-smtp.us-east-1.amazonses.com',
  }

  /**
   * The records we WRITE must be the records the verifier LOOKS FOR. Two
   * generators is how a wizard comes to print one target while the check reads
   * another, so this is derived from the same function and asserted against
   * it rather than against a hand-written list.
   */
  it('addresses exactly the required records, relative to the zone', () => {
    const required = sendingDomainRequiredRecords(record)
    const zoned = platformZoneRecords(required, WEB_APEX)

    expect(zoned).toHaveLength(required.length)
    for (const [index, entry] of zoned.entries()) {
      expect(entry.name).toBe(
        required[index].name.slice(0, -(WEB_APEX.length + 1)),
      )
      expect(entry.name.endsWith(WEB_APEX)).toBe(false)
      expect(entry.value).toBe(required[index].value)
    }
  })

  it('names the return path and the signing key under the site label', () => {
    const zoned = platformZoneRecords(sendingDnsRecords(record), WEB_APEX)
    const names = zoned.map((entry) => entry.name)
    expect(names).toContain('send.acme.mail')
    expect(names).toContain('resend._domainkey.acme.mail')
  })

  /**
   * A domain with no issued key must publish no DKIM record. An empty TXT is
   * a record that says nothing while looking published, and it can never
   * verify.
   */
  it('drops a record with no value rather than publishing an empty one', () => {
    const zoned = platformZoneRecords(
      sendingDnsRecords({ ...record, dkimPublicKey: '' }),
      WEB_APEX,
    )
    expect(zoned.some((entry) => entry.name.includes('_domainkey'))).toBe(false)
    expect(zoned.every((entry) => entry.value)).toBe(true)
  })

  /** Anything outside the zone is not ours to write. */
  it('drops a record that does not sit inside the zone', () => {
    const zoned = platformZoneRecords(
      [{ type: 'TXT', name: 'send.acme.com', value: 'v=spf1 -all' }],
      WEB_APEX,
    )
    expect(zoned).toEqual([])
  })

  it('carries the MX priority the return path needs', () => {
    const zoned = platformZoneRecords(sendingDnsRecords(record), WEB_APEX)
    const mx = zoned.find((entry) => entry.type === 'MX')
    expect(mx.priority).toBe(10)
    expect(mx.value).toBe('feedback-smtp.us-east-1.amazonses.com')
  })
})

describe('the names a teardown removes', () => {
  /**
   * Every name the domain owns, and NOTHING a neighbouring site owns. The zone
   * driver matches exactly for this reason; a suffix match on `acme` would
   * take `acme-2`'s records with it.
   */
  it('names the domain, its return path and its signing key', () => {
    const names = platformZoneNamesFor('acme', 'resend')
    expect(names).toEqual([
      'acme.mail',
      'send.acme.mail',
      'resend._domainkey.acme.mail',
    ])
  })

  it('names nothing belonging to a site whose label merely starts the same', () => {
    const names = platformZoneNamesFor('acme', 'resend')
    for (const name of names) {
      expect(name.includes('acme-2')).toBe(false)
    }
  })

  /**
   * With no selector the DKIM name cannot be built. Omitting it is correct —
   * a guessed selector deletes nothing and reports success, leaving a live
   * signing key in the zone for a site that no longer exists.
   */
  it('omits the signing key when no selector was recorded', () => {
    const names = platformZoneNamesFor('acme', null)
    expect(names).toEqual(['acme.mail', 'send.acme.mail'])
  })

  it('names nothing at all for a label that could never have been issued', () => {
    expect(platformZoneNamesFor('send', 'resend')).toEqual([])
    expect(platformZoneNamesFor('', 'resend')).toEqual([])
  })
})

describe('tenant mail never resolves to the platform address', () => {
  /**
   * The house rule, checked against the REAL resolver rather than a stand-in.
   *
   * `platformFrom` is present and valid in every case below. The assertion is
   * not that the platform address was missing — it is that a tenant audience
   * cannot reach it.
   */
  it('refuses a tenant send that has selected nothing', () => {
    const verdict = resolveSendingIdentity({
      selection: null,
      platformFrom: PLATFORM_FROM,
      audience: 'tenant',
    })

    expect(verdict.from).toBeNull()
    expect(verdict.source).toBeNull()
    expect(verdict.refusal.code).toBe('tenant-identity-unprovisioned')
  })

  it.each(['requested', 'records-issued', 'failed'] as const)(
    'refuses a tenant send on a domain at %s',
    (status) => {
      const verdict = resolveSendingIdentity({
        selection: {
          domain: `acme.${MAIL_APEX}`,
          status,
          localPart: 'hello',
        },
        platformFrom: PLATFORM_FROM,
        audience: 'tenant',
      })

      expect(verdict.from).toBeNull()
      expect(verdict.summary).not.toContain('aglyn.com')
    },
  )

  it('sends on the site domain once it verifies', () => {
    const verdict = resolveSendingIdentity({
      selection: {
        domain: `acme.${MAIL_APEX}`,
        status: 'verified',
        localPart: 'hello',
      },
      platformFrom: PLATFORM_FROM,
      audience: 'tenant',
    })

    expect(verdict.from).toBe(`hello@acme.${MAIL_APEX}`)
    expect(verdict.source).toBe('custom')
  })

  /**
   * The exhaustive form. No combination of selection state and platform
   * configuration produces an `aglyn.com` address for a tenant audience.
   */
  it('produces no aglyn.com address from any tenant input', () => {
    const selections = [
      null,
      { domain: `acme.${MAIL_APEX}`, status: 'requested' as const, localPart: 'hello' },
      { domain: `acme.${MAIL_APEX}`, status: 'records-issued' as const, localPart: 'hello' },
      { domain: `acme.${MAIL_APEX}`, status: 'failed' as const, localPart: 'hello' },
      { domain: `acme.${MAIL_APEX}`, status: 'verified' as const, localPart: 'hello' },
      { domain: '', status: 'verified' as const, localPart: 'hello' },
      { domain: 'aglyn.com', status: 'requested' as const, localPart: 'noreply' },
    ]

    for (const selection of selections) {
      for (const platformFrom of [PLATFORM_FROM, 'noreply@aglyn.com', '', null]) {
        const verdict = resolveSendingIdentity({
          selection,
          platformFrom,
          audience: 'tenant',
        })
        expect(String(verdict.from ?? '')).not.toContain('aglyn.com')
      }
    }
  })

  /**
   * The other half, and the reason `audience` exists rather than the platform
   * address being deleted outright: Aglyn's own mail to its own customers
   * still leaves on `aglyn.com`, and that is correct.
   */
  it('still resolves the platform address for platform mail', () => {
    const verdict = resolveSendingIdentity({
      selection: null,
      platformFrom: PLATFORM_FROM,
    })

    expect(verdict.source).toBe('platform')
    expect(verdict.from).toBe(PLATFORM_FROM)
  })
})

/*==========================================
  The shared pool
==========================================*/

/**
 * THE POOL IS THE THING THAT MAKES THIS SCALE.
 *
 * A dedicated per-site domain is `O(hosts)` in three resources that do not
 * stretch: a provider domain object out of a per-account allowance, THREE
 * records in our own DNS zone, and a permanent place in the re-verification
 * sweep. The pool is `O(1)` in all three, and that is the property under test
 * here — not a nicety of naming.
 */
describe('the shared pool', () => {
  it('is a fixed size that does not grow with hosts', () => {
    const pool = sharedSendingPool(MAIL_APEX, DEFAULT_SHARED_POOL_SIZE)
    expect(pool).toHaveLength(DEFAULT_SHARED_POOL_SIZE)
    expect(pool[0]).toBe(`shared1.${MAIL_APEX}`)

    // Ten thousand sites, still the same pool. The zone cost is 3 records per
    // MEMBER, so this is the whole DNS footprint of every unprovisioned site
    // on the platform.
    const assigned = new Set<string>()
    for (let index = 0; index < 10_000; index += 1) {
      assigned.add(sharedSendingDomainFor(`Host${index}`, MAIL_APEX, DEFAULT_SHARED_POOL_SIZE))
    }
    expect(assigned.size).toBeLessThanOrEqual(DEFAULT_SHARED_POOL_SIZE)
    for (const domain of assigned) expect(pool).toContain(domain)
  })

  it('spreads sites across every member, so one bad sender is not everybody', () => {
    const counts = new Map<string, number>()
    for (let index = 0; index < 4_000; index += 1) {
      const domain = sharedSendingDomainFor(`Host${index}`, MAIL_APEX, 4)
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
    // All four members carry traffic, and none of them carries most of it. A
    // hash that degenerated onto one member would satisfy every other test in
    // this block while leaving the blast radius exactly where it started.
    expect(counts.size).toBe(4)
    for (const share of counts.values()) {
      expect(share).toBeGreaterThan(4_000 / 4 / 3)
    }
  })

  it('gives one site the same member every time', () => {
    for (const id of ['HostAbc', 'HostXyz', 'a', 'Z9']) {
      const first = sharedSendingDomainFor(id, MAIL_APEX, 4)
      expect(sharedSendingDomainFor(id, MAIL_APEX, 4)).toBe(first)
    }
  })

  /**
   * THE REASON THIS IS RENDEZVOUS HASHING AND NOT A MODULO.
   *
   * An operator grows the pool when a member is in trouble, which makes that
   * the worst possible moment to shuffle everybody. Reputation is built by
   * sending steadily from one name, so a site that is reassigned does not get
   * rebalanced — it gets reset.
   *
   * The guarantee is NOT "few sites move" in general: adding a fifth member to
   * four must move about a fifth of them, because that is what a balanced
   * assignment across five members means. The guarantee is that **nothing moves
   * that did not have to** — every site that moves, moves ONTO the new member,
   * and no site is shuffled between two members that both already existed.
   *
   * That second assertion is the one a modulo fails catastrophically. `hash %
   * 4` → `hash % 5` reassigns roughly 80% of hosts and scatters them across
   * every member, so the great majority of the churn is pure loss: sites
   * abandoning one warm domain for another warm domain, for nothing.
   */
  it('moves sites only onto the NEW member when the pool grows', () => {
    const before = new Map<string, string>()
    for (let index = 0; index < 2_000; index += 1) {
      before.set(`Host${index}`, sharedSendingDomainFor(`Host${index}`, MAIL_APEX, 4))
    }

    const added = `shared5.${MAIL_APEX}`
    let moved = 0
    for (const [id, was] of before) {
      const now = sharedSendingDomainFor(id, MAIL_APEX, 5)
      if (now === was) continue
      moved += 1
      // The whole property, in one assertion: a site that moved went to the
      // member that did not exist before. Nothing churns between old members.
      expect(now).toBe(added)
    }

    // And the share that moved is about the 1/5 a balanced pool of five
    // implies — not the ~80% a modulo would reassign.
    expect(moved / before.size).toBeGreaterThan(0.1)
    expect(moved / before.size).toBeLessThan(0.32)
  })

  /**
   * The other direction, which is what an operator actually does to retire a
   * member whose reputation has gone: only that member's own sites move.
   */
  it('moves only the removed member’s sites when the pool shrinks', () => {
    const retired = `shared4.${MAIL_APEX}`
    for (let index = 0; index < 2_000; index += 1) {
      const id = `Host${index}`
      const was = sharedSendingDomainFor(id, MAIL_APEX, 4)
      const now = sharedSendingDomainFor(id, MAIL_APEX, 3)
      if (was !== retired) expect(now).toBe(was)
    }
  })

  it('has no pool, and refuses, when it cannot be told which site is sending', () => {
    expect(sharedSendingDomainFor('', MAIL_APEX, 4)).toBe('')
    expect(sharedTenantSendingFrom('', MAIL_APEX, 4)).toBe('')
    expect(sharedTenantSendingFrom(null, MAIL_APEX, 4)).toBe('')
  })

  /**
   * The address must sit ON a pool member, never under one — see the module
   * docblock. Under `adkim=s` the `From:` domain and the DKIM `d=` have to be
   * the same name, and each member is its own provider domain object signing
   * for itself.
   */
  it('puts the address exactly on a member, one label below the apex', () => {
    const from = sharedTenantSendingFrom('HostAbc', MAIL_APEX, 4)
    const domain = from.split('@')[1]

    expect(sharedSendingPool(MAIL_APEX, 4)).toContain(domain)
    expect(domain.endsWith(`.${MAIL_APEX}`)).toBe(true)
    // Exactly one label deeper. A second label would be a name whose DKIM key
    // is its parent's, which does not align under strict DMARC.
    expect(domain.slice(0, -(MAIL_APEX.length + 1))).not.toContain('.')
    expect(from).not.toContain('aglyn.com')
  })

  /**
   * A tenant must not be able to take a pool label. Checked by RULE rather
   * than by list, so raising the pool size cannot hand a site a name the pool
   * is about to want.
   */
  it('reserves every pool label against tenants, at any pool size', () => {
    for (const label of ['shared1', 'shared2', 'shared9', 'shared64', 'shared128']) {
      expect(isSharedPoolLabel(label)).toBe(true)
      expect(isReservedMailLabel(label)).toBe(true)
      expect(platformSendingDomainFor(label, MAIL_APEX)).toBe('')
    }
    // …and does not over-reach onto names a site might legitimately want.
    for (const label of ['shared', 'sharedthings', 'share1', 'shared-1', 'shared0x']) {
      expect(isSharedPoolLabel(label)).toBe(false)
    }
    // `shared` itself IS reserved, by the fixed list rather than the pattern.
    expect(isReservedMailLabel('sharedthings')).toBe(false)
  })

  it('builds the pool despite those labels being reserved against tenants', () => {
    // The deadlock this guards: routing the pool builder through the tenant
    // gate would refuse every one of its own names and yield an empty pool —
    // the guard protecting the pool being what stopped the pool existing.
    expect(sharedSendingPool(MAIL_APEX, 4)).toHaveLength(4)
  })

  /**
   * ⛔ NOTHING MAY EVER TEAR A POOL MEMBER DOWN.
   *
   * This is the most important assertion about the pool and the reason
   * {@link sendingDomainTeardownRefusal} exists as one function rather than as
   * a check each teardown path writes for itself.
   *
   * A pool member is owned by NO HOST — sites are assigned to one by hash, not
   * by a stored pointer — so "nothing points at this domain" describes a live
   * pool member perfectly. Any orphan reaper is therefore, by default, a
   * program that deletes exactly these four. Releasing one at the provider
   * stops a quarter of the platform's receipts, password resets and booking
   * confirmations, and stops them silently: a domain that is merely no longer
   * verified raises no error anywhere, the sends just start refusing.
   */
  describe('⛔ the teardown refusal', () => {
    it('refuses EVERY pool member, at every pool size', () => {
      for (const size of [1, 4, 8, 64]) {
        for (const domain of sharedSendingPool(MAIL_APEX, size)) {
          expect(sendingDomainTeardownRefusal(domain, null, MAIL_APEX, size)).toBe(
            'shared-pool',
          )
        }
      }
    })

    it('refuses on the LABEL too, which is the hole a fallback opens', () => {
      /*
       * `platformSendingLabel` hands back `''` for a pool member, because the
       * label is reserved. A teardown that then fell back to a label it was
       * given separately — which is exactly what
       * `sendingDomainLabel(domain) || teardown.label` does — would walk past
       * the derivation that was protecting it and delete the pool member's
       * zone records under its own name.
       */
      expect(platformSendingLabel('shared3.mail.aglyn.app', MAIL_APEX)).toBe('')
      expect(
        sendingDomainTeardownRefusal('shared3.mail.aglyn.app', 'shared3', MAIL_APEX, 4),
      ).toBe('shared-pool')
      // And on the label alone, for a caller whose domain field is empty or
      // has been rewritten to something else.
      expect(sendingDomainTeardownRefusal('', 'shared2', MAIL_APEX, 4)).toBe(
        'shared-pool',
      )
      expect(
        sendingDomainTeardownRefusal('northwind.mail.aglyn.app', 'shared1', MAIL_APEX, 4),
      ).toBe('shared-pool')
    })

    it('refuses a member the CURRENT pool size no longer reaches', () => {
      // A deployment shrunk from eight to four still holds `shared5`..`shared8`
      // at the provider, and they are still infrastructure. The label pattern
      // is what catches them; a membership test against the current pool alone
      // would hand all four to the reaper the moment the size was lowered.
      expect(sendingDomainTeardownRefusal('shared7.mail.aglyn.app', null, MAIL_APEX, 4))
        .toBe('shared-pool')
    })

    it('still permits an ordinary tenant domain — the control', () => {
      // Without this the block above passes for a function that refuses
      // everything, which would be a reaper that never reaps and a leak that
      // never closes.
      expect(
        sendingDomainTeardownRefusal('northwind.mail.aglyn.app', 'northwind', MAIL_APEX, 4),
      ).toBeNull()
      expect(
        sendingDomainTeardownRefusal('shared-goods.mail.aglyn.app', 'shared-goods', MAIL_APEX, 4),
      ).toBeNull()
    })

    it("refuses a customer's own domain as not ours to touch", () => {
      // A different refusal with a different consequence: we never provisioned
      // it, hold no provider slot for it, and must never write to its zone.
      expect(sendingDomainTeardownRefusal('acme.com', null, MAIL_APEX, 4)).toBe(
        'not-our-zone',
      )
      expect(sendingDomainTeardownRefusal(MAIL_APEX, null, MAIL_APEX, 4)).toBe(
        'not-our-zone',
      )
      expect(sendingDomainTeardownRefusal('', null, MAIL_APEX, 4)).toBe('not-our-zone')
    })
  })
})
