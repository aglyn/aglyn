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
 * THE WEBHOOK STEP HEARS EVERY CRM EVENT (AGL-2627).
 *
 * An integration that cannot poll `/v1` wants to be told, and the telling is
 * an action on the event with a `webhookPost` step. Nothing in the runner
 * filters events by name on the way to that step, but nothing proved it
 * either — the six CRM events (AGL-2605) were added after the step was
 * written, and a `switch` somebody added later would drop them silently.
 * So each one is driven through the same door the emitters use,
 * `emitHostEvent`, into an action carrying only a webhook step, and the
 * request that leaves is read back: the body is `{ event, payload, sentAt }`
 * with the payload verbatim, and the signature is the HMAC of exactly those
 * bytes under the hook's secret — the contract the API docs publish.
 *
 * The `lead` event rides too, because AGL-2627 gave it the `leadId` a
 * webhook needs to read the row back over `/v1/leads/{id}`.
 */

import { createHmac } from 'node:crypto'

const HOST_ID = 'site-1'
const ORG_ID = 'o1'

/** Actions returned by the trigger query, filtered by `trigger.event`. */
let mockActions: { id: string; data: Record<string, any> }[] = []
/** `hosts/site-1/webhooks`, by document id. */
let mockWebhooks: Record<string, Record<string, any>> = {}
/** The org's billing doc, as the run's gate reads it. */
let mockOrg: Record<string, any> = { plan: 'business' }

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const readField = (data: Record<string, any>, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

const docSnapshot = (id: string, data: Record<string, any>) => ({
  id,
  exists: true,
  data: () => data,
  get: (field: string) => readField(data, field),
})

const missingSnapshot = (id: string) => ({
  id,
  exists: false,
  data: () => undefined,
  get: () => undefined,
})

/**
 * Enough Firestore for a webhook step: the actions query, the webhook
 * document, and a sink for the run record and the counter. Every other
 * read answers empty, so a step that wandered into a collection this world
 * does not model reads nothing rather than throwing.
 */
const collectionHandle = (path: string): any => {
  const query = (matchers: ((data: Record<string, any>) => boolean)[]): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query([...matchers, (data) => readField(data, field) === value]),
    limit: () => query(matchers),
    orderBy: () => query(matchers),
    get: async () => {
      if (path.endsWith('actions')) {
        const docs = mockActions
          .filter((entry) => matchers.every((matcher) => matcher(entry.data)))
          .map((entry) => docSnapshot(entry.id, entry.data))
        return { docs, empty: docs.length === 0 }
      }
      return { docs: [], empty: true }
    },
  })
  return {
    ...query([]),
    doc: (given?: string) => {
      const id = given ?? 'minted'
      return {
        id,
        get: async () =>
          path.endsWith('webhooks') && mockWebhooks[id]
            ? docSnapshot(id, mockWebhooks[id])
            : missingSnapshot(id),
        set: async () => undefined,
        update: async () => undefined,
        collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
      }
    },
    add: async () => ({ id: 'new' }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => collectionHandle(name),
      }),
    }),
  },
  getOrgForHost: async () => ({ orgId: ORG_ID, org: mockOrg }),
  resolveOrgIdForHost: async () => ORG_ID,
  consentGroupForSite: async () => ({
    hostId: HOST_ID,
    groupId: HOST_ID,
    name: null,
    hostIds: [HOST_ID],
    declared: false,
  }),
  orgDataCollectionForHost: async () => collectionHandle(`orgs/${ORG_ID}/datasets`),
  orgDataQueryForHost: async () => ({
    ref: collectionHandle(`orgs/${ORG_ID}/contacts`),
    query: collectionHandle(`orgs/${ORG_ID}/contacts`),
  }),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  flowEmailRefusal: async () => null,
  enrollListMember: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async () => ({ sent: true }),
  sendFailureReason: () => null,
}))

import type { HostEventType } from '@aglyn/aglyn/app-utils/workflows'
import { emitHostEvent } from './emit-host-event'
import type { HostEventPayload } from './run-event-workflows'

const HOOK = {
  name: 'CRM sink',
  direction: 'outbound',
  url: 'https://sink.example.com/aglyn',
  secret: 's3cret',
  enabled: true,
}

/** An action on `event` carrying only the webhook step. */
const forwarding = (event: string) => ({
  id: `forward-${event}`,
  data: {
    name: `Forward ${event}`,
    enabled: true,
    trigger: { event },
    steps: [{ type: 'webhookPost', webhookId: 'hook-1' }],
  },
})

const sign = (body: string) =>
  createHmac('sha256', HOOK.secret).update(body).digest('hex')

const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }))

beforeEach(() => {
  mockActions = []
  mockWebhooks = { 'hook-1': HOOK }
  mockOrg = { plan: 'business' }
  fetchMock.mockClear()
  ;(globalThis as any).fetch = fetchMock
})

/**
 * Each CRM event with a payload in the shape its emitter sends — scalars
 * only, every optional key present — plus the lead event with its id.
 */
const CRM_EVENTS: Array<[HostEventType, HostEventPayload]> = [
  [
    'contactCreated',
    {
      contactId: 'c-1',
      email: 'ann@acme.com',
      name: 'Ann Lee',
      source: 'form',
      hostId: HOST_ID,
      lifecycleStage: 'lead',
    },
  ],
  [
    'contactStageChanged',
    { contactId: 'c-1', email: 'ann@acme.com', lifecycleStage: 'customer', previousStage: 'lead' },
  ],
  [
    'taskCompleted',
    {
      taskId: 't-1',
      title: 'Call back',
      kind: 'call',
      priority: 'high',
      dueAtMs: 1_760_000_000_000,
      completedAtMs: 1_760_000_100_000,
      completedByUid: 'u-1',
      assigneeUid: 'u-1',
      createdByUid: 'u-2',
      contactId: 'c-1',
      companyId: '',
      dealId: 'd-1',
      taskHostId: HOST_ID,
    },
  ],
  [
    'dealStageChanged',
    {
      dealId: 'd-1',
      title: 'Acme',
      amountCents: 12_500,
      currency: 'usd',
      stageId: 'proposal-sent',
      previousStageId: 'qualified',
      ownerUid: 'u-1',
      contactId: 'c-1',
      companyId: 'co-1',
    },
  ],
  [
    'dealWon',
    {
      dealId: 'd-1',
      title: 'Acme',
      amountCents: 12_500,
      currency: 'usd',
      stageId: 'won',
      previousStageId: 'negotiation',
      ownerUid: 'u-1',
      contactId: 'c-1',
      companyId: 'co-1',
    },
  ],
  [
    'dealLost',
    {
      dealId: 'd-1',
      title: 'Acme',
      amountCents: 12_500,
      currency: 'usd',
      stageId: 'lost',
      previousStageId: 'negotiation',
      ownerUid: 'u-1',
      contactId: 'c-1',
      companyId: 'co-1',
      lostReason: 'Went with a competitor',
    },
  ],
  ['lead', { email: 'ann@acme.com', source: 'signup', leadId: 'a'.repeat(64) }],
]

describe('the webhook step, from the emit door', () => {
  it.each(CRM_EVENTS)(
    'delivers %s with its payload verbatim, signed over the exact bytes',
    async (event, payload) => {
      mockActions = [forwarding(event)]
      await emitHostEvent(HOST_ID, event, payload)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe(HOOK.url)
      expect(init.method).toBe('POST')
      const body = String(init.body)
      expect(JSON.parse(body)).toEqual({ event, payload, sentAt: expect.any(String) })
      expect(new Date(JSON.parse(body).sentAt).getTime()).not.toBeNaN()
      expect((init.headers as Record<string, string>)['X-Aglyn-Signature']).toBe(sign(body))
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    },
  )

  it('fires only the action on the event that happened', async () => {
    mockActions = [forwarding('dealWon')]
    await emitHostEvent(HOST_ID, 'dealLost', { dealId: 'd-1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends no signature header when the hook has no secret', async () => {
    mockWebhooks = { 'hook-1': { ...HOOK, secret: '' } }
    mockActions = [forwarding('contactCreated')]
    await emitHostEvent(HOST_ID, 'contactCreated', { contactId: 'c-1' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('X-Aglyn-Signature')
  })

  it('is gated by the webhooks entitlement, not by the event', async () => {
    // A plan without webhooks: the action runs, the step refuses, nothing
    // leaves — for a CRM event exactly as for a form submission.
    mockOrg = { plan: 'starter' }
    mockActions = [forwarding('dealWon')]
    await emitHostEvent(HOST_ID, 'dealWon', { dealId: 'd-1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
