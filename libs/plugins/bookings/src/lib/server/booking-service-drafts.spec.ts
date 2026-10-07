/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
 *
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
 * The booking-service draft writer (AGL-3616), against the real plan table
 * and the real model: only the Admin SDK is a double, one that honors
 * transactions and counts a collection.
 *
 *  - THE REFUSAL is the resources route's: plan feature, role, allowance.
 *  - THE CHECK holds content to what the service dialog can store.
 *  - THE WRITE makes a draft, and asked again under its id finds it.
 *  - A DRAFT is offered nowhere until activated.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { bookingServiceIsOffered } from '../model/bookings'
import {
  BOOKING_SERVICE_DRAFT_RESOURCE,
  BOOKING_SERVICE_PLAN_REFUSAL,
  BOOKING_SERVICE_ROLE_REFUSAL,
  bookingServiceDraftWriter,
  bookingServiceLimitRefusal,
  checkBookingServiceContent,
  createBookingServiceDraftWriter,
  registerBookingServiceDraftWriter,
} from './booking-service-drafts'

const NOW = new Date('2026-10-06T15:00:00.000Z')

// ── Firestore double ─────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>()
let commits: string[] = []

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

const childrenOf = (path: string) =>
  [...store.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const counted = {
    kind: 'count',
    get: async () => ({ data: () => ({ count: childrenOf(path).length }) }),
  }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), count: () => counted }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'doc' ? snapshotOf(target.path) : target.get(),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const writer = createBookingServiceDraftWriter({ firestore: () => firestore })

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Starter: bookings on, one service. */
const STARTER = { plan: 'starter' }
/** Pro: bookings on, services unlimited. */
const PRO = { plan: 'pro' }
/** Free: no bookings. */
const FREE = { plan: 'free' }

const CONTENT = {
  name: 'Free estimate visit',
  durationMinutes: 60,
  description: 'We come out, look at the job and quote it on the spot.',
  windows: { 1: [{ start: 540, end: 720 }, { start: 780, end: 1020 }], 3: [{ start: 540, end: 1020 }] },
  timezone: 'America/Chicago',
  priceDisplay: 'estimate',
  askPhone: 'required',
  askAddress: 'required',
}

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: PRO as Record<string, unknown>,
  now: NOW,
  id: 'draft-1',
  name: 'Free estimate visit',
  content: CONTENT,
  ...patch,
})

beforeEach(() => {
  store.clear()
  commits = []
  store.set('hosts/host-1', { memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer' } })
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the booking-service writer', () => {
  it('writes the service the dialog saves, born a draft, with the stamps the resources route adds', async () => {
    const written = await writer.write(request())
    expect(written).toEqual({
      ok: true,
      replayed: false,
      id: 'draft-1',
      name: 'Free estimate visit',
      versionId: null,
      facts: {
        status: 'draft',
        durationMinutes: 60,
        priceDisplay: 'estimate',
        priceText: 'Free estimate',
        timezone: 'America/Chicago',
        openWeekdays: [1, 3],
      },
    })
    expect(store.get('hosts/host-1/services/draft-1')).toEqual({
      name: 'Free estimate visit',
      durationMinutes: 60,
      description: 'We come out, look at the job and quote it on the spot.',
      windows: CONTENT.windows,
      timezone: 'America/Chicago',
      priceDisplay: 'estimate',
      priceUsd: 0,
      askPhone: 'required',
      askAddress: 'required',
      crmMeetingActivity: true,
      crmFollowUpTask: false,
      status: 'draft',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    // What it wrote takes no bookings until a person activates it.
    expect(bookingServiceIsOffered(store.get('hosts/host-1/services/draft-1'))).toBe(false)
    expect(bookingServiceIsOffered({ ...store.get('hosts/host-1/services/draft-1'), status: 'active' })).toBe(true)
  })

  it('states no price it was not given: no price and no label is "Contact for price"', async () => {
    const written = await writer.write(request({ content: { ...CONTENT, priceDisplay: undefined } }))
    expect(written).toMatchObject({ ok: true, facts: { priceDisplay: 'contact', priceText: 'Contact for price' } })
    expect(store.get('hosts/host-1/services/draft-1')).toMatchObject({ priceDisplay: 'contact', priceUsd: 0 })
  })

  it('keeps a fixed price the content states', async () => {
    const written = await writer.write(request({ content: { ...CONTENT, priceDisplay: undefined, priceUsd: 120 } }))
    expect(written).toMatchObject({ ok: true, facts: { priceDisplay: 'fixed', priceText: '$120' } })
    expect(store.get('hosts/host-1/services/draft-1')).toMatchObject({ priceDisplay: 'fixed', priceUsd: 120 })
  })

  it('finds its draft when asked again under the same id, and writes nothing more', async () => {
    await writer.write(request())
    commits = []
    const again = await writer.write(request({ name: 'Another name entirely' }))
    expect(again).toMatchObject({
      ok: true,
      replayed: true,
      id: 'draft-1',
      name: 'Free estimate visit',
      facts: { status: 'draft' },
    })
    expect(commits).toEqual([])
    expect(await writer.read({ hostId: 'host-1', id: 'draft-1' })).toMatchObject({
      id: 'draft-1',
      name: 'Free estimate visit',
      versionId: null,
    })
    expect(await writer.read({ hostId: 'host-1', id: 'nothing' })).toBeNull()
  })

  it('reports an activated draft as active when read back', async () => {
    await writer.write(request())
    store.set('hosts/host-1/services/draft-1', { ...store.get('hosts/host-1/services/draft-1'), status: 'active' })
    expect(await writer.read({ hostId: 'host-1', id: 'draft-1' })).toMatchObject({ facts: { status: 'active' } })
  })

  it('takes the content’s name when the request names none', async () => {
    const written = await writer.write(request({ name: '  ' }))
    expect(written).toMatchObject({ ok: true, name: 'Free estimate visit' })
  })

  it('refuses content the check refuses, with its first problem, and writes nothing', async () => {
    const written = await writer.write(request({ content: { ...CONTENT, durationMinutes: 600 } }))
    expect(written).toEqual({ ok: false, status: 400, error: 'The length is whole minutes from 5 to 480' })
    expect(commits).toEqual([])
  })
})

describe('the refusal', () => {
  it('admits an editor on a plan with room', async () => {
    expect(await writer.refusal(request())).toBeNull()
  })

  it('refuses a plan without bookings, in the resources route’s words', async () => {
    const refusal = { status: 403, error: BOOKING_SERVICE_PLAN_REFUSAL }
    expect(await writer.refusal(request({ org: FREE }))).toEqual(refusal)
    expect(await writer.write(request({ org: FREE }))).toEqual({ ok: false, ...refusal })
    expect(commits).toEqual([])
  })

  it('refuses a member who may not write the site', async () => {
    const refusal = { status: 403, error: BOOKING_SERVICE_ROLE_REFUSAL }
    expect(await writer.refusal(request({ uid: 'uid-2' }))).toEqual(refusal)
    expect(await writer.write(request({ uid: 'uid-2' }))).toEqual({ ok: false, ...refusal })
  })

  it('refuses at the allowance, counted inside the write as the resources route counts it', async () => {
    expect(await writer.refusal(request({ org: STARTER }))).toBeNull()
    store.set('hosts/host-1/services/existing', { name: 'Consult', durationMinutes: 30 })
    const refusal = { status: 403, error: bookingServiceLimitRefusal(1) }
    expect(refusal.error).toBe('Your plan includes 1 service — upgrade in Billing for more')
    expect(await writer.refusal(request({ org: STARTER }))).toEqual(refusal)
    expect(await writer.write(request({ org: STARTER }))).toEqual({ ok: false, ...refusal })
    expect(store.has('hosts/host-1/services/draft-1')).toBe(false)
  })

  it('answers an unknown site', async () => {
    expect(await writer.refusal(request({ hostId: 'host-x' }))).toEqual({ status: 404, error: 'Unknown site' })
    expect(await writer.write(request({ hostId: 'host-x' }))).toEqual({ ok: false, status: 404, error: 'Unknown site' })
  })
})

describe('the check', () => {
  const problemsOf = (patch: Record<string, unknown>) => {
    const check = checkBookingServiceContent({ ...CONTENT, ...patch })
    return check.ok === false ? check.problems : []
  }

  it('passes the content with what it would store', () => {
    expect(checkBookingServiceContent(CONTENT)).toEqual({
      ok: true,
      facts: expect.objectContaining({ status: 'draft', priceText: 'Free estimate' }),
    })
  })

  it('holds the length to 5–480 whole minutes', () => {
    expect(problemsOf({ durationMinutes: 4 })).toEqual(['The length is whole minutes from 5 to 480'])
    expect(problemsOf({ durationMinutes: 481 })).toHaveLength(1)
    expect(problemsOf({ durationMinutes: 30.5 })).toHaveLength(1)
    expect(problemsOf({ durationMinutes: 5 })).toEqual([])
    expect(problemsOf({ durationMinutes: 480 })).toEqual([])
  })

  it('needs a name, a real time zone and weekly hours', () => {
    expect(problemsOf({ name: ' ' })).toEqual(['The service needs a name'])
    expect(problemsOf({ name: 'x'.repeat(81) })).toEqual(['The name is longer than 80 characters'])
    expect(problemsOf({ timezone: 'Mars/Olympus_Mons' })).toEqual([
      'The time zone is an IANA zone, such as America/Chicago',
    ])
    expect(problemsOf({ windows: {} })).toEqual([
      'The service needs weekly hours: at least one open window on one weekday',
    ])
  })

  it('holds windows to weekdays, whole minutes in a day, and no overlap', () => {
    expect(problemsOf({ windows: { 7: [{ start: 0, end: 60 }] } })).toEqual([
      '"7" is not a weekday: weekdays are 0 (Sunday) to 6 (Saturday)',
    ])
    expect(problemsOf({ windows: { 1: [{ start: 600, end: 540 }] } })).toHaveLength(1)
    expect(problemsOf({ windows: { 1: [{ start: 0, end: 1441 }] } })).toHaveLength(1)
    expect(problemsOf({ windows: { 1: [{ start: 540, end: 720 }, { start: 700, end: 800 }] } })).toEqual([
      'Two windows on weekday 1 overlap',
    ])
  })

  it('needs a stated price for a fixed one, and a known way of stating it', () => {
    expect(problemsOf({ priceDisplay: 'fixed' })).toHaveLength(1)
    expect(problemsOf({ priceDisplay: 'fixed', priceUsd: -1 })).toHaveLength(1)
    expect(problemsOf({ priceDisplay: 'fixed', priceUsd: 0 })).toEqual([])
    expect(problemsOf({ priceDisplay: 'whatever' })).toEqual([
      'The price is stated as fixed, varies, estimate or contact',
    ])
    // A label wins over a stated price, which it is never shown beside.
    expect(checkBookingServiceContent({ ...CONTENT, priceUsd: 80 })).toMatchObject({
      ok: true,
      facts: { priceText: 'Free estimate' },
    })
  })

  it('holds the two asks to off, optional or required', () => {
    expect(problemsOf({ askPhone: 'sometimes' })).toEqual(['Asking for a phone number is off, optional or required'])
    expect(problemsOf({ askAddress: true })).toEqual(['Asking for an address is off, optional or required'])
  })
})

describe('registration', () => {
  it('registers the writer under its resource, owned by the bookings plugin', () => {
    registerBookingServiceDraftWriter()
    expect(pluginResourceDraftWriter(BOOKING_SERVICE_DRAFT_RESOURCE)).toEqual({
      pluginId: 'bookings',
      writer: bookingServiceDraftWriter,
    })
    // A second call replaces its own registration rather than throwing.
    registerBookingServiceDraftWriter()
    expect(pluginResourceDraftWriter(BOOKING_SERVICE_DRAFT_RESOURCE)?.pluginId).toBe('bookings')
  })
})
