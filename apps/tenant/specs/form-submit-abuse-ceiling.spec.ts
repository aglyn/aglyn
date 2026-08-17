/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * The per-site form-submission abuse ceiling (AGL-1655), driven through the
 * real route with a fake Firestore.
 *
 * The claim under test is a BILLING one, so the assertions are about the
 * document the invoice is computed from. /api/billing/report-usage prices
 * `hosts/{id}/counters/formSubmissions[YYYY-MM]`; a submission refused for
 * abuse must leave that number exactly where it was. Everything else here —
 * the status, the code, the notification — is how a human finds out. The
 * counter is the bug.
 *
 * The entitlement layer is deliberately NOT mocked: these are the real plan
 * tables answering, which is what makes the "the plan gate would have said
 * yes" control below mean something.
 */

import {
  checkFormSubmissionQuota,
  FORM_ABUSE_CEILING_CODE,
  FORM_ABUSE_CEILING_FLOOR,
} from '@aglyn/aglyn/server'

const HOST_ID = 'site-1'
const MONTH = new Date().toISOString().slice(0, 7)

/** Sentinel for `FieldValue.increment`, applied by the fake `set`. */
type Increment = { __increment: number }
const mockIsIncrement = (value: unknown): value is Increment =>
  typeof value === 'object' && value !== null && '__increment' in (value as any)

let mockStore: Record<string, Record<string, any>> = {}
let mockAddedSubmissions: Record<string, any>[] = []
let mockNotifications: Record<string, any>[] = []
let mockOrgPlan: string | null = 'starter'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string) => ({
  get: async () => {
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    const base = options?.merge ? (mockStore[path] ?? {}) : {}
    const next: Record<string, any> = { ...base }
    for (const [key, value] of Object.entries(patch)) {
      next[key] = mockIsIncrement(value)
        ? Number(next[key] ?? 0) + value.__increment
        : value
    }
    mockStore[path] = next
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string) => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    if (!path.endsWith('formSubmissions')) {
      throw new Error(`unexpected add to ${path}`)
    }
    mockAddedSubmissions.push(data)
    return { id: `submission-${mockAddedSubmissions.length}` }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({ collection: (name: string) => mockCollectionHandle(name) }),
    }),
  },
  // The per-IP limiter is a different control with its own coverage; it must
  // never be what makes this test pass.
  consumeRateLimit: async () => ({ allowed: true, resetMs: Date.now() + 1000 }),
  getOrgForHost: async () => (mockOrgPlan ? { org: { plan: mockOrgPlan } } : null),
  notifyHostManagers: async (hostId: string, payload: Record<string, any>) => {
    mockNotifications.push({ hostId, ...payload })
  },
  orgDataCollectionForHost: async () => {
    throw new Error('no dataset binding in these cases')
  },
  upsertHostContact: async () => undefined,
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => null,
}))

// Below the mocks by intent, not by accident: babel hoists `jest.mock` above
// every import, so the route under test resolves the fakes above.
import { POST } from '../app/api/forms/submit/route'

const submit = (overrides: Record<string, unknown> = {}) =>
  POST(
    new Request('https://site.example/api/forms/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({
        hostId: HOST_ID,
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'visitor@example.com', message: 'hello' },
        ...overrides,
      }),
    }),
  ) as Promise<Response>

const counterPath = `hosts/${HOST_ID}/counters/formSubmissions`
const refusedPath = `hosts/${HOST_ID}/counters/formSubmissionsRefused`
const spamPath = `hosts/${HOST_ID}/counters/formSubmissionsSpam`
const billedThisMonth = () => Number(mockStore[counterPath]?.[MONTH] ?? 0)

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockAddedSubmissions = []
  mockNotifications = []
  mockOrgPlan = 'starter'
})

describe('form submission abuse ceiling (AGL-1655)', () => {
  it('accepts and bills the submission one below the ceiling', () => {
    // The control. Without it, a ceiling that refused EVERYTHING would pass
    // every assertion in the case below.
    mockStore[counterPath] = { [MONTH]: FORM_ABUSE_CEILING_FLOOR - 1 }
    return submit().then(async (response) => {
      expect(response.status).toBe(200)
      expect(mockAddedSubmissions).toHaveLength(1)
      expect(billedThisMonth()).toBe(FORM_ABUSE_CEILING_FLOOR)
      expect(mockStore[refusedPath]).toBeUndefined()
      // The routine "New form submission" alert fires, the pause alert does
      // not — the ceiling is silent until it is actually reached.
      expect(mockNotifications.map((entry) => entry.type)).toEqual([
        'content.formSubmission',
      ])
    })
  })

  it('refuses at the ceiling WITHOUT incrementing the billable counter', async () => {
    mockStore[counterPath] = { [MONTH]: FORM_ABUSE_CEILING_FLOOR }

    // The premise, asserted rather than assumed: Starter meters, so the plan
    // gate this route already had says yes here. The ceiling is the only
    // thing that can refuse — and before it existed, this submission billed.
    expect(
      checkFormSubmissionQuota({ plan: 'starter' } as any, FORM_ABUSE_CEILING_FLOOR)
        .allowed,
    ).toBe(true)

    const response = await submit()
    expect(response.status).toBe(429)
    const body = await response.json()
    // Distinguishable from the free plan's 429, which carries no code.
    expect(body.code).toBe('form-abuse-ceiling')
    // Not a fake success: the visitor is told, unlike the honeypot path.
    expect(body.error).toMatch(/paused/i)
    expect(response.headers.get('Retry-After')).toBeTruthy()

    // THE ASSERTION. A refused submission does not move the number the
    // customer is invoiced on.
    expect(billedThisMonth()).toBe(FORM_ABUSE_CEILING_FLOOR)
    // And none of the downstream fan-out ran either — no inbox row, so no
    // contact upsert, dataset append or host event behind it.
    expect(mockAddedSubmissions).toHaveLength(0)
  })

  it('records the trip for staff and warns the managers exactly once a month', async () => {
    mockStore[counterPath] = { [MONTH]: FORM_ABUSE_CEILING_FLOOR }

    await submit()
    expect(mockStore[refusedPath][MONTH]).toBe(1)
    expect(mockStore[refusedPath].ceiling).toBe(FORM_ABUSE_CEILING_FLOOR)
    expect(typeof mockStore[refusedPath].lastRefusedAtMs).toBe('number')
    expect(mockNotifications).toHaveLength(1)
    // `system.`, not `content.` — `content` is the category a busy site owner
    // mutes to stop routine form-submission chatter, which is exactly the
    // owner whose form just stopped accepting.
    expect(mockNotifications[0].type).toBe('system.formSubmissionsPaused')

    await submit()
    await submit()
    // Refusals keep counting — a silent drop is what this replaces.
    expect(mockStore[refusedPath][MONTH]).toBe(3)
    // The alert does not. Notifying per refused bot request would deliver
    // the flood rather than report it.
    expect(mockNotifications).toHaveLength(1)
    // Still not billed, three refusals in.
    expect(billedThisMonth()).toBe(FORM_ABUSE_CEILING_FLOOR)
  })

  it('caps an unlimited plan too, and never before the free wall on free', async () => {
    // Enterprise has no included band to exceed, so the plan gate can never
    // refuse it — an unlimited PLAN is not an unlimited tolerance for a bot.
    mockOrgPlan = 'enterprise'
    mockStore[counterPath] = { [MONTH]: 1_000_000 }
    expect(
      checkFormSubmissionQuota({ plan: 'enterprise' } as any, 1_000_000).allowed,
    ).toBe(true)
    expect((await submit()).status).toBe(429)
    expect(billedThisMonth()).toBe(1_000_000)

    // Free's own 20/month wall is far below the ceiling and still fires
    // first, with its own bodiless 429 — the ceiling did not move it.
    mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
    mockNotifications = []
    mockOrgPlan = 'free'
    mockStore[counterPath] = { [MONTH]: 20 }
    const walled = await submit()
    expect(walled.status).toBe(429)
    expect((await walled.json()).code).toBeUndefined()
    expect(mockStore[refusedPath]).toBeUndefined()
  })
})

/**
 * Honeypot instrumentation (AGL-1664).
 *
 * AGL-1664's decision — attestation or not — asked to be made on a MEASURED
 * bot rate, and the honeypot was the instrument it named. But the honeypot
 * path returned fake success and recorded nothing, so the bot rate it was
 * supposed to measure did not exist anywhere. These cases pin the fix: a hit
 * increments `counters/formSubmissionsSpam` (same per-month shape as
 * `formSubmissionsRefused`) and everything else about the path — the fake
 * success, the untouched billable counter, the silence toward managers —
 * stays exactly as it was.
 */
describe('AGL-1664 · honeypot hits are counted, not just dropped', () => {
  it('counts the hit per month and still pretends success', async () => {
    const response = await submit({ website: 'https://spam.example' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })

    // THE measurement: the hit left a per-host, per-month trace.
    expect(mockStore[spamPath][MONTH]).toBe(1)
    expect(typeof mockStore[spamPath].lastSpamAtMs).toBe('number')

    // And ONLY a trace — nothing stored, nothing billed, nobody notified.
    // The billable counter is the AGL-1655 invariant; the notification
    // silence is what keeps a flood of honeypot hits from becoming a flood
    // of alerts.
    expect(mockAddedSubmissions).toHaveLength(0)
    expect(billedThisMonth()).toBe(0)
    expect(mockNotifications).toHaveLength(0)

    await submit({ website: 'more spam' })
    expect(mockStore[spamPath][MONTH]).toBe(2)
  })

  it('writes nothing for an unknown or unusable host id', async () => {
    // An attacker spraying invented host ids must not be able to create
    // orphan counter documents under hosts that do not exist.
    const unknown = await submit({
      hostId: 'no-such-host',
      website: 'spam',
    })
    expect(unknown.status).toBe(200)
    expect(mockStore['hosts/no-such-host/counters/formSubmissionsSpam']).toBe(
      undefined,
    )

    // A missing host id has nowhere to count; the fake success still holds.
    const missing = await submit({ hostId: undefined, website: 'spam' })
    expect(missing.status).toBe(200)
    expect(await missing.json()).toEqual({ received: true })
  })
})

/**
 * What the refusal hands the VISITOR (AGL-1666).
 *
 * The body is read by a stranger to the site, so it is constrained in both
 * directions: it must carry enough for the component to say something useful
 * (the code, and a door that still opens) and nothing about why the site
 * stopped accepting. The copy itself lives in `@aglyn/aglyn`; what this
 * pins is which FIELDS cross the wire.
 */
describe('AGL-1666 · the refusal body a visitor receives', () => {
  it('carries the site’s published support address when it has one', async () => {
    mockStore[`hosts/${HOST_ID}`] = {
      name: 'Site',
      business: { supportEmail: '  help@northwind.example  ' },
    }
    mockStore[counterPath] = { [MONTH]: FORM_ABUSE_CEILING_FLOOR }

    const body = await (await submit()).json()
    expect(body.code).toBe(FORM_ABUSE_CEILING_CODE)
    // Trimmed by the host-token registry, which is also what defines this
    // field as the address a site publishes TO VISITORS.
    expect(body.contact).toBe('help@northwind.example')
  })

  it('omits the contact when the site publishes none', async () => {
    mockStore[counterPath] = { [MONTH]: FORM_ABUSE_CEILING_FLOOR }
    const body = await (await submit()).json()
    expect(body.code).toBe(FORM_ABUSE_CEILING_CODE)
    expect('contact' in body).toBe(false)
  })

  it('leaks nothing about the site’s account', async () => {
    mockStore[`hosts/${HOST_ID}`] = {
      name: 'Site',
      business: { supportEmail: 'help@northwind.example' },
      // Account data that sits on the same document and must not ride along.
      orgId: 'org-secret',
      subdomain: 'northwind',
    }
    mockStore[counterPath] = { [MONTH]: FORM_ABUSE_CEILING_FLOOR }

    const body = await (await submit()).json()
    // A closed set. Adding the count or the ceiling here would tell every
    // bot in the flood exactly how well it was doing, and every human
    // visitor something the owner never published.
    expect(Object.keys(body).sort()).toEqual(['code', 'contact', 'error'])
    expect(JSON.stringify(body)).not.toContain('org-secret')
    expect(JSON.stringify(body)).not.toContain(
      String(FORM_ABUSE_CEILING_FLOOR),
    )
  })
})
