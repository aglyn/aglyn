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
 * THE CREATE ROUTE'S HALF OF THE CRM DOOR (AGL-2660).
 *
 * A booking link carries the record it was dropped from as `?crm=`, and the
 * widget posts it as `crmRef`. The route keeps a well-formed reference on
 * the row and hands it — with the service, whose two switches decide what
 * is filed — to the filing after a FREE booking lands. A value that is not
 * a reference is neither stored nor forwarded: this is a public door.
 *
 * The filing itself is doubled here; what it writes is held in
 * `crm-booking-activity.spec.ts` in the admin library.
 */

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
  captureHostContact: () => undefined,
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

const fileBookingOnCrm = jest.fn(async () => ({ filed: false, reason: 'no-record' }))
jest.mock('./server/booking-crm', () => ({
  fileBookingOnCrm: (...args: unknown[]) => fileBookingOnCrm(...(args as [])),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const bookings = new Map<string, Record<string, unknown>>()
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
    __state: { bookings, service },
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
    notifyHostManagers: async () => undefined,
    hostSendingIdentity: async () => ({ from: 'hello@shop.example.com' }),
    resolveCampaignTouch: async () => null,
    attributeCampaignConversion: async () => null,
    getPluginConfig: async () => ({}),
    renderHostEmailWithTokens: async () => null,
    addHostLead: async () => true,
  }
})

import { computeOpenSlots } from './model'
import { bookHandler } from './server'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: { bookings: Map<string, Record<string, unknown>>; service: any }
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
    headers: { host: 'shop.example.com', 'x-forwarded-for': '203.0.113.9' },
    socket: { remoteAddress: '203.0.113.9' },
    query: {},
    cookies: {},
  }) as any

beforeEach(() => {
  state.bookings.clear()
  fileBookingOnCrm.mockClear()
})

/** The one row the route wrote. */
const writtenRow = () => {
  const rows = [...state.bookings.entries()]
  expect(rows).toHaveLength(1)
  return { id: rows[0][0], row: rows[0][1] }
}

describe('a free booking made through a CRM booking link', () => {
  it('keeps the reference on the row and hands it, with the service, to the filing', async () => {
    const res = makeRes()
    await bookHandler(makeReq({ crmRef: 'contact:contact-1' }), res)
    expect(res.statusCode).toBe(200)
    const { id, row } = writtenRow()
    expect(row).toMatchObject({ status: 'confirmed', crmRef: 'contact:contact-1' })
    expect(fileBookingOnCrm).toHaveBeenCalledTimes(1)
    expect(fileBookingOnCrm.mock.calls[0][1]).toMatchObject({
      hostId: 'host-1',
      bookingId: id,
      booking: {
        serviceId: 'service-1',
        serviceName: 'Intro call',
        email: 'dana@example.com',
        crmRef: 'contact:contact-1',
      },
      service: { name: 'Intro call', crmFollowUpTask: true },
    })
  })

  it('neither stores nor forwards a value that is not a reference', async () => {
    const res = makeRes()
    await bookHandler(makeReq({ crmRef: 'company:x/y' }), res)
    expect(res.statusCode).toBe(200)
    expect(writtenRow().row).not.toHaveProperty('crmRef')
    expect(fileBookingOnCrm).toHaveBeenCalledTimes(1)
    expect(fileBookingOnCrm.mock.calls[0][1]).not.toHaveProperty(['booking', 'crmRef'])
  })

  it('files the meeting for a booking taken off the widget cold, matched by address', async () => {
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(writtenRow().row).not.toHaveProperty('crmRef')
    expect(fileBookingOnCrm).toHaveBeenCalledTimes(1)
  })
})
