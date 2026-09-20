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
 * ONE AUTOMATION ENGINE: a workflow step can be any server-side Actions step
 * (AGL-3105).
 *
 * Every assertion here drives the REAL runners — `runEventWorkflows`,
 * `runEventActions`, `resumeFlowEnrollment` — over an in-memory Firestore, with
 * only the outside world faked: the mail provider, the dataset lookup and the
 * owner assignment. What they pin:
 *
 *  1. A workflow a form submission starts writes a dataset record, sends an
 *     email and tags the CRM contact, as steps of that one workflow, through
 *     the executors actions use — and its function calls feed them.
 *  2. A step only a visitor's browser can run is refused: by the editor's
 *     validator before it is saved, and by the engine if it was stored anyway.
 *  3. Actions steps keep the Actions tier gates inside a workflow.
 *  4. One run is metered once, on one meter.
 *  5. A workflow of function calls runs exactly as it always has.
 *  6. `wait` holds a workflow's run, results and all, and the beat resumes it
 *     as the workflow — while a workflow run inside another automation cannot
 *     wait at all.
 */

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const GROUP_ID = 'group-1'
const MONTH = new Date().toISOString().slice(0, 7)

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
  OWNER_ASSIGNMENT_REFUSALS: {},
  reassignContactOwner: async () => ({ outcome: 'none', reason: 'failed' }),
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

import { contactFacetPath } from '@aglyn/aglyn/app-utils/contacts'
import { resumeFlowEnrollment, runEventActions } from './run-event-actions'
import { runEventWorkflows } from './run-event-workflows'
import { validateWorkflowSteps } from './workflow-steps'

const hostPath = `hosts/${HOST_ID}`

/** Seeds a document at a path. */
const seed = (path: string, data: Record<string, any>) => {
  store[path] = data
}

/** The rows the run history holds, oldest first. */
const history = () =>
  Object.keys(store)
    .filter((key) => key.startsWith(`${hostPath}/activity/`))
    .map((key) => store[key])

const counter = (name: 'workflowRuns' | 'actionRuns') =>
  store[`${hostPath}/counters/${name}`]?.[MONTH]

/** The records written under the Leads dataset. */
const leadRecords = () =>
  Object.keys(store)
    .filter((key) => key.startsWith(`orgs/${ORG_ID}/datasets/leads/records/`))
    .map((key) => store[key])

/** A submission of the site's contact form. */
const SUBMISSION = {
  formName: 'Contact',
  path: '/contact',
  email: 'ada@example.com',
  name: 'Ada',
  budget: 40,
}

beforeEach(() => {
  store = {}
  updates = []
  minted = 0
  mockOrg = { plan: 'business' }
  sentMessages = []
  notices = []
  seed(hostPath, { name: 'Site' })
  // A function the workflow calls: doubles the submitted budget.
  seed(`${hostPath}/functions/fn-score`, {
    name: 'score',
    parameters: [{ name: 'budget', type: 'number' }],
    variables: [{ name: 'result', type: 'number' }],
    operations: [
      {
        if: { left: '1', comparator: '==', right: '1' },
        then: [{ set: 'result', expression: 'budget * 2' }],
        otherwise: [],
      },
    ],
    returnValue: 'result',
  })
  seed(`orgs/${ORG_ID}/datasets/leads`, {
    displayName: 'Leads',
    fields: ['email', 'name', 'score'],
  })
  seed(`orgs/${ORG_ID}/contacts/contact-ada`, {
    email: 'ada@example.com',
    visibleTo: ['org'],
  })
})

/** A form-submission workflow with the given steps. */
const seedWorkflow = (steps: Record<string, any>[], id = 'wf-intake') =>
  seed(`${hostPath}/workflows/${id}`, {
    name: 'Lead intake',
    trigger: { event: 'formSubmission' },
    returnValue: '',
    steps,
  })

const INTAKE_STEPS = [
  // A function call, the shape every workflow has stored since the builder
  // shipped; its result joins the payload the Actions steps read.
  { functionName: 'score', functionId: 'fn-score', args: ['budget'], resultName: 'score' },
  { type: 'datasetAppend', datasetId: 'leads', datasetName: 'Leads' },
  { type: 'sendEmail', subject: 'Thanks, {{name}}', body: 'We have your message.' },
  { type: 'addContactTag', tag: 'website' },
]

describe('a workflow whose steps are Actions steps', () => {
  it('writes a dataset record, sends an email and tags the contact, as steps of one workflow', async () => {
    seedWorkflow(INTAKE_STEPS)

    await runEventWorkflows(HOST_ID, 'formSubmission', {
      ...SUBMISSION,
      contactId: 'contact-ada',
    })

    // The dataset write, with the function call's result in it.
    expect(leadRecords()).toHaveLength(1)
    expect(leadRecords()[0]['values']).toEqual({
      email: 'ada@example.com',
      name: 'Ada',
      score: '80',
    })
    // The email, to the address the submission carried.
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toMatchObject({ to: 'ada@example.com' })
    // The CRM contact, tagged inside the site's facet.
    expect(updates).toContainEqual({
      path: `orgs/${ORG_ID}/contacts/contact-ada`,
      data: expect.objectContaining({
        [contactFacetPath(GROUP_ID, 'tags')]: { __arrayUnion: ['website'] },
      }),
    })
    // One run, whose history line says what every step did.
    expect(history()).toEqual([
      expect.objectContaining({
        result: 'succeeded',
        trigger: 'formSubmission',
        summary: 'ran score · saved to Leads · sent email · tagged website',
        action: 'Workflow ran on formSubmission',
        status: 'ok',
        target: { type: 'workflow', id: 'wf-intake', name: 'Lead intake' },
      }),
    ])
  })

  it('records a failed Actions step and runs the steps after it, as an action does', async () => {
    seedWorkflow([
      { type: 'datasetAppend', datasetId: 'gone', datasetName: 'Gone' },
      { type: 'notifyAdmins', title: 'New lead' },
    ])

    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    expect(notices).toHaveLength(1)
    expect(history()[0]).toMatchObject({
      result: 'failed',
      summary: 'notified admins',
      action: 'Workflow ran on formSubmission with errors: unknown dataset "Gone"',
    })
  })

  it('stops at a function call that fails, because the steps after it read its result', async () => {
    seedWorkflow([
      { functionName: 'missing', args: [], resultName: 'x' },
      { type: 'notifyAdmins', title: 'New lead' },
    ])

    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    expect(notices).toHaveLength(0)
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(String(history()[0]['action'])).toContain('Unknown function "missing"')
  })

  it('hands a site alert back to the request that raised the event', async () => {
    seedWorkflow([{ type: 'siteAlert', message: 'Thanks!', severity: 'success' }])

    const alerts = await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    expect(alerts).toEqual([{ message: 'Thanks!', severity: 'success' }])
  })
})

describe('a step only the visitor’s browser can run', () => {
  const CLIENT_STEP = { type: 'addClass', selector: '.cta', className: 'on' }

  it('is refused by the editor’s validator', () => {
    expect(
      validateWorkflowSteps([{ type: 'notifyAdmins', title: 'x' }, CLIENT_STEP]),
    ).toBe(
      'Step 2: “Add a CSS class” runs in the visitor’s browser, so a workflow ' +
        'cannot run it — build it as an interaction in Actions',
    )
  })

  it('is refused by the engine when a writer stored it anyway', async () => {
    seedWorkflow([CLIENT_STEP, { type: 'notifyAdmins', title: 'New lead' }])

    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    expect(history()[0]).toMatchObject({ result: 'failed', summary: 'notified admins' })
    expect(String(history()[0]['action'])).toContain(
      '“Add a CSS class” runs in the visitor’s browser',
    )
  })

  it('leaves every server step to the validator the Actions editor uses', () => {
    // The Actions editor's own message for the same missing field, renumbered.
    expect(
      validateWorkflowSteps([
        { functionName: 'score', args: ['budget'] },
        { type: 'sendEmail', subject: '', body: 'x' },
      ]),
    ).toBe('Step 2: enter the subject')
    expect(validateWorkflowSteps(INTAKE_STEPS)).toBeNull()
  })
})

describe('the Actions tier gates, inside a workflow', () => {
  it('refuses an Actions step on a plan without the actions builder, and still runs the calls', async () => {
    // Starter carries workflows and their runs, and no Actions steps.
    mockOrg = { plan: 'starter' }
    seedWorkflow(INTAKE_STEPS.slice(0, 2))

    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    expect(leadRecords()).toHaveLength(0)
    expect(history()[0]).toMatchObject({ result: 'failed', summary: 'ran score' })
    expect(String(history()[0]['action'])).toContain(
      '“Write to a dataset” needs the Pro plan',
    )
  })

  it('keeps a webhook on Business, as it is in an action', async () => {
    mockOrg = { plan: 'pro' }
    seedWorkflow([{ type: 'webhookPost', webhookId: 'hook-1' }])

    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    expect(String(history()[0]['action'])).toContain(
      'webhooks require a Business plan',
    )
  })
})

describe('one run, metered once', () => {
  it('counts a workflow with Actions steps once, on the workflow meter', async () => {
    seedWorkflow(INTAKE_STEPS)

    await runEventWorkflows(HOST_ID, 'formSubmission', {
      ...SUBMISSION,
      contactId: 'contact-ada',
    })

    expect(counter('workflowRuns')).toBe(1)
    expect(counter('actionRuns')).toBeUndefined()
  })

  it('counts an action whose step runs such a workflow once, on the action meter', async () => {
    seed(`${hostPath}/workflows/wf-notify`, {
      name: 'Notify',
      returnValue: '',
      steps: [{ type: 'notifyAdmins', title: 'From a workflow' }],
    })
    seed(`${hostPath}/actions/act-1`, {
      name: 'On submit',
      enabled: true,
      trigger: { event: 'formSubmission' },
      steps: [{ type: 'runWorkflow', workflowId: 'wf-notify', workflowName: 'Notify' }],
    })

    await runEventActions(HOST_ID, 'formSubmission', SUBMISSION)

    // The workflow's step was PERFORMED, inside the action's run…
    expect(notices).toEqual([expect.objectContaining({ title: 'From a workflow' })])
    expect(history()).toEqual([
      expect.objectContaining({ result: 'succeeded', summary: 'ran workflow' }),
    ])
    // …which is the one run on the one meter.
    expect(counter('actionRuns')).toBe(1)
    expect(counter('workflowRuns')).toBeUndefined()
  })
})

describe('a workflow of function calls', () => {
  it('runs exactly as it always has', async () => {
    seedWorkflow([{ functionName: 'score', args: ['budget'], resultName: 'score' }])

    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    const [row] = history()
    expect(row).toEqual({
      actorId: null,
      actorEmail: null,
      action: 'Workflow ran on formSubmission',
      result: 'succeeded',
      trigger: 'formSubmission',
      summary: 'Ran',
      status: 'ok',
      durationMs: expect.any(Number),
      target: { type: 'workflow', id: 'wf-intake', name: 'Lead intake' },
      createdAt: 'server-timestamp',
    })
    expect(counter('workflowRuns')).toBe(1)
  })
})

describe('a wait inside a workflow', () => {
  const WAITING_STEPS = [
    { functionName: 'score', args: ['budget'], resultName: 'score' },
    { type: 'wait', delayMinutes: 60 },
    { type: 'datasetAppend', datasetId: 'leads', datasetName: 'Leads' },
  ]

  it('enrolls the person as the workflow, results and all, and the beat resumes it', async () => {
    seedWorkflow(WAITING_STEPS)

    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)

    expect(leadRecords()).toHaveLength(0)
    const enrollmentPath = Object.keys(store).find((key) =>
      key.startsWith(`${hostPath}/flowEnrollments/workflow-wf-intake__`),
    )
    expect(enrollmentPath).toBeDefined()
    const enrollment = store[enrollmentPath as string]
    expect(enrollment).toMatchObject({
      automation: 'workflow',
      actionId: 'wf-intake',
      nextStepIndex: 2,
      payload: expect.objectContaining({ score: 80 }),
    })
    expect(history()[0]).toMatchObject({
      result: 'succeeded',
      summary: 'ran score · waiting 60m',
      action: 'Workflow is waiting, on formSubmission',
    })

    const ending = await resumeFlowEnrollment(
      enrollment as any,
      docRef(enrollmentPath as string),
    )

    expect(ending).toBe('ran')
    expect(leadRecords()).toEqual([
      expect.objectContaining({
        values: { email: 'ada@example.com', name: 'Ada', score: '80' },
      }),
    ])
    expect(store[enrollmentPath as string]).toBeUndefined()
    // The resumed leg is a run of the WORKFLOW, on the workflow meter.
    expect(counter('workflowRuns')).toBe(2)
    expect(history()[1]).toMatchObject({ summary: 'saved to Leads' })
  })

  it('stops a waiting person when the workflow is deleted', async () => {
    seedWorkflow(WAITING_STEPS)
    await runEventWorkflows(HOST_ID, 'formSubmission', SUBMISSION)
    const enrollmentPath = Object.keys(store).find((key) =>
      key.includes('/flowEnrollments/'),
    ) as string
    store[`${hostPath}/workflows/wf-intake`]['deletedAt'] = 'yesterday'

    const ending = await resumeFlowEnrollment(
      store[enrollmentPath] as any,
      docRef(enrollmentPath),
    )

    expect(ending).toBe('stopped')
    expect(leadRecords()).toHaveLength(0)
    expect(history().at(-1)).toMatchObject({
      result: 'skipped',
      summary: 'the workflow was deleted',
    })
  })

  it('is refused inside a workflow another automation runs as a step', async () => {
    seed(`${hostPath}/workflows/wf-drip`, {
      name: 'Drip',
      returnValue: '',
      steps: [{ type: 'wait', delayMinutes: 60 }, { type: 'notifyAdmins', title: 'x' }],
    })
    seed(`${hostPath}/actions/act-1`, {
      name: 'On submit',
      enabled: true,
      trigger: { event: 'formSubmission' },
      steps: [{ type: 'runWorkflow', workflowId: 'wf-drip' }],
    })

    await runEventActions(HOST_ID, 'formSubmission', SUBMISSION)

    expect(notices).toHaveLength(0)
    expect(Object.keys(store).some((key) => key.includes('/flowEnrollments/'))).toBe(
      false,
    )
    expect(String(history()[0]['action'])).toContain(
      'cannot wait — give it its own trigger instead',
    )
  })
})
