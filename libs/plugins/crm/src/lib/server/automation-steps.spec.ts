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
 * THE CRM'S HALF OF AN AUTOMATION (AGL-2605, AGL-2615, AGL-3080).
 *
 * The engine hands the CRM a step through the server-step seam, and offers it
 * an email through the record timeline's `prepareEmail`; this holds what the
 * CRM answers each, called the way the seams call it. The two halves run
 * together, through the real engine, in
 * `apps/console/specs/crm-automation-steps.spec.ts`.
 */

const HOST_ID = 'site-1'
const GROUP_ID = 'group-1'
const ORG_ID = 'org-1'

/** Every document, by full path. */
let store: Record<string, Record<string, any>> = {}
let updates: { path: string; data: Record<string, any> }[] = []
let mockActivityCount = 0
let minted = 0
/** Set to make every Firestore read throw. */
let storageDown = false
/** Every lead assignment the owner step asked for (AGL-3458). */
let mockLeadAssignments: Record<string, any>[] = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const readField = (data: Record<string, any> | undefined, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const snapshotOf = (path: string): any => ({
  id: lastSegment(path),
  exists: store[path] !== undefined,
  data: () => store[path],
  get: (field: string) => readField(store[path], field),
  ref: docRef(path),
})

function docRef(path: string): any {
  return {
    id: lastSegment(path),
    path,
    get: async () => {
      if (storageDown) throw new Error('storage down')
      return snapshotOf(path)
    },
    set: async (data: Record<string, any>) => {
      store[path] = { ...data }
    },
    update: async (data: Record<string, any>) => {
      updates.push({ path, data })
    },
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
  }
}

const childrenOf = (path: string) =>
  Object.keys(store).filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )

function mockCollectionRef(path: string): any {
  const query = (matchers: ((data: Record<string, any>) => boolean)[]): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query([...matchers, (data) => readField(data, field) === value]),
    limit: () => query(matchers),
    get: async () => {
      if (storageDown) throw new Error('storage down')
      const docs = childrenOf(path)
        .filter((key) => matchers.every((matcher) => matcher(store[key])))
        .map(snapshotOf)
      return { docs, empty: docs.length === 0 }
    },
  })
  return {
    ...query([]),
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `minted-${(minted += 1)}`}`),
    add: async (data: Record<string, any>) => {
      const id = `auto-${(minted += 1)}`
      store[`${path}/${id}`] = { ...data }
      return docRef(`${path}/${id}`)
    },
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath ? docRef(parentPath) : null
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => ({ collection: (name: string) => mockCollectionRef(name) }) }),
  },
  consentGroupForSite: async () => ({ hostId: HOST_ID, groupId: GROUP_ID, hostIds: [HOST_ID] }),
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: mockCollectionRef(`orgs/${ORG_ID}/${name}`),
  }),
  restampCrmListFieldsAt: async () => 'current',
  countCrmActivitiesForRecord: async () => mockActivityCount,
  newCrmActivityRef: (_firestore: unknown, orgId: string) =>
    mockCollectionRef(`orgs/${orgId}/crmActivities`).doc(),
  writeCrmEmailActivity: async (ref: any, activity: Record<string, any>) => ref.set(activity),
}))

jest.mock('./crm-next-activity', () => ({
  __esModule: true,
  ...jest.requireActual('./crm-next-activity'),
  recomputeCrmNextTaskAt: async () => ({ records: 0, missing: 0 }),
}))

jest.mock('./assign-contact-owner', () => ({
  __esModule: true,
  OWNER_ASSIGNMENT_REFUSALS: {},
  reassignContactOwner: async () => ({ outcome: 'unchanged', ownerUid: 'uid-sam' }),
  // The rotation's own transaction is `assign-contact-owner.spec.ts`'s; here
  // the step's request, and the owner it wrote on the lead the event names.
  reassignLeadOwner: async (input: Record<string, any>) => {
    mockLeadAssignments.push(input)
    const path = `orgs/${ORG_ID}/leads/${input['leadId']}`
    store[path] = { ...(store[path] ?? {}), ownerUid: 'uid-sam' }
    return {
      outcome: 'assigned',
      ownerUid: 'uid-sam',
      by: 'roundRobin',
      leadMirrored: false,
      notified: true,
    }
  },
}))

import { CRM_ACTIVITIES_PER_RECORD_CEILING } from '@aglyn/aglyn/app-utils/crm'
import { declaredServerSteps, type ServerStepRequest } from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import { personKey } from '@aglyn/aglyn/server'
import { BUNDLE_ID, CRM_STEP_TYPES } from '../constants/bundle-common'
import { prepareCrmRecordEmail, runCrmAutomationStep } from './automation-steps'

const BUSINESS = { plan: 'business' }
const WITHDRAWN = { plan: 'business', entitlements: { features: { crm: false } } }

const stepRequest = (
  step: Record<string, unknown> & { type: string },
  payload: Record<string, unknown> = { email: 'ada@example.com' },
  org: unknown = BUSINESS,
): ServerStepRequest => ({
  hostId: HOST_ID,
  org,
  orgId: ORG_ID,
  run: { kind: 'action', id: 'action-1', name: 'Work the lead' },
  event: 'formSubmission',
  payload,
  step,
})

const emailRequest = (extra: Record<string, unknown> = {}) => ({
  orgId: ORG_ID,
  hostId: HOST_ID,
  to: 'Ada@Example.com',
  link: { contactId: 'contact-1', email: 'ada@example.com' },
  org: BUSINESS as unknown,
  ...extra,
})

const contactPath = `orgs/${ORG_ID}/contacts/contact-1`

beforeEach(() => {
  store = {}
  updates = []
  mockActivityCount = 0
  minted = 0
  storageDown = false
  mockLeadAssignments = []
  store[`orgs/${ORG_ID}`] = BUSINESS
  store[contactPath] = {
    email: 'ada@example.com',
    visibleTo: [`host:${HOST_ID}`],
    facets: { [GROUP_ID]: { lifecycleStage: 'lead', companyId: 'company-1' } },
  }
})

describe('the steps the CRM declares', () => {
  it('are exactly the five it runs, declared as the CRM’s', () => {
    expect(
      declaredServerSteps()
        .filter((row) => row.pluginId === BUNDLE_ID)
        .map((row) => row.type),
    ).toEqual([...CRM_STEP_TYPES])
  })
})

describe('a CRM step', () => {
  it('is refused, in the words the run history carries, on a plan without the CRM', async () => {
    const answer = await runCrmAutomationStep(
      stepRequest({ type: 'setContactStage', lifecycleStage: 'customer' }, undefined, WITHDRAWN),
    )
    expect(answer).toEqual({ error: 'CRM steps require the Starter plan' })
    expect(updates).toEqual([])
  })

  it('answers a stage that moved as the event for the engine to raise, and raises nothing itself', async () => {
    const answer = await runCrmAutomationStep(
      stepRequest({ type: 'setContactStage', lifecycleStage: 'customer' }),
    )
    expect(updates).toEqual([
      {
        path: contactPath,
        data: { [`facets.${GROUP_ID}.lifecycleStage`]: 'customer', updatedAt: 'server-timestamp' },
      },
    ])
    expect(answer).toEqual({
      detail: 'Customer',
      emit: {
        event: 'contactStageChanged',
        payload: {
          contactId: 'contact-1',
          email: 'ada@example.com',
          lifecycleStage: 'customer',
          previousStage: 'lead',
        },
      },
    })
  })

  it('answers a stage the contact already has with no write and no event', async () => {
    const answer = await runCrmAutomationStep(
      stepRequest({ type: 'setContactStage', lifecycleStage: 'lead' }),
    )
    expect(answer).toEqual({ detail: 'Lead (already)' })
    expect(updates).toEqual([])
  })

  it('names the automation as the source of what it creates', async () => {
    await runCrmAutomationStep(stepRequest({ type: 'logCrmActivity', kind: 'note', body: 'Hi' }))
    const [row] = childrenOf(`orgs/${ORG_ID}/crmActivities`).map((key) => store[key])
    expect(row).toMatchObject({ sourceActionId: 'action-1', byUid: '', contactId: 'contact-1' })
  })

  it('answers why when the event names nobody, or nobody the site can see', async () => {
    expect(
      await runCrmAutomationStep(stepRequest({ type: 'addContactTag', tag: 'vip' }, { path: '/' })),
    ).toEqual({ error: 'the event names no contact — no contactId or email in its payload' })
    store[contactPath]['visibleTo'] = ['host:other-site']
    expect(
      await runCrmAutomationStep(stepRequest({ type: 'addContactTag', tag: 'vip' }, { contactId: 'contact-1' })),
    ).toEqual({ error: 'no contact or lead this site can see for contact-1' })
    expect(updates).toEqual([])
  })
})

/*
 * AGL-3458 — a lead-routed form files a LEAD and no contact, so the steps a
 * welcome automation runs act on the lead the `lead` event names.
 */
describe('a CRM step on a lead, when the workspace holds no contact', () => {
  const LEAD_KEY = 'lead-key-1'
  const leadPath = `orgs/${ORG_ID}/leads/${LEAD_KEY}`
  const onLead = { leadId: LEAD_KEY, email: 'lead@example.com' }

  beforeEach(() => {
    store[leadPath] = { email: 'lead@example.com', visibleTo: [`host:${HOST_ID}`] }
  })

  it('rotates in an owner on the LEAD, through the lead assignment', async () => {
    const answer = await runCrmAutomationStep(stepRequest({ type: 'assignContactOwner', roundRobin: true }, onLead))
    expect(mockLeadAssignments).toEqual([{ hostId: HOST_ID, leadId: LEAD_KEY, assign: { roundRobin: true } }])
    expect(answer).toEqual({ detail: 'round robin → uid-sam (lead)' })
  })

  it('books the task on the lead, for the owner a step before it just chose', async () => {
    await runCrmAutomationStep(stepRequest({ type: 'assignContactOwner', roundRobin: true }, onLead))
    const answer = await runCrmAutomationStep(
      stepRequest({ type: 'createCrmTask', title: 'Call the new lead', kind: 'call', dueInDays: 1 }, onLead),
    )
    expect(answer).toEqual({ detail: 'Call the new lead (lead)' })
    const [task] = childrenOf(`orgs/${ORG_ID}/crmTasks`).map((key) => store[key])
    expect(task).toMatchObject({
      title: 'Call the new lead',
      leadId: LEAD_KEY,
      assigneeUid: 'uid-sam',
      sourceActionId: 'action-1',
      hostId: HOST_ID,
    })
    expect(task?.['contactId']).toBeUndefined()
  })

  it('tags the lead itself, with arrayUnion', async () => {
    const answer = await runCrmAutomationStep(stepRequest({ type: 'addContactTag', tag: 'website' }, onLead))
    expect(answer).toEqual({ detail: 'website (lead)' })
    expect(updates).toEqual([
      { path: leadPath, data: { tags: { __arrayUnion: ['website'] }, updatedAt: 'server-timestamp' } },
    ])
  })

  it('logs an activity under the lead', async () => {
    await runCrmAutomationStep(stepRequest({ type: 'logCrmActivity', kind: 'note', body: 'Welcomed' }, onLead))
    const [row] = childrenOf(`orgs/${ORG_ID}/crmActivities`).map((key) => store[key])
    expect(row).toMatchObject({ body: 'Welcomed', leadId: LEAD_KEY, sourceActionId: 'action-1' })
  })

  it('refuses a stage on a lead, and says why', async () => {
    const answer = await runCrmAutomationStep(
      stepRequest({ type: 'setContactStage', lifecycleStage: 'customer' }, onLead),
    )
    expect(answer).toEqual({
      error: 'the event names a lead, and a lead has no lifecycle stage until it is converted to a contact',
    })
    expect(updates).toEqual([])
  })

  it('finds the lead by its address when the event carries no leadId', async () => {
    const byAddress = `orgs/${ORG_ID}/leads/${personKey('lead@example.com')}`
    store[byAddress] = { email: 'lead@example.com', visibleTo: [`host:${HOST_ID}`] }
    await runCrmAutomationStep(stepRequest({ type: 'addContactTag', tag: 'vip' }, { email: 'lead@example.com' }))
    expect(updates.map((update) => update.path)).toEqual([byAddress])
  })

  it('treats a lead this site cannot see as nobody', async () => {
    store[leadPath]['visibleTo'] = ['host:other-site']
    expect(await runCrmAutomationStep(stepRequest({ type: 'addContactTag', tag: 'vip' }, onLead))).toEqual({
      error: 'no contact or lead this site can see for lead@example.com',
    })
    expect(updates).toEqual([])
  })

  it('CONTROL: a contact for the address is still the one acted on', async () => {
    await runCrmAutomationStep(stepRequest({ type: 'addContactTag', tag: 'vip' }, { ...onLead, email: 'ada@example.com' }))
    expect(updates.map((update) => update.path)).toEqual([contactPath])
  })

  it('files the welcome email on the lead’s timeline', async () => {
    // The timeline's link names the person by address; the lead is keyed by it.
    store[`orgs/${ORG_ID}/leads/${personKey('lead@example.com')}`] = store[leadPath]
    const prepared = await prepareCrmRecordEmail(
      emailRequest({ to: 'lead@example.com', link: { email: 'lead@example.com' } }),
    )
    expect(prepared).not.toBeNull()
    await prepared?.file({ subject: 'Thanks', body: 'Hi', to: 'lead@example.com', sourceRef: 'action-1' })
    const [row] = childrenOf(`orgs/${ORG_ID}/crmActivities`).map((key) => store[key])
    expect(row).toMatchObject({
      kind: 'email',
      subject: 'Thanks',
      leadId: personKey('lead@example.com'),
    })
    expect(row?.['contactId']).toBeUndefined()
  })
})

describe('an email offered for the timeline', () => {
  it('answers the tags the message carries, and files the entry once it went', async () => {
    const prepared = await prepareCrmRecordEmail(emailRequest())
    expect(prepared?.tags).toEqual([
      { name: 'orgId', value: ORG_ID },
      { name: 'activityId', value: 'minted-1' },
      { name: 'hostId', value: HOST_ID },
    ])
    // Nothing is written before the send.
    expect(childrenOf(`orgs/${ORG_ID}/crmActivities`)).toEqual([])
    await prepared?.file({ subject: 'Welcome', body: 'Hello', to: 'Ada@Example.com', atMs: 5, sourceRef: 'action-1' })
    expect(store[`orgs/${ORG_ID}/crmActivities/minted-1`]).toMatchObject({
      kind: 'email',
      subject: 'Welcome',
      body: 'Hello',
      to: 'ada@example.com',
      atMs: 5,
      byUid: '',
      sourceActionId: 'action-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: HOST_ID,
      visibleTo: [`host:${HOST_ID}`],
    })
  })

  it('reads the organization itself when the sender did not hand it over', async () => {
    store[`orgs/${ORG_ID}`] = WITHDRAWN
    expect(await prepareCrmRecordEmail(emailRequest({ org: undefined }))).toBeNull()
    store[`orgs/${ORG_ID}`] = BUSINESS
    expect(await prepareCrmRecordEmail(emailRequest({ org: undefined }))).not.toBeNull()
  })

  it('answers nothing for a message to somebody other than the person, or nobody the site sees', async () => {
    expect(await prepareCrmRecordEmail(emailRequest({ to: 'boss@acme.com' }))).toBeNull()
    expect(
      await prepareCrmRecordEmail(emailRequest({ to: 'stranger@example.com', link: { email: 'stranger@example.com' } })),
    ).toBeNull()
  })

  it('answers nothing on a plan without the CRM, or for a record at its ceiling', async () => {
    expect(await prepareCrmRecordEmail(emailRequest({ org: WITHDRAWN }))).toBeNull()
    mockActivityCount = CRM_ACTIVITIES_PER_RECORD_CEILING
    expect(await prepareCrmRecordEmail(emailRequest())).toBeNull()
  })

  it('never throws at the sender', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    storageDown = true
    await expect(prepareCrmRecordEmail(emailRequest())).resolves.toBeNull()
    jest.restoreAllMocks()
  })
})
