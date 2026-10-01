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

import { createHmac } from 'node:crypto'

const docs = new Map<string, Record<string, unknown>>()
const consoleWrites: Array<{ payload: Record<string, unknown>; options: Record<string, unknown> }> = []
const operatorEmails: Array<Record<string, unknown>> = []
const digestEmails: Array<Record<string, unknown>> = []
const posts: Array<{ url: string; headers: Record<string, string>; body: string }> = []
let recipients: string[] = ['ops@example.com']
let autoId = 0

function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : { ...data })
    },
    create: async (data: Record<string, unknown>) => {
      if (docs.has(path)) throw new Error('ALREADY_EXISTS')
      docs.set(path, { ...data })
    },
    delete: async () => {
      docs.delete(path)
    },
  }
}

function snapshotOf(path: string): any {
  const data = docs.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    ref: docRef(path),
  }
}

const fakeFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => docRef(`${name}/${id}`),
    add: async (data: Record<string, unknown>) => {
      autoId += 1
      docs.set(`${name}/auto${autoId}`, { ...data })
    },
    orderBy: () => ({
      limit: () => ({
        get: async () => ({
          docs: [...docs.keys()]
            .filter((path) => path.startsWith(`${name}/`))
            .map(snapshotOf)
            .sort((a, b) => Number(a.data().atMs) - Number(b.data().atMs)),
        }),
      }),
    }),
  }),
  runTransaction: async (work: (transaction: any) => Promise<unknown>) =>
    work({
      get: async (ref: any) => snapshotOf(ref.path),
      set: (ref: any, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        docs.set(ref.path, options?.merge ? { ...(docs.get(ref.path) ?? {}), ...data } : { ...data })
      },
      update: (ref: any, data: Record<string, unknown>) => {
        docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
      },
    }),
  batch: () => {
    const deletes: string[] = []
    return {
      delete: (ref: any) => deletes.push(ref.path),
      commit: async () => {
        for (const path of deletes) docs.delete(path)
      },
    }
  },
}

jest.mock('./firebase-admin', () => {
  const admin = { app: () => ({ firestore: () => fakeFirestore }) }
  return { __esModule: true, default: admin, firebaseAdmin: admin }
})
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/notifications'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/operator-alerts'),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => true,
}))
jest.mock('./notifications', () => ({
  notifyStaffConsole: async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
    consoleWrites.push({ payload, options })
  },
}))
jest.mock('./staff-alert-email', () => ({
  resolveStaffAlertRecipients: async () => recipients,
  sendOperatorAlertEmail: async (input: Record<string, unknown>) => {
    operatorEmails.push(input)
    return recipients.length ? { sent: true } : { sent: false, reason: 'unconfigured' }
  },
  sendOperatorAlertDigestEmail: async (input: Record<string, unknown>) => {
    digestEmails.push(input)
    return { sent: true }
  },
}))

import {
  getOperatorAlert,
  listOperatorAlerts,
  resetOperatorAlertsForTests,
} from '@aglyn/aglyn/plugin-manager/operator-alerts'
import type { OperatorAlertDefinition } from '@aglyn/aglyn/server'
import {
  claimOperatorAlert,
  composeOperatorDigestBody,
  invalidateOperatorAlertSettingsCache,
  normalizeOperatorAlertSettings,
  OPERATOR_ALERT_SETTINGS_COLLECTION,
  OPERATOR_ALERT_SETTINGS_DOC,
  raiseOperatorAlert,
  sendOperatorAlertDigest,
} from './operator-alerts'

const ENV = ['OPERATOR_ALERT_WEBHOOK_URL', 'OPERATOR_ALERT_WEBHOOK_SECRET', 'NEXT_PUBLIC_CONSOLE_URL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  docs.clear()
  consoleWrites.length = 0
  operatorEmails.length = 0
  digestEmails.length = 0
  posts.length = 0
  recipients = ['ops@example.com']
  for (const key of ENV) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env['NEXT_PUBLIC_CONSOLE_URL'] = 'https://console.example.com'
  invalidateOperatorAlertSettingsCache()
  resetOperatorAlertsForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  global.fetch = jest.fn(async (url: string, init: any) => {
    posts.push({ url, headers: init.headers, body: init.body })
    return { ok: true, status: 200 } as Response
  }) as unknown as typeof fetch
})
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  jest.restoreAllMocks()
})

function setSettings(value: Record<string, unknown>): void {
  docs.set(`${OPERATOR_ALERT_SETTINGS_COLLECTION}/${OPERATOR_ALERT_SETTINGS_DOC}`, value)
  invalidateOperatorAlertSettingsCache()
}

describe('raiseOperatorAlert (AGL-3377)', () => {
  it('writes the console notification and emails the operator once, from the registry copy', async () => {
    const result = await raiseOperatorAlert('billing.usageNotReported', {
      dedupeKey: 'o1:2026-08',
      context: { orgId: 'o1', orgName: 'Acme', month: '2026-08', amount: '$12.40', reason: 'no-customer' },
    })
    expect(result.outcome).toBe('delivered')
    expect(consoleWrites).toHaveLength(1)
    expect(consoleWrites[0].payload).toMatchObject({
      type: 'system.operatorAlert',
      title: 'Usage for 2026-08 not billed on o1',
      link: '/admin/orgs/o1',
    })
    // The operator is mailed, so the per-person channel stands down.
    expect(consoleWrites[0].options).toEqual({ skipEmail: true })
    expect(operatorEmails).toEqual([
      expect.objectContaining({
        title: 'Usage for 2026-08 not billed on o1',
        url: 'https://console.example.com/admin/orgs/o1',
        context: 'operator-alert billing.usageNotReported',
      }),
    ])
    expect(String(operatorEmails[0]['body'])).toContain('$12.40')
    // The workspace by name as well as id (AGL-3432).
    expect(String(operatorEmails[0]['body'])).toContain('on workspace Acme (o1)')
  })

  it('tells a flapping condition once per window, and counts the repeats it held back', async () => {
    const raise = () =>
      raiseOperatorAlert('data.orgErasureFailed', { dedupeKey: 'o9', context: { orgId: 'o9', reason: 'erase-failed' } })
    expect((await raise()).outcome).toBe('delivered')
    expect((await raise()).outcome).toBe('deduped')
    expect(operatorEmails).toHaveLength(1)
    expect(consoleWrites).toHaveLength(1)
  })

  it('holds an alert until minOccurrences raises land inside the window', async () => {
    const raise = () =>
      raiseOperatorAlert('billing.webhookSignatureRejected', { dedupeKey: 'signature', context: { count: 3 } })
    expect((await raise()).outcome).toBe('below-threshold')
    expect((await raise()).outcome).toBe('below-threshold')
    expect((await raise()).outcome).toBe('delivered')
    expect(operatorEmails).toHaveLength(1)
  })

  it('a type staff switched off stays in the console and emails nobody', async () => {
    setSettings({ types: { 'billing.autoLocked': { enabled: false } } })
    const result = await raiseOperatorAlert('billing.autoLocked', { context: { orgId: 'o1' } })
    expect(result.outcome).toBe('console-only')
    expect(consoleWrites).toHaveLength(1)
    expect(consoleWrites[0].options).toEqual({})
    expect(operatorEmails).toHaveLength(0)
    expect(posts).toHaveLength(0)
  })

  it('a digest type is queued, not mailed, and the digest sends it once a day', async () => {
    const queued = await raiseOperatorAlert('support.ticketOpened', {
      subject: 'New support ticket: Checkout button missing',
      body: 'northwind opened a ticket.',
      url: '/admin/support',
    })
    expect(queued.outcome).toBe('queued')
    expect(operatorEmails).toHaveLength(0)
    const now = Date.UTC(2026, 8, 28, 15, 0, 0)
    const first = await sendOperatorAlertDigest({ now })
    expect(first).toMatchObject({ sent: true, count: 1 })
    expect(digestEmails).toEqual([
      expect.objectContaining({ date: '2026-09-28', count: 1, url: 'https://console.example.com/admin/operator-alerts' }),
    ])
    expect(String(digestEmails[0]['body'])).toContain('Checkout button missing')
    // Sent alerts are cleared, and the day is claimed.
    expect([...docs.keys()].some((path) => path.startsWith('operatorAlertDigest/'))).toBe(false)
    await raiseOperatorAlert('support.ticketReply', { subject: 'Reply', body: 'b' })
    expect(await sendOperatorAlertDigest({ now: now + 60_000 })).toMatchObject({ sent: false, reason: 'already-sent' })
  })

  it('the digest waits for the configured hour', async () => {
    setSettings({ digestHourUtc: 18 })
    await raiseOperatorAlert('marketplace.review', { subject: 'Listing', body: 'b' })
    expect(await sendOperatorAlertDigest({ now: Date.UTC(2026, 8, 28, 17, 59) })).toMatchObject({ reason: 'not-due' })
    expect(await sendOperatorAlertDigest({ now: Date.UTC(2026, 8, 28, 18, 0) })).toMatchObject({ sent: true })
  })

  it('a type staff moved to the digest is queued; one moved to immediate is mailed', async () => {
    setSettings({
      types: {
        'data.backupExportFailed': { delivery: 'digest' },
        'system.scopeDrift': { delivery: 'immediate' },
      },
    })
    expect((await raiseOperatorAlert('data.backupExportFailed', { context: { reason: 'http-403' } })).outcome).toBe('queued')
    expect((await raiseOperatorAlert('system.scopeDrift', { subject: 'Drift', body: '3 docs' })).outcome).toBe('delivered')
  })

  it('posts to the out-of-band webhook, signed, even when no inbox exists', async () => {
    recipients = []
    process.env['OPERATOR_ALERT_WEBHOOK_URL'] = 'https://hooks.example.com/T000/B000/xyz'
    process.env['OPERATOR_ALERT_WEBHOOK_SECRET'] = 'shh'
    const result = await raiseOperatorAlert('deliverability.providerCredentialsRejected', {
      context: { problem: 'API key rejected', detail: 'The provider refused the key.' },
    })
    expect(result.outcome).toBe('delivered')
    expect(result.email).toEqual({ sent: false, reason: 'unconfigured' })
    expect(posts).toHaveLength(1)
    const body = JSON.parse(posts[0].body)
    expect(body.text).toContain('[Should know] Email delivery is failing: API key rejected')
    expect(body.alert).toMatchObject({ type: 'deliverability.providerCredentialsRejected', tier: 'should' })
    const timestamp = posts[0].headers['x-operator-alert-timestamp']
    expect(posts[0].headers['x-operator-alert-signature']).toBe(
      'sha256=' + createHmac('sha256', 'shh').update(`${timestamp}.${posts[0].body}`).digest('hex'),
    )
    // No inbox, so the per-person channel is not stood down.
    expect(consoleWrites[0].options).toEqual({})
  })

  it('stamps each alert with its level on the console notification (AGL-3437)', async () => {
    await raiseOperatorAlert('billing.usageNotReported', { context: { orgId: 'o1' } })
    await raiseOperatorAlert('system.healthDegraded', { context: { check: 'Ways in' } })
    await raiseOperatorAlert('system.healthRecovered', { context: { check: 'Ways in' } })
    await raiseOperatorAlert('system.healthRecovered', {
      context: { check: 'Ways in' },
      level: 'info',
    })
    expect(consoleWrites.map((write) => write.payload['level'])).toEqual([
      // A must-know with no level of its own is red…
      'critical',
      // …a degraded check is amber, not red…
      'warning',
      // …a recovery is good news…
      'success',
      // …and a caller's own judgement wins.
      'info',
    ])
  })

  it('an unregistered type is still told, never dropped', async () => {
    const result = await raiseOperatorAlert('nobody.registeredThis', { subject: 'Something broke', body: 'details' })
    expect(result.outcome).toBe('delivered')
    expect(consoleWrites[0].payload).toMatchObject({ type: 'system.operatorAlert', title: 'Something broke' })
  })

  it('a plugin passing its definition registers it, so staff see it listed', async () => {
    const definition: OperatorAlertDefinition = {
      type: 'commerce.taxNotReversed',
      pluginId: 'commerce',
      label: 'Tax not reversed',
      description: 'd',
      tier: 'must',
      category: 'payments',
      title: 'Tax not reversed on {{invoiceId}}',
      body: 'b',
      delivery: 'immediate',
      dedupeWindowMinutes: 60,
      defaultEnabled: true,
    }
    expect(getOperatorAlert('commerce.taxNotReversed')).toBeUndefined()
    await raiseOperatorAlert(definition, { dedupeKey: 'in_1', context: { invoiceId: 'in_1' } })
    expect(getOperatorAlert('commerce.taxNotReversed')?.pluginId).toBe('commerce')
    expect(listOperatorAlerts().map((entry) => entry.type)).toContain('commerce.taxNotReversed')
    expect(operatorEmails[0]['title']).toBe('Tax not reversed on in_1')
  })

  it('drops a link whose token is missing rather than opening the wrong page', async () => {
    await raiseOperatorAlert('billing.autoLocked', { context: { reason: 'budget' } })
    expect(consoleWrites[0].payload['link']).toBeUndefined()
  })
})

describe('each alert body stands on its own (AGL-3432)', () => {
  it('a failed payout prints the amount the caller passed, and who it was for', async () => {
    // The caller passes `amount`; the sum that did not arrive must print.
    await raiseOperatorAlert('billing.connectPayoutFailed', {
      context: {
        kind: 'payout',
        stripeId: 'po_1',
        account: 'acct_1',
        merchant: 'Harbor View',
        reason: 'The bank account has been closed',
        amount: '$420.00',
      },
    })
    expect(String(operatorEmails[0]['body'])).toBe(
      'A $420.00 Stripe payout (po_1) to connected account acct_1 (Harbor View) failed: The bank account has been closed. The merchant’s funds are not where the ledger says.',
    )
  })

  it('an SLA breach opens the ticket itself, not the queue', async () => {
    await raiseOperatorAlert('support.slaBreached', {
      context: { ticketId: 't1', subject: 'Checkout broken', tier: 'priority', orgId: 'o1', orgName: 'Acme', overdue: '3 h' },
    })
    expect(consoleWrites[0].payload['link']).toBe('/admin/support?ticketId=t1')
    expect(operatorEmails[0]['url']).toBe('https://console.example.com/admin/support?ticketId=t1')
    expect(String(operatorEmails[0]['body'])).toContain('from workspace Acme (o1)')
  })

  it('a failed job reads as one sentence, not "The scheduled job The … failed"', async () => {
    await raiseOperatorAlert('ops.pluginJobFailed', {
      context: { job: 'The publish outbox drain', error: '2 failed' },
    })
    expect(String(operatorEmails[0]['body'])).toBe('The publish outbox drain failed: 2 failed')
  })

  it('a full sending-domain allowance is its own alert, and does not read as a failure', async () => {
    await raiseOperatorAlert('deliverability.sendingDomainCapacityFull', {
      context: { held: 50, capacity: 50 },
    })
    expect(operatorEmails[0]['title']).toBe('Sending-domain allowance full (50/50)')
    const body = String(operatorEmails[0]['body'])
    expect(body).toContain('No mail is lost')
    expect(body).not.toMatch(/fail/i)
  })
})

describe('claimOperatorAlert', () => {
  it('fires again once the window has passed', async () => {
    const definition = { type: 'x.y', dedupeWindowMinutes: 10 }
    const t0 = 1_000_000_000_000
    expect(await claimOperatorAlert(definition, 'k', t0)).toEqual({ fire: true, repeats: 0 })
    // A fresh instance has no local memory; the store still suppresses.
    expect((await claimOperatorAlert(definition, 'k2', t0)).fire).toBe(true)
    expect(await claimOperatorAlert(definition, 'k2', t0 + 11 * 60_000)).toEqual({ fire: true, repeats: 0 })
  })
})

describe('normalizeOperatorAlertSettings', () => {
  it('keeps only answers the pipeline understands', () => {
    expect(
      normalizeOperatorAlertSettings({
        types: { a: { enabled: false, delivery: 'weekly' }, b: 'nope', c: {} },
        digestHourUtc: 99,
      }),
    ).toEqual({ types: { a: { enabled: false } }, digestHourUtc: 14 })
  })
})

describe('composeOperatorDigestBody', () => {
  it('lists each alert and counts what it left out', () => {
    const alert = {
      type: 't',
      label: 'l',
      tier: 'low' as const,
      category: 'support' as const,
      title: 'T',
      body: 'B',
      link: '',
      notificationType: 'system.operatorAlert' as const,
    }
    expect(composeOperatorDigestBody([alert], 60)).toBe('• T\nB\n\n…and 59 more in the staff console.')
  })
})
