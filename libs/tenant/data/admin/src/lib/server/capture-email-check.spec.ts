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
 * The deliverability check at capture (AGL-3328), on the platform MX cache
 * double and a resolver answering from a table — no DNS leaves this file.
 * What it holds the check to: "Would bounce" written through the record
 * seam for a domain that takes no mail, and only then; the check's own
 * verdict withdrawn when the domain answers again, and never a bounce; a
 * public mailbox never refused; the queue flushed once, after the
 * response, and nothing at all outside a request; an import's count; and
 * one address's standing as a record page and a composer read it.
 */

import type { MailDnsResolver } from '@aglyn/shared-util-email'
import { fakeFirestore, type FakeFirestore } from './test-firestore'

jest.mock('./email-suppression', () => ({
  suppressEmail: async () => ({ key: 'k', created: true }),
}))
jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => {
      throw new Error('the spec hands in its own store')
    },
  },
}))

/** `after()` as a request would run it: recorded, and run when the spec says the response went. */
const mockAfter: Array<() => Promise<void>> = []
let mockInRequest = true
jest.mock('next/server', () => ({
  after: (task: () => Promise<void>) => {
    if (!mockInRequest) throw new Error('`after` was called outside a request scope')
    mockAfter.push(task)
  },
}))

import {
  registerPluginRecordEmailStateWriter,
  type PluginRecordEmailStateRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  checkCapturedEmails,
  countUndeliverableEmails,
  findUndeliverableEmails,
  queuedCapturedEmailsForTests,
  readAddressDeliverability,
  resetCapturedEmailChecksForTests,
  scheduleCapturedEmailCheck,
  settleWithin,
} from './capture-email-check'
import { recordMailGatewayOutcome, resetMailDeliverabilityMemoryForTests } from './email-deliverability'

const NOW = Date.parse('2026-09-28T15:00:00Z')
const DAY = 86_400_000

let store: FakeFirestore
let asked: string[]
let mx: Record<string, Array<{ exchange: string; priority: number }> | null | 'down'>
let stamps: PluginRecordEmailStateRequest[]

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
  stamps = []
  mockAfter.length = 0
  mockInRequest = true
  mx = {
    'lifespire.example': [{ exchange: 'd78608a.ess.barracudanetworks.com', priority: 10 }],
    'workspace.example': [{ exchange: 'aspmx.l.google.com', priority: 1 }],
    'gmail.com': null,
    'parked.example': null,
    'nomail.example': [{ exchange: '.', priority: 0 }],
    'down.example': 'down',
  }
  resetMailDeliverabilityMemoryForTests()
  resetCapturedEmailChecksForTests()
  resetPluginServicesForTests()
  registerPluginRecordEmailStateWriter(
    {
      async stamp(request) {
        stamps.push(request)
        return { records: 1 }
      },
    },
    { pluginId: 'crm' },
  )
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('checkCapturedEmails — "Would bounce" on the record', () => {
  it('stamps an address whose domain has no MX, and one publishing a null MX, and nobody else', async () => {
    const report = await checkCapturedEmails(
      [
        { orgId: 'org-1', email: 'Pat@Parked.example' },
        { orgId: 'org-1', email: 'lee@nomail.example' },
        { orgId: 'org-1', email: 'sam@lifespire.example' },
        { orgId: 'org-1', email: 'kim@down.example' },
      ],
      deps(),
    )
    expect(stamps).toEqual([
      {
        orgId: 'org-1',
        email: 'pat@parked.example',
        state: { status: 'undeliverable', atMs: NOW, source: 'check', detail: null },
      },
      {
        orgId: 'org-1',
        email: 'lee@nomail.example',
        state: {
          status: 'undeliverable',
          atMs: NOW,
          source: 'check',
          detail: 'nomail.example publishes a null MX record: it says it accepts no email.',
        },
      },
    ])
    // The resolver that could not answer is unknown, and unknown writes nothing.
    expect(report).toEqual({ checked: 3, undeliverable: 2, stamped: 2, withdrawn: 0 })
  })

  it('never refuses a public mailbox provider, whatever its lookup said', async () => {
    await checkCapturedEmails([{ orgId: 'org-1', email: 'pat@gmail.com' }], deps())
    expect(stamps).toEqual([])
  })

  it('asks each domain once, and each address once per organization', async () => {
    await checkCapturedEmails(
      [
        { orgId: 'org-1', email: 'a@parked.example' },
        { orgId: 'org-1', email: 'A@parked.example' },
        { orgId: 'org-1', email: 'b@parked.example' },
        { orgId: 'org-2', email: 'a@parked.example' },
      ],
      deps(),
    )
    expect(asked).toEqual(['parked.example'])
    expect(stamps.map((stamp) => `${stamp.orgId}:${stamp.email}`)).toEqual([
      'org-1:a@parked.example',
      'org-1:b@parked.example',
      'org-2:a@parked.example',
    ])
  })

  it('names the site when it has no organization to hand, and skips an address it cannot key', async () => {
    await checkCapturedEmails(
      [
        { hostId: 'site-1', email: 'pat@parked.example' },
        { email: 'orphan@parked.example' },
        { orgId: 'org-1', email: 'not an address' },
      ],
      deps(),
    )
    expect(stamps.map((stamp) => [stamp.orgId, stamp.hostId, stamp.email])).toEqual([
      [undefined, 'site-1', 'pat@parked.example'],
    ])
  })

  it('writes nothing again over a record already reading "Would bounce"', async () => {
    const report = await checkCapturedEmails([{ orgId: 'org-1', email: 'pat@parked.example', predicted: true }], deps())
    expect(stamps).toEqual([])
    expect(report.undeliverable).toBe(1)
  })

  it('withdraws its own verdict once the domain takes mail, and only where the record held it', async () => {
    const report = await checkCapturedEmails(
      [
        { orgId: 'org-1', email: 'pat@lifespire.example', predicted: true },
        { orgId: 'org-1', email: 'sam@lifespire.example' },
        { orgId: 'org-1', email: 'kim@down.example', predicted: true },
      ],
      deps(),
    )
    expect(stamps).toEqual([
      {
        orgId: 'org-1',
        email: 'pat@lifespire.example',
        state: { status: 'undeliverable', atMs: NOW, source: 'check', detail: null },
        withdraw: true,
      },
    ])
    expect(report.withdrawn).toBe(1)
  })

  it('never throws when the seam has no writer', async () => {
    resetPluginServicesForTests()
    await expect(checkCapturedEmails([{ orgId: 'org-1', email: 'pat@parked.example' }], deps())).resolves.toMatchObject({
      undeliverable: 1,
      stamped: 0,
    })
  })
})

describe('scheduleCapturedEmailCheck — after the response, once', () => {
  it('queues every capture of one invocation behind a single after()', () => {
    scheduleCapturedEmailCheck({ orgId: 'org-1', email: 'a@parked.example' })
    scheduleCapturedEmailCheck({ orgId: 'org-1', email: 'b@parked.example' })
    scheduleCapturedEmailCheck({ orgId: 'org-1', email: 'not an address' })
    expect(mockAfter).toHaveLength(1)
    expect(queuedCapturedEmailsForTests().map((item) => item.email)).toEqual(['a@parked.example', 'b@parked.example'])
    expect(stamps).toEqual([])
  })

  it('checks nothing outside a request — the backfill covers those writes', () => {
    mockInRequest = false
    scheduleCapturedEmailCheck({ orgId: 'org-1', email: 'a@parked.example' })
    expect(mockAfter).toHaveLength(0)
    expect(queuedCapturedEmailsForTests()).toHaveLength(0)
  })
})

describe('what an import reports', () => {
  it('names the addresses whose domain takes no mail, and counts the rows stored', async () => {
    const found = await findUndeliverableEmails(
      ['Pat@parked.example', 'sam@lifespire.example', 'lee@nomail.example', 'kim@down.example'],
      deps(),
    )
    expect(found && [...found].sort()).toEqual(['lee@nomail.example', 'pat@parked.example'])
    expect(countUndeliverableEmails(['PAT@parked.example', 'sam@lifespire.example'], found)).toBe(1)
    expect(countUndeliverableEmails(['pat@parked.example'], null)).toBeUndefined()
  })

  it('answers nothing, never something wrong, when the answer is late', async () => {
    const never = new Promise<Set<string>>(() => undefined)
    await expect(settleWithin(never, 5)).resolves.toBeNull()
    await expect(settleWithin(Promise.resolve(new Set(['a'])), 1_000)).resolves.toEqual(new Set(['a']))
  })
})

describe('readAddressDeliverability — the chip and the composer warning', () => {
  it('warns about a domain with no mail server', async () => {
    const answer = await readAddressDeliverability({ email: 'pat@parked.example', from: 'Shop <hello@shop.example>' }, deps())
    expect(answer).toMatchObject({
      email: 'pat@parked.example',
      checked: true,
      code: 'no_mx',
      gateway: null,
      chip: { tone: 'blocked' },
    })
    expect(answer.message).toMatch(/no mail server/)
  })

  it('names the gateway, and warns once it refused this sender twice', async () => {
    const quiet = await readAddressDeliverability({ email: 'pat@lifespire.example', from: 'hello@shop.example' }, deps())
    expect(quiet).toMatchObject({ checked: true, code: null, gateway: 'barracuda', chip: { label: 'Barracuda', tone: 'neutral' } })

    for (const atMs of [NOW - 2 * DAY, NOW - DAY]) {
      await recordMailGatewayOutcome(null, { sendingDomain: 'shop.example', gateway: 'barracuda', outcome: 'blocked', atMs }, deps())
    }
    resetMailDeliverabilityMemoryForTests()
    const held = await readAddressDeliverability({ email: 'pat@lifespire.example', from: 'hello@shop.example' }, deps())
    expect(held).toMatchObject({ code: 'gateway_held', gateway: 'barracuda', chip: { tone: 'refused' } })
    // Another sending domain's standing is its own.
    resetMailDeliverabilityMemoryForTests()
    const other = await readAddressDeliverability({ email: 'pat@lifespire.example', from: 'hi@other.example' }, deps())
    expect(other.code).toBeNull()
  })

  it('draws no provider chip beside a public mailbox', async () => {
    mx['gmail.com'] = [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }]
    const answer = await readAddressDeliverability({ email: 'pat@gmail.com', from: 'hello@shop.example' }, deps())
    expect(answer).toMatchObject({ checked: true, code: null, gateway: 'google', chip: null })
  })

  it('says nothing about an address it could not look up', async () => {
    const answer = await readAddressDeliverability({ email: 'kim@down.example' }, deps())
    expect(answer).toEqual({ email: 'kim@down.example', checked: false, code: null, message: null, gateway: null, chip: null })
  })
})
