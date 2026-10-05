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
 * WHAT A BOOKING ASKS THE RECORD SYSTEM TO FILE (AGL-2660).
 *
 * The booking reaches its record through the core's record-timeline seam,
 * and a stand-in record system answers here the way the loader would stand
 * the real one up: one plugin may not import another. What is held is the
 * REQUEST — the meeting at the slot, the follow-up a business day on for
 * whoever holds the record, both keyed by the booking, the record the link
 * carried and the booker's address to find it by — and that nothing is
 * asked on a site whose record system is off. Which record the CRM finds for
 * it, and what it writes, is held in the CRM's record-timeline spec.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getOrgForHost: jest.fn(async () => ({
    orgId: 'org-1',
    org: { plan: 'starter', enabledPlugins: ['record-system', 'bookings'] },
  })),
}))

import {
  registerPluginRecordTimelineWriter,
  type PluginRecordActivityRequest,
  type PluginRecordTaskRequest,
  type PluginRecordWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { getOrgForHost } from '@aglyn/tenant-data-admin'
import { fileBookingOnCrm } from './booking-crm'

const HOST = 'host-1'
const DAY = 24 * 60 * 60 * 1000
// Tuesday, September 15, 2026 at 10:00 AM in Chicago.
const STARTS = Date.UTC(2026, 8, 15, 15, 0)
const ENDS = STARTS + 30 * 60_000

const docs = new Map<string, Record<string, unknown>>()
const doc = (path: string): any => ({
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
})
const firestore: any = { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }) }

let activities: PluginRecordActivityRequest[]
let tasks: PluginRecordTaskRequest[]
let meetingAnswer: PluginRecordWrite

function standInRecordSystem() {
  resetPluginServicesForTests()
  registerPluginRecordTimelineWriter(
    {
      logActivity: async (request) => {
        activities.push(request)
        return meetingAnswer
      },
      createTask: async (request) => {
        tasks.push(request)
        return { ok: true, id: 'task-1', created: true }
      },
    },
    { pluginId: 'record-system' },
  )
}

const booking = (extra: Record<string, unknown> = {}) => ({
  serviceId: 'service-1',
  serviceName: 'Intro call',
  email: 'rhea@example.com',
  startsAtMs: STARTS,
  endsAtMs: ENDS,
  ...extra,
})

const service = (extra: Record<string, unknown> = {}) => ({
  name: 'Intro call',
  timezone: 'America/Chicago',
  ...extra,
})

const file = (
  bookingExtra: Record<string, unknown> = {},
  serviceExtra: Record<string, unknown> | null = {},
) =>
  fileBookingOnCrm(firestore, {
    hostId: HOST,
    bookingId: 'booking-1',
    booking: booking(bookingExtra),
    ...(serviceExtra === null ? {} : { service: service(serviceExtra) as never }),
  })

beforeEach(() => {
  docs.clear()
  docs.set(`hosts/${HOST}`, {})
  activities = []
  tasks = []
  meetingAnswer = { ok: true, id: 'activity-1', created: true }
  standInRecordSystem()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  resetPluginServicesForTests()
})

describe('the meeting a booking files', () => {
  it('is the slot, named in the service zone, keyed by the booking, on the booker found by address', async () => {
    const outcome = await file()
    expect(outcome).toMatchObject({ filed: true, followUp: null })
    expect(activities).toEqual([
      {
        orgId: 'org-1',
        hostId: HOST,
        link: { record: null, email: 'rhea@example.com' },
        sourcePluginId: 'bookings',
        kind: 'meeting',
        atMs: STARTS,
        body: 'Intro call — Tuesday, September 15, 2026 at 10:00 AM (America/Chicago)',
        byUid: '',
        dedupeKey: 'booking:booking-1',
      },
    ])
    expect(tasks).toEqual([])
  })

  it('names the phone and the job address the service asked for (AGL-3493)', async () => {
    await file({ phone: '+15125550107', address: '12 Oak St\nAustin, TX 78701' })
    expect(activities[0]?.body).toBe(
      'Intro call — Tuesday, September 15, 2026 at 10:00 AM (America/Chicago)\n' +
        'Phone: +15125550107\n' +
        'Address: 12 Oak St, Austin, TX 78701',
    )
  })

  it('carries back the record the booking link named, beside the address', async () => {
    await file({ crmRef: 'deal:deal-7' })
    expect(activities[0]?.link).toEqual({
      record: { kind: 'deal', id: 'deal-7' },
      email: 'rhea@example.com',
    })
  })

  it('carries no record for a reference that is not one', async () => {
    await file({ crmRef: 'deal:../../x' })
    expect(activities[0]?.link).toEqual({ record: null, email: 'rhea@example.com' })
  })

  it('asks for nothing when the service has switched the meeting off and wants no follow-up', async () => {
    expect(await file({}, { crmMeetingActivity: false })).toEqual({
      filed: false,
      reason: 'nothing-to-file',
    })
    expect(activities).toEqual([])
  })

  it('reads the service when the caller holds none', async () => {
    docs.set(`hosts/${HOST}/services/service-1`, service({ crmMeetingActivity: false }))
    expect(await file({}, null)).toEqual({ filed: false, reason: 'nothing-to-file' })
  })
})

describe('where nothing is asked', () => {
  it('a site that has switched the record system off', async () => {
    docs.set(`hosts/${HOST}`, { disabledPlugins: ['record-system'] })
    expect(await file()).toEqual({ filed: false, reason: 'record-system-off' })
    expect(activities).toEqual([])
  })

  it('a workspace that has not turned the record system on', async () => {
    ;(getOrgForHost as jest.Mock).mockResolvedValueOnce({
      orgId: 'org-1',
      org: { plan: 'starter', enabledPlugins: ['bookings'] },
    })
    expect(await file()).toEqual({ filed: false, reason: 'record-system-off' })
  })

  it('a workspace no plugin keeps records for', async () => {
    resetPluginServicesForTests()
    expect(await file()).toEqual({ filed: false, reason: 'no-record-system' })
  })
})

describe('the follow-up task', () => {
  it('is one business day after the slot, for whoever holds the record, keyed by the booking', async () => {
    await file({}, { crmFollowUpTask: true })
    expect(tasks).toEqual([
      {
        orgId: 'org-1',
        hostId: HOST,
        link: { record: null, email: 'rhea@example.com' },
        sourcePluginId: 'bookings',
        dedupeKey: 'booking-follow-up:booking-1',
        title: 'Follow up after Intro call',
        kind: 'todo',
        dueAtMs: ENDS + DAY,
        assigneeUid: null,
        createdByUid: '',
      },
    ])
  })

  it('is owed even when the service files no meeting', async () => {
    await file({}, { crmFollowUpTask: true, crmMeetingActivity: false })
    expect(activities).toEqual([])
    expect(tasks).toHaveLength(1)
  })

  it('is still asked for when the record refuses the meeting', async () => {
    meetingAnswer = { ok: false, status: 409, error: 'The activity log is full.' }
    const outcome = await file({}, { crmFollowUpTask: true })
    expect(outcome).toMatchObject({ filed: true, meeting: { ok: false, status: 409 } })
    expect(tasks).toHaveLength(1)
  })
})

describe('failure posture', () => {
  it('never throws: a broken read is logged and reported', async () => {
    ;(getOrgForHost as jest.Mock).mockRejectedValueOnce(new Error('unavailable'))
    expect(await file()).toEqual({ filed: false, reason: 'failed' })
    expect(console.error).toHaveBeenCalled()
  })
})
