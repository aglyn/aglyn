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
 * Re-checking a verified sending domain.
 *
 * DNS and Firestore are faked; the DECISIONS are real. `assessSendingRecords`
 * and `assessDomainDrift` are the shipped pure functions and are never mocked,
 * so "a transient failure changes nothing" is a statement about the rule the
 * product runs rather than about a stand-in for it.
 *
 * The two assertions the whole module exists for sit in "a resolver outage"
 * and "a record that is genuinely gone": an unreachable lookup must never cost
 * a working sender their domain, and a removed record must eventually cost a
 * drifted one theirs.
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
    ref: docRef(path),
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
        .filter(
          (key) =>
            key.startsWith(`${path}/`) &&
            !key.slice(path.length + 1).includes('/'),
        )
        .map(snapshotOf)
      return { docs, empty: docs.length === 0 }
    },
  }
}

/** Whether the query builder was asked for the composite ordering. */
let orderedBy: string | null = null

/**
 * A collection-group query that honors the two filters and the order, because
 * every safety property here depends on WHICH documents the sweep sees.
 *
 * It also reproduces the one Firestore behavior that could silently hide a
 * domain: a document with no value at the ordered field is not returned. A
 * fake that ignored that would make the invariant test below vacuous.
 */
function collectionGroupRef(name: string) {
  const filters: Array<[string, string, unknown]> = []
  let take = Infinity
  const query = {
    where(field: string, op: string, value: unknown) {
      filters.push([field, op, value])
      return query
    },
    orderBy(field: string) {
      orderedBy = field
      return query
    },
    limit(count: number) {
      take = count
      return query
    },
    async get() {
      const docs = [...store.entries()]
        .filter(([key]) => key.split('/').slice(-2, -1)[0] === name)
        .filter(([, data]) =>
          filters.every(([field, op, value]) => {
            const held = data[field]
            if (op === '==') return held === value
            if (op === '<') {
              return typeof held === 'number' && held < (value as number)
            }
            return true
          }),
        )
        .filter(([, data]) => !orderedBy || data[orderedBy] !== undefined)
        .sort(
          ([, a], [, b]) =>
            Number(a[orderedBy ?? 'lastCheckedAtMs']) -
            Number(b[orderedBy ?? 'lastCheckedAtMs']),
        )
        .slice(0, take)
        .map(([key]) => snapshotOf(key))
      return { docs, empty: docs.length === 0 }
    },
  }
  return query
}

const db = {
  collection: (name: string) => collectionRef(name),
  collectionGroup: (name: string) => collectionGroupRef(name),
}

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
  recheckSendingDomains,
  driftProbeStatus,
  SENDING_DOMAIN_DRIFT_MIN_AGE_MS,
  SENDING_DOMAIN_FAILURES_BEFORE_REVOKE,
} from './sending-domain-recheck'
import { verifySendingDomain } from './sending-domains'

const ORG = 'org123'
const DOMAIN = 'acme.com'
const DKIM_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAexamplekey'
const SELECTOR = `aglyn-${ORG}`
const RETURN_PATH = 'feedback-smtp.us-east-1.amazonses.com'
const PATH = `orgs/${ORG}/sendingDomains/${DOMAIN}`

const DAY = 24 * 60 * 60_000
/** Comfortably past both the staleness floor and the drift age floor. */
const NOW = 400 * DAY

/**
 * How far apart two checks of one domain actually land.
 *
 * NOT exactly the staleness floor. The sweep asks for domains checked strictly
 * LONGER ago than the floor, and the beat that asks is hourly, so a domain
 * checked at T becomes due at the first beat after T + 24h. Stepping by
 * exactly 24h in a test would model a domain that is never due again —
 * a mistake that reads as the feature being broken.
 */
const CHECK_STEP_MS = DAY + 60 * 60_000

/**
 * Checks a removed record survives before the sweep acts, derived from the two
 * thresholds rather than written out.
 *
 * Both must be met, so it is the LATER of them: the count is reached on check
 * `failures - 1` (check zero is the first miss), and the age floor not until
 * the first miss is that old. Deriving it is what makes the boundary tests
 * move with the constants instead of silently asserting the wrong step.
 */
const CHECKS_TO_REVOKE = Math.max(
  SENDING_DOMAIN_FAILURES_BEFORE_REVOKE - 1,
  Math.ceil(SENDING_DOMAIN_DRIFT_MIN_AGE_MS / CHECK_STEP_MS),
)

/** All three lookups answer, and everything the domain needs is published. */
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
    records: [{ exchange: RETURN_PATH, priority: 10 }],
  })
}

/** The DKIM record has been deleted. Everything answered; it is not there. */
function dnsDkimRemoved() {
  dnsAllPublished()
  const published = lookupTxt.getMockImplementation()
  lookupTxt.mockImplementation(async (host: string) => {
    if (host === `${SELECTOR}._domainkey.${DOMAIN}`) {
      return { answered: true, records: [] }
    }
    return published(host)
  })
}

/** Nobody answered. The records may be perfect; we cannot see them. */
function dnsUnreachable() {
  lookupTxt.mockResolvedValue({ answered: false, records: [] })
  lookupMx.mockResolvedValue({ answered: false, records: [] })
}

/** A domain in the state the sweep is about: verified, and long unchecked. */
function seedVerified(extra: Doc = {}) {
  store.set(PATH, {
    domain: DOMAIN,
    status: 'verified',
    dkimSelector: SELECTOR,
    dkimPublicKey: DKIM_KEY,
    returnPathHost: RETURN_PATH,
    verifiedAtMs: NOW - 200 * DAY,
    lastCheckedAtMs: NOW - 30 * DAY,
    ...extra,
  })
}

const held = () => store.get(PATH) ?? {}

beforeEach(() => {
  store.clear()
  orderedBy = null
  lookupTxt.mockReset()
  lookupMx.mockReset()
  lookupTxt.mockResolvedValue({ answered: true, records: [] })
  lookupMx.mockResolvedValue({ answered: true, records: [] })
})

/*==========================================
  A resolver outage costs nobody their domain
==========================================*/

describe('a resolver outage', () => {
  it('leaves a verified domain verified when nobody answered', async () => {
    seedVerified()
    dnsUnreachable()

    const summary = await recheckSendingDomains({ nowMs: NOW })

    // THE assertion this module exists for. Every lookup failed, which is
    // exactly what a customer who deleted their records also looks like to a
    // naive check — and the difference is the whole safety property.
    expect(summary.held).toBe(1)
    expect(summary.revoked).toBe(0)
    expect(held().status).toBe('verified')
    expect(held().lastMissing).toBeUndefined()
  })

  it('records no failure at all, so an outage cannot build a case', async () => {
    seedVerified()
    dnsUnreachable()

    await recheckSendingDomains({ nowMs: NOW })

    // Not "one failure, cleared later" — none. An outage must not manufacture
    // evidence, or three days of it would revoke every domain on the platform
    // at once.
    expect(held().recheckFailures).toBeUndefined()
    expect(held().recheckFirstFailureAtMs).toBeUndefined()
  })

  it('never revokes, however many times it repeats', async () => {
    seedVerified()
    dnsUnreachable()

    for (let n = 0; n <= CHECKS_TO_REVOKE + 5; n += 1) {
      await recheckSendingDomains({ nowMs: NOW + n * CHECK_STEP_MS })
    }

    // Well past the point where the same number of CONCLUSIVE misses would
    // have un-verified it. An outage of any length is still evidence of
    // nothing.
    expect(held().status).toBe('verified')
    expect(held().recheckFailures).toBeUndefined()
  })

  it('does not launder away failures already gathered', async () => {
    // Two conclusive misses on record, then the resolver goes down. The run
    // must PAUSE, not reset: an outage that cleared the count would let a
    // genuinely removed record hide behind one.
    seedVerified({
      recheckFailures: 2,
      recheckFirstFailureAtMs: NOW - 10 * DAY,
    })
    dnsUnreachable()

    await recheckSendingDomains({ nowMs: NOW })

    expect(held().recheckFailures).toBe(2)
    expect(held().recheckFirstFailureAtMs).toBe(NOW - 10 * DAY)
  })

  it('moves the check time so an unreachable domain cannot monopolize the batch', async () => {
    seedVerified()
    dnsUnreachable()

    await recheckSendingDomains({ nowMs: NOW })

    expect(held().lastCheckedAtMs).toBe(NOW)
  })
})

/*==========================================
  A record that is genuinely gone
==========================================*/

describe('a removed record', () => {
  it('does not revoke on the first conclusive miss', async () => {
    seedVerified()
    dnsDkimRemoved()

    const summary = await recheckSendingDomains({ nowMs: NOW })

    // One answer is not enough for an unattended sweep. The count starts and
    // the domain keeps sending.
    expect(summary.counted).toBe(1)
    expect(summary.revoked).toBe(0)
    expect(held().status).toBe('verified')
    expect(held().recheckFailures).toBe(1)
  })

  it('names the missing record while the domain is still sending', async () => {
    seedVerified()
    dnsDkimRemoved()

    await recheckSendingDomains({ nowMs: NOW })

    expect(held().lastMissing).toEqual([`TXT:${SELECTOR}._domainkey.${DOMAIN}`])
  })

  it('un-verifies once the misses are enough, for long enough', async () => {
    seedVerified()
    dnsDkimRemoved()

    let summary
    for (let n = 0; n <= CHECKS_TO_REVOKE; n += 1) {
      summary = await recheckSendingDomains({ nowMs: NOW + n * CHECK_STEP_MS })
    }

    // The other half of the pair: a domain whose records are actually gone
    // does stop being trusted, or the safety above would just be a way of
    // never acting.
    expect(summary.revoked).toBe(1)
    expect(held().status).toBe('failed')
    expect(held().lastMissing).toEqual([`TXT:${SELECTOR}._domainkey.${DOMAIN}`])
  })

  it('needs the count too, not just the wall clock', async () => {
    // Literal numbers, deliberately. Deriving the scenario from the threshold
    // would make it move WITH the threshold, so lowering the threshold to one
    // would still pass — which is exactly the regression this pins.
    expect(SENDING_DOMAIN_FAILURES_BEFORE_REVOKE).toBeGreaterThanOrEqual(3)

    // A failure run already older than the age floor, two misses in. The age
    // floor is met and must not be sufficient on its own, or a domain whose
    // resolvers answered wrongly once a month ago would be revoked by the
    // next single miss.
    seedVerified({
      recheckFailures: 1,
      recheckFirstFailureAtMs: NOW - 30 * DAY,
    })
    dnsDkimRemoved()

    const summary = await recheckSendingDomains({ nowMs: NOW })

    expect(summary.revoked).toBe(0)
    expect(held().status).toBe('verified')
    expect(held().recheckFailures).toBe(2)
  })

  it('needs the wall clock too, not just the count', async () => {
    seedVerified()
    dnsDkimRemoved()

    // Three checks in three minutes — a beat firing too often, or somebody
    // re-running the sweep by hand. The count is met and the age is not.
    for (let n = 0; n < SENDING_DOMAIN_FAILURES_BEFORE_REVOKE + 2; n += 1) {
      await recheckSendingDomains({
        nowMs: NOW + n * 60_000,
        recheckAfterMs: 0,
      })
    }

    expect(held().status).toBe('verified')
    expect(Number(held().recheckFailures)).toBeGreaterThanOrEqual(
      SENDING_DOMAIN_FAILURES_BEFORE_REVOKE,
    )
  })

  it('spends the run on revoking, so a re-verified domain starts over', async () => {
    seedVerified()
    dnsDkimRemoved()

    for (let n = 0; n <= CHECKS_TO_REVOKE; n += 1) {
      await recheckSendingDomains({ nowMs: NOW + n * CHECK_STEP_MS })
    }

    expect(held().recheckFailures).toBeUndefined()
    expect(held().recheckFirstFailureAtMs).toBeUndefined()
  })
})

/*==========================================
  Recovery
==========================================*/

describe('a domain that comes back', () => {
  it('clears the failure run when the records reappear', async () => {
    seedVerified({
      recheckFailures: 2,
      recheckFirstFailureAtMs: NOW - 10 * DAY,
      lastMissing: ['dkim:whatever'],
    })
    dnsAllPublished()

    const summary = await recheckSendingDomains({ nowMs: NOW })

    // A stale count would make the next unrelated failure the third one.
    expect(summary.cleared).toBe(1)
    expect(held().status).toBe('verified')
    expect(held().recheckFailures).toBeUndefined()
    expect(held().recheckFirstFailureAtMs).toBeUndefined()
    expect(held().lastMissing).toBeUndefined()
  })
})

/*==========================================
  What the sweep looks at
==========================================*/

describe('the sweep selection', () => {
  it('does not re-check a domain checked recently', async () => {
    seedVerified({ lastCheckedAtMs: NOW - 60_000 })
    dnsDkimRemoved()

    const summary = await recheckSendingDomains({ nowMs: NOW })

    // The staleness bound is in the QUERY, so a beat with nothing due does no
    // DNS and reads no documents to discard.
    expect(summary.checked).toBe(0)
    expect(lookupTxt).not.toHaveBeenCalled()
    expect(held().status).toBe('verified')
  })

  it('leaves a domain that never verified alone', async () => {
    store.set(PATH, {
      domain: DOMAIN,
      status: 'records-issued',
      dkimSelector: SELECTOR,
      dkimPublicKey: DKIM_KEY,
      lastCheckedAtMs: NOW - 30 * DAY,
    })
    dnsDkimRemoved()

    const summary = await recheckSendingDomains({ nowMs: NOW })

    // Polling an onboarding domain is a different job with a different
    // cadence; this one is a trust expiry and only verified domains have any.
    expect(summary.checked).toBe(0)
    expect(held().status).toBe('records-issued')
  })

  it('takes the least recently checked first, and only a batch of them', async () => {
    for (let n = 0; n < 5; n += 1) {
      store.set(`orgs/org${n}/sendingDomains/site${n}.com`, {
        domain: `site${n}.com`,
        status: 'verified',
        dkimSelector: SELECTOR,
        dkimPublicKey: DKIM_KEY,
        returnPathHost: RETURN_PATH,
        // Descending age, so document order and the intended order disagree.
        lastCheckedAtMs: NOW - (5 - n) * 30 * DAY,
      })
    }
    dnsUnreachable()

    const summary = await recheckSendingDomains({ nowMs: NOW, batch: 2 })

    expect(summary.checked).toBe(2)
    expect(orderedBy).toBe('lastCheckedAtMs')
    // The two OLDEST, not the two the store happened to list first. A `limit`
    // with no order is a random sample, and a random sample starves whichever
    // domains it keeps missing.
    expect(
      store.get('orgs/org0/sendingDomains/site0.com').lastCheckedAtMs,
    ).toBe(NOW)
    expect(
      store.get('orgs/org1/sendingDomains/site1.com').lastCheckedAtMs,
    ).toBe(NOW)
    expect(
      store.get('orgs/org4/sendingDomains/site4.com').lastCheckedAtMs,
    ).not.toBe(NOW)
  })

  it('keeps sweeping after one domain throws', async () => {
    seedVerified()
    store.set('orgs/other/sendingDomains/bad.com', {
      domain: 'bad.com',
      status: 'verified',
      dkimSelector: SELECTOR,
      dkimPublicKey: DKIM_KEY,
      returnPathHost: RETURN_PATH,
      // Older, so it is reached first and its failure is in front of the rest.
      lastCheckedAtMs: NOW - 90 * DAY,
    })
    lookupMx.mockResolvedValue({ answered: true, records: [] })
    lookupTxt.mockImplementation(async (host: string) => {
      if (host.includes('bad.com')) throw new Error('resolver exploded')
      return { answered: false, records: [] }
    })

    const summary = await recheckSendingDomains({ nowMs: NOW })

    // One bad zone must not cost every other customer their re-check.
    expect(summary.checked).toBe(2)
    expect(summary.held).toBe(1)
    expect(held().lastCheckedAtMs).toBe(NOW)
  })
})

/*==========================================
  The invariant the query depends on
==========================================*/

describe('every verified document carries a check time', () => {
  it('is stamped by the one writer of the verified status', async () => {
    store.set(PATH, {
      domain: DOMAIN,
      status: 'records-issued',
      dkimSelector: SELECTOR,
      dkimPublicKey: DKIM_KEY,
      returnPathHost: RETURN_PATH,
    })
    dnsAllPublished()

    await verifySendingDomain(ORG, DOMAIN)

    // `orderBy('lastCheckedAtMs')` DROPS a document that lacks the field, so a
    // verified domain without one would be invisible to the sweep — trusted
    // forever, exactly the defect being closed, and silently. This is the
    // check on the only writer that can create that state.
    expect(held().status).toBe('verified')
    expect(typeof held().lastCheckedAtMs).toBe('number')
  })

  it('is what the sweep filters on, so a document lacking it is not seen', async () => {
    seedVerified()
    delete store.get(PATH).lastCheckedAtMs
    dnsDkimRemoved()

    const summary = await recheckSendingDomains({ nowMs: NOW })

    // Stated rather than hidden: this is the cost of the ordered query, and
    // it is why the writer above is pinned.
    expect(summary.checked).toBe(0)
  })
})

/*==========================================
  The mapping, on its own
==========================================*/

describe('the probe-to-drift mapping', () => {
  it('reads an inconclusive probe as unreachable', () => {
    // The one line the whole module turns on. `missing` would count it as
    // evidence and revoke on a resolver outage.
    expect(driftProbeStatus('inconclusive')).toBe('unreachable')
  })

  it('reads a conclusive miss as missing and a pass as proven', () => {
    expect(driftProbeStatus('failed')).toBe('missing')
    expect(driftProbeStatus('verified')).toBe('proven')
  })
})
