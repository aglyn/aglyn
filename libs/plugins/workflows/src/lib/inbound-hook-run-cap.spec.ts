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
 * AGL-2228 — the inbound webhook run meets `workflowRunsPerMonth`, and moves
 * the counter it is measured against.
 *
 * The handler's docblock said, from AGL-149 onward, that these "runs bill
 * against the workflow-runs meter like any other run". They did not. The file
 * mentioned neither `workflowRunsPerMonth` nor `counters/workflowRuns` — so an
 * inbound hook was a workflow execution that no cap could refuse and no meter
 * could see. A comment asserting behaviour that never existed is the exact
 * shape a green check is worst at catching, because nothing reads a comment.
 *
 * ## Both halves, in both directions
 *
 * A suite that only asserted "past the cap it is refused" would also pass
 * against a handler that refuses every hook — which is the likelier way this
 * fix goes wrong, since the entitlement gate above it already refuses most
 * plans. So each case pins the pair: the LAST run inside the cap succeeds and
 * the next one is refused, and the counter is asserted to have moved by
 * exactly one on the success.
 *
 * ## Why the counter half is a separate claim
 *
 * "Refused at the cap" and "counted when it runs" are different properties and
 * only the second is what makes the customer's usage card, the usage-alerts
 * cron and the COGS rollup tell the truth. A handler that checked the cap but
 * still never incremented would satisfy the refusal tests forever and keep
 * reporting zero inbound runs — so the increment is asserted on its own, and
 * on a FAILED run too, because a run that executed and threw spent the same
 * compute as one that returned a value.
 */

const mockGetOrgForHost = jest.fn()

interface MockStoreShape {
  hook: Record<string, unknown> | undefined
  workflows: Array<Record<string, unknown>>
  /** `counters/workflowRuns` — month key → count. */
  runCounter: Record<string, number>
  /** Activity rows the handler wrote. */
  activity: Array<Record<string, unknown>>
}

const mockStore: MockStoreShape = {
  hook: undefined,
  workflows: [],
  runCounter: {},
  activity: [],
}

/** `FieldValue.increment(n)` as a resolvable sentinel, like the server's. */
interface MockIncrement {
  __increment: number
}
const mockIsIncrement = (value: unknown): value is MockIncrement =>
  Boolean(value) && typeof (value as MockIncrement).__increment === 'number'

const mockDocsOf = (rows: Array<Record<string, unknown>>) => ({
  docs: rows.map((row, index) => ({
    id: `doc-${index}`,
    data: () => row,
    get: (field: string) => row[field],
  })),
})

const mockHostRef = {
  collection: (name: string) => {
    if (name === 'webhooks') {
      return {
        doc: () => ({
          get: async () => ({
            data: () => mockStore.hook,
            get: (field: string) => mockStore.hook?.[field],
          }),
        }),
      }
    }
    if (name === 'counters') {
      return {
        doc: () => ({
          get: async () => ({
            get: (field: string) => mockStore.runCounter[field],
          }),
          // `set(..., { merge: true })` conjures the document when absent and
          // merges when present — modelled exactly, because `update()` would
          // throw NOT_FOUND on an org's first run and a double that used it
          // would turn a real bug into a passing test.
          set: async (payload: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(payload)) {
              mockStore.runCounter[key] = mockIsIncrement(value)
                ? (mockStore.runCounter[key] ?? 0) + value.__increment
                : (value as number)
            }
          },
        }),
      }
    }
    if (name === 'activity') {
      return {
        add: async (row: Record<string, unknown>) => {
          mockStore.activity.push(row)
        },
      }
    }
    // functions / variables / workflows
    return {
      limit: () => ({
        get: async () =>
          mockDocsOf(name === 'workflows' ? mockStore.workflows : []),
      }),
    }
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__server_timestamp__',
    increment: (by: number) => ({ __increment: by }),
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({ collection: () => ({ doc: () => mockHostRef }) }),
    }),
  },
  getOrgForHost: (...args: unknown[]) => mockGetOrgForHost(...args),
}))

const mockRegistered: Array<(req: any, res: any) => unknown> = []

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table, the REAL entitlement check and the REAL workflow
  // engine. Stubbing `resolveOrgEntitlements` would let this suite pass
  // against a handler that read nothing, which IS the defect under repair.
  ...jest.requireActual(
    '../../../../aglyn/src/lib/app-utils/plan-entitlements',
  ),
  ...jest.requireActual('../../../../aglyn/src/lib/app-utils/workflows'),
  registerPluginApiRoute: (_path: string, handler: (req: any, res: any) => unknown) => {
    mockRegistered.push(handler)
  },
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { registerWorkflowsApi } from './server'

registerWorkflowsApi()
const inboundHook = mockRegistered[0]

const MONTH = new Date().toISOString().slice(0, 7)
const SECRET = 'sh-secret-value'

/** A plan with webhooks AND a finite run allowance. */
const BUSINESS_RUNS = PLAN_ENTITLEMENTS.business.workflowRunsPerMonth

interface Captured {
  status: number
  body: unknown
}

const callHook = async (
  hookId = 'hook-1',
  secret = SECRET,
): Promise<Captured> => {
  const captured: Captured = { status: 0, body: undefined }
  const res: any = {
    status: (code: number) => {
      captured.status = code
      return res
    },
    json: (body: unknown) => {
      captured.body = body
      return res
    },
    send: () => res,
    setHeader: () => undefined,
    end: () => undefined,
  }
  await inboundHook(
    {
      method: 'POST',
      query: { hostId: 'host-1', hookId },
      body: {},
      headers: { 'x-aglyn-secret': secret },
      cookies: {},
      socket: {},
    },
    res,
  )
  return captured
}

/**
 * A distinct hook id per call, because `rateLimited` is a module-level map
 * keyed by `${hostId}/${hookId}` with a 30/60s bound that no `beforeEach` can
 * clear. A suite that shared one id would start reporting 429s partway
 * through and the failures would look like the cap working.
 */
let hookSeq = 0
const nextHookId = () => `hook-${(hookSeq += 1)}`

beforeEach(() => {
  jest.clearAllMocks()
  mockStore.hook = {
    direction: 'inbound',
    enabled: true,
    secret: SECRET,
    name: 'Orders in',
    workflowName: 'ingest',
  }
  mockStore.workflows = [{ name: 'ingest', steps: [] }]
  mockStore.runCounter = {}
  mockStore.activity = []
  mockGetOrgForHost.mockResolvedValue({
    org: { plan: 'business', subscription: { status: 'active' } },
  })
})

describe('the premise', () => {
  it('business carries webhooks AND a finite monthly run allowance', () => {
    // Without both, every case below is vacuous: no webhooks and the
    // entitlement refuses first; an infinite allowance and the cap can never
    // speak.
    expect(PLAN_ENTITLEMENTS.business.features.webhooks).toBe(true)
    expect(Number.isFinite(BUSINESS_RUNS)).toBe(true)
    expect(BUSINESS_RUNS).toBeGreaterThan(0)
    // …and free, which is what an unreadable org doc resolves to, carries
    // neither. That is the direction an org we cannot read must fall.
    expect(PLAN_ENTITLEMENTS.free.features.webhooks).toBe(false)
    expect(PLAN_ENTITLEMENTS.free.workflowRunsPerMonth).toBe(0)
  })
})

describe('the monthly run cap (AGL-2228)', () => {
  it('runs the LAST hook inside the allowance', async () => {
    mockStore.runCounter = { [MONTH]: BUSINESS_RUNS - 1 }
    const response = await callHook(nextHookId())
    expect(response.status).toBe(200)
    // …and it counted, which is the half a refusal test cannot see.
    expect(mockStore.runCounter[MONTH]).toBe(BUSINESS_RUNS)
  })

  it('refuses the NEXT one with a 402 and runs nothing', async () => {
    mockStore.runCounter = { [MONTH]: BUSINESS_RUNS }
    const response = await callHook(nextHookId())
    expect(response.status).toBe(402)
    expect(String((response.body as any).error)).toContain(
      String(BUSINESS_RUNS),
    )
    // A refused run must not count, must not log activity, and must not have
    // executed — "refused, and billed anyway" is the same defect with a
    // smaller number.
    expect(mockStore.runCounter[MONTH]).toBe(BUSINESS_RUNS)
    expect(mockStore.activity).toHaveLength(0)
  })

  it('counts a run that FAILED, exactly as the event path does', async () => {
    // A workflow that throws spent the same compute as one that returned.
    mockStore.workflows = [
      { name: 'ingest', steps: [{ type: 'set', name: '', value: '' }] },
    ]
    const response = await callHook(nextHookId())
    expect(response.status).toBe(422)
    expect(mockStore.activity[0]?.['result']).toBe('failed')
    expect(mockStore.runCounter[MONTH]).toBe(1)
    expect(mockStore.activity).toHaveLength(1)
  })

  it('counts LAST MONTH separately — the cap is monthly, not lifetime', async () => {
    mockStore.runCounter = { '2020-01': BUSINESS_RUNS }
    const response = await callHook(nextHookId())
    expect(response.status).toBe(200)
    expect(mockStore.runCounter[MONTH]).toBe(1)
    expect(mockStore.runCounter['2020-01']).toBe(BUSINESS_RUNS)
  })
})

describe('an org the cap cannot read falls to FREE, which refuses', () => {
  it('refuses when the owning org is unknown', async () => {
    // `getOrgForHost` returning nothing resolves as free — `webhooks: false`
    // — so the entitlement gate speaks first. Asserted so the fail direction
    // is pinned: an unreadable org doc must not become an uncapped one.
    mockGetOrgForHost.mockResolvedValue(undefined)
    const response = await callHook(nextHookId())
    expect(response.status).toBe(403)
    expect(mockStore.runCounter[MONTH]).toBeUndefined()
  })

  it('refuses on a staff override that grants webhooks but no runs', async () => {
    // The shape the cap exists for, and the reason it is not a second gate on
    // the same fact: `entitlementOverrides` can switch `webhooks` on without
    // buying a single run. With only the entitlement check, this ran forever.
    mockGetOrgForHost.mockResolvedValue({
      org: { plan: 'free', entitlements: { features: { webhooks: true } } },
    })
    const response = await callHook(nextHookId())
    expect(response.status).toBe(402)
    expect(mockStore.activity).toHaveLength(0)
  })
})

describe('POSITIVE CONTROL: the cap is the only thing refusing', () => {
  it('an org well inside its allowance runs and is never refused', async () => {
    // Without this the suite is satisfied by a handler that 402s everything.
    mockStore.runCounter = { [MONTH]: 0 }
    for (let index = 0; index < 3; index += 1) {
      expect((await callHook(nextHookId())).status).toBe(200)
    }
    expect(mockStore.runCounter[MONTH]).toBe(3)
    expect(mockStore.activity).toHaveLength(3)
  })
})
