/**
 * @jest-environment node
 */

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
 * EVERY AUTOMATION STORED BEFORE THE ONE ENGINE STILL RUNS (AGL-3105).
 *
 * Workflows gained Actions steps and the Actions executor was split into one
 * step at a time, so the risk is not in a new automation — it is in the ones
 * already stored. The fixtures below are the SHAPES the production workflows
 * and actions hold, read key by key and type by type (values invented): four
 * workflows of function calls, one with no trigger and one with no steps;
 * element interactions bound by selector, some deleted; alerts on clicks and
 * form submissions; and the CRM automations a recipe or a draft writes, with
 * their explicitly nulled trigger fields.
 *
 * Each is read by the unified step model as what it was, validates as it did,
 * and runs through the real runners to the outcome it had before.
 */

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const GROUP_ID = 'group-1'

/** Every document, by its full path. */
let store: Record<string, Record<string, any>> = {}
/** Every `update()`, in order, by the path it wrote. */
let updates: { path: string; data: Record<string, any> }[] = []
let minted = 0
/** The owning org's billing doc — the plan every gate reads. */
let mockOrg: Record<string, any> = { plan: 'business' }
/** Every message handed to the mail provider. */
let sentMessages: Record<string, any>[] = []
/** Every manager notification. */
let notices: Record<string, any>[] = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

const readField = (data: Record<string, any> | undefined, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

/** A patch applied the way Firestore applies one: increments add up. */
const applyPatch = (
  existing: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> => {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    next[key] =
      value && typeof value === 'object' && '__increment' in value
        ? Number(existing[key] ?? 0) + value.__increment
        : value
  }
  return next
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const snapshotOf = (path: string) => ({
  id: lastSegment(path),
  exists: store[path] !== undefined,
  data: () => store[path],
  get: (field: string) => readField(store[path], field),
  ref: docRef(path),
})

const docRef = (path: string): any => ({
  id: lastSegment(path),
  path,
  get firestore() {
    return firestoreHandle
  },
  get: async () => snapshotOf(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    store[path] = applyPatch(options?.merge ? (store[path] ?? {}) : {}, data)
  },
  update: async (data: Record<string, any>) => {
    updates.push({ path, data })
    store[path] = applyPatch(store[path] ?? {}, data)
  },
  delete: async () => {
    delete store[path]
  },
  collection: (name: string) => collectionRef(`${path}/${name}`),
})

const collectionRef = (
  path: string,
  filters: ((data: Record<string, any>) => boolean)[] = [],
  cap = Number.POSITIVE_INFINITY,
): any => {
  const matching = () =>
    Object.keys(store)
      .filter(
        (key) =>
          key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
      )
      .filter((key) => filters.every((filter) => filter(store[key])))
      .slice(0, cap)
  return {
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `minted-${(minted += 1)}`}`),
    where: (field: string, op: string, value: any) =>
      collectionRef(
        path,
        [
          ...filters,
          (data) => {
            const held = readField(data, field)
            if (op === '==') return held === value
            if (op === '<=') return held <= value
            if (op === 'array-contains-any') {
              return Array.isArray(held) && value.some((v: unknown) => held.includes(v))
            }
            return true
          },
        ],
        cap,
      ),
    orderBy: () => collectionRef(path, filters, cap),
    limit: (count: number) => collectionRef(path, filters, count),
    get: async () => {
      const docs = matching().map(snapshotOf)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: matching().length }) }),
    }),
    add: async (data: Record<string, any>) => {
      const ref = docRef(`${path}/auto-${(minted += 1)}`)
      store[ref.path] = { ...data }
      return ref
    },
    get parent() {
      return docRef(path.slice(0, path.lastIndexOf('/')))
    },
  }
}

const firestoreHandle: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (work: (transaction: any) => Promise<unknown>) =>
    work({
      get: (ref: any) => ref.get(),
      set: (ref: any, data: Record<string, any>) => ref.set(data),
      update: (ref: any, data: Record<string, any>) => ref.update(data),
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => firestoreHandle }),
    firestore: {
      FieldValue: { increment: (by: number) => ({ __increment: by }) },
    },
  },
  getOrgForHost: async () => ({ orgId: ORG_ID, org: mockOrg }),
  resolveOrgIdForHost: async () => ORG_ID,
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    collectionRef(`orgs/${ORG_ID}/${name}`),
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: collectionRef(`orgs/${ORG_ID}/${name}`),
    query: collectionRef(`orgs/${ORG_ID}/${name}`),
  }),
  consentGroupForSite: async () => ({
    hostId: HOST_ID,
    groupId: GROUP_ID,
    name: null,
    hostIds: [HOST_ID],
    declared: false,
  }),
  dataStorageRefusal: async () => null,
  flowEmailRefusal: async () => null,
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async (_hostId: string, notice: Record<string, any>) => {
    notices.push(notice)
  },
  enrollListMember: async () => undefined,
  countCrmActivitiesForRecord: async () => 0,
  recomputeCrmNextTaskAt: async () => ({ records: 0, missing: 0 }),
  newCrmActivityRef: (_firestore: unknown, orgId: string) =>
    collectionRef(`orgs/${orgId}/crmActivities`).doc(),
  writeCrmEmailActivity: async (ref: any, activity: Record<string, any>) =>
    ref.set(activity),
}))

// The dataset lookup is the runtime's, and not what is under test: it answers
// the dataset the step names by id, from the store.
jest.mock('@aglyn/tenant-runtime/resolve-dataset', () => ({
  __esModule: true,
  resolveDatasetDoc: async (datasetsRef: any, step: { datasetId?: string }) =>
    datasetsRef.doc(String(step.datasetId ?? '')).get(),
}))

jest.mock('@aglyn/tenant-runtime/assign-contact-owner', () => ({
  __esModule: true,
  OWNER_ASSIGNMENT_REFUSALS: { failed: 'the owner could not be assigned' },
  reassignContactOwner: async () => ({
    outcome: 'assigned',
    ownerUid: 'uid-sam',
    by: 'member',
    leadMirrored: false,
    notified: true,
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  isDeferrableSendResult: () => false,
  sendEmail: async (message: Record<string, any>) => {
    sentMessages.push(message)
    return { sent: true }
  },
  sendFailureReason: (result: { sent?: boolean } | null) =>
    !result || result.sent ? null : 'failed',
}))

import { validateHostAction, type HostAction } from '@aglyn/aglyn/app-utils/actions'
import { contactFacetPath } from '@aglyn/aglyn/app-utils/contacts'
import { runWorkflow, type HostWorkflow } from '@aglyn/aglyn/app-utils/workflows'
import { runEventActions, runSingleAction } from './run-event-actions'
import { runEventWorkflows } from './run-event-workflows'
import {
  isWorkflowActionStep,
  isWorkflowFunctionStep,
  validateWorkflowSteps,
  workflowHasActionSteps,
} from './workflow-steps'

const hostPath = `hosts/${HOST_ID}`

const seed = (path: string, data: Record<string, any>) => {
  store[path] = data
}

const history = () =>
  Object.keys(store)
    .filter((key) => key.startsWith(`${hostPath}/activity/`))
    .map((key) => store[key])

/** Two functions the stored workflows call, in the stored function shape. */
const FUNCTIONS: Record<string, Record<string, any>> = {
  'fn-add': {
    name: 'add',
    parameters: [
      { name: 'a', type: 'number' },
      { name: 'b', type: 'number' },
    ],
    variables: [{ name: 'sum', type: 'number' }],
    operations: [
      {
        if: { left: '1', comparator: '==', right: '1' },
        then: [{ set: 'sum', expression: 'a + b' }],
        otherwise: [],
      },
    ],
    returnValue: 'sum',
  },
  'fn-double': {
    name: 'double',
    parameters: [{ name: 'n', type: 'number' }],
    variables: [{ name: 'out', type: 'number' }],
    operations: [
      {
        if: { left: '1', comparator: '==', right: '1' },
        then: [{ set: 'out', expression: 'n * 2' }],
        otherwise: [],
      },
    ],
    returnValue: 'out',
  },
}

/*
 * THE STORED WORKFLOWS: `createdAt, name, returnValue, steps, updatedAt`, a
 * `trigger` on three of them, and steps of `args, functionName, resultName`
 * with no `functionId` — written before steps were stored by id.
 */
const STORED_WORKFLOWS: Record<string, Record<string, any>> = {
  'wf-no-trigger': {
    createdAt: 'ts',
    name: 'Price with tax',
    returnValue: 'total',
    steps: [
      { args: ['price', 'tax'], functionName: 'add', resultName: 'subtotal' },
      { args: ['subtotal', '0'], functionName: 'add', resultName: 'total' },
    ],
    updatedAt: 'ts',
  },
  'wf-two-args': {
    createdAt: 'ts',
    name: 'Sum on submit',
    returnValue: 'sum',
    steps: [{ args: ['1', '2'], functionName: 'add', resultName: 'sum' }],
    trigger: { event: 'formSubmission' },
    updatedAt: 'ts',
  },
  'wf-no-steps': {
    createdAt: 'ts',
    name: 'Empty',
    returnValue: '',
    steps: [],
    trigger: { event: 'formSubmission' },
    updatedAt: 'ts',
  },
  'wf-one-arg': {
    createdAt: 'ts',
    name: 'Double on submit',
    returnValue: 'twice',
    steps: [{ args: ['4'], functionName: 'double', resultName: 'twice' }],
    trigger: { event: 'formSubmission' },
    updatedAt: 'ts',
  },
}

/** The null-cleared trigger an editor-saved or drafted action carries. */
const SAVED_TRIGGER = {
  combinator: null,
  condition: null,
  conditions: null,
  cooldownMinutes: null,
  everyTime: false,
  oncePerSession: false,
  oncePerVisitor: false,
}

/*
 * THE STORED ACTIONS, by the shapes production holds.
 */
const STORED_ACTIONS: Record<string, Record<string, any>> = {
  'act-menu-open': {
    createdAt: 'ts',
    enabled: true,
    migratedToNode: 'node-1',
    name: 'Open the menu on hover',
    steps: [{ menuNodeId: 'menu-1', selector: '[data-aglyn="leaf:menu"]', type: 'openMenu' }],
    trigger: { event: 'elementHoverEnter', everyTime: true, selector: '[data-aglyn="leaf:nav"]' },
    updatedAt: 'ts',
  },
  'act-hide-panel': {
    enabled: true,
    migratedToNode: 'node-2',
    name: 'Hide the panel on leave',
    steps: [{ delayMs: 200, selector: '#panel', type: 'hideElement' }],
    trigger: { event: 'elementHoverLeave', everyTime: true, selector: '#nav' },
  },
  'act-show-panel': {
    createdAt: 'ts',
    enabled: true,
    migratedToNode: 'node-3',
    name: 'Show the panel on hover',
    steps: [{ dismissOn: ['escape', 'outsideClick'], selector: '#panel', type: 'showElement' }],
    trigger: { event: 'elementHoverEnter', everyTime: true, selector: '#nav' },
    updatedAt: 'ts',
  },
  'act-click-alert': {
    createdAt: 'ts',
    enabled: true,
    name: 'Say hello on click',
    steps: [{ message: 'Hello', severity: 'info', type: 'siteAlert' }],
    trigger: { event: 'elementClick', selector: '#cta' },
  },
  'act-visible-alert': {
    createdAt: 'ts',
    enabled: true,
    name: 'Say hello when seen',
    steps: [{ message: 'Seen', severity: 'success', type: 'siteAlert' }],
    trigger: { event: 'elementVisible', selector: '#cta' },
    updatedAt: 'ts',
  },
  'act-won-stage': {
    createdAt: 'ts',
    createdBy: 'uid-1',
    enabled: true,
    name: 'Won makes a customer',
    steps: [{ lifecycleStage: 'customer', type: 'setContactStage' }],
    trigger: { ...SAVED_TRIGGER, event: 'dealWon' },
    updatedAt: 'ts',
  },
  'act-new-contact': {
    createdAt: 'ts',
    createdBy: 'uid-1',
    enabled: true,
    name: 'Work a new contact',
    steps: [
      { ownerEmail: 'sam@example.com', type: 'assignContactOwner' },
      { dueInDays: 1, kind: 'call', title: 'Call the lead', type: 'createCrmTask' },
      { tag: 'website', type: 'addContactTag' },
    ],
    trigger: {
      ...SAVED_TRIGGER,
      combinator: 'and',
      conditions: [{ field: 'source', op: 'equals', value: 'form' }],
      event: 'contactCreated',
    },
    updatedAt: 'ts',
  },
  'act-submit-alert': {
    createdAt: 'ts',
    enabled: true,
    name: 'Thank the visitor',
    steps: [{ message: 'Thanks!', severity: 'success', type: 'siteAlert' }],
    trigger: { event: 'formSubmission' },
    updatedAt: 'ts',
  },
}

beforeEach(() => {
  store = {}
  updates = []
  minted = 0
  mockOrg = { plan: 'business' }
  sentMessages = []
  notices = []
  seed(hostPath, { name: 'Site' })
  for (const [id, data] of Object.entries(FUNCTIONS)) {
    seed(`${hostPath}/functions/${id}`, data)
  }
  seed(`orgs/${ORG_ID}/contacts/contact-ada`, {
    email: 'ada@example.com',
    visibleTo: ['org'],
  })
  seed(`orgs/${ORG_ID}/members/uid-sam`, { email: 'sam@example.com' })
})

describe('the stored workflows', () => {
  it('read as the function calls they were written as', () => {
    for (const workflow of Object.values(STORED_WORKFLOWS)) {
      expect(workflowHasActionSteps(workflow)).toBe(false)
      for (const step of workflow['steps']) {
        expect(isWorkflowFunctionStep(step)).toBe(true)
        expect(isWorkflowActionStep(step)).toBe(false)
      }
      expect(validateWorkflowSteps(workflow['steps'])).toBeNull()
    }
  })

  it('run on their trigger to the outcome the evaluator gives them', async () => {
    for (const [id, data] of Object.entries(STORED_WORKFLOWS)) {
      seed(`${hostPath}/workflows/${id}`, data)
    }
    await runEventWorkflows(HOST_ID, 'formSubmission', { path: '/contact' })

    const functions: Record<string, any> = {}
    for (const [id, data] of Object.entries(FUNCTIONS)) {
      functions[id] = data
      functions[data['name']] = data
    }
    const triggered = ['wf-two-args', 'wf-no-steps', 'wf-one-arg']
    expect(history()).toHaveLength(triggered.length)
    for (const id of triggered) {
      const expected = runWorkflow(
        STORED_WORKFLOWS[id] as HostWorkflow,
        functions,
        {},
        { event: 'formSubmission', path: '/contact' },
      )
      expect(expected.ok).toBe(true)
      expect(history()).toContainEqual(
        expect.objectContaining({
          action: 'Workflow ran on formSubmission',
          result: 'succeeded',
          summary: 'Ran',
          status: 'ok',
          target: { type: 'workflow', id, name: STORED_WORKFLOWS[id]['name'] },
        }),
      )
    }
    expect(store[`${hostPath}/counters/workflowRuns`]).toBeDefined()
  })

  it('run, untriggered, as the step of an action that names one', async () => {
    seed(`${hostPath}/workflows/wf-no-trigger`, STORED_WORKFLOWS['wf-no-trigger'])
    seed(`${hostPath}/actions/act-run`, {
      name: 'Price it',
      enabled: true,
      trigger: { event: 'formSubmission' },
      steps: [{ type: 'runWorkflow', workflowName: 'Price with tax' }],
    })

    await runEventActions(HOST_ID, 'formSubmission', { price: 10, tax: 2 })

    expect(history()).toEqual([
      expect.objectContaining({ result: 'succeeded', summary: 'ran workflow' }),
    ])
  })
})

describe('the stored actions', () => {
  const live = Object.entries(STORED_ACTIONS)

  it('read as Actions steps and validate as they did', () => {
    for (const [, action] of live) {
      for (const step of action['steps']) expect(isWorkflowActionStep(step)).toBe(true)
      expect(validateHostAction(action as unknown as HostAction)).toBeNull()
    }
  })

  it('run their element interactions in the page and nothing on the server', async () => {
    for (const id of ['act-menu-open', 'act-hide-panel', 'act-show-panel']) {
      seed(`${hostPath}/actions/${id}`, STORED_ACTIONS[id])
      const event = STORED_ACTIONS[id]['trigger']['event']
      expect(await runSingleAction(HOST_ID, id, event, {})).toEqual([])
    }
    expect(history().map((row) => row['summary'])).toEqual(['Ran', 'Ran', 'Ran'])
    expect(updates).toEqual([])
  })

  it('run nothing at all once deleted', async () => {
    seed(`${hostPath}/actions/act-menu-open`, {
      ...STORED_ACTIONS['act-menu-open'],
      deletedAt: 'ts',
    })
    await runSingleAction(HOST_ID, 'act-menu-open', 'elementHoverEnter', {})
    expect(history()).toEqual([])
  })

  it('hand their alerts back, on a click and on a submission', async () => {
    seed(`${hostPath}/actions/act-click-alert`, STORED_ACTIONS['act-click-alert'])
    seed(`${hostPath}/actions/act-visible-alert`, STORED_ACTIONS['act-visible-alert'])
    seed(`${hostPath}/actions/act-submit-alert`, STORED_ACTIONS['act-submit-alert'])

    expect(await runSingleAction(HOST_ID, 'act-click-alert', 'elementClick', {})).toEqual([
      { message: 'Hello', severity: 'info' },
    ])
    expect(
      await runSingleAction(HOST_ID, 'act-visible-alert', 'elementVisible', {}),
    ).toEqual([{ message: 'Seen', severity: 'success' }])
    expect(await runEventActions(HOST_ID, 'formSubmission', {})).toEqual([
      { message: 'Thanks!', severity: 'success' },
    ])
  })

  it('set the stage a won deal names', async () => {
    seed(`${hostPath}/actions/act-won-stage`, STORED_ACTIONS['act-won-stage'])

    await runEventActions(HOST_ID, 'dealWon', { contactId: 'contact-ada' })

    expect(updates).toContainEqual({
      path: `orgs/${ORG_ID}/contacts/contact-ada`,
      data: expect.objectContaining({
        [contactFacetPath(GROUP_ID, 'lifecycleStage')]: 'customer',
      }),
    })
    expect(history()).toEqual([
      expect.objectContaining({ result: 'succeeded', summary: 'set stage Customer' }),
    ])
  })

  it('work a new contact through all three CRM steps, behind their condition', async () => {
    seed(`${hostPath}/actions/act-new-contact`, STORED_ACTIONS['act-new-contact'])

    await runEventActions(HOST_ID, 'contactCreated', {
      contactId: 'contact-ada',
      email: 'ada@example.com',
      source: 'import',
    })
    // The condition said no: the run is recorded as skipped and does nothing.
    expect(history()).toEqual([
      expect.objectContaining({
        result: 'skipped',
        summary: 'Condition on source not met',
      }),
    ])
    expect(updates).toEqual([])

    await runEventActions(HOST_ID, 'contactCreated', {
      contactId: 'contact-ada',
      email: 'ada@example.com',
      source: 'form',
    })
    expect(history()).toEqual([
      expect.objectContaining({ result: 'skipped' }),
      expect.objectContaining({
        result: 'succeeded',
        summary:
          'assigned owner sam@example.com · created task Call the lead · tagged website',
      }),
    ])
  })
})
