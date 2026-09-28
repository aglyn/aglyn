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

/**
 * The platform's deliverability store (AGL-3328), on a store keyed by
 * collection path and a resolver answering from a table — no DNS leaves
 * this file. What it holds the store to: one MX cache for every
 * organization; a stale "takes no mail" never reused to stop a send; the
 * preflight refusing a domain with no mail server for every purpose and
 * holding only bulk mail; the ledger keyed by the SENDING domain; and the
 * webhook teaching the ledger only what it saw first.
 */

import type { EmailDeliveryEvent, MailDnsResolver } from '@aglyn/shared-util-email'
import { fakeFirestore, type FakeFirestore } from './test-firestore'

const mockSuppressions: Array<Record<string, unknown>> = []
jest.mock('./email-suppression', () => ({
  suppressEmail: async (input: Record<string, unknown>) => {
    mockSuppressions.push({ email: input['email'], reason: input['reason'], hostId: input['hostId'] ?? null })
    return { key: 'k', created: true }
  },
}))
jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => {
      throw new Error('the spec hands in its own store')
    },
  },
}))

import {
  filterDeliverableRecipients,
  listMailGatewayLedgers,
  readMailDomains,
  readMailGatewayLedgers,
  recordDeliverabilityFromDeliveryEvents,
  recordMailGatewayOutcome,
  resetMailDeliverabilityMemoryForTests,
  runEmailDeliverabilityPreflight,
} from './email-deliverability'

const NOW = Date.parse('2026-09-24T15:00:00Z')
const DAY = 86_400_000

let store: FakeFirestore
let asked: string[]
let mx: Record<string, Array<{ exchange: string; priority: number }> | null | 'down'>

const resolver: MailDnsResolver = {
  async resolveMx(domain) {
    asked.push(domain)
    const answer = mx[domain]
    if (answer === 'down') throw Object.assign(new Error('queryMx ETIMEOUT'), { code: 'ETIMEOUT' })
    if (!answer) throw Object.assign(new Error('queryMx ENODATA'), { code: 'ENODATA' })
    return answer
  },
  async resolveAddress() {
    return false
  },
}

const deps = () => ({ firestore: store as unknown as FirebaseFirestore.Firestore, resolver, nowMs: NOW })

beforeEach(() => {
  store = fakeFirestore()
  asked = []
  mockSuppressions.length = 0
  mx = {
    'lifespire.example': [{ exchange: 'd78608a.ess.barracudanetworks.com', priority: 10 }],
    'workspace.example': [{ exchange: 'aspmx.l.google.com', priority: 1 }],
    'gmail.com': null,
    'parked.example': null,
    'down.example': 'down',
  }
  resetMailDeliverabilityMemoryForTests()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

/** Two refusals of `aglyn.com` by Barracuda this week, on the top-level ledger. */
async function refuseTwice(sendingDomain = 'aglyn.com') {
  for (const atMs of [NOW - 2 * DAY, NOW]) {
    await recordMailGatewayOutcome(null, { sendingDomain, gateway: 'barracuda', outcome: 'blocked', atMs }, deps())
  }
  resetMailDeliverabilityMemoryForTests()
}

describe('readMailDomains — one MX cache for the platform', () => {
  it('looks a domain up once and stores it where every organization reads it', async () => {
    const first = await readMailDomains(['LifeSpire.example', 'lifespire.example'], deps())
    expect(first.get('lifespire.example')).toMatchObject({ status: 'mx', gateway: 'barracuda' })
    expect(store.docs('mailDomains')['lifespire.example']).toMatchObject({ status: 'mx', gateway: 'barracuda', resolvedAtMs: NOW })
    resetMailDeliverabilityMemoryForTests()
    await readMailDomains(['lifespire.example'], deps())
    expect(asked).toEqual(['lifespire.example'])
  })

  it('reads a resolver that cannot answer as unknown, and never reuses a stale "takes no mail"', async () => {
    await store.collection('mailDomains').doc('down.example').set({
      domain: 'down.example',
      status: 'no_mx',
      mx: [],
      gateway: 'none',
      resolvedAtMs: NOW - 3 * DAY,
    })
    const answers = await readMailDomains(['down.example'], deps())
    expect(answers.get('down.example')).toBeNull()
  })
})

describe('runEmailDeliverabilityPreflight — the seam on sendEmail', () => {
  it('refuses a domain with no mail server for every purpose, and suppresses the address with its own reason', async () => {
    const verdict = await runEmailDeliverabilityPreflight(
      {
        recipients: ['nobody@parked.example', 'casey@workspace.example'],
        purpose: 'transactional',
        sendingDomain: 'aglyn.com',
        sendingSource: 'platform',
        context: 'password-reset',
        hostId: null,
      },
      deps(),
    )
    expect(verdict.refused).toEqual([
      { email: 'nobody@parked.example', code: 'no_mx', reason: 'parked.example has no mail server, so nobody@parked.example would bounce.' },
    ])
    expect(verdict.held).toEqual([])
    expect(mockSuppressions).toEqual([{ email: 'nobody@parked.example', reason: 'no_mail_server', hostId: null }])
  })

  it('never refuses, nor suppresses, a public mailbox provider on a bad MX answer', async () => {
    const verdict = await runEmailDeliverabilityPreflight(
      { recipients: ['casey@gmail.com'], purpose: 'bulk', sendingDomain: 'aglyn.com', sendingSource: 'platform' },
      deps(),
    )
    expect(verdict).toEqual({ refused: [], held: [] })
    expect(mockSuppressions).toEqual([])
  })

  it('holds bulk mail behind a gateway that refused the sending domain twice — and only bulk mail, only that domain', async () => {
    await refuseTwice('aglyn.com')
    const ask = (purpose: 'bulk' | 'transactional', sendingDomain: string) =>
      runEmailDeliverabilityPreflight(
        { recipients: ['kristan@lifespire.example'], purpose, sendingDomain, sendingSource: 'platform' },
        deps(),
      )
    expect((await ask('bulk', 'aglyn.com')).held).toEqual([
      {
        email: 'kristan@lifespire.example',
        gateway: 'barracuda',
        reason:
          'Barracuda refused this sender twice in the last 30 days and delivered nothing, so bulk mail to lifespire.example is held.',
      },
    ])
    // The receipt the person asked for still goes.
    expect(await ask('transactional', 'aglyn.com')).toEqual({ refused: [], held: [] })
    // The block was on aglyn.com's reputation, not the recipient's.
    expect(await ask('bulk', 'mail.acme.example')).toEqual({ refused: [], held: [] })
  })
})

describe('the ledger', () => {
  it('flags the platform’s own and the pooled sending domains as shared, and lists them for staff', async () => {
    process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.com>'
    await refuseTwice('aglyn.com')
    await recordMailGatewayOutcome(
      null,
      { sendingDomain: 'mail.acme.example', gateway: 'google', outcome: 'delivered', atMs: NOW },
      deps(),
    )
    expect(store.docs('mailGatewayLedger')['aglyn.com~barracuda']).toMatchObject({ blocked: 2, shared: true })
    expect(store.docs('mailGatewayLedger')['mail.acme.example~google']).toMatchObject({ delivered: 1, shared: false })
    const rows = await listMailGatewayLedgers({}, deps())
    expect(rows.find((row) => row.id === 'aglyn.com~barracuda')).toMatchObject({ shared: true, holds: true })
    delete process.env.USAGE_EMAIL_FROM
  })

  it('keeps an organization’s mailbox ledger under the organization', async () => {
    await recordMailGatewayOutcome(
      { orgId: 'org-1' },
      { sendingDomain: 'aglyn.io', gateway: 'barracuda', outcome: 'blocked', atMs: NOW },
      deps(),
    )
    expect(store.docs('orgs/org-1/mailGatewayLedger')['aglyn.io~barracuda']).toMatchObject({ blocked: 1, orgId: 'org-1' })
    expect(store.docs('mailGatewayLedger')).toEqual({})
    const ledgers = await readMailGatewayLedgers({ orgId: 'org-1' }, 'aglyn.io', ['barracuda', 'google'], deps())
    expect(ledgers.get('barracuda')).toMatchObject({ blocked: 1 })
    expect(ledgers.get('google')).toBeNull()
  })
})

describe('recordDeliverabilityFromDeliveryEvents — what Resend teaches the ledger', () => {
  const event = (overrides: Partial<EmailDeliveryEvent>): EmailDeliveryEvent => ({
    type: 'bounced',
    at: NOW,
    provider: 'resend',
    providerMessageId: 'msg-1',
    to: 'kristan@lifespire.example',
    subject: null,
    context: 'campaign',
    tags: {},
    link: null,
    bounceType: 'permanent',
    detail: '550 5.7.1 blocked using Barracuda Reputation',
    from: 'hello@mail.acme.example',
    bounceStatus: '5.7.1',
    remoteMta: null,
    ...overrides,
  })
  const first = (one: EmailDeliveryEvent) => ({
    firstOfType: true,
    providerMessageId: one.providerMessageId,
    to: one.to,
    type: one.type,
    at: one.at,
  })

  it('counts a gateway refusal as a block on the sending domain, with its words', async () => {
    const bounce = event({})
    expect(await recordDeliverabilityFromDeliveryEvents([bounce], [first(bounce)], deps())).toBe(1)
    expect(store.docs('mailGatewayLedger')['mail.acme.example~barracuda']).toMatchObject({
      blocked: 1,
      lastBlockedDetail: '550 5.7.1 blocked using Barracuda Reputation',
    })
  })

  it('files a refusal under the gateway the bounce names, whatever the MX says', async () => {
    const bounce = event({ to: 'casey@workspace.example', remoteMta: 'mx1.pphosted.com' })
    await recordDeliverabilityFromDeliveryEvents([bounce], [first(bounce)], deps())
    expect(Object.keys(store.docs('mailGatewayLedger'))).toEqual(['mail.acme.example~proofpoint'])
  })

  it('credits a delivery, and counts nothing for an unknown address, a transient bounce or a replay', async () => {
    const delivered = event({ type: 'delivered', providerMessageId: 'msg-2', bounceType: null, detail: null })
    const unknown = event({ providerMessageId: 'msg-3', detail: '550 5.1.1 no such user', bounceStatus: '5.1.1' })
    const transient = event({ providerMessageId: 'msg-4', bounceType: 'transient' })
    const replay = event({ providerMessageId: 'msg-5' })
    const recorded = await recordDeliverabilityFromDeliveryEvents(
      [delivered, unknown, transient, replay],
      [first(delivered), first(unknown), first(transient), { ...first(replay), firstOfType: false }],
      deps(),
    )
    expect(recorded).toBe(1)
    expect(store.docs('mailGatewayLedger')['mail.acme.example~barracuda']).toMatchObject({ delivered: 1, blocked: 0 })
  })
})

describe('filterDeliverableRecipients — a campaign’s audience', () => {
  it('takes out who would bounce and who is held, and keeps the rest — including the unknown', async () => {
    await refuseTwice('mail.acme.example')
    const answer = await filterDeliverableRecipients(
      {
        emails: ['nobody@parked.example', 'kristan@lifespire.example', 'casey@workspace.example', 'x@down.example'],
        sendingDomain: 'mail.acme.example',
      },
      deps(),
    )
    expect(answer).toEqual({
      deliverable: ['casey@workspace.example', 'x@down.example'],
      noMailServer: ['nobody@parked.example'],
      gatewayHeld: ['kristan@lifespire.example'],
    })
  })
})
