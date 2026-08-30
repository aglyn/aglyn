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
 * The sending-domain store.
 *
 * DNS and Firestore are faked; the DECISIONS are real. `assessSendingRecords`
 * and `resolveSendingIdentity` are imported from the pure module and never
 * mocked, so "the store obeys the rule" is a statement about the rule the
 * product actually runs rather than about a stand-in for it.
 *
 * The assertions that matter most are in "an unverified record refuses" and
 * "an unreachable resolver changes nothing".
 */

type Doc = Record<string, unknown>

const store = new Map<string, Doc>()
const DELETE = '<delete>'

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string) {
  return {
    path,
    id: path.split('/').pop(),
    async get() {
      return snapshotOf(path)
    },
    async set(value: Doc, options?: { merge?: boolean }) {
      const previous = options?.merge ? (store.get(path) ?? {}) : {}
      const merged = { ...previous, ...value }
      for (const [key, entry] of Object.entries(merged)) {
        if (entry === DELETE) delete merged[key]
      }
      store.set(path, merged)
    },
    async delete() {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string) {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    async get() {
      const docs = [...store.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(snapshotOf)
      return { docs, empty: docs.length === 0 }
    },
  }
}

const db = { collection: (name: string) => collectionRef(name) }

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => db }),
    firestore: { FieldValue: { delete: () => DELETE } },
  },
}))

const lookupTxt = jest.fn()
const lookupMx = jest.fn()
jest.mock('./dns-probe', () => ({
  __esModule: true,
  lookupTxt: (host: string) => lookupTxt(host),
  lookupMx: (host: string) => lookupMx(host),
}))

import {
  getSendingDomain,
  listSendingDomains,
  readDmarcPolicy,
  recordIssuedSendingDomain,
  recordSendingDomainIssueFailure,
  releaseSendingDomain,
  requestSendingDomain,
  resolveHostSendingIdentity,
  sendingDkimSelector,
  verifySendingDomain,
} from './sending-domains'
import { sendingDomainRequiredRecords } from '@aglyn/shared-util-email'

const ORG = 'org123'
const DOMAIN = 'acme.com'
const DKIM_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAexamplekey'
const PLATFORM = 'noreply@aglyn.com'
const SELECTOR = `aglyn-${ORG}`

/** The three lookups a verification makes, all answering correctly. */
function dnsAllPublished() {
  lookupTxt.mockImplementation(async (host: string) => {
    if (host === `send.${DOMAIN}`) {
      return { answered: true, records: ['v=spf1 include:amazonses.com ~all'] }
    }
    if (host === `${SELECTOR}._domainkey.${DOMAIN}`) {
      return { answered: true, records: [`p=${DKIM_KEY}`] }
    }
    return { answered: true, records: [] }
  })
  lookupMx.mockResolvedValue({
    answered: true,
    records: [{ exchange: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 }],
  })
}

async function seedIssued() {
  await requestSendingDomain({ orgId: ORG, domain: DOMAIN })
  await recordIssuedSendingDomain({
    orgId: ORG,
    domain: DOMAIN,
    dkimPublicKey: DKIM_KEY,
    returnPathHost: 'feedback-smtp.us-east-1.amazonses.com',
  })
}

beforeEach(() => {
  store.clear()
  lookupTxt.mockReset()
  lookupMx.mockReset()
  lookupTxt.mockResolvedValue({ answered: true, records: [] })
  lookupMx.mockResolvedValue({ answered: true, records: [] })
})

/*==========================================
  The refusal, through the store
==========================================*/

describe('an unverified record refuses', () => {
  /**
   * The end-to-end statement of the rule, made against the stored document
   * rather than a hand-built selection: a site pointed at a real, issued, not
   * yet verified domain does not send, and does not send as the platform.
   */
  it('refuses a site pointed at a domain that is issued but not verified', async () => {
    await seedIssued()

    const verdict = await resolveHostSendingIdentity({
      orgId: ORG,
      selectedDomain: DOMAIN,
      platformFrom: PLATFORM,
    })

    expect(verdict.refusal).not.toBeNull()
    expect(verdict.from).toBeNull()
    expect(verdict.from).not.toBe(PLATFORM)
    expect(verdict.refusal.domain).toBe(DOMAIN)
  })

  it('refuses a selection whose record has been released', async () => {
    // The record is gone and the site still names it. That is a site
    // configured to send as a domain nothing has verified.
    await seedIssued()
    await releaseSendingDomain(ORG, DOMAIN)

    const verdict = await resolveHostSendingIdentity({
      orgId: ORG,
      selectedDomain: DOMAIN,
      platformFrom: PLATFORM,
    })

    expect(verdict.refusal).not.toBeNull()
    expect(verdict.from).toBeNull()
  })

  /**
   * The rule this feature is FOR, stated where its opposite used to be.
   *
   * A site that has selected nothing does not borrow the platform's address.
   * `aglyn.com` carries Aglyn's own billing and account mail, and a tenant's
   * list quality must never be charged against it — which is what the previous
   * behavior did, for every site, including their transactional mail.
   *
   * `platformFrom` is supplied and CORRECT here on purpose: the assertion is
   * not that the address was unavailable, it is that a perfectly usable
   * platform address is not reachable from this audience at all.
   */
  it('refuses rather than borrowing the platform address when the site selects nothing', async () => {
    const verdict = await resolveHostSendingIdentity({
      orgId: ORG,
      selectedDomain: null,
      platformFrom: PLATFORM,
    })

    expect(verdict.source).toBeNull()
    expect(verdict.from).toBeNull()
    expect(verdict.refusal.code).toBe('tenant-identity-unprovisioned')
  })

  it('sends on the custom identity once the domain verifies', async () => {
    await seedIssued()
    dnsAllPublished()
    await verifySendingDomain(ORG, DOMAIN)

    const verdict = await resolveHostSendingIdentity({
      orgId: ORG,
      selectedDomain: DOMAIN,
      selectedLocalPart: 'news',
      platformFrom: PLATFORM,
    })

    expect(verdict.source).toBe('custom')
    expect(verdict.from).toBe('news@acme.com')
  })

  it('does not read any org document when the site selects nothing', async () => {
    // A campaign resolves an identity on a hot path. The common case must not
    // pay for a feature it is not using.
    const reads: string[] = []
    const original = db.collection
    db.collection = ((name: string) => {
      reads.push(name)
      return original(name)
    }) as typeof db.collection

    await resolveHostSendingIdentity({
      orgId: ORG,
      selectedDomain: null,
      platformFrom: PLATFORM,
    })

    db.collection = original
    expect(reads).toEqual([])
  })
})

/*==========================================
  Verification
==========================================*/

describe('verifySendingDomain', () => {
  it('flips to verified when every record is live', async () => {
    await seedIssued()
    dnsAllPublished()

    const result = await verifySendingDomain(ORG, DOMAIN)

    expect(result.record.status).toBe('verified')
    expect(result.missing).toEqual([])
    expect(result.record.verifiedAtMs).toBeGreaterThan(0)
  })

  it('flips to failed and names what is missing', async () => {
    await seedIssued()
    // SPF is live; DKIM and the return path are not.
    lookupTxt.mockImplementation(async (host: string) =>
      host === `send.${DOMAIN}`
        ? { answered: true, records: ['v=spf1 include:amazonses.com ~all'] }
        : { answered: true, records: [] },
    )
    lookupMx.mockResolvedValue({ answered: true, records: [] })

    const result = await verifySendingDomain(ORG, DOMAIN)

    expect(result.record.status).toBe('failed')
    expect(result.record.lastMissing).toEqual([
      `TXT:${SELECTOR}._domainkey.${DOMAIN}`,
      `MX:send.${DOMAIN}`,
    ])
  })

  /**
   * The arm that keeps a resolver outage from stopping a tenant's mail.
   *
   * A verified domain whose lookup nobody answers must stay verified. Marking
   * it failed would refuse every send for a customer whose DNS never changed,
   * and the refusal would be indistinguishable from a real misconfiguration.
   */
  it('leaves a verified domain verified when the resolver is unreachable', async () => {
    await seedIssued()
    dnsAllPublished()
    await verifySendingDomain(ORG, DOMAIN)

    lookupTxt.mockResolvedValue({ answered: false, records: [] })
    lookupMx.mockResolvedValue({ answered: false, records: [] })
    const result = await verifySendingDomain(ORG, DOMAIN)

    expect(result.inconclusive).toBe(true)
    expect(result.record.status).toBe('verified')
    // And the site keeps sending.
    const verdict = await resolveHostSendingIdentity({
      orgId: ORG,
      selectedDomain: DOMAIN,
      platformFrom: PLATFORM,
    })
    expect(verdict.source).toBe('custom')
  })

  it('leaves an unverified domain unverified when the resolver is unreachable', async () => {
    // The other direction of the same rule: silence is not proof either way.
    await seedIssued()
    lookupTxt.mockResolvedValue({ answered: false, records: [] })
    lookupMx.mockResolvedValue({ answered: false, records: [] })

    const result = await verifySendingDomain(ORG, DOMAIN)

    expect(result.inconclusive).toBe(true)
    expect(result.record.status).toBe('records-issued')
  })

  it('never verifies a domain whose DKIM key was never issued', async () => {
    // Only `requested`: no key, nothing to sign with, nothing to verify.
    await requestSendingDomain({ orgId: ORG, domain: DOMAIN })
    dnsAllPublished()

    const result = await verifySendingDomain(ORG, DOMAIN)

    expect(result.record.status).toBe('failed')
    expect(result.record.status).not.toBe('verified')
  })

  it('refuses to verify a domain with no claim', async () => {
    const result = await verifySendingDomain(ORG, DOMAIN)

    expect(result.error).toMatch(/add it first/i)
    expect(result.record).toBeNull()
  })
})

/*==========================================
  The record and its lifecycle
==========================================*/

describe('the record', () => {
  it('starts at requested, with a per-org DKIM selector', async () => {
    const result = await requestSendingDomain({ orgId: ORG, domain: ' ACME.com ' })

    expect(result.status).toBe(201)
    expect(result.record.domain).toBe(DOMAIN)
    expect(result.record.status).toBe('requested')
    // Two orgs verifying the same name must not share one record name.
    expect(result.record.dkimSelector).toBe(SELECTOR)
    expect(sendingDkimSelector('other')).not.toBe(SELECTOR)
  })

  it('is idempotent and keeps an issued key on a re-request', async () => {
    // Reissuing would invalidate a record the customer may already have
    // published, turning a working setup into a mysterious failure.
    await seedIssued()

    const again = await requestSendingDomain({ orgId: ORG, domain: DOMAIN })

    expect(again.status).toBe(200)
    expect(again.record.dkimPublicKey).toBe(DKIM_KEY)
    expect(again.record.status).toBe('records-issued')
  })

  it('refuses a mailbox provider and a malformed name', async () => {
    expect((await requestSendingDomain({ orgId: ORG, domain: 'gmail.com' })).status).toBe(400)
    expect((await requestSendingDomain({ orgId: ORG, domain: 'nope' })).status).toBe(400)
  })

  it('will not record a key against a domain with no claim', async () => {
    const result = await recordIssuedSendingDomain({
      orgId: ORG,
      domain: DOMAIN,
      dkimPublicKey: DKIM_KEY,
    })

    expect(result.status).toBe(404)
  })

  it('shows the records the customer must publish', async () => {
    await seedIssued()

    const view = await getSendingDomain(ORG, DOMAIN)

    expect(view.records.map((entry) => entry.name)).toEqual([
      `send.${DOMAIN}`,
      `${SELECTOR}._domainkey.${DOMAIN}`,
      `send.${DOMAIN}`,
    ])
    expect(view.records[1].value).toBe(`p=${DKIM_KEY}`)
  })

  it('lists a org’s domains', async () => {
    await seedIssued()
    await requestSendingDomain({ orgId: ORG, domain: 'other.com' })

    const domains = await listSendingDomains(ORG)

    expect(domains.map((entry) => entry.domain).sort()).toEqual(['acme.com', 'other.com'])
  })
})

/*==========================================
  Recording what a provider issued — or refused
==========================================*/

/**
 * The seam the console's provider driver feeds.
 *
 * Its whole job is that there is no path from a provider that issued nothing
 * to a domain that says it has records. `records-issued` is a promise the
 * customer acts on: they open their registrar because we told them there is
 * something to publish.
 */
describe('the issuing seam', () => {
  it('records the key AND the selector the provider actually signs under', async () => {
    await requestSendingDomain({ orgId: ORG, domain: DOMAIN })

    // Resend signs on a selector of its own choosing, not the per-org name
    // `sendingDkimSelector` proposes.
    const result = await recordIssuedSendingDomain({
      orgId: ORG,
      domain: DOMAIN,
      dkimPublicKey: DKIM_KEY,
      dkimSelector: 'resend',
      providerDomainId: 'd91cd9bd',
    })

    expect(result.status).toBe(200)
    expect(result.record.status).toBe('records-issued')
    expect(result.record.dkimSelector).toBe('resend')
    expect(result.record.providerDomainId).toBe('d91cd9bd')

    const view = await getSendingDomain(ORG, DOMAIN)
    expect(view.records[1].name).toBe(`resend._domainkey.${DOMAIN}`)
  })

  it('keeps the proposed selector when the provider named none', async () => {
    await requestSendingDomain({ orgId: ORG, domain: DOMAIN })

    const result = await recordIssuedSendingDomain({
      orgId: ORG,
      domain: DOMAIN,
      dkimPublicKey: DKIM_KEY,
    })

    expect(result.record.dkimSelector).toBe(SELECTOR)
  })

  /**
   * The invariant the whole seam exists for: a domain that reports
   * `records-issued` HAS records. A status saying otherwise beside an empty
   * DKIM row is a blank the customer reads as our bug, and it can never
   * verify — `assessSendingRecords` refuses it from the other side.
   */
  it('refuses to reach records-issued without a publishable DKIM record', async () => {
    await requestSendingDomain({ orgId: ORG, domain: DOMAIN })

    const empty = await recordIssuedSendingDomain({
      orgId: ORG,
      domain: DOMAIN,
      dkimPublicKey: '   ',
    })

    expect(empty.status).toBe(400)
    expect((await getSendingDomain(ORG, DOMAIN)).record.status).toBe('requested')
  })

  it('never overwrites a key the customer may already have published', async () => {
    await seedIssued()

    const clobber = await recordIssuedSendingDomain({
      orgId: ORG,
      domain: DOMAIN,
      dkimPublicKey: 'ADIFFERENTKEYENTIRELY',
    })

    expect(clobber.status).toBe(409)
    expect((await getSendingDomain(ORG, DOMAIN)).record.dkimPublicKey).toBe(DKIM_KEY)
  })

  it('is a no-op when the same key arrives twice, so a retry is safe', async () => {
    await seedIssued()

    const again = await recordIssuedSendingDomain({
      orgId: ORG,
      domain: DOMAIN,
      dkimPublicKey: DKIM_KEY,
    })

    expect(again.status).toBe(200)
    expect(again.record.status).toBe('records-issued')
  })

  /**
   * A `4xx` from the provider means no key exists. The domain stays where it
   * was — refusing sends, with nothing to publish — and carries a reason,
   * rather than a status that says the work is done.
   */
  it('records a provider failure as a REASON, never as a status', async () => {
    await requestSendingDomain({ orgId: ORG, domain: DOMAIN })

    await recordSendingDomainIssueFailure({
      orgId: ORG,
      domain: DOMAIN,
      detail: 'http-403:restricted_api_key',
    })

    const view = await getSendingDomain(ORG, DOMAIN)
    expect(view.record.status).toBe('requested')
    expect(view.record.dkimPublicKey).toBeNull()
    expect(view.record.lastIssueError).toBe('http-403:restricted_api_key')
    // Nothing publishable, so nothing a surface could print as a record.
    expect(sendingDomainRequiredRecords(view.record)).toHaveLength(2)
  })

  it('a failure on a verified domain does not unverify it', async () => {
    await seedIssued()
    dnsAllPublished()
    await verifySendingDomain(ORG, DOMAIN)

    await recordSendingDomainIssueFailure({ orgId: ORG, domain: DOMAIN, detail: 'timeout' })

    expect((await getSendingDomain(ORG, DOMAIN)).record.status).toBe('verified')
  })

  it('clears a stale failure once a key is recorded', async () => {
    await requestSendingDomain({ orgId: ORG, domain: DOMAIN })
    await recordSendingDomainIssueFailure({ orgId: ORG, domain: DOMAIN, detail: 'timeout' })

    await recordIssuedSendingDomain({ orgId: ORG, domain: DOMAIN, dkimPublicKey: DKIM_KEY })

    expect((await getSendingDomain(ORG, DOMAIN)).record.lastIssueError).toBeNull()
  })

  /**
   * The store is the last place a leaked credential could land, and a
   * Firestore document is the worst of the three places it could land in —
   * it outlives the request, the log retention and the deploy.
   */
  it('redacts anything key-shaped before it reaches the document', async () => {
    await requestSendingDomain({ orgId: ORG, domain: DOMAIN })

    await recordSendingDomainIssueFailure({
      orgId: ORG,
      domain: DOMAIN,
      detail: 'rejected Bearer re_domains_notarealkey_0123456789abcdef',
    })

    const stored = String((await getSendingDomain(ORG, DOMAIN)).record.lastIssueError)
    expect(stored).not.toContain('notarealkey')
    expect(stored).toContain('[redacted]')
  })

  it('will not write a failure against a domain with no claim', async () => {
    await recordSendingDomainIssueFailure({ orgId: ORG, domain: DOMAIN, detail: 'timeout' })

    expect(await getSendingDomain(ORG, DOMAIN)).toBeNull()
  })
})

/*==========================================
  DMARC
==========================================*/

describe('readDmarcPolicy', () => {
  it('reports the policy the customer publishes', async () => {
    lookupTxt.mockResolvedValue({
      answered: true,
      records: ['v=DMARC1; p=reject'],
    })

    expect((await readDmarcPolicy(DOMAIN)).policy).toBe('reject')
  })

  it('answers null rather than "absent" when nobody answered', async () => {
    // Reporting `absent` here would tell a customer under p=reject that they
    // have no protection, which is both wrong and the opposite of the truth.
    lookupTxt.mockResolvedValue({ answered: false, records: [] })

    expect(await readDmarcPolicy(DOMAIN)).toBeNull()
  })
})
