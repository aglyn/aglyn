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

import type { PluginSmsSendRequest } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { SMS_COST_PER_SEGMENT_USD, SMS_USAGE_COLLECTION } from './constants'
import { createSmsMessaging, smsUsageMonth } from './sms-messaging'
import type { SmsProvider } from './sms-provider'
import { measureSmsUsage } from './sms-usage-meter'

/**
 * The rules every text sits behind (AGL-3610), in order, with the vendor and
 * the stores injected. The order is the point: a suppressed number must never
 * reach the vendor, and a refused send must never be metered.
 */

const writes: Array<{ path: string; value: Record<string, unknown> }> = []
const store = new Map<string, Record<string, unknown>>()

function docRef(path: string): any {
  return {
    set: async (value: Record<string, unknown>) => {
      writes.push({ path, value })
      const existing = store.get(path) ?? {}
      const next: Record<string, unknown> = { ...existing }
      for (const [key, field] of Object.entries(value)) {
        next[key] =
          field && typeof field === 'object' && 'by' in (field as object)
            ? Number(existing[key] ?? 0) + (field as { by: number }).by
            : field
      }
      store.set(path, next)
    },
    get: async () => ({
      exists: store.has(path),
      get: (field: string) => store.get(path)?.[field],
    }),
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  }
}
const firestore: any = { collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }) }

function provider(result: Awaited<ReturnType<SmsProvider['send']>>, configured = true) {
  const send = jest.fn(async () => result)
  return { send, provider: { id: 'fake', isConfigured: () => configured, send } as SmsProvider }
}

const REQUEST: PluginSmsSendRequest = {
  to: '(555) 555-0100',
  body: 'Northwind Coffee: order #1042 has shipped.',
  hostId: 'host-1',
  purpose: 'transactional',
  context: 'order-shipped',
}

const NOW = Date.UTC(2026, 9, 6, 12)

function messaging(
  fake: ReturnType<typeof provider>,
  overrides: Partial<Parameters<typeof createSmsMessaging>[0]> = {},
) {
  return createSmsMessaging({
    provider: fake.provider,
    firestore: () => firestore,
    isSuppressed: async () => false,
    orgIdForHost: async () => 'org-1',
    consumeRate: async () => ({ allowed: true }),
    increment: (by) => ({ by }),
    now: () => NOW,
    ...overrides,
  })
}

beforeEach(() => {
  writes.length = 0
  store.clear()
})

describe('createSmsMessaging (AGL-3610)', () => {
  it('normalizes, sends and meters at cost', async () => {
    const fake = provider({ ok: true, id: 'SM1', segments: 2 })
    expect(await messaging(fake).send(REQUEST)).toEqual({
      status: 'sent',
      id: 'SM1',
      to: '+15555550100',
      segments: 2,
    })
    expect(fake.send).toHaveBeenCalledWith({ to: '+15555550100', body: REQUEST.body })
    expect(writes).toEqual([
      {
        path: `orgs/org-1/${SMS_USAGE_COLLECTION}/2026-10`,
        value: {
          month: '2026-10',
          messages: { by: 1 },
          segments: { by: 2 },
          costMicros: { by: Math.round(2 * SMS_COST_PER_SEGMENT_USD * 1_000_000) },
          updatedAtMs: NOW,
        },
      },
    ])
  })

  it('never reaches the vendor for an unconfigured install, a bad number, or a suppressed one', async () => {
    const unconfigured = provider({ ok: true, id: 'x', segments: 1 }, false)
    expect(await messaging(unconfigured).send(REQUEST)).toEqual({ status: 'not-configured' })
    const fake = provider({ ok: true, id: 'x', segments: 1 })
    expect(await messaging(fake).send({ ...REQUEST, to: '12' })).toEqual({ status: 'invalid-number' })
    const isSuppressed = jest.fn(async () => true)
    expect(await messaging(fake, { isSuppressed }).send(REQUEST)).toEqual({ status: 'suppressed' })
    expect(isSuppressed).toHaveBeenCalledWith('+15555550100')
    expect(fake.send).not.toHaveBeenCalled()
    expect(unconfigured.send).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('fails closed when the suppression list cannot be read', async () => {
    const fake = provider({ ok: true, id: 'x', segments: 1 })
    const outcome = await messaging(fake, {
      isSuppressed: async () => {
        throw new Error('list unreachable')
      },
    }).send(REQUEST)
    expect(outcome).toEqual({ status: 'failed', error: 'list unreachable' })
    expect(fake.send).not.toHaveBeenCalled()
  })

  it('refuses a site with no workspace to bill, and a workspace over its hourly ceiling', async () => {
    const fake = provider({ ok: true, id: 'x', segments: 1 })
    expect(await messaging(fake, { orgIdForHost: async () => null }).send(REQUEST)).toMatchObject({
      status: 'failed',
    })
    const consumeRate = jest.fn(async () => ({ allowed: false }))
    expect(await messaging(fake, { consumeRate }).send(REQUEST)).toEqual({ status: 'rate-limited' })
    expect(consumeRate).toHaveBeenCalledWith('sms:org:org-1')
    expect(fake.send).not.toHaveBeenCalled()
  })

  it('meters nothing for a send the vendor refused', async () => {
    const refused = provider({ ok: false, error: 'carrier said no' })
    expect(await messaging(refused).send(REQUEST)).toEqual({
      status: 'failed',
      error: 'carrier said no',
    })
    const unreachable = provider({ ok: false, error: 'opted out', invalidNumber: true })
    expect(await messaging(unreachable).send(REQUEST)).toEqual({ status: 'invalid-number' })
    expect(writes).toEqual([])
  })

  it('refuses anything but a transactional text', async () => {
    const fake = provider({ ok: true, id: 'x', segments: 1 })
    expect(
      await messaging(fake).send({ ...REQUEST, purpose: 'marketing' as never }),
    ).toMatchObject({ status: 'failed' })
    expect(fake.send).not.toHaveBeenCalled()
  })

  it('keys the month in UTC', () => {
    expect(smsUsageMonth(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10')
    expect(smsUsageMonth(Date.UTC(2026, 10, 1, 0, 1))).toBe('2026-11')
  })
})

describe('measureSmsUsage (AGL-3610)', () => {
  it('bills the month at cost', async () => {
    store.set(`orgs/org-1/${SMS_USAGE_COLLECTION}/2026-10`, {
      messages: 3,
      segments: 4,
      costMicros: 45_200,
    })
    expect(await measureSmsUsage({ orgId: 'org-1', month: '2026-10' }, firestore)).toEqual({
      fields: {
        smsMessages: 3,
        smsSegments: 4,
        smsCostUsd: 0.0452,
        smsBilledUsd: 0.05,
      },
      billedUsd: 0.05,
    })
  })

  it('reads an unsent month as zero', async () => {
    expect(
      (await measureSmsUsage({ orgId: 'org-2', month: '2026-10' }, firestore)).billedUsd,
    ).toBe(0)
  })
})
