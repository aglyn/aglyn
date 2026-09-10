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
 * WHAT A BOOKING FILES ON THE RECORD (AGL-2660).
 *
 * Held against an in-memory Firestore: the meeting and the follow-up land
 * where a person-logged activity would, the reference on the link beats the
 * booker's address, nothing is filed on a site whose CRM is off, the
 * service's two switches are honored, and a redelivered booking files no
 * second meeting.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
  },
}))

import { recordCrmBooking } from './crm-booking-activity'

// ---------------------------------------------------------------------------
// In-memory Firestore: documents by path, equality queries, counts, adds.
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, unknown>>()
let minted = 0

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  ref: docHandle(path),
  exists: docs.has(path),
  get: (field: string) => docs.get(path)?.[field],
  data: () => docs.get(path),
})

function docHandle(path: string): any {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get: async () => snapshotFor(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : { ...data })
    },
    collection: (sub: string) => collectionHandle(`${path}/${sub}`),
  }
}

/** The documents directly under a collection path, as snapshots. */
function rowsUnder(path: string) {
  const rows: ReturnType<typeof snapshotFor>[] = []
  for (const key of docs.keys()) {
    if (!key.startsWith(`${path}/`)) continue
    if (key.slice(path.length + 1).includes('/')) continue
    rows.push(snapshotFor(key))
  }
  return rows
}

function queryHandle(path: string, filters: Array<[string, unknown]>, max?: number): any {
  const matching = () => {
    const rows = rowsUnder(path).filter((row) =>
      filters.every(([field, value]) => row.get(field) === value),
    )
    return typeof max === 'number' ? rows.slice(0, max) : rows
  }
  return {
    where: (field: string, _op: string, value: unknown) =>
      queryHandle(path, [...filters, [field, value]], max),
    limit: (count: number) => queryHandle(path, filters, count),
    get: async () => {
      const rows = matching()
      return { empty: rows.length === 0, docs: rows }
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: matching().length }) }),
    }),
  }
}

function collectionHandle(path: string): any {
  const parentPath = path.slice(0, path.lastIndexOf('/'))
  return {
    ...queryHandle(path, []),
    path,
    parent: parentPath.includes('/') ? docHandle(parentPath) : null,
    doc: (id?: string) => docHandle(`${path}/${id ?? `minted-${(minted += 1)}`}`),
    add: async (data: Record<string, unknown>) => {
      const id = `minted-${(minted += 1)}`
      docs.set(`${path}/${id}`, { ...data })
      return { id }
    },
  }
}

const firestore: any = {
  collection: (name: string) => collectionHandle(name),
}

/** Every document under a collection, keyed by id. */
const under = (path: string) =>
  Object.fromEntries(rowsUnder(path).map((row) => [row.id, row.data()]))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const ORG = 'org-1'
/**
 * An org with no consent groups declared — the site is a group of its own —
 * on a plan that carries the CRM suite the filed rows belong to.
 */
const org = { plan: 'starter', enabledPlugins: ['crm', 'bookings'] }

// Tuesday, September 15, 2026 at 10:00 AM in Chicago.
const STARTS = Date.UTC(2026, 8, 15, 15, 0)
const ENDS = STARTS + 30 * 60_000
const DAY = 24 * 60 * 60 * 1000

const service = (extra: Record<string, unknown> = {}) => ({
  name: 'Intro call',
  timezone: 'America/Chicago',
  ...extra,
})

const booking = (extra: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  serviceId: 'service-1',
  serviceName: 'Intro call',
  email: 'rhea@example.com',
  startsAtMs: STARTS,
  endsAtMs: ENDS,
  ...extra,
})

/** A contact this site captured, owned by a rep, at a company. */
function seedContact(id: string, email: string, extra: Record<string, unknown> = {}) {
  docs.set(`orgs/${ORG}/contacts/${id}`, {
    email,
    visibleTo: [`host:${HOST}`],
    facets: { [HOST]: { ownerUid: 'rep-1', companyId: 'company-1' } },
    ...extra,
  })
}

const file = (
  extra: Partial<Parameters<typeof recordCrmBooking>[1]> = {},
  serviceExtra: Record<string, unknown> = {},
  bookingExtra: Record<string, unknown> = {},
) =>
  recordCrmBooking(firestore, {
    hostId: HOST,
    org,
    orgId: ORG,
    booking: booking(bookingExtra),
    service: service(serviceExtra),
    host: null,
    ...extra,
  })

beforeEach(() => {
  docs.clear()
  minted = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the meeting a booking files', () => {
  it('lands on the contact the booker address names, in the site scope', async () => {
    seedContact('contact-1', 'rhea@example.com')
    const outcome = await file()
    expect(outcome).toEqual({
      filed: true,
      matchedBy: 'email',
      link: { contactId: 'contact-1', companyId: 'company-1' },
      activityId: 'minted-1',
      taskId: null,
    })
    const activities = under(`orgs/${ORG}/crmActivities`)
    expect(Object.keys(activities)).toHaveLength(1)
    expect(activities['minted-1']).toMatchObject({
      kind: 'meeting',
      body: 'Intro call — Tuesday, September 15, 2026 at 10:00 AM (America/Chicago)',
      atMs: STARTS,
      byUid: '',
      contactId: 'contact-1',
      companyId: 'company-1',
      bookingId: 'booking-1',
      hostId: HOST,
      visibleTo: [`host:${HOST}`],
      createdAt: 'server-timestamp',
    })
    expect(under(`orgs/${ORG}/crmTasks`)).toEqual({})
  })

  it('files no meeting when the service has switched it off', async () => {
    seedContact('contact-1', 'rhea@example.com')
    const outcome = await file({}, { crmMeetingActivity: false })
    expect(outcome).toEqual({ filed: false, reason: 'nothing-to-file' })
    expect(under(`orgs/${ORG}/crmActivities`)).toEqual({})
  })

  it('files nothing on a site whose CRM is off, however the site says so', async () => {
    seedContact('contact-1', 'rhea@example.com')
    expect(await file({ org: { enabledPlugins: ['bookings'] } })).toEqual({
      filed: false,
      reason: 'crm-off',
    })
    expect(await file({ host: { disabledPlugins: ['crm'] } })).toEqual({
      filed: false,
      reason: 'crm-off',
    })
    expect(under(`orgs/${ORG}/crmActivities`)).toEqual({})
  })

  /*
   * The meeting and the follow-up are a CRM activity and a CRM task — the
   * suite's records, included from Starter (AGL-2787). A Free workspace
   * that runs the CRM plugin still captures the booker as a contact; it
   * does not have its timeline filled with suite rows it cannot open.
   */
  it('files nothing for a plan without the CRM suite, and says so', async () => {
    seedContact('contact-1', 'rhea@example.com')
    const free = { plan: 'free', enabledPlugins: ['crm', 'bookings'] }
    expect(await file({ org: free }, { crmFollowUpTask: true })).toEqual({
      filed: false,
      reason: 'not-entitled',
    })
    expect(under(`orgs/${ORG}/crmActivities`)).toEqual({})
    expect(under(`orgs/${ORG}/crmTasks`)).toEqual({})
    // A per-org grant of the suite on a Free plan files as any paid plan does.
    const granted = { ...free, entitlements: { features: { crm: true } } }
    expect((await file({ org: granted })).filed).toBe(true)
  })

  it('reads the host document for the deny-list when the caller holds none', async () => {
    seedContact('contact-1', 'rhea@example.com')
    docs.set(`hosts/${HOST}`, { disabledPlugins: ['crm'] })
    expect(await file({ host: undefined })).toEqual({ filed: false, reason: 'crm-off' })
  })

  it('files nothing when neither the reference nor the address names a record', async () => {
    expect(await file()).toEqual({ filed: false, reason: 'no-record' })
    expect(under(`orgs/${ORG}/crmActivities`)).toEqual({})
  })

  it('files one meeting per booking, whatever path re-enters', async () => {
    seedContact('contact-1', 'rhea@example.com')
    expect((await file()).filed).toBe(true)
    expect(await file()).toEqual({ filed: false, reason: 'already-filed' })
    expect(Object.keys(under(`orgs/${ORG}/crmActivities`))).toHaveLength(1)
  })
})

describe('the record the booking link named', () => {
  it('beats the booker address: a contact reference files under that contact', async () => {
    seedContact('contact-1', 'rhea@example.com')
    seedContact('contact-2', 'other@example.com', {
      facets: { [HOST]: { ownerUid: 'rep-2' } },
    })
    const outcome = await file({}, {}, { crmRef: 'contact:contact-2' })
    expect(outcome).toMatchObject({
      filed: true,
      matchedBy: 'crmRef',
      link: { contactId: 'contact-2' },
    })
    expect(under(`orgs/${ORG}/crmActivities`)['minted-1']).toMatchObject({
      contactId: 'contact-2',
    })
  })

  it('files under a deal, carrying its contact and company', async () => {
    docs.set(`orgs/${ORG}/deals/deal-1`, {
      visibleTo: [`host:${HOST}`],
      contactId: 'contact-9',
      companyId: 'company-9',
      ownerUid: 'rep-3',
    })
    const outcome = await file({}, { crmFollowUpTask: true }, { crmRef: 'deal:deal-1' })
    expect(outcome).toMatchObject({
      filed: true,
      matchedBy: 'crmRef',
      link: { dealId: 'deal-1', contactId: 'contact-9', companyId: 'company-9' },
    })
    expect(under(`orgs/${ORG}/crmTasks`)['minted-2']).toMatchObject({
      dealId: 'deal-1',
      assigneeUid: 'rep-3',
    })
  })

  it('files under a lead of this site', async () => {
    docs.set(`hosts/${HOST}/leads/lead-1`, { email: 'lead@example.com' })
    const outcome = await file({}, {}, { crmRef: 'lead:lead-1' })
    expect(outcome).toMatchObject({ filed: true, matchedBy: 'crmRef', link: { leadId: 'lead-1' } })
  })

  it('falls through to the address for a reference this site cannot see', async () => {
    seedContact('contact-1', 'rhea@example.com')
    seedContact('contact-2', 'other@example.com', { visibleTo: ['host:another'] })
    expect(await file({}, {}, { crmRef: 'contact:contact-2' })).toMatchObject({
      filed: true,
      matchedBy: 'email',
      link: { contactId: 'contact-1' },
    })
  })

  it('ignores a malformed reference rather than storing or searching it', async () => {
    seedContact('contact-1', 'rhea@example.com')
    expect(await file({}, {}, { crmRef: 'company:x/y' })).toMatchObject({
      filed: true,
      matchedBy: 'email',
    })
  })
})

describe('the follow-up task', () => {
  it('is filed one business day after the slot, on the relationship owner', async () => {
    seedContact('contact-1', 'rhea@example.com')
    const outcome = await file({}, { crmFollowUpTask: true })
    expect(outcome).toMatchObject({ filed: true, activityId: 'minted-1', taskId: 'minted-2' })
    expect(under(`orgs/${ORG}/crmTasks`)['minted-2']).toEqual({
      title: 'Follow up after Intro call',
      kind: 'todo',
      priority: 'normal',
      status: 'open',
      dueAtMs: ENDS + DAY,
      assigneeUid: 'rep-1',
      createdByUid: '',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: HOST,
      visibleTo: [`host:${HOST}`],
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
    })
  })

  it('is owed even when the service files no meeting', async () => {
    seedContact('contact-1', 'rhea@example.com')
    const outcome = await file({}, { crmFollowUpTask: true, crmMeetingActivity: false })
    expect(outcome).toMatchObject({ filed: true, activityId: null, taskId: 'minted-1' })
    expect(under(`orgs/${ORG}/crmActivities`)).toEqual({})
  })
})

describe('failure posture', () => {
  it('never throws: a broken read is logged and reported', async () => {
    const broken: any = {
      collection: () => {
        throw new Error('unavailable')
      },
    }
    const outcome = await recordCrmBooking(broken, {
      hostId: HOST,
      org,
      orgId: ORG,
      booking: booking(),
      service: service(),
      host: null,
    })
    expect(outcome).toEqual({ filed: false, reason: 'failed' })
    expect(console.error).toHaveBeenCalled()
  })
})
