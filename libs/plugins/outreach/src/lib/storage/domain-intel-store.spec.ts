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
 * @jest-environment node
 */

import { resetMailDeliverabilityMemoryForTests } from '@aglyn/tenant-data-admin/server/email-deliverability'
import { OUTREACH_DOMAIN_INTEL_TTL_MS } from '../engine/mail-gateway'
import { outreachDeliveredStepCount } from '../runtime/gateway-ledger'
import {
  outreachMailboxSendingDomain,
  readOutreachDomainIntel,
  readOutreachGatewayStandings,
  recordOutreachGatewayOutcome,
  resolveOutreachDomainMx,
} from './domain-intel-store'

/**
 * The domain intel and the gateway ledger (AGL-3326), on the platform's
 * store (AGL-3328) keyed by document path: what a read caches and when it
 * asks the resolver again, what a resolver that cannot answer leaves
 * standing, how an outcome moves the mailbox's sending-domain ledger, and
 * what the legacy per-gateway ledger still adds.
 */

const ORG = 'org-1'
const NOW = Date.parse('2026-09-24T15:00:00Z')
const DAY = 86_400_000
const SENDER = 'aglyn.io'
const org = (path: string) => `orgs/${ORG}/${path}`

type Data = Record<string, unknown>

/** A plain-data copy, the way a document round-trips. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function fakeFirestore(docs: Map<string, Data>) {
  const snapshot = (path: string) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    exists: docs.has(path),
    data: () => (docs.has(path) ? clone(docs.get(path)) : undefined),
  })
  const doc = (path: string): any => ({
    path,
    get: async () => snapshot(path),
    set: async (data: Data, options?: { merge?: boolean }) =>
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...clone(data) } : clone(data)),
    update: async (data: Data) => docs.set(path, { ...(docs.get(path) ?? {}), ...clone(data) }),
  })
  const collection = (path: string): any => ({ doc: (id: string) => doc(`${path}/${id}`) })
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({ ...doc(`${name}/${id}`), collection: (sub: string) => collection(`${name}/${id}/${sub}`) }),
    }),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async (run: (transaction: any) => Promise<unknown>) => {
      const writes: Array<() => void> = []
      const result = await run({
        get: async (ref: { path: string }) => snapshot(ref.path),
        set: (ref: { path: string }, data: Data) => void writes.push(() => docs.set(ref.path, clone(data))),
      })
      writes.forEach((apply) => apply())
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

let docs: Map<string, Data>
let asked: string[]

const resolveMx = async (domain: string) => {
  asked.push(domain)
  if (domain === 'parked.example') throw Object.assign(new Error('queryMx ENODATA'), { code: 'ENODATA' })
  if (domain.endsWith('down.example')) throw new Error('queryMx ETIMEOUT')
  if (domain === 'lifespire.example') return [{ exchange: 'd78608a.ess.barracudanetworks.com.', priority: 10 }]
  return [
    { exchange: 'alt1.aspmx.l.google.com', priority: 5 },
    { exchange: 'aspmx.l.google.com', priority: 1 },
  ]
}

beforeEach(() => {
  docs = new Map()
  asked = []
  resetMailDeliverabilityMemoryForTests()
})

describe('resolveOutreachDomainMx', () => {
  it('orders the exchanges by preference, and classifies them', async () => {
    await expect(resolveOutreachDomainMx(resolveMx, 'workspace.example')).resolves.toEqual({
      mx: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'],
      gateway: 'google',
    })
  })

  it('reads a domain the resolver says has no MX as none, and lets any other failure through', async () => {
    await expect(resolveOutreachDomainMx(resolveMx, 'parked.example')).resolves.toEqual({ mx: [], gateway: 'none' })
    await expect(resolveOutreachDomainMx(resolveMx, 'down.example')).rejects.toThrow('ETIMEOUT')
  })
})

describe('outreachMailboxSendingDomain', () => {
  it('is the send-as address’s domain, else the account’s', () => {
    expect(outreachMailboxSendingDomain({ sendAs: 'Zach@Aglyn.io', email: 'zach@gmail.com' })).toBe('aglyn.io')
    expect(outreachMailboxSendingDomain({ sendAs: '', email: 'zach@aglyn.io' })).toBe('aglyn.io')
    expect(outreachMailboxSendingDomain(null)).toBeNull()
  })
})

describe('readOutreachDomainIntel', () => {
  it('looks a domain up once, caches it for the whole platform, and reads the cache for a week', async () => {
    const firestore = fakeFirestore(docs)
    const first = await readOutreachDomainIntel(firestore, ORG, ['kristan@lifespire.example', 'other@lifespire.example'], {
      resolveMx,
      nowMs: NOW,
    })
    expect(first.get('kristan@lifespire.example')).toEqual({
      domain: 'lifespire.example',
      status: 'mx',
      mx: ['d78608a.ess.barracudanetworks.com'],
      gateway: 'barracuda',
      resolvedAtMs: NOW,
    })
    expect(asked).toEqual(['lifespire.example'])
    // The platform cache, not the organization's: every workspace reads it.
    expect(docs.get('mailDomains/lifespire.example')).toMatchObject({ gateway: 'barracuda', status: 'mx' })
    expect(docs.has(org('outreachDomainIntel/lifespire.example'))).toBe(false)

    resetMailDeliverabilityMemoryForTests()
    await readOutreachDomainIntel(firestore, 'org-2', ['kristan@lifespire.example'], {
      resolveMx,
      nowMs: NOW + OUTREACH_DOMAIN_INTEL_TTL_MS - 1,
    })
    expect(asked).toEqual(['lifespire.example'])
    await readOutreachDomainIntel(firestore, ORG, ['kristan@lifespire.example'], {
      resolveMx,
      nowMs: NOW + OUTREACH_DOMAIN_INTEL_TTL_MS,
    })
    expect(asked).toEqual(['lifespire.example', 'lifespire.example'])
  })

  it('keeps a stale answer when the resolver cannot answer, and reads a domain never known as unchecked', async () => {
    docs.set('mailDomains/down.example', {
      domain: 'down.example',
      status: 'mx',
      mx: ['mx.down.example'],
      gateway: 'other',
      resolvedAtMs: NOW - 30 * DAY,
    })
    const answers = await readOutreachDomainIntel(
      fakeFirestore(docs),
      ORG,
      ['a@down.example', 'b@never.down.example', 'not-an-address'],
      { resolveMx, nowMs: NOW },
    )
    expect(answers.get('a@down.example')).toMatchObject({ gateway: 'other', resolvedAtMs: NOW - 30 * DAY })
    expect(answers.get('b@never.down.example')).toBeNull()
    expect(answers.get('not-an-address')).toBeNull()
  })

  it('reads a domain with no MX but an address record as deliverable when the caller can ask', async () => {
    const answers = await readOutreachDomainIntel(fakeFirestore(docs), ORG, ['a@parked.example'], {
      resolveMx,
      resolveAddress: async () => true,
      nowMs: NOW,
    })
    expect(answers.get('a@parked.example')).toMatchObject({ status: 'implicit_mx', gateway: 'other' })
  })
})

describe('recordOutreachGatewayOutcome and the standings it feeds', () => {
  const ledger = (gateway: string) => org(`mailGatewayLedger/${SENDER}~${gateway}`)

  it('counts an outcome on the mailbox’s sending-domain ledger, by day, pruned to the window', async () => {
    const firestore = fakeFirestore(docs)
    docs.set(ledger('barracuda'), {
      sendingDomain: SENDER,
      gateway: 'barracuda',
      sent: 1,
      delivered: 0,
      blocked: 0,
      days: { '2026-06-01': { sent: 1, delivered: 0, blocked: 0 } },
    })
    await recordOutreachGatewayOutcome(firestore, ORG, {
      sendingDomain: 'Aglyn.io',
      gateway: 'barracuda',
      outcome: 'sent',
      atMs: NOW - 2 * DAY,
    })
    await recordOutreachGatewayOutcome(firestore, ORG, {
      sendingDomain: SENDER,
      gateway: 'barracuda',
      outcome: 'blocked',
      atMs: NOW - 2 * DAY,
      detail: '550 5.7.1 <kristan@lifespire.example> blocked using Barracuda Reputation',
    })
    await recordOutreachGatewayOutcome(firestore, ORG, {
      sendingDomain: SENDER,
      gateway: 'barracuda',
      outcome: 'blocked',
      atMs: NOW,
    })
    expect(docs.get(ledger('barracuda'))).toEqual({
      sendingDomain: SENDER,
      gateway: 'barracuda',
      sent: 2,
      delivered: 0,
      blocked: 2,
      lastBlockedAtMs: NOW,
      // Scrubbed of the address before it is kept.
      lastBlockedDetail: '550 5.7.1 <<address>> blocked using Barracuda Reputation',
      days: {
        '2026-09-22': { sent: 1, delivered: 0, blocked: 1 },
        '2026-09-24': { sent: 0, delivered: 0, blocked: 1 },
      },
      updatedAtMs: NOW,
      orgId: ORG,
    })

    // What the gates then read for an address at a Barracuda domain, sent
    // from the same domain: the week's and the month's refusals.
    resetMailDeliverabilityMemoryForTests()
    const standings = await readOutreachGatewayStandings(firestore, ORG, ['kristan@lifespire.example'], {
      resolveMx,
      nowMs: NOW,
      sendingDomain: SENDER,
    })
    expect(standings.get('kristan@lifespire.example')).toEqual({
      gateway: 'barracuda',
      blocked7: 2,
      delivered7: 0,
      blocked30: 2,
      delivered30: 0,
    })
    // A mailbox on another domain has no history with that gateway.
    resetMailDeliverabilityMemoryForTests()
    const other = await readOutreachGatewayStandings(firestore, ORG, ['kristan@lifespire.example'], {
      resolveMx,
      nowMs: NOW,
      sendingDomain: 'other-sender.example',
    })
    expect(other.get('kristan@lifespire.example')).toMatchObject({ blocked30: 0 })
  })

  it('reads the legacy per-gateway ledger through, for every sending domain', async () => {
    docs.set(org('outreachGatewayStats/barracuda'), {
      gateway: 'barracuda',
      blocked: 2,
      days: { '2026-09-23': { sent: 2, delivered: 0, blocked: 2 } },
    })
    const standings = await readOutreachGatewayStandings(fakeFirestore(docs), ORG, ['kristan@lifespire.example'], {
      resolveMx,
      nowMs: NOW,
      sendingDomain: SENDER,
    })
    expect(standings.get('kristan@lifespire.example')).toEqual({
      gateway: 'barracuda',
      blocked7: 2,
      delivered7: 0,
      blocked30: 2,
      delivered30: 0,
    })
  })

  it('counts several deliveries at once, nothing for a count of none, and nothing without a sending domain', async () => {
    const firestore = fakeFirestore(docs)
    await recordOutreachGatewayOutcome(firestore, ORG, {
      sendingDomain: SENDER,
      gateway: 'proofpoint',
      outcome: 'delivered',
      count: 3,
      atMs: NOW,
    })
    await recordOutreachGatewayOutcome(firestore, ORG, {
      sendingDomain: SENDER,
      gateway: 'proofpoint',
      outcome: 'delivered',
      count: 0,
      atMs: NOW,
    })
    await recordOutreachGatewayOutcome(firestore, ORG, {
      sendingDomain: null,
      gateway: 'proofpoint',
      outcome: 'blocked',
      atMs: NOW,
    })
    expect(docs.get(ledger('proofpoint'))).toMatchObject({
      delivered: 3,
      blocked: 0,
      lastBlockedAtMs: null,
      days: { '2026-09-24': { sent: 0, delivered: 3, blocked: 0 } },
    })
    expect([...docs.keys()].filter((path) => path.includes('mailGatewayLedger'))).toHaveLength(1)
  })
})

describe('outreachDeliveredStepCount (the sync’s delivery credit)', () => {
  const step = (kind: 'email' | 'task', atMs: number) => ({ stepIndex: 0, stepId: 's', kind, atMs })

  it('counts the email steps a day old, and not the one a bounce answered', () => {
    const records = [step('email', NOW - 3 * DAY), step('task', NOW - 2 * DAY), step('email', NOW - DAY), step('email', NOW - 60_000)]
    expect(outreachDeliveredStepCount({ status: 'active', stepRecords: records }, NOW)).toBe(2)
    expect(outreachDeliveredStepCount({ status: 'bounced', stepRecords: records }, NOW)).toBe(2)
    expect(outreachDeliveredStepCount({ status: 'bounced', stepRecords: records.slice(0, 3) }, NOW)).toBe(1)
    expect(outreachDeliveredStepCount({ status: 'finished', stepRecords: [] }, NOW)).toBe(0)
    expect(outreachDeliveredStepCount({ status: 'active' }, NOW)).toBe(0)
  })
})
