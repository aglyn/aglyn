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
 * A campaign meeting the platform hourly send ceiling (AGL-2409).
 *
 * Scheduled campaigns could emit 10 claimed campaigns × 500 recipients × 4
 * runs an hour = 20,000 messages, from a domain whose steady-state volume is a
 * few hundred a day, on the same Resend key and the same From address that
 * carries every customer's password resets under `p=reject`.
 *
 * Three behaviours are asserted, and the third is the one that makes the other
 * two safe to have:
 *
 *  1. A campaign that does not fit in the current hour is deferred WHOLE —
 *     nothing sent, nothing claimed against the monthly cap.
 *  2. A campaign refused mid-batch stops rather than grinding through the rest,
 *     reports how many were left, and reconciles its monthly claim to what
 *     actually went out.
 *  3. **A deferred scheduled campaign goes back to `scheduled`, not `failed`.**
 *     Without that, a ramp silently destroys merchants' campaigns and the only
 *     symptom is a `failed` row somebody has to notice.
 *
 * `global.fetch` throws on everything: `sendEmail` is stubbed, and if a future
 * edit puts a real send on this path it fails here rather than on the domain.
 */

const mockState: {
  store: Record<string, Record<string, any>>
  sent: Array<Record<string, any>>
  /** Queue of results the stubbed `sendEmail` returns, in order. */
  sendResults: Array<Record<string, any>>
  reserved: Array<{ count: number; limit: number }>
  reconciled: Array<{ reserved: number; delivered: number }>
  rate: { perHour: number; enabled: boolean; used: number }
} = {
  store: {},
  sent: [],
  sendResults: [],
  reserved: [],
  reconciled: [],
  rate: { perHour: 100_000, enabled: true, used: 0 },
}

function mockFirestore(): any {
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => ({
      id: path.split('/').pop(),
      exists: mockState.store[path] !== undefined,
      data: () => mockState.store[path],
      get: (field: string) => mockState.store[path]?.[field],
      ref: docRef(path),
    }),
    set: async (value: any, options?: { merge?: boolean }) => {
      mockState.store[path] = options?.merge
        ? { ...(mockState.store[path] ?? {}), ...value }
        : { ...value }
    },
    update: async (value: any) => {
      mockState.store[path] = { ...(mockState.store[path] ?? {}), ...value }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
    // `campaignDoc.ref.parent.parent` is how the processor recovers the host
    // from a collection-group hit. Modelled by path arithmetic rather than
    // stubbed to a constant, so a handler that walked the wrong number of
    // levels would land somewhere real and fail visibly.
    get parent() {
      const collectionPath = path.split('/').slice(0, -1).join('/')
      return {
        id: collectionPath.split('/').pop(),
        path: collectionPath,
        get parent() {
          const parentDoc = collectionPath.split('/').slice(0, -1).join('/')
          return parentDoc ? docRef(parentDoc) : null
        },
      }
    },
  })
  const collectionRef = (path: string): any => {
    const ref: any = {
      doc: (id: string) => docRef(`${path}/${id}`),
      limit: () => ref,
      where: () => ref,
      orderBy: () => ref,
      get: async () => ({
        docs: Object.keys(mockState.store)
          .filter(
            (key) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes('/'),
          )
          .map((key) => ({
            id: key.split('/').pop(),
            exists: true,
            data: () => mockState.store[key],
            get: (field: string) => mockState.store[key]?.[field],
            ref: docRef(key),
          })),
      }),
    }
    return ref
  }
  return {
    collection: (name: string) => collectionRef(name),
    /**
     * The processor claims due campaigns with a collection-group query. The
     * double filters by the LAST path segment, which is what a collection
     * group actually is, and applies the `status`/`sendAtMs` predicates the
     * handler passes — a `where` that ignored its arguments would let this
     * file certify a processor that claimed already-sent campaigns.
     */
    collectionGroup: (name: string) => {
      const predicates: Array<[string, string, any]> = []
      const ref: any = {
        where: (field: string, op: string, value: any) => {
          predicates.push([field, op, value])
          return ref
        },
        limit: () => ref,
        get: async () => ({
          docs: Object.keys(mockState.store)
            .filter((key) => key.split('/').slice(-2)[0] === name)
            .filter((key) =>
              predicates.every(([field, op, value]) => {
                const actual = mockState.store[key]?.[field]
                if (op === '==') return actual === value
                if (op === '<=') return Number(actual) <= Number(value)
                return true
              }),
            )
            .map((key) => ({
              id: key.split('/').pop(),
              exists: true,
              data: () => mockState.store[key],
              get: (field: string) => mockState.store[key]?.[field],
              ref: docRef(key),
            })),
        }),
      }
      return ref
    },
    runTransaction: async (body: any) =>
      body({
        get: async (ref: any) => ref.get(),
        update: async (ref: any, value: any) => ref.update(value),
        set: async (ref: any, value: any, options?: any) =>
          ref.set(value, options),
      }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
    },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  orgCampaignEmailSendsForMonth: async () => 0,
  reserveCampaignEmailSends: async ({ orgId, month, count, limit }: any) => {
    mockState.reserved.push({ count, limit })
    return {
      ok: true,
      reservation: { orgId, month, reserved: count },
      used: 0,
      limit,
    }
  },
  reconcileCampaignSendReservation: async (
    reservation: any,
    delivered: number,
  ) => {
    if (!reservation) return
    mockState.reconciled.push({ reserved: reservation.reserved, delivered })
  },
  readEmailSendRateConfig: async () => ({
    perHour: mockState.rate.perHour,
    enabled: mockState.rate.enabled,
    updatedAtMs: null,
    updatedByEmail: null,
    note: '',
  }),
  readEmailSendRateWindow: async () => ({
    windowStartMs: 1_755_100_800_000,
    resetMs: 1_755_104_400_000,
    used: mockState.rate.used,
  }),
}))

// `requireActual` and NOT a closed world: `rateLimitedRetryAtMs` is the helper
// the sender uses to recognise a deferral, and a factory that omitted it would
// silently make the deferral branch unreachable — the guard would be dead and
// the file would still be green.
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    const next = mockState.sendResults.shift() ?? { sent: true }
    // `throwInstead` is the only way to exercise the `finally` — a real
    // `sendEmail` never throws, but the code around it in the loop can.
    if ((next as any).throwInstead) throw new Error('boom')
    if (next.sent) mockState.sent.push(message)
    return next
  },
}))

import {
  CampaignSendDeferredError,
  performCampaignSend,
} from './campaign-send'
import { campaignProcessScheduledHandler } from './campaign-process-scheduled'

const HOST = 'host-1'

function seedHost(leads: string[]) {
  mockState.store[`hosts/${HOST}`] = { subdomain: 'acme', orgId: 'org-1' }
  leads.forEach((email, index) => {
    mockState.store[`hosts/${HOST}/leads/lead-${index}`] = {
      email,
      visibleTo: [HOST],
    }
  })
}

const send = () =>
  performCampaignSend({
    hostId: HOST,
    subject: 'Spring sale',
    body: 'plain text',
    audience: 'leads',
    senderUid: 'uid-1',
  })

const originalFetch = global.fetch

beforeEach(() => {
  mockState.store = {}
  mockState.sent = []
  mockState.sendResults = []
  mockState.reserved = []
  mockState.reconciled = []
  mockState.rate = { perHour: 100_000, enabled: true, used: 0 }
  process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = 'test-secret'
  process.env.CRON_SECRET = 'cron-secret'
  global.fetch = (async (url: any) => {
    throw new Error(`Blocked outbound request in a spec: ${String(url)}`)
  }) as any
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('admission control — the whole campaign, or none of it', () => {
  it('defers a campaign the current hour has no room for, sending nothing', async () => {
    seedHost(['a@example.com', 'b@example.com', 'c@example.com'])
    mockState.rate = { perHour: 10, enabled: true, used: 8 }

    await expect(send()).rejects.toBeInstanceOf(CampaignSendDeferredError)
    expect(mockState.sent).toHaveLength(0)
    // Nothing claimed either: a deferral must not spend the org's monthly
    // allowance on a campaign that did not go.
    expect(mockState.reserved).toHaveLength(0)
  })

  it('carries the retry instant so the caller can say when', async () => {
    seedHost(['a@example.com'])
    mockState.rate = { perHour: 1, enabled: true, used: 1 }
    await send().then(
      () => {
        throw new Error('expected a deferral')
      },
      (error) => {
        expect(error).toBeInstanceOf(CampaignSendDeferredError)
        expect(error.status).toBe(429)
        expect(error.retryAtMs).toBe(1_755_104_400_000)
      },
    )
  })

  it('sends when the hour has room for the whole batch', async () => {
    seedHost(['a@example.com', 'b@example.com'])
    mockState.rate = { perHour: 10, enabled: true, used: 8 }
    await expect(send()).resolves.toMatchObject({ sent: 2 })
  })

  it('does not defer while the governor is parked', async () => {
    seedHost(['a@example.com', 'b@example.com'])
    mockState.rate = { perHour: 1, enabled: false, used: 900 }
    await expect(send()).resolves.toMatchObject({ sent: 2 })
  })
})

describe('a refusal mid-batch', () => {
  it('stops, reports the remainder, and reconciles to what went out', async () => {
    seedHost(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'])
    mockState.sendResults = [
      { sent: true },
      { sent: true },
      { sent: false, reason: 'rate-limited', retryAtMs: 1_755_104_400_000 },
      // Never reached — the loop must stop rather than grind through.
      { sent: true },
    ]

    const result = await send()
    expect(result).toMatchObject({ sent: 2, deferred: 2 })
    expect(mockState.sent).toHaveLength(2)
    // Claimed 4, delivered 2 — the customer is not charged for the two that
    // never left.
    expect(mockState.reconciled).toEqual([{ reserved: 4, delivered: 2 }])
  })

  it('keeps going past an ordinary per-recipient failure', async () => {
    seedHost(['a@example.com', 'b@example.com', 'c@example.com'])
    mockState.sendResults = [
      { sent: false, reason: 'rejected', status: 422 },
      { sent: true },
      { sent: true },
    ]

    const result = await send()
    expect(result).toMatchObject({ sent: 2 })
    expect(result).not.toHaveProperty('deferred')
    expect(mockState.reconciled).toEqual([{ reserved: 3, delivered: 2 }])
  })

  it('reconciles even when the send path THROWS after the claim', async () => {
    seedHost(['a@example.com', 'b@example.com', 'c@example.com'])
    // `sendEmail` does not throw in production — but the loop around it can,
    // and the claim is taken before it. Without the `finally`, this campaign
    // would spend three of the org's allowance forever having sent one.
    mockState.sendResults = [
      { sent: true },
      { sent: true, throwInstead: true },
      { sent: true },
    ]

    await expect(send()).rejects.toThrow('boom')
    expect(mockState.reconciled).toEqual([{ reserved: 3, delivered: 1 }])
  })
})

describe('the scheduled processor', () => {
  function res() {
    const captured: { status: number; body: any } = { status: 0, body: null }
    const response: any = {
      status: (code: number) => {
        captured.status = code
        return response
      },
      json: (body: any) => {
        captured.body = body
        return response
      },
    }
    return { response, captured }
  }

  it('puts a DEFERRED campaign back to scheduled, not failed', async () => {
    seedHost(['a@example.com', 'b@example.com'])
    mockState.store[`hosts/${HOST}/campaigns/camp-1`] = {
      status: 'scheduled',
      sendAtMs: 1,
      subject: 'Sale',
      body: 'text',
      audience: 'leads',
      scheduledBy: 'uid-1',
    }
    mockState.rate = { perHour: 1, enabled: true, used: 1 }

    const { response, captured } = res()
    await campaignProcessScheduledHandler(
      { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } } as any,
      response,
    )

    expect(captured.status).toBe(200)
    const row = mockState.store[`hosts/${HOST}/campaigns/camp-1`]
    // THE ASSERTION. `failed` here is a lost campaign a merchant has to find
    // in the History list and re-create.
    expect(row.status).toBe('scheduled')
    expect(row).not.toHaveProperty('failedAt')
    expect(row.deferredUntilMs).toBe(1_755_104_400_000)
    expect(mockState.sent).toHaveLength(0)
  })

  it('still FAILS a campaign that is genuinely broken', async () => {
    seedHost([])
    mockState.store[`hosts/${HOST}/campaigns/camp-2`] = {
      status: 'scheduled',
      sendAtMs: 1,
      subject: 'Sale',
      body: 'text',
      audience: 'leads',
      scheduledBy: 'uid-1',
    }

    const { response, captured } = res()
    await campaignProcessScheduledHandler(
      { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } } as any,
      response,
    )

    expect(captured.status).toBe(200)
    const row = mockState.store[`hosts/${HOST}/campaigns/camp-2`]
    // An empty audience is not a ramp — retrying it forever would be the
    // regression in the other direction.
    expect(row.status).toBe('failed')
  })
})
