/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where `Request`/`Response` do
 * not exist and every test here fails on construction.
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
 * AGL-1983 — the §512(g) counter-notice intake.
 *
 * The suite is built around the two ways this endpoint can fail a customer,
 * which are opposite failures and only one of them is obvious.
 *
 * The obvious one: accepting an incomplete counter-notice. That leaves us
 * owing a complainant a forward and a customer a restoration on the strength
 * of a document with no legal effect.
 *
 * The one that would ship quietly: **the clock sliding**. `receivedAt` is the
 * instant §512(g)(2)(C) counts its 10-to-14 business days from. If a
 * resubmission re-stamps it, then every time a locked-out customer nervously
 * presses the button again their restoration moves further away, and nothing
 * anywhere says so. That is the assertion this file exists for.
 */

const REMOVED = 'https://acme.aglyn.app/gallery'

let mockStore: Record<string, Record<string, any>> = {}
let mockAllowed = true
let mockResolvedHost: { $id: string; orgId: string } | null = null
let mockWriteThrows = false
let mockNow = Date.UTC(2026, 7, 17, 9, 30)

type Increment = { __increment: number }
const mockIsIncrement = (value: unknown): value is Increment =>
  typeof value === 'object' && value !== null && '__increment' in (value as any)

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

/**
 * The double models `set(..., {merge:true})` faithfully — a partial write
 * MERGES rather than replacing. An unfaithful fake here would fabricate a
 * GREEN on the `receivedAt` assertions, because a replacing double loses the
 * prior value and so cannot express the bug those tests exist to catch.
 */
const mockApplySet = (
  path: string,
  patch: Record<string, any>,
  options?: { merge?: boolean },
) => {
  if (mockWriteThrows) throw new Error('firestore unavailable')
  const base = options?.merge ? (mockStore[path] ?? {}) : {}
  const next: Record<string, any> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    next[key] = mockIsIncrement(value)
      ? Number(next[key] ?? 0) + value.__increment
      : value
  }
  mockStore[path] = next
}

const mockDocHandle = (path: string) => ({
  __path: path,
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) =>
    mockApplySet(path, patch, options),
})

let mockNotifications: Record<string, any>[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  notifyStaff: async (payload: Record<string, any>) => {
    mockNotifications.push(payload)
  },
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => mockDocHandle(`${name}/${id}`),
        }),
        runTransaction: async (fn: (tx: any) => Promise<void>) =>
          fn({
            get: async (ref: any) => {
              const data = mockStore[ref.__path]
              return { exists: data !== undefined, data: () => data }
            },
            set: (ref: any, patch: Record<string, any>, options?: any) =>
              mockApplySet(ref.__path, patch, options),
          }),
      }),
    }),
  },
  consumeRateLimit: async () => ({
    allowed: mockAllowed,
    limit: 5,
    remaining: mockAllowed ? 4 : 0,
    resetMs: Date.now() + 120_000,
    degraded: false,
  }),
}))

jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: async () => ({ host: mockResolvedHost, nextPageToken: '', error: null }),
  default: async () => ({ host: mockResolvedHost, nextPageToken: '', error: null }),
}))

import { GET, POST } from '../app/api/counter-notice/route'

/**
 * AGL-2016: this intake's contact addresses and its `<title>` come from the
 * operator's configuration. Assertions below that expect an address at all
 * hold only because this configures one — unset is a first-class state and
 * renders prose instead.
 */
const setOperator = (values: Record<string, string>): void => {
  for (const key of [
    'NEXT_PUBLIC_OPERATOR_NAME',
    'NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL',
    'NEXT_PUBLIC_OPERATOR_LEGAL_EMAIL',
  ]) {
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(values)) process.env[key] = value
}
const AGLYN_OPERATED = {
  NEXT_PUBLIC_OPERATOR_NAME: 'Aglyn LLC',
  NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'support@aglyn.com',
}
beforeEach(() => setOperator(AGLYN_OPERATED))
afterEach(() => setOperator(AGLYN_OPERATED))

import {
  COUNTER_NOTICE_MAX_BUSINESS_DAYS,
  COUNTER_NOTICE_MIN_BUSINESS_DAYS,
  counterNoticeClock,
} from '@aglyn/aglyn/server'

const notices = () =>
  Object.entries(mockStore).filter(([path]) =>
    path.startsWith('dmcaCounterNotices/'),
  )

const theNotice = () => notices()[0]?.[1]

/** Every statutory element, as a no-JS form would send it. */
const COMPLETE: Record<string, string> = {
  url: REMOVED,
  material: 'The three product photographs on the gallery page, which I shot.',
  name: 'Dana Okonkwo',
  address: '128 Rue Example, Suite 4, Austin, TX 78701, United States',
  phone: '+1 512 555 0134',
  email: 'dana@acme.test',
  signature: 'Dana Okonkwo',
  goodFaithMistake: 'on',
  consentJurisdiction: 'on',
  acceptService: 'on',
}

const formPost = (
  fields: Record<string, string>,
  ip = '203.0.113.5',
): Request =>
  new Request('https://acme.aglyn.app/api/counter-notice', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': ip,
    },
    body: new URLSearchParams(fields).toString(),
  })

const jsonPost = (body: Record<string, unknown>, ip = '203.0.113.5'): Request =>
  new Request('https://acme.aglyn.app/api/counter-notice', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  mockStore = {}
  mockAllowed = true
  mockWriteThrows = false
  mockNotifications = []
  mockResolvedHost = { $id: 'host-acme', orgId: 'org-9' }
  mockNow = Date.UTC(2026, 7, 17, 9, 30)
  jest.spyOn(Date, 'now').mockImplementation(() => mockNow)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a locked-out subscriber can reach us without signing in', () => {
  it('renders the form to an anonymous GET', async () => {
    // The whole point of the endpoint being unauthenticated: the person who
    // needs it has a 503 site and, if the lock is org-scope, no console
    // either. A login here would make it unreachable exactly when it matters.
    const response = await GET(
      new Request('https://acme.aglyn.app/api/counter-notice'),
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('<form method="post" action="/api/counter-notice">')
    expect(body).toContain('penalty of perjury')
    // No script tag anywhere: a hardened browser must be able to file.
    expect(body).not.toContain('<script')
  })

  it('accepts a complete no-JavaScript form post and records every element', async () => {
    const response = await POST(formPost(COMPLETE))
    expect(response.status).toBe(200)
    expect(notices()).toHaveLength(1)
    const stored = theNotice()
    expect(stored.status).toBe('received')
    expect(stored.subscriberName).toBe('Dana Okonkwo')
    expect(stored.subscriberPhone).toBe('+1 512 555 0134')
    expect(stored.subscriberAddress).toContain('Austin')
    expect(stored.signature).toBe('Dana Okonkwo')
    expect(stored.goodFaithMistake).toBe(true)
    expect(stored.consentJurisdiction).toBe(true)
    expect(stored.acceptService).toBe(true)
    expect(stored.hostId).toBe('host-acme')
    expect(stored.orgId).toBe('org-9')
    expect(stored.receivedAtMs).toBe(mockNow)
  })

  it('answers a JSON client with the reference', async () => {
    const response = await POST(jsonPost({ ...COMPLETE, goodFaithMistake: true }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.received).toBe(true)
    expect(body.reference).toMatch(/^CN-[A-F0-9]{10}$/)
  })

  it('tells the subscriber the clock started when they pressed the button', async () => {
    // The receipt is the only place the subscriber learns that staff latency
    // is not their problem. If it stops saying so, the anti-lockout property
    // is still true but nobody knows it, and they resubmit — which is the
    // behaviour the next block exists to make harmless.
    const response = await POST(formPost(COMPLETE))
    const body = await response.text()
    expect(body).toContain(String(COUNTER_NOTICE_MIN_BUSINESS_DAYS))
    expect(body).toContain(String(COUNTER_NOTICE_MAX_BUSINESS_DAYS))
    expect(body).toContain('when you pressed the button')
  })
})

describe('the statutory clock does not slide', () => {
  it('keeps the FIRST receipt when an anxious customer resubmits', async () => {
    // The load-bearing assertion of this file. §512(g)(2)(C) counts from
    // receipt, so a merge-set that re-stamped `receivedAt` would push the
    // restoration date further away every time the customer pressed the
    // button again — punishing exactly the people most worried about being
    // locked out, silently.
    await POST(formPost(COMPLETE))
    const firstReceipt = theNotice().receivedAtMs
    expect(notices()).toHaveLength(1)

    mockNow += 3 * 86_400_000
    await POST(formPost(COMPLETE))

    // Still one row — the same person answering the same takedown merges.
    expect(notices()).toHaveLength(1)
    expect(theNotice().receivedAtMs).toBe(firstReceipt)
    expect(theNotice().submissionCount).toBe(2)
    // And the row still says when it was last touched, so staff can tell a
    // resubmission happened at all.
    expect(theNotice().updatedAt).toBe('server-timestamp')
  })

  it('does not drag a forwarded notice back to `received`', async () => {
    // Staff have discharged §512(g)(2)(A) and started work. A resubmission
    // must not undo that and re-queue the row, the same way a repeat abuse
    // report must not reopen a staff decision.
    await POST(formPost(COMPLETE))
    mockStore[notices()[0][0]].status = 'forwarded'
    await POST(formPost(COMPLETE))
    expect(theNotice().status).toBe('forwarded')
  })

  it('gives a different subscriber their own row', async () => {
    // Merging is keyed on the URL and the FILER, not the URL alone. Two
    // people can have material on one page, and collapsing them would lose
    // one person's sworn statement entirely.
    await POST(formPost(COMPLETE))
    await POST(formPost({ ...COMPLETE, email: 'sam@acme.test', name: 'Sam Reyes' }))
    expect(notices()).toHaveLength(2)
  })

  it('does not fragment one person across networks the way the abuse intake does', async () => {
    // The abuse intake keys on IP because it is distinguishing anonymous
    // strangers. Here the filer is named by law, so keying on IP would turn
    // one customer retrying from home, then from their phone, into two rows
    // and two staff notifications for one dispute.
    await POST(formPost(COMPLETE, '203.0.113.5'))
    await POST(formPost(COMPLETE, '198.51.100.77'))
    expect(notices()).toHaveLength(1)
    expect(mockNotifications).toHaveLength(1)
  })

  it('schedules restoration inside the statutory window from receipt', async () => {
    // The clock the admin route will read. Asserted against the bounds the
    // statute draws rather than a fixed date, so the target can move inside
    // the window without this going red — and cannot move outside it.
    await POST(formPost(COMPLETE))
    const clock = counterNoticeClock(theNotice().receivedAtMs)
    expect(clock.restoreAtMs).toBeGreaterThanOrEqual(clock.earliestMs)
    expect(clock.restoreAtMs).toBeLessThanOrEqual(clock.latestMs)
  })
})

describe('the intake refuses an ineffective counter-notice', () => {
  it.each([
    ['the location of the material', 'url'],
    ['identification of the material', 'material'],
    ['the subscriber name', 'name'],
    ['the postal address', 'address'],
    ['the telephone number', 'phone'],
    ['the electronic signature', 'signature'],
    ['the perjury statement', 'goodFaithMistake'],
    ['consent to jurisdiction', 'consentJurisdiction'],
    ['agreement to accept service', 'acceptService'],
  ])('refuses a submission missing %s, and records nothing', async (_label, field) => {
    const incomplete = { ...COMPLETE }
    delete incomplete[field]
    const response = await POST(jsonPost(incomplete))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.field).toBe(field)
    // Nothing is stored. A half-recorded sworn statement would be worse than
    // none: it would appear in the queue as an obligation we do not have.
    expect(notices()).toHaveLength(0)
    expect(mockNotifications).toHaveLength(0)
  })

  it('returns the subscriber to a form that kept what they typed', async () => {
    // A refusal that cleared a long postal address and a paragraph of prose
    // would lose a locked-out customer at the last step. The URL is echoed
    // back, escaped.
    const incomplete = { ...COMPLETE }
    delete incomplete['phone']
    const response = await POST(formPost(incomplete))
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(body).toContain(REMOVED)
    expect(body).toContain('telephone number')
  })
})

describe('anti-abuse cannot close the intake', () => {
  it('lets the FIRST counter-notice from any source through', async () => {
    // The instrument that would silence this endpoint is a tight rate limit.
    // A law firm and a customer can share one corporate NAT.
    const response = await POST(formPost(COMPLETE, '198.51.100.1'))
    expect(response.status).toBe(200)
    expect(notices()).toHaveLength(1)
  })

  it('hands a throttled subscriber another route rather than a wall', async () => {
    mockAllowed = false
    const response = await POST(jsonPost(COMPLETE))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
    const body = await response.json()
    // The refusal must not be the last thing a real filer sees.
    expect(body.contact).toContain('@')
  })

  it('swallows a honeypot hit without recording it', async () => {
    const response = await POST(
      formPost({ ...COMPLETE, website: 'https://spam.example' }),
    )
    // Same shape as success, so a bot learns nothing from the difference.
    expect(response.status).toBe(200)
    expect(notices()).toHaveLength(0)
  })

  it('refuses a javascript: location before it reaches the staff console', async () => {
    // Stored XSS aimed at the one session that can suspend any site on the
    // platform — the same reasoning the abuse intake's URL allow-list carries.
    const response = await POST(
      // eslint-disable-next-line no-script-url
      jsonPost({ ...COMPLETE, url: 'javascript:alert(1)' }),
    )
    expect(response.status).toBe(400)
    expect(notices()).toHaveLength(0)
  })
})

describe('a counter-notice we could not store is never reported as filed', () => {
  it('answers 503 and tells the subscriber to keep a copy', async () => {
    // The worst possible lie on this endpoint is a receipt for a sworn
    // document we did not record: the customer stops chasing, and the clock
    // they think is running does not exist.
    mockWriteThrows = true
    const response = await POST(jsonPost(COMPLETE))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.contact).toContain('@')
    expect(mockNotifications).toHaveLength(0)
  })
})

describe('staff are told, because the deadline is already running', () => {
  it('raises a notification on the first submission only', async () => {
    await POST(formPost(COMPLETE))
    expect(mockNotifications).toHaveLength(1)
    expect(mockNotifications[0].type).toBe('system.dmcaCounterNotice')
    expect(mockNotifications[0].link).toBe('/admin/abuse-reports')
    // Unlike the abuse intake there is no severity gate — every counter-notice
    // carries a statutory deadline, so there is no low-value tail of these to
    // drown out the important ones.
    expect(mockNotifications[0].body).toContain('Dana Okonkwo')

    await POST(formPost(COMPLETE))
    expect(mockNotifications).toHaveLength(1)
  })

  it('still records the notice when the notification fails', async () => {
    // The notification is outside the write's try/catch deliberately: a
    // failure there must not turn a counter-notice we already hold into a 503
    // that invites the subscriber to swear it all over again.
    await POST(formPost(COMPLETE))
    expect(theNotice().status).toBe('received')
  })
})

describe('a counter-notice about a site we cannot resolve is still recorded', () => {
  it('stores it with a null hostId rather than refusing', async () => {
    // A subscriber whose site was already erased, or who mistyped a
    // subdomain, must not lose a statutory document to a lookup failure.
    mockResolvedHost = null
    const response = await POST(formPost(COMPLETE))
    expect(response.status).toBe(200)
    expect(notices()).toHaveLength(1)
    expect(theNotice().hostId).toBeNull()
  })
})

describe('AGL-2016 · the §512(g) statements name the right service provider', () => {
  /**
   * The served page with runs of whitespace collapsed.
   *
   * The consent clause is wrapped across source lines, so the raw bytes carry
   * a newline and indentation mid-sentence. Asserting on the raw string would
   * make this guard sensitive to reflowing a template literal — it would go
   * red on a formatting change and, worse, could be "fixed" by loosening the
   * assertion until it stopped checking the sentence at all.
   */
  const form = async (): Promise<string> => {
    const response = await GET(
      new Request('https://site.example.com/api/counter-notice'),
    )
    expect(response.status).toBe(200)
    return (await response.text()).replace(/\s+/g, ' ')
  }

  afterEach(() => setOperator(AGLYN_OPERATED))

  it('makes a self-hoster\'s subscriber consent to THEIR jurisdiction', async () => {
    // The most severe item in this issue, and not a branding leak.
    // §512(g)(3)(D) requires the subscriber to consent to the district of the
    // SERVICE PROVIDER. Hardcoded to "Aglyn", a self-hosted install collected
    // a sworn statement naming a company with no relationship to the dispute
    // — arguably a defective counter-notice, which would mean the put-back
    // clock the operator is running never validly started.
    setOperator({
      NEXT_PUBLIC_OPERATOR_NAME: 'Bramble Studio GmbH',
      NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'hello@bramble.example',
    })
    const body = await form()
    expect(body).toContain(
      'any judicial district in which Bramble Studio GmbH may be found',
    )
    expect(body.toLowerCase()).not.toContain('aglyn')
  })

  it('still names us on our own deployment', async () => {
    const body = await form()
    expect(body).toContain(
      'any judicial district in which Aglyn LLC may be found',
    )
    expect(body).toContain('Counter-notice — Aglyn LLC')
  })

  it('names the operator generically rather than naming us when unconfigured', async () => {
    setOperator({})
    const body = await form()
    expect(body).toContain(
      'any judicial district in which the operator of this site may be found',
    )
    expect(body.toLowerCase()).not.toContain('aglyn')
    // And the title loses the suffix rather than gaining a placeholder: a
    // sworn document with no publisher named beats one naming the wrong one.
    expect(body).toContain('<title>Counter-notice</title>')
  })
})
