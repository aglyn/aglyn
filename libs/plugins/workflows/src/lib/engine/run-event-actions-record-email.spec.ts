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
 * AN AUTOMATION'S EMAIL, OFFERED TO THE RECORD SYSTEM'S TIMELINE (AGL-2615,
 * AGL-3080).
 *
 * A `sendEmail` step is the engine's own. Whether the message lands on a
 * person's timeline is the record system's to say, through the record
 * timeline's `prepareEmail`: the engine offers the message before it goes,
 * carries the tags it is answered with — the only thing the delivery webhook
 * has to find the entry by — and files the entry once the provider accepted
 * it. Pinned here against the real engine with a stand-in record system;
 * the CRM's answer is its own spec's, and the real pair runs together in
 * `apps/console/specs/crm-automation-steps.spec.ts`.
 */

const HOST_ID = 'site-1'
const ORG_ID = 'o1'

/** Actions returned by the trigger query, filtered by `trigger.event`. */
let mockActions: { id: string; data: Record<string, any> }[] = []
/** The org's billing doc, as the run's gate read it. */
let mockOrg: Record<string, any> = { plan: 'business' }
/** Everything added to `hosts/{id}/activity`. */
let mockActivity: Record<string, any>[] = []
/** Every message handed to `sendEmail`, and what it answers. */
let sentMessages: Record<string, any>[] = []
let sendResult: Record<string, any> = { sent: true }
/** Whether the site has an organization at all. */
let mockOwned = true

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
    doc: (id: string) => ({
      id,
      get: async () => missingSnapshot(id),
      set: async () => undefined,
      collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
    }),
    add: async (data: Record<string, any>) => {
      if (path.endsWith('activity')) mockActivity.push(data)
      return { id: 'new' }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => ({ collection: (name: string) => collectionHandle(name) }) }),
  },
  getOrgForHost: async () => (mockOwned ? { orgId: ORG_ID, org: mockOrg } : { orgId: null, org: mockOrg }),
  resolveOrgIdForHost: async () => (mockOwned ? ORG_ID : null),
  consentGroupForSite: async () => ({ hostId: HOST_ID, groupId: HOST_ID, hostIds: [HOST_ID] }),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  flowEmailRefusal: async () => null,
  enrollListMember: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  isDeferrableSendResult: () => false,
  sendEmail: async (message: Record<string, any>) => {
    sentMessages.push(message)
    return sendResult
  },
  sendFailureReason: (result: { sent?: boolean; reason?: string } | null) =>
    !result || result.sent ? null : (result.reason ?? null),
}))

import {
  registerPluginRecordTimelineWriter,
  type PluginRecordEmailPrepareRequest,
  type PluginRecordEmailSent,
  type PluginRecordTimelineWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { runEventActions } from './run-event-actions'

/** What the stand-in record system was offered, and what it filed. */
let offered: PluginRecordEmailPrepareRequest[] = []
let filed: PluginRecordEmailSent[] = []
/** What it answers the next offer with: tags, or `null` for a message that earns no entry. */
let answer: 'entry' | 'none' = 'entry'

const refusal = async () => ({ ok: false as const, status: 400 as const, error: 'not here' })

/** A record system that files sent mail, stood in: the CRM may not be loaded here. */
const records: PluginRecordTimelineWriter = {
  logActivity: refusal,
  createTask: refusal,
  async prepareEmail(request) {
    offered.push(request)
    if (answer === 'none') return null
    return {
      tags: [{ name: 'entry', value: 'entry-1' }],
      file: async (sent) => {
        filed.push(sent)
      },
    }
  },
}

const welcome = (extra: Record<string, any> = {}) => ({
  id: 'action-1',
  data: {
    name: 'Welcome',
    enabled: true,
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'sendEmail', subject: 'Welcome aboard', body: 'Glad to have you.', ...extra }],
  },
})

const run = (payload: Record<string, string | number | boolean>) =>
  runEventActions(HOST_ID, 'formSubmission', payload)

beforeEach(() => {
  mockActions = []
  mockActivity = []
  sentMessages = []
  sendResult = { sent: true }
  mockOrg = { plan: 'business' }
  mockOwned = true
  offered = []
  filed = []
  answer = 'entry'
  resetPluginServicesForTests()
  registerPluginRecordTimelineWriter(records, { pluginId: 'records' })
})

describe('a sendEmail step, offered to the record system', () => {
  it('offers the message before it goes, naming the person the event is about', async () => {
    mockActions = [welcome()]
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(offered).toEqual([
      {
        orgId: ORG_ID,
        hostId: HOST_ID,
        to: 'ada@example.com',
        link: { contactId: 'contact-1', email: 'ada@example.com' },
        org: mockOrg,
      },
    ])
  })

  it('carries the tags it was answered with, and files the entry once the provider accepted it', async () => {
    mockActions = [welcome()]
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].tags).toEqual([{ name: 'entry', value: 'entry-1' }])
    expect(filed).toEqual([
      { subject: 'Welcome aboard', body: 'Glad to have you.', to: 'ada@example.com', sourceRef: 'action-1' },
    ])
    expect(mockActivity[0].result).not.toBe('failed')
  })

  it('offers the address the step sends to, which is the record system’s to match', async () => {
    mockActions = [welcome({ toField: 'managerEmail' })]
    await run({ contactId: 'contact-1', email: 'ada@example.com', managerEmail: 'boss@acme.com' })
    expect(offered[0]).toMatchObject({
      to: 'boss@acme.com',
      link: { contactId: 'contact-1', email: 'ada@example.com' },
    })
  })

  it('files nothing when the provider refused the message', async () => {
    sendResult = { sent: false, reason: 'rejected' }
    mockActions = [welcome()]
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(filed).toEqual([])
  })

  it('sends untagged, and files nothing, for a message that earns no entry', async () => {
    answer = 'none'
    mockActions = [welcome()]
    await run({ email: 'stranger@example.com' })
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].tags).toBeUndefined()
    expect(filed).toEqual([])
  })

  it('sends untagged when no plugin keeps records', async () => {
    resetPluginServicesForTests()
    mockActions = [welcome()]
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].tags).toBeUndefined()
  })
})
