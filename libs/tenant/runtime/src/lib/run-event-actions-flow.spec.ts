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
 * WHAT A FLOW DOES, on both sides of the wait.
 *
 * The scheduling contract is held next door in `flow-enrollments.spec.ts`.
 * This is the executor: that a wait actually STOPS the run, that the steps
 * after it run later against the list the person entered with, that turning a
 * flow off stops it for the people already inside, and that a message a step
 * sends passes every gate a campaign passes.
 */

const HOST_ID = 'site-1'
const NOW = 1_700_000_000_000

let mockActivity: Record<string, any>[] = []
let mockActions: Record<string, Record<string, any>> = {}
let mockCounters: Record<string, any> = {}
let mockOrg: Record<string, any> | null = { plan: 'pro' }
/** The `flowEnrollments` store, shared by the executor and the assertions. */
let enrollments: Record<string, Record<string, any>> = {}
/** Every message the run handed to the sender. */
let sent: Record<string, any>[] = []
/** What `sendEmail` answers, swapped per case. */
let sendResult: Record<string, any> = { sent: true }
/** What the consent + topic gate answers, swapped per case. */
let flowGateRefusal: string | null = null
/** Every question the consent + topic gate was asked. */
let flowGateCalls: Record<string, any>[] = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

const enrollmentRef = (id: string): any => ({
  path: `hosts/${HOST_ID}/flowEnrollments/${id}`,
  id,
  get: async () => ({
    exists: enrollments[id] !== undefined,
    data: () => enrollments[id],
    get: (field: string) => enrollments[id]?.[field],
  }),
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    const next = options?.merge
      ? { ...(enrollments[id] ?? {}), ...patch }
      : patch
    if ((next as any).resumes?.__increment !== undefined) {
      next.resumes =
        Number(enrollments[id]?.['resumes'] ?? 0) +
        (next as any).resumes.__increment
    }
    enrollments[id] = next
  },
  update: async (patch: Record<string, any>) => {
    enrollments[id] = { ...(enrollments[id] ?? {}), ...patch }
  },
  delete: async () => {
    delete enrollments[id]
  },
})

const collectionHandle = (path: string): any => ({
  doc: (id: string) => {
    if (path.endsWith('flowEnrollments')) return enrollmentRef(id)
    return {
      id,
      get: async () => ({
        exists: path.endsWith('actions')
          ? mockActions[id] !== undefined
          : Boolean(mockCounters[`${path}/${id}`]),
        data: () =>
          path.endsWith('actions')
            ? mockActions[id]
            : mockCounters[`${path}/${id}`],
        get: (field: string) =>
          field
            .split('.')
            .reduce<any>(
              (value, key) => value?.[key],
              path.endsWith('actions')
                ? mockActions[id]
                : mockCounters[`${path}/${id}`],
            ),
      }),
      set: async (patch: Record<string, any>) => {
        mockCounters[`${path}/${id}`] = {
          ...(mockCounters[`${path}/${id}`] ?? {}),
          ...patch,
        }
      },
      collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
    }
  },
  where: () => collectionHandle(path),
  limit: () => collectionHandle(path),
  get: async () => {
    if (path.endsWith('actions')) {
      const docs = Object.entries(mockActions).map(([id, data]) => ({
        id,
        exists: true,
        data: () => data,
        get: (field: string) =>
          field.split('.').reduce<any>((value, key) => value?.[key], data),
      }))
      return { docs, empty: docs.length === 0, size: docs.length }
    }
    return { docs: [], empty: true, size: 0 }
  },
  add: async (data: Record<string, any>) => {
    if (path.endsWith('activity')) mockActivity.push(data)
    return { id: 'new' }
  },
})

const firestore: any = {
  collection: (name: string) => collectionHandle(name),
  runTransaction: async (body: (transaction: any) => Promise<any>) =>
    await body({
      get: async (ref: any) => await ref.get(),
      set: async (ref: any, data: any) => {
        await ref.set(data)
      },
      update: async (ref: any, patch: any) => {
        await ref.update(patch)
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's own sending identity, which every tenant send now resolves.
   *
   * A VERIFIED one, because these specs are about the mail their subject
   * sends rather than about the identity boundary — a refusing stub would
   * turn each of them into an assertion that no mail was sent, which is not
   * what any of them was written to check. The boundary itself is proved in
   * `platform-sending-domain.spec.ts`, `host-sending-domain.spec.ts` and
   * `email-audience-coverage.spec.ts`.
   *
   * The domain is the SITE's, never `aglyn.com`, so an assertion on a From:
   * address in this file cannot accidentally pass against a platform
   * fallback.
   */
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  // The literal three call sites compare against — the unsubscribe writes
  // it, the resubscribe link refuses to reverse anything else, and the
  // preference page reads it. A mock that omitted it would write `undefined`
  // and every one of those comparisons would silently stop matching.
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => firestore }),
    firestore: {
      FieldValue: { increment: (by: number) => ({ __increment: by }) },
    },
  },
  getOrgForHost: async () =>
    mockOrg ? { orgId: 'org-1', org: mockOrg } : null,
  // The consent + topic gate is instrumented rather than stubbed to a
  // constant: "was it asked, and with what" is itself an assertion here.
  flowEmailRefusal: async (options: Record<string, any>) => {
    flowGateCalls.push(options)
    return flowGateRefusal
  },
  dataStorageRefusal: async () => null,
  enrollListMember: async () => ({ enrolled: true, created: true }),
  meterHostEmail: async () => undefined,
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => collectionHandle('orgs/org-1/datasets'),
  orgDataQueryForHost: async () => collectionHandle('orgs/org-1/contacts'),
  resolveOrgIdForHost: async () => 'org-1',
}))

jest.mock('./resolve-dataset', () => ({
  __esModule: true,
  resolveDatasetDoc: async () => null,
}))

jest.mock('@aglyn/shared-util-email', () => {
  // The REAL refusal classifiers. `isDeferrableSendResult` is the one place
  // "worth coming back for" is decided, and stubbing it would make the
  // deferral tests below assert the stub.
  const actual = jest.requireActual('@aglyn/shared-util-email')
  return {
    __esModule: true,
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: async (message: Record<string, any>) => {
      sent.push(message)
      return sendResult
    },
  }
})

import { enrollInFlow, type FlowEnrollment } from './flow-enrollments'
import { resumeFlowEnrollment, runEventActions } from './run-event-actions'

const WELCOME_STEPS = [
  { type: 'sendEmail', subject: 'Thanks', body: 'Welcome aboard' },
  { type: 'wait', delayMinutes: 60 * 24 * 3 },
  { type: 'sendEmail', subject: 'Day three', body: 'How is it going?' },
]

function seedAction(steps: unknown[], overrides: Record<string, any> = {}) {
  mockActions = {
    'action-1': {
      name: 'Welcome series',
      enabled: true,
      trigger: { event: 'formSubmission' },
      steps,
      ...overrides,
    },
  }
}

/** The single enrollment the run produced, with its id. */
function onlyEnrollment(): [string, FlowEnrollment] {
  const entries = Object.entries(enrollments)
  expect(entries).toHaveLength(1)
  return entries[0] as [string, FlowEnrollment]
}

beforeEach(() => {
  mockActivity = []
  mockActions = {}
  mockCounters = {}
  mockOrg = { plan: 'pro' }
  enrollments = {}
  sent = []
  sendResult = { sent: true }
  flowGateRefusal = null
  flowGateCalls = []
})

describe('the fixture reaches the code under test', () => {
  it('runs an ordinary action with no wait, start to finish', async () => {
    // The control. Without it every "nothing after the wait ran" assertion
    // below would pass for a fixture that ran nothing at all.
    seedAction([
      { type: 'sendEmail', subject: 'One', body: 'a' },
      { type: 'sendEmail', subject: 'Two', body: 'b' },
    ])

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(sent.map((message) => message.subject)).toEqual(['One', 'Two'])
    expect(enrollments).toEqual({})
  })
})

describe('a wait stops the run where it stands', () => {
  it('sends the first email, enrolls, and sends nothing else', async () => {
    seedAction(WELCOME_STEPS)

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(sent.map((message) => message.subject)).toEqual(['Thanks'])
    const [, enrollment] = onlyEnrollment()
    expect(enrollment.status).toBe('waiting')
    expect(enrollment.nextStepIndex).toBe(2)
    expect(enrollment.email).toBe('a@b.co')
  })

  it('records the run as waiting rather than finished', async () => {
    seedAction(WELCOME_STEPS)

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(mockActivity[0].action).toContain('waiting')
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it('refuses to wait when the trigger names no person, and says so', async () => {
    seedAction([{ type: 'wait', delayMinutes: 60 }])

    await runEventActions(HOST_ID, 'formSubmission', { name: 'anonymous' })

    expect(enrollments).toEqual({})
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('needs the person')
  })

  it('does not enroll the same person twice concurrently', async () => {
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(Object.keys(enrollments)).toHaveLength(1)
    expect(mockActivity[1].action).toContain('already waiting')
  })
})

describe('the rest of the flow runs when the wait ends', () => {
  it('sends the step after the wait and clears the enrollment', async () => {
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sent = []

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW })

    expect(sent.map((message) => message.subject)).toEqual(['Day three'])
    expect(enrollments[id]).toBeUndefined()
  })

  it('counts the resume on the run meter', async () => {
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW })

    const month = new Date(NOW).toISOString().slice(0, 7)
    expect(mockCounters[`hosts/${HOST_ID}/counters/actionRuns`][month]).toEqual(
      { __increment: 1 },
    )
  })

  it('waits again at a second wait step', async () => {
    // Three-step sequences are the whole point of the feature; a design that
    // could only wait once would unlock a reminder, not a series.
    seedAction([
      { type: 'wait', delayMinutes: 60 },
      { type: 'sendEmail', subject: 'Day one', body: 'a' },
      { type: 'wait', delayMinutes: 60 * 24 * 7 },
      { type: 'sendEmail', subject: 'Week one', body: 'b' },
    ])
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id] = onlyEnrollment()

    await resumeFlowEnrollment(
      enrollments[id] as FlowEnrollment,
      enrollmentRef(id),
      { nowMs: NOW },
    )

    expect(sent.map((message) => message.subject)).toEqual(['Day one'])
    expect(enrollments[id].status).toBe('waiting')
    expect(enrollments[id].nextStepIndex).toBe(3)
  })
})

describe('a flow edited while somebody is waiting inside it', () => {
  it('finishes the flow that person entered, not the edited one', async () => {
    /*
     * THE DECISION, and the reason it is this one. `nextStepIndex` is a
     * position in a LIST: an author who inserts a step at the top moves every
     * later position, so resuming against the edited list would deliver
     * whatever now sits at index 2. That is not a changed flow, it is a
     * scrambled one, and the person it happens to cannot see it.
     */
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sent = []

    // The merchant rewrites the flow completely while the wait is running.
    seedAction([
      { type: 'sendEmail', subject: 'Rewritten first', body: 'x' },
      { type: 'sendEmail', subject: 'Rewritten second', body: 'y' },
      { type: 'sendEmail', subject: 'Rewritten third', body: 'z' },
    ])

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW })

    // The message the person was promised, not index 2 of a different list.
    expect(sent.map((message) => message.subject)).toEqual(['Day three'])
  })

  it('applies the edit to whoever enrolls after it', async () => {
    // The other half: an edit is not ignored, it is scoped. Without this the
    // test above would pass for an implementation that had frozen the flow.
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'first@b.co' })
    seedAction([
      { type: 'wait', delayMinutes: 60 },
      { type: 'sendEmail', subject: 'The new step', body: 'x' },
    ])

    await runEventActions(HOST_ID, 'formSubmission', { email: 'second@b.co' })
    const second = Object.values(enrollments).find(
      (row) => row['email'] === 'second@b.co',
    ) as FlowEnrollment
    sent = []
    await resumeFlowEnrollment(second, enrollmentRef('x'), { nowMs: NOW })

    expect(sent.map((message) => message.subject)).toEqual(['The new step'])
  })

  it('STOPS the flow for everyone inside when it is disabled', async () => {
    // Editing is scoped; turning it off is not. "Off" that keeps mailing the
    // queue for three more days is not off, and this is the control a
    // merchant reaches for when a flow is doing something wrong.
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sent = []
    mockActions['action-1'].enabled = false

    const ending = await resumeFlowEnrollment(enrollment, enrollmentRef(id), {
      nowMs: NOW,
    })

    expect(ending).toBe('stopped')
    expect(sent).toEqual([])
    expect(enrollments[id]).toBeUndefined()
    expect(mockActivity.at(-1)?.result).toBe('skipped')
    expect(mockActivity.at(-1)?.action).toContain('turned off or deleted')
  })

  it('stops it when the action is deleted outright', async () => {
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sent = []
    mockActions = {}

    expect(
      await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW }),
    ).toBe('stopped')
    expect(sent).toEqual([])
  })

  it('stops it when the plan no longer includes automations', async () => {
    // A three-day wait outlives a downgrade. Resuming would be a free org
    // sending mail on a paid feature.
    seedAction(WELCOME_STEPS)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sent = []
    mockOrg = { plan: 'free' }

    expect(
      await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW }),
    ).toBe('stopped')
    expect(sent).toEqual([])
    expect(mockActivity.at(-1)?.action).toContain('plan no longer includes')
  })
})

describe('an email sent from a flow is still marketing mail', () => {
  const oneWait = [
    { type: 'wait', delayMinutes: 60 },
    { type: 'sendEmail', subject: 'Day one', body: 'a', topicId: 'promotions' },
  ]

  async function resumeOnce() {
    seedAction(oneWait)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sent = []
    const ending = await resumeFlowEnrollment(enrollment, enrollmentRef(id), {
      nowMs: NOW,
    })
    return { id, ending }
  }

  it('asks the consent and topic gate before the sender', async () => {
    await resumeOnce()

    expect(flowGateCalls).toEqual([
      expect.objectContaining({
        hostId: HOST_ID,
        email: 'a@b.co',
        topicId: 'promotions',
      }),
    ])
  })

  it('declares itself marketing, so the shared seam applies its three', async () => {
    // The unsubscribe header pair, both suppression lists and the frequency
    // ceiling all ride `marketing: { hostId, siteBase }`. A flow step that
    // omitted it would be the fifth bulk path with no way out — the exact
    // defect the bulk-path audit closed.
    await resumeOnce()

    expect(sent[0].marketing).toEqual(
      expect.objectContaining({ hostId: HOST_ID }),
    )
    expect(sent[0].priority).toBe('bulk')
  })

  it('is REFUSED for someone who left the topic, and nothing is sent', async () => {
    flowGateRefusal = 'topic-unsubscribed'

    const { id, ending } = await resumeOnce()

    expect(sent).toEqual([])
    // Permanent for this message, so the flow moves on rather than retrying
    // the same refusal every beat for ever.
    expect(ending).toBe('ran')
    expect(enrollments[id]).toBeUndefined()
    expect(mockActivity.at(-1)?.action).toContain('left this email topic')
  })

  it('is REFUSED for someone with no consent basis', async () => {
    flowGateRefusal = 'consent-withheld'

    await resumeOnce()

    expect(sent).toEqual([])
    expect(mockActivity.at(-1)?.action).toContain('no marketing consent record')
  })

  it('is REFUSED for a suppressed address, by the shared seam', async () => {
    // The seam answers this one, so the assertion is that the executor
    // believes it: nothing is retried and the refusal is named.
    sendResult = { sent: false, reason: 'suppressed' }

    const { id, ending } = await resumeOnce()

    expect(ending).toBe('ran')
    expect(enrollments[id]).toBeUndefined()
    expect(mockActivity.at(-1)?.action).toContain('unsubscribed or suppressed')
  })

  it('does NOT apply the consent gate to an immediate reply', async () => {
    /*
     * The line this draws, deliberately. An auto-response to the form the
     * visitor just submitted is a reply to their own act, which is exactly
     * what `marketing-send.ts` says marketing is NOT. Gating it on a consent
     * basis would break every auto-responder on the platform.
     */
    seedAction([{ type: 'sendEmail', subject: 'Thanks', body: 'a' }])
    flowGateRefusal = 'consent-withheld'

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(flowGateCalls).toEqual([])
    expect(sent).toHaveLength(1)
    expect(sent[0].priority).toBeUndefined()
  })
})

describe('a refusal a later beat could pass keeps the person in the flow', () => {
  const oneWait = [
    { type: 'wait', delayMinutes: 60 },
    { type: 'sendEmail', subject: 'Day one', body: 'a' },
  ]

  it('leaves the enrollment on the SAME step after a rate-limit', async () => {
    /*
     * DEFERRED IS NOT SENT. The platform's hourly ceiling had no room, and
     * nothing left. Advancing past the step — or deleting the row — would
     * turn "not this hour" into an email nobody ever receives, which is the
     * defect the scheduled-campaign processor and the cart sweep each name.
     */
    seedAction(oneWait)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sendResult = { sent: false, reason: 'rate-limited' }

    const ending = await resumeFlowEnrollment(enrollment, enrollmentRef(id), {
      nowMs: NOW,
    })

    expect(ending).toBe('deferred')
    expect(enrollments[id].status).toBe('waiting')
    expect(enrollments[id].nextStepIndex).toBe(1)
    expect(enrollments[id].resumeAtMs).toBeGreaterThan(NOW)
  })

  it('does the same for a full frequency window', async () => {
    seedAction(oneWait)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sendResult = { sent: false, reason: 'frequency-capped' }

    expect(
      await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW }),
    ).toBe('deferred')
    expect(enrollments[id].status).toBe('waiting')
  })

  it('writes no run-history row for a deferral', async () => {
    // A row per refused beat would bury the runs that did something under a
    // log of the ceiling working.
    seedAction(oneWait)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    const before = mockActivity.length
    sendResult = { sent: false, reason: 'rate-limited' }

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW })

    expect(mockActivity).toHaveLength(before)
  })

  it('sends on the next beat once there is room', async () => {
    seedAction(oneWait)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()
    sendResult = { sent: false, reason: 'rate-limited' }
    await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW })
    sendResult = { sent: true }
    // The refused attempt handed a message to the sender and got nothing
    // back; what the retry does is the assertion, so the tally starts here.
    sent = []

    await resumeFlowEnrollment(
      enrollments[id] as FlowEnrollment,
      enrollmentRef(id),
      { nowMs: NOW + 60_000 },
    )

    expect(sent.map((message) => message.subject)).toEqual(['Day one'])
    expect(enrollments[id]).toBeUndefined()
  })
})

describe('a step condition is a branch inside the flow', () => {
  it('skips the step whose condition is unmet and keeps going', async () => {
    seedAction([
      {
        type: 'sendEmail',
        subject: 'For subscribers',
        body: 'a',
        when: {
          conditions: [{ field: 'subscribe', op: 'equals', value: 'yes' }],
        },
      },
      { type: 'sendEmail', subject: 'For everybody', body: 'b' },
    ])

    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      subscribe: 'no',
    })

    expect(sent.map((message) => message.subject)).toEqual(['For everybody'])
  })

  it('runs it when the condition is met', async () => {
    seedAction([
      {
        type: 'sendEmail',
        subject: 'For subscribers',
        body: 'a',
        when: {
          conditions: [{ field: 'subscribe', op: 'equals', value: 'yes' }],
        },
      },
    ])

    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      subscribe: 'yes',
    })

    expect(sent).toHaveLength(1)
  })

  it('ends the flow at a conditional exit, mid-wait', async () => {
    // The abandoned-cart shape: wait, and stop if they came back.
    seedAction([
      { type: 'wait', delayMinutes: 60 },
      {
        type: 'exitFlow',
        when: {
          conditions: [{ field: 'ordered', op: 'equals', value: 'yes' }],
        },
      },
      { type: 'sendEmail', subject: 'Still in your cart', body: 'a' },
    ])
    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      ordered: 'yes',
    })
    const [id, enrollment] = onlyEnrollment()

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW })

    expect(sent).toEqual([])
    expect(enrollments[id]).toBeUndefined()
  })

  it('sends the reminder when the exit condition is not met', async () => {
    seedAction([
      { type: 'wait', delayMinutes: 60 },
      {
        type: 'exitFlow',
        when: {
          conditions: [{ field: 'ordered', op: 'equals', value: 'yes' }],
        },
      },
      { type: 'sendEmail', subject: 'Still in your cart', body: 'a' },
    ])
    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      ordered: 'no',
    })
    const [id, enrollment] = onlyEnrollment()

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), { nowMs: NOW })

    expect(sent.map((message) => message.subject)).toEqual([
      'Still in your cart',
    ])
  })
})

describe('a wait for an event carries a timeout branch', () => {
  const withTimeout = [
    { type: 'waitForEvent', eventName: 'orderPaid', timeoutMinutes: 60 * 24 },
    {
      type: 'sendEmail',
      subject: 'You never ordered',
      body: 'a',
      when: { conditions: [{ field: '_waitTimedOut', op: 'notEmpty' }] },
    },
    {
      type: 'sendEmail',
      subject: 'Thanks for ordering',
      body: 'b',
      when: {
        conditions: [
          { field: '_waitTimedOut', op: 'equals', value: 'nothing' },
        ],
      },
    },
  ]

  it('takes the timeout path when the deadline is what woke it', async () => {
    seedAction(withTimeout)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), {
      timedOut: true,
      nowMs: NOW,
    })

    expect(sent.map((message) => message.subject)).toEqual([
      'You never ordered',
    ])
  })

  it('does not take it when the awaited event arrived', async () => {
    seedAction(withTimeout)
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })
    const [id, enrollment] = onlyEnrollment()

    await resumeFlowEnrollment(enrollment, enrollmentRef(id), {
      timedOut: false,
      nowMs: NOW,
    })

    expect(sent).toEqual([])
  })

  it('stores the awaited event and a deadline, so both wakes are possible', async () => {
    seedAction(withTimeout)

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    const [, enrollment] = onlyEnrollment()
    expect(enrollment.awaitingEvent).toBe('orderPaid')
    expect(enrollment.resumeAtMs).toBeGreaterThan(Date.now())
  })
})

describe('enrollInFlow is the only door onto the collection', () => {
  it('stamps every field the sweep and the resume both need', async () => {
    const result = await enrollInFlow({
      hostId: HOST_ID,
      actionId: 'action-1',
      action: { name: 'Series', steps: WELCOME_STEPS as never },
      email: 'A@B.co',
      event: 'formSubmission',
      payload: { email: 'A@B.co' },
      nextStepIndex: 2,
      resumeAtMs: NOW + 1000,
      nowMs: NOW,
    })

    expect(result).toEqual({ enrolled: true, id: expect.any(String) })
    const [, enrollment] = onlyEnrollment()
    expect(enrollment).toEqual(
      expect.objectContaining({
        hostId: HOST_ID,
        actionId: 'action-1',
        status: 'waiting',
        resumeAtMs: NOW + 1000,
        nextStepIndex: 2,
        // Normalized, because the person key is a hash of the normalized
        // address and a row keyed one way and read another finds nobody.
        email: 'a@b.co',
      }),
    )
    expect(enrollment.steps).toHaveLength(3)
  })
})
