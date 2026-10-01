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
 * The filing itself is doubled here; what it asks the record system for is
 * held in `server/booking-crm.spec.ts`, and what the CRM files for it in the
 * CRM's record-timeline spec.
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
    resolveCampaignTouch: async () => null,
    attributeCampaignConversion: async () => null,
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
    headers: { host: 'shop.example.com', 'x-forwarded-for': '203.0.113.9' },
    socket: { remoteAddress: '203.0.113.9' },
    query: {},
    cookies: {},
  }) as any

/** What the door reported, filled by the stand-in record system. */
let captured: PluginContactCaptureRequest[] = []

beforeEach(() => {
  state.bookings.clear()
  state.notices.length = 0
  fileBookingOnCrm.mockClear()
  captured = standInRecordSystem()
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

  /**
   * WHO KEEPS THE PERSON IS NOT THIS PLUGIN'S BUSINESS (AGL-3080).
   *
   * A booking request identifies somebody, and bookings reports that through
   * the platform's contact-capture contract rather than writing a contact
   * itself. What it owes the record system is the address, its own word for
   * the door, the stage a request is worth and the consent the visitor gave;
   * everything a person record is — keying the address, the audience band,
   * the erasure rows — belongs to whichever plugin keeps people.
   *
   * ⚠️ A LEAD SURFACE, not a customer (AGL-3232): no money has moved when
   * a request is made, so the record system files a lead — or lands the
   * request on the contact the workspace already holds. The payment webhook
   * is the door that makes a customer. The door itself writes no lead.
   */
  it('reports the person it met to whichever plugin keeps people, as a lead surface', async () => {
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      hostId: 'host-1',
      identity: { email: 'dana@example.com' },
      interaction: { source: 'booking', refId: writtenRow().id },
      surface: 'lead',
    })
    expect(captured[0]).not.toHaveProperty('lifecycleFloor')
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

/**
 * THE BOOKING CARRIES ITS ZONE (AGL-3432).
 *
 * The paid confirmation and the reminder read the booking, never the service,
 * and the booking stored no zone: both formatted in the server's zone (UTC)
 * and the confirmation printed an empty "()". The managers' notice was a bare
 * server-side `toLocaleString()`. The route now stores the zone it told the
 * time in, and the notice says who booked what, when, in that zone.
 */
describe('a booking is told and stored in its service’s zone (AGL-3432)', () => {
  afterEach(() => {
    state.service.timezone = 'UTC'
  })

  it('stores the zone on the row and names it in the managers’ notice', async () => {
    state.service.timezone = 'America/Chicago'
    const startsAtMs = nextBookableStart()
    const res = makeRes()
    await bookHandler(makeReq({ startsAtMs }), res)
    expect(res.statusCode).toBe(200)
    expect(writtenRow().row).toMatchObject({ timezone: 'America/Chicago' })

    const when = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(startsAtMs))
    expect(state.notices).toEqual([
      expect.objectContaining({
        hostId: 'host-1',
        type: 'content.booking',
        title: 'New booking on {site}',
        body:
          `Dana (dana@example.com) booked Intro call on {site} for ${when} ` +
          '(America/Chicago).',
      }),
    ])
  })
})
