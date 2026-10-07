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
 *
 * @jest-environment node
 */

/**
 * WHAT A SERVICE ASKS THE BOOKER FOR, AS THE BOOKING ROUTE HOLDS IT (AGL-3493).
 *
 * An on-site service needs a phone to call and the address of the job. The
 * service says off, optional or required for each, and the route checks the
 * request against that itself — the widget checks too, but this is a public
 * door and a request can be written by hand. What was given is stored on the
 * booking, named in the managers' notice, handed to the CRM filing for the
 * meeting, and the phone goes to the person only where they hold none.
 */

let ipSeq = 0
const nextIp = () => `198.51.100.${++ipSeq}`

jest.mock('@aglyn/aglyn/server', () => ({
  registerPluginApiRoute: () => undefined,
  registerPluginConfigSchema: () => undefined,
  registerPluginJob: () => undefined,
  registerBillingWebhookHandler: () => undefined,
  pluginJobHostGate: () => ({}),
  checkEntitlement: () => true,
  resolveBrandingProfile: () => ({ fromName: 'Acme' }),
  resolveTransactionFeeCents: () => 0,
  sanitizeAuthorHtml: (value: string) => value,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: async () => ({ alerts: [] }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  loadHostEmail: async () => null,
  renderLoadedHostEmail: () => ({ subject: '', html: '' }),
  sendEmail: async () => undefined,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'NOW', delete: () => 'DELETE' },
}))

const fileBookingOnCrm = jest.fn(
  async (_firestore: unknown, _input: Record<string, unknown>) => ({
    filed: false as const,
    reason: 'no-record' as const,
  }),
)
jest.mock('./server/booking-crm', () => ({
  fileBookingOnCrm: (firestore: unknown, input: Record<string, unknown>) =>
    fileBookingOnCrm(firestore, input),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const bookings = new Map<string, Record<string, unknown>>()
  const notices: Array<Record<string, unknown>> = []
  let autoId = 0
  /** A FREE service, open around the clock: no Stripe leg, confirmed on landing. */
  const service = {
    name: 'Intro call',
    durationMinutes: 30,
    priceUsd: 0,
    timezone: 'UTC',
    crmFollowUpTask: true,
    windows: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((day) => [day, [{ start: 0, end: 1440 }]]),
    ),
  }
  const bookingsCollection: any = {
    doc: (id?: string) => {
      const key = id ?? `booking-${++autoId}`
      return { id: key, path: `bookings/${key}` }
    },
    where: () => bookingsCollection,
    limit: () => bookingsCollection,
    add: async (data: Record<string, unknown>) => {
      const key = `added-${++autoId}`
      bookings.set(key, data)
      return { id: key }
    },
  }
  const hostRef = {
    get: async () => ({ exists: true, get: () => undefined }),
    collection: (name: string) =>
      name === 'bookings'
        ? bookingsCollection
        : {
            add: async () => ({ id: `${name}-${++autoId}` }),
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => service,
                get: (field: string) => (service as Record<string, unknown>)[field],
              }),
            }),
          },
  }
  return {
    __state: { bookings, service, notices },
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({ doc: () => hostRef }),
          runTransaction: async (fn: any) =>
            fn({
              get: async () => ({ docs: [] }),
              set: (ref: any, data: Record<string, unknown>) => {
                bookings.set(ref.id, data)
              },
            }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    getOrgForHost: async () => ({ orgId: 'org-1', org: { id: 'org-1', plan: 'pro' } }),
    resolveOrgIdForHost: async () => 'org-1',
    meterHostEmail: async () => undefined,
    notifyHostManagers: async (hostId: string, payload: Record<string, unknown>) => {
      notices.push({ hostId, ...payload })
    },
    hostSendingIdentity: async () => ({ from: 'hello@shop.example.com' }),
    getPluginConfig: async () => ({}),
    renderHostEmailWithTokens: async () => null,
    addHostLead: async () => true,
  }
})

import type { PluginContactCaptureRequest } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { standInRecordSystem } from './testing/stand-in-record-system'
import { computeOpenSlots } from './model'
import { bookHandler } from './server'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: {
      bookings: Map<string, Record<string, unknown>>
      service: any
      notices: Array<Record<string, unknown>>
    }
  }
).__state

/** A real bookable instant from the real slot generator. */
function nextBookableStart(): number {
  const from = Date.now() + 3 * 24 * 60 * 60_000
  const slots = computeOpenSlots(state.service, from, from + 2 * 24 * 60 * 60_000, [], 1)
  if (!slots.length) throw new Error('the fixture service has no open slot')
  return slots[0].startsAtMs
}

const makeRes = () => {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const makeReq = (overrides: Record<string, unknown> = {}) =>
  ({
    method: 'POST',
    body: {
      hostId: 'host-1',
      serviceId: 'service-1',
      startsAtMs: nextBookableStart(),
      name: 'Dana',
      email: 'dana@example.com',
      ...overrides,
    },
    // A fresh address per request: the door's per-address rate limit is
    // not what these cases are about.
    headers: { host: 'shop.example.com', 'x-forwarded-for': nextIp() },
    socket: { remoteAddress: '' },
    query: {},
    cookies: {},
  }) as any

let captured: PluginContactCaptureRequest[] = []

beforeEach(() => {
  state.bookings.clear()
  state.notices.length = 0
  fileBookingOnCrm.mockClear()
  captured = standInRecordSystem()
  state.service.askPhone = 'required'
  state.service.askAddress = 'required'
})

afterEach(() => {
  delete state.service.askPhone
  delete state.service.askAddress
})

const rows = () => [...state.bookings.values()]

describe('a service that asks for a phone and an address', () => {
  it('refuses a request without the required phone, and writes nothing', async () => {
    const res = makeRes()
    await bookHandler(makeReq({ address: '12 Oak St, Austin' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Enter your phone number' })
    expect(rows()).toHaveLength(0)
  })

  it('refuses a request without the required address', async () => {
    const res = makeRes()
    await bookHandler(makeReq({ phone: '512-555-0107', address: '   \n  ' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Enter the address' })
    expect(rows()).toHaveLength(0)
  })

  it('refuses a phone that cannot be one, even when it is optional', async () => {
    state.service.askPhone = 'optional'
    const res = makeRes()
    await bookHandler(makeReq({ phone: 'call me', address: '12 Oak St' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Enter a valid phone number' })
  })

  it('stores both, tells the managers, files them on the meeting, and fills the phone', async () => {
    const res = makeRes()
    await bookHandler(
      makeReq({ phone: '(512) 555-0107', address: '  12 Oak St \n Austin, TX 78701 ' }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(rows()[0]).toMatchObject({
      phone: '+15125550107',
      address: '12 Oak St\nAustin, TX 78701',
    })
    expect(state.notices[0]['body']).toMatch(
      / Phone: \+15125550107\. Address: 12 Oak St, Austin, TX 78701\.$/,
    )
    expect(fileBookingOnCrm.mock.calls[0][1]).toMatchObject({
      booking: { phone: '+15125550107', address: '12 Oak St\nAustin, TX 78701' },
    })
    // Onto the person only where they hold none — the record system's rule,
    // asked for through `profileFill` rather than `profile`.
    expect(captured[0].profileFill).toEqual({ phone: '+15125550107' })
    expect(captured[0]).not.toHaveProperty('profile')
  })

  it('keeps a number written the local way abroad rather than refusing it', async () => {
    const res = makeRes()
    await bookHandler(makeReq({ phone: '020 7946 0958', address: '1 High St' }), res)
    expect(res.statusCode).toBe(200)
    expect(rows()[0]).toMatchObject({ phone: '020 7946 0958' })
  })
})

describe('a service that asks for neither — the default', () => {
  it('drops a phone and an address it never asked for', async () => {
    delete state.service.askPhone
    delete state.service.askAddress
    const res = makeRes()
    await bookHandler(makeReq({ phone: '512-555-0107', address: '12 Oak St' }), res)
    expect(res.statusCode).toBe(200)
    expect(rows()[0]).not.toHaveProperty('phone')
    expect(rows()[0]).not.toHaveProperty('address')
    expect(String(state.notices[0]['body'])).not.toMatch(/Phone|Address/)
    expect(captured[0]).not.toHaveProperty('profileFill')
  })

  it('takes an optional field left empty', async () => {
    state.service.askPhone = 'optional'
    state.service.askAddress = 'optional'
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(rows()[0]).not.toHaveProperty('phone')
  })
})

/**
 * The booking route refuses a draft service (AGL-3616): the directory never
 * lists one, but a request can name any service id by hand.
 */
describe('a draft service', () => {
  afterEach(() => {
    delete state.service.status
  })

  it('takes no booking, and writes nothing', async () => {
    state.service.status = 'draft'
    const res = makeRes()
    await bookHandler(makeReq({ phone: '512-555-0107', address: '12 Oak St' }), res)
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'Unknown service' })
    expect(rows()).toEqual([])
  })

  it('books once activated', async () => {
    state.service.status = 'active'
    const res = makeRes()
    await bookHandler(makeReq({ phone: '512-555-0107', address: '12 Oak St' }), res)
    expect(res.statusCode).toBe(200)
    expect(rows()).toHaveLength(1)
  })
})
