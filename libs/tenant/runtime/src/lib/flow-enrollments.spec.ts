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
 * THE SCHEDULING CONTRACT, exercised against a store rather than a stub.
 *
 * A wait step is only as good as the thing that comes back for it, and every
 * property that matters here is a property of the STORE and the query — not
 * of any code path a mocked `get()` could stand in for. So the fixture below
 * is a small in-memory Firestore with real documents, a real
 * `collectionGroup` query with an inequality and an `orderBy`, real paging,
 * and real transactions that see each other's writes.
 *
 * What that buys is the four assertions this file exists for:
 *
 *  1. a waiting enrollment survives the process that created it;
 *  2. two beats cannot resume the same person;
 *  3. one beat cannot read the whole enrolled population; and
 *  4. a locked host's row is SKIPPED, not consumed.
 */

const store = new Map<string, Record<string, any>>()

/** Every `collectionGroup` query the sweep ran, for the cost assertions. */
let queryLog: Array<{ limit: number; startAfter: string | null }> = []

function pathParts(path: string): string[] {
  return path.split('/')
}

function snapshotFor(path: string) {
  const data = store.get(path)
  return {
    id: pathParts(path).slice(-1)[0],
    exists: data !== undefined,
    ref: refFor(path),
    data: () => data,
    get: (field: string) =>
      field.split('.').reduce<any>((value, key) => value?.[key], data),
  }
}

function refFor(path: string): any {
  return {
    path,
    id: pathParts(path).slice(-1)[0],
    get parent() {
      const parts = pathParts(path)
      return {
        get parent() {
          return parts.length >= 3 ? refFor(parts.slice(0, -2).join('/')) : null
        },
      }
    },
    get: async () => snapshotFor(path),
    set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
      const next = options?.merge
        ? { ...(store.get(path) ?? {}), ...patch }
        : patch
      // The one FieldValue this module uses; applied rather than stored, so a
      // `resumes` count read back in an assertion is a number.
      if ((next as any).resumes?.__increment !== undefined) {
        next.resumes =
          Number(store.get(path)?.['resumes'] ?? 0) +
          (next as any).resumes.__increment
      }
      store.set(path, next)
    },
    update: async (patch: Record<string, any>) => {
      store.set(path, { ...(store.get(path) ?? {}), ...patch })
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(prefix: string): any {
  return {
    doc: (id: string) => refFor(`${prefix}/${id}`),
    // A subcollection is queryable too — `findFlowEnrollmentsAwaiting` reads
    // one site's enrollments rather than the group, and a fake that only
    // answered `doc()` would make its "found nobody" assertions pass because
    // the query threw.
    ...groupQuery({
      group: pathParts(prefix).slice(-1)[0],
      prefix,
      filters: [],
      order: null,
      limit: 1000,
      startAfter: null,
    }),
  }
}

interface QueryState {
  group: string
  /** Set for a single-collection query; absent for a collection group. */
  prefix?: string
  filters: Array<[string, string, any]>
  order: string | null
  limit: number
  startAfter: string | null
}

function groupQuery(state: QueryState): any {
  const next = (patch: Partial<QueryState>) =>
    groupQuery({ ...state, ...patch })
  return {
    where: (field: string, op: string, value: any) =>
      next({ filters: [...state.filters, [field, op, value]] }),
    orderBy: (field: string) => next({ order: field }),
    limit: (count: number) => next({ limit: count }),
    startAfter: (snapshot: any) =>
      next({ startAfter: snapshot?.ref?.path ?? snapshot?.path ?? null }),
    get: async () => {
      queryLog.push({ limit: state.limit, startAfter: state.startAfter })
      let rows = [...store.entries()].filter(([path]) =>
        state.prefix
          ? path.startsWith(`${state.prefix}/`)
          : pathParts(path).slice(-2)[0] === state.group,
      )
      for (const [field, op, value] of state.filters) {
        rows = rows.filter(([, data]) => {
          const actual = data[field]
          if (op === '==') return actual === value
          if (op === '<=') return Number(actual) <= Number(value)
          return true
        })
      }
      /*
       * The ORDER is applied here, and a row missing the ordered field is
       * DROPPED — exactly as Firestore drops it. That is not fixture
       * pedantry: it is what makes `every waiting row carries resumeAtMs` an
       * assertion with teeth instead of a comment.
       */
      if (state.order) {
        rows = rows
          .filter(([, data]) => data[state.order as string] !== undefined)
          .sort(
            (a, b) =>
              Number(a[1][state.order as string]) -
              Number(b[1][state.order as string]),
          )
      }
      if (state.startAfter) {
        const at = rows.findIndex(([path]) => path === state.startAfter)
        rows = at === -1 ? rows : rows.slice(at + 1)
      }
      const page = rows.slice(0, state.limit)
      return {
        empty: page.length === 0,
        size: page.length,
        docs: page.map(([path]) => snapshotFor(path)),
      }
    },
  }
}

const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => refFor(`${name}/${id}`),
  }),
  doc: (path: string) => refFor(path),
  collectionGroup: (group: string) =>
    groupQuery({
      group,
      filters: [],
      order: null,
      limit: 1000,
      startAfter: null,
    }),
  runTransaction: async (body: (transaction: any) => Promise<any>) => {
    // Serial, which is what the Admin SDK guarantees for the conflicting case
    // and all these tests need: a claim either sees the other claim's write
    // or is the first.
    const transaction = {
      get: async (ref: any) => snapshotFor(ref.path),
      set: async (ref: any, data: any) => {
        store.set(ref.path, data)
      },
      update: async (ref: any, patch: any) => {
        store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...patch })
      },
    }
    return await body(transaction)
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => firestore }),
    firestore: {
      FieldValue: { increment: (by: number) => ({ __increment: by }) },
    },
  },
}))

import {
  claimFlowEnrollment,
  enrollInFlow,
  FLOW_CLAIM_STALE_MS,
  findFlowEnrollmentsAwaiting,
  flowEnrollmentId,
  sweepDueFlowEnrollments,
  type FlowEnrollment,
} from './flow-enrollments'

const HOST = 'site-1'
const NOW = 1_700_000_000_000
const gateOpen = { isLocked: async () => false }

const enrollmentPath = (hostId: string, id: string) =>
  `hosts/${hostId}/flowEnrollments/${id}`

async function enroll(options?: {
  hostId?: string
  actionId?: string
  email?: string
  resumeAtMs?: number
  awaitingEvent?: string | null
}) {
  return await enrollInFlow({
    hostId: options?.hostId ?? HOST,
    actionId: options?.actionId ?? 'action-1',
    action: {
      name: 'Welcome series',
      steps: [
        { type: 'wait', delayMinutes: 60 },
        { type: 'sendEmail', subject: 'Hi', body: 'Hello' },
      ],
    },
    email: options?.email ?? 'buyer@example.com',
    event: 'formSubmission',
    payload: { email: options?.email ?? 'buyer@example.com' },
    nextStepIndex: 1,
    resumeAtMs: options?.resumeAtMs ?? NOW + 60_000,
    ...(options?.awaitingEvent !== undefined
      ? { awaitingEvent: options.awaitingEvent }
      : {}),
    nowMs: NOW,
  })
}

beforeEach(() => {
  store.clear()
  queryLog = []
})

describe('the fixture reaches the code under test', () => {
  it('writes a waiting row a sweep can find', async () => {
    // The control every refusal below depends on. Without it a broken fake
    // would report "nothing resumed" for every case and the file would pass
    // having scheduled nothing.
    await enroll()
    const resumed: string[] = []

    const result = await sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW + 120_000,
      resume: async (enrollment) => {
        resumed.push(enrollment.email)
      },
    })

    expect(result.resumed).toBe(1)
    expect(resumed).toEqual(['buyer@example.com'])
  })
})

describe('a waiting enrollment survives the process that created it', () => {
  it('is found by a sweep that shares no state with the enrollment', async () => {
    /*
     * DURABILITY, stated as the only thing that can actually be shown in a
     * unit test: the enrollment is written by one call, every in-process
     * handle to it is dropped, and a sweep that never saw that call finds it
     * by QUERY alone. Nothing is held in a timer, a closure or a module
     * variable — which is the property a deploy, a restart and a cold start
     * each destroy, and the reason `setTimeout` is not an implementation of
     * a three-day wait.
     */
    await enroll({ resumeAtMs: NOW + 3 * 24 * 60 * 60_000 })
    const rowsAfterEnrolment = new Map(store)

    // The "restart": every module-level cache is gone, the only thing that
    // crossed the boundary is the durable store.
    jest.resetModules()
    const fresh = await import('./flow-enrollments')
    store.clear()
    for (const [path, data] of rowsAfterEnrolment) store.set(path, data)

    const seen: FlowEnrollment[] = []
    const result = await fresh.sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW + 3 * 24 * 60 * 60_000 + 1,
      resume: async (enrollment) => {
        seen.push(enrollment)
      },
    })

    expect(result.resumed).toBe(1)
    expect(seen[0].nextStepIndex).toBe(1)
    expect(seen[0].steps).toHaveLength(2)
  })

  it('is not resumed one beat early', async () => {
    // The other half of durable: a wait that is not over is not due. Without
    // this the "survives" test above would pass for a sweep that resumed
    // everything it could see.
    await enroll({ resumeAtMs: NOW + 3 * 24 * 60 * 60_000 })

    const result = await sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW + 60_000,
      resume: async () => undefined,
    })

    expect(result.resumed).toBe(0)
    expect(result.scanned).toBe(0)
  })

  it('carries resumeAtMs on every waiting row, or the sweep cannot see it', async () => {
    /*
     * An `orderBy` DROPS a document that lacks the ordered field, silently.
     * A writer that ever omitted `resumeAtMs` would therefore not produce a
     * late enrollment — it would produce one that is invisible to the only
     * thing that resumes it, for ever. The fixture drops such rows exactly as
     * Firestore does, so this asserts the WRITER rather than the query.
     */
    await enroll()
    const written = [...store.values()]
    expect(written).toHaveLength(1)
    expect(typeof written[0]['resumeAtMs']).toBe('number')
    expect(written[0]['status']).toBe('waiting')
  })
})

describe('a person is not enrolled twice in the same flow', () => {
  it('refuses a second concurrent enrollment', async () => {
    const first = await enroll()
    const second = await enroll()

    expect(first).toEqual({
      enrolled: true,
      id: expect.stringContaining('action-1__'),
    })
    expect(second).toEqual({ enrolled: false, reason: 'already-waiting' })
    expect(store.size).toBe(1)
  })

  it('lets the same person back in once the flow has ended', async () => {
    // The reason a finished flow DELETES its row: a tombstone would be a
    // permanent refusal to ever run this sequence for this person again.
    await enroll()
    store.delete(enrollmentPath(HOST, flowEnrollmentId('action-1', keyFor())))

    expect(await enroll()).toEqual({
      enrolled: true,
      id: expect.any(String),
    })
  })

  it('keeps a different flow, and a different person, separate', async () => {
    await enroll()
    const otherFlow = await enroll({ actionId: 'action-2' })
    const otherPerson = await enroll({ email: 'other@example.com' })

    expect(otherFlow.enrolled).toBe(true)
    expect(otherPerson.enrolled).toBe(true)
    expect(store.size).toBe(3)
  })

  it('refuses to wait for nobody', async () => {
    // A flow that waits continues later FOR A PERSON. Without an address
    // there is no dedupe key, so a page-view trigger would mint a row per
    // visit — unbounded storage from an anonymous event.
    expect(await enroll({ email: '' })).toEqual({
      enrolled: false,
      reason: 'no-person',
    })
    expect(store.size).toBe(0)
  })
})

describe('two beats cannot resume the same person', () => {
  it('claims transactionally, so the second beat finds nothing to do', async () => {
    await enroll()
    const ref = firestore.doc(
      enrollmentPath(HOST, flowEnrollmentId('action-1', keyFor())),
    )

    const first = await claimFlowEnrollment(ref, { nowMs: NOW + 120_000 })
    const second = await claimFlowEnrollment(ref, { nowMs: NOW + 120_000 })

    expect(first?.email).toBe('buyer@example.com')
    expect(second).toBeNull()
  })

  it('re-arms a claim whose beat never came back', async () => {
    // A `running` row nobody is holding is the one state that would strand a
    // person for ever: not waiting, so no sweep finds it; not done, so
    // nobody is told.
    await enroll()
    const ref = firestore.doc(
      enrollmentPath(HOST, flowEnrollmentId('action-1', keyFor())),
    )
    await claimFlowEnrollment(ref, { nowMs: NOW })

    const stale = await claimFlowEnrollment(ref, {
      nowMs: NOW + FLOW_CLAIM_STALE_MS + 1,
    })

    expect(stale?.email).toBe('buyer@example.com')
  })

  it('does not re-arm one that is merely slow', async () => {
    await enroll()
    const ref = firestore.doc(
      enrollmentPath(HOST, flowEnrollmentId('action-1', keyFor())),
    )
    await claimFlowEnrollment(ref, { nowMs: NOW })

    expect(
      await claimFlowEnrollment(ref, { nowMs: NOW + FLOW_CLAIM_STALE_MS - 1 }),
    ).toBeNull()
  })
})

describe('one beat does not read every enrollment', () => {
  it('stops at the scan budget and says where to resume', async () => {
    for (let i = 0; i < 30; i += 1) {
      await enroll({
        email: `person-${i}@example.com`,
        resumeAtMs: NOW + i,
      })
    }

    const result = await sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW + 10 * 60_000,
      scanBudget: 10,
      resume: async () => undefined,
    })

    expect(result.scanned).toBe(10)
    expect(result.resumed).toBe(10)
    expect(result.complete).toBe(false)
    expect(result.cursor?.path).toContain('flowEnrollments/')
  })

  it('resumes from the cursor rather than restarting', async () => {
    for (let i = 0; i < 30; i += 1) {
      await enroll({ email: `person-${i}@example.com`, resumeAtMs: NOW + i })
    }
    const first = await sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW + 10 * 60_000,
      scanBudget: 10,
      resume: async () => undefined,
    })

    const emails: string[] = []
    await sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW + 10 * 60_000,
      scanBudget: 10,
      cursor: first.cursor,
      resume: async (enrollment) => {
        emails.push(enrollment.email)
      },
    })

    // The second beat starts where the first stopped: nobody the first beat
    // already picked up is handed to the resume a second time. A cursor that
    // was ignored would replay person 0, which for a real resume is a step
    // executed twice for the same person.
    expect(emails.length).toBeGreaterThan(0)
    for (let i = 0; i < 10; i += 1) {
      expect(emails).not.toContain(`person-${i}@example.com`)
    }
  })

  it('never reads a row whose wait has not ended, whatever the budget', async () => {
    /*
     * THE COST PROPERTY, and the difference between this design and the naive
     * one. Ten thousand people waiting three days cost NOTHING on the beats
     * before those three days are up, because the query asks for due rows
     * rather than for the population.
     */
    for (let i = 0; i < 50; i += 1) {
      await enroll({
        email: `person-${i}@example.com`,
        resumeAtMs: NOW + 3 * 24 * 60 * 60_000,
      })
    }
    await enroll({ email: 'due@example.com', resumeAtMs: NOW - 1 })

    const seen: string[] = []
    const result = await sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW,
      resume: async (enrollment) => {
        seen.push(enrollment.email)
      },
    })

    expect(result.scanned).toBe(1)
    expect(seen).toEqual(['due@example.com'])
  })

  it('pages rather than asking for everything at once', async () => {
    for (let i = 0; i < 120; i += 1) {
      await enroll({ email: `person-${i}@example.com`, resumeAtMs: NOW + i })
    }

    await sweepDueFlowEnrollments(gateOpen, {
      nowMs: NOW + 10 * 60_000,
      resume: async () => undefined,
    })

    // Every page carries a bounded limit, and every page after the first
    // carries a cursor — the shape that keeps one invocation's read set
    // bounded no matter how much work is due.
    expect(queryLog.length).toBeGreaterThan(1)
    expect(queryLog.every((entry) => entry.limit <= 50)).toBe(true)
    expect(queryLog.slice(1).every((entry) => entry.startAfter !== null)).toBe(
      true,
    )
  })
})

describe('a locked site is skipped, not consumed', () => {
  it('leaves the row waiting and overdue', async () => {
    await enroll({ resumeAtMs: NOW - 1 })
    const gate = { isLocked: async (hostId: string) => hostId === HOST }

    const result = await sweepDueFlowEnrollments(gate, {
      nowMs: NOW,
      resume: async () => {
        throw new Error('a locked host must not be resumed')
      },
    })

    expect(result.skippedLocked).toBe(1)
    expect(result.resumed).toBe(0)
    const row = [...store.values()][0]
    // Untouched: still waiting, still due, still at the same step. A gate
    // that stamped, deleted or advanced anything would turn a pause into a
    // cancellation for everybody mid-flow.
    expect(row['status']).toBe('waiting')
    expect(row['resumeAtMs']).toBe(NOW - 1)
    expect(row['nextStepIndex']).toBe(1)
  })

  it('resumes on the first beat after the lift', async () => {
    await enroll({ resumeAtMs: NOW - 1 })
    let locked = true
    const gate = { isLocked: async () => locked }
    await sweepDueFlowEnrollments(gate, {
      nowMs: NOW,
      resume: async () => undefined,
    })

    locked = false
    const after = await sweepDueFlowEnrollments(gate, {
      nowMs: NOW + 60_000,
      resume: async () => undefined,
    })

    expect(after.resumed).toBe(1)
  })

  it('gets past a wall of locked rows to the work behind them', async () => {
    // The reason the budget and cursor matter even though the query is
    // already narrow: a locked row STAYS due, so without paging past it one
    // suspended site would starve every other site's flows.
    for (let i = 0; i < 60; i += 1) {
      await enroll({
        hostId: 'locked-site',
        email: `person-${i}@example.com`,
        resumeAtMs: NOW - 1000 + i,
      })
    }
    await enroll({ resumeAtMs: NOW - 1 })
    const gate = {
      isLocked: async (hostId: string) => hostId === 'locked-site',
    }

    const seen: string[] = []
    await sweepDueFlowEnrollments(gate, {
      nowMs: NOW,
      resume: async (enrollment) => {
        seen.push(enrollment.email)
      },
    })

    expect(seen).toEqual(['buyer@example.com'])
  })
})

describe('waiting for an event is a keyed lookup, not a scan', () => {
  it('finds only this person, on this site, for this event', async () => {
    await enroll({ awaitingEvent: 'orderPaid' })
    await enroll({
      email: 'someone-else@example.com',
      awaitingEvent: 'orderPaid',
    })
    await enroll({ actionId: 'action-9', awaitingEvent: 'newsletterSignup' })

    const found = await findFlowEnrollmentsAwaiting({
      hostId: HOST,
      event: 'orderPaid',
      email: 'buyer@example.com',
    })

    expect(found).toHaveLength(1)
    expect(found[0].get('email')).toBe('buyer@example.com')
  })

  it('matches nobody for an event no flow is waiting on', async () => {
    await enroll({ awaitingEvent: 'orderPaid' })

    expect(
      await findFlowEnrollmentsAwaiting({
        hostId: HOST,
        event: 'pageView',
        email: 'buyer@example.com',
      }),
    ).toEqual([])
  })

  it('asks nothing at all without an address', async () => {
    await enroll({ awaitingEvent: 'orderPaid' })
    queryLog = []

    expect(
      await findFlowEnrollmentsAwaiting({
        hostId: HOST,
        event: 'orderPaid',
        email: '',
      }),
    ).toEqual([])
    expect(queryLog).toEqual([])
  })
})

/** The person key the fixture's default address hashes to. */
function keyFor(email = 'buyer@example.com'): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:crypto').createHash('sha256').update(email).digest('hex')
}
