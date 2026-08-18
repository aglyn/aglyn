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
 * AGL-1964 — the public abuse-report intake, guarded in BOTH directions.
 *
 * The deny direction is the easy half and the less important one. What this
 * suite is really for is the accept direction: an anonymous stranger's first
 * report must land. Every instrument on this endpoint — honeypot, rate limit,
 * validation — is a way for a real report to be lost, and a report lost is
 * the exact outcome the issue exists to prevent, because the reporter's next
 * step is a domain-level block on `*.aglyn.app` that takes every legitimate
 * customer down.
 *
 * So each hardening test below is paired with the legitimate case it must not
 * catch.
 */

const REPORTED = 'https://evil.aglyn.app/signin'

let mockStore: Record<string, Record<string, any>> = {}
let mockAllowed = true
let mockResolvedHost: { $id: string; orgId: string } | null = null
let mockWriteThrows = false

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
 * The fake has to model `set(..., {merge:true})` faithfully — a partial write
 * MERGES, it does not replace — or the `createdAt`/`status` assertions below
 * would pass against a double that cannot express the bug they exist to
 * catch.
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

// Mocked so the suite never reaches the render cache or Firestore for host
// resolution. `$id` is what `/admin/lockdown` takes, which is the only reason
// the route resolves a host at all.
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: async () => ({ host: mockResolvedHost, nextPageToken: '', error: null }),
  default: async () => ({ host: mockResolvedHost, nextPageToken: '', error: null }),
}))

import { GET, POST } from '../app/api/report-abuse/route'

const reports = () =>
  Object.entries(mockStore).filter(([path]) => path.startsWith('abuseReports/'))

const formPost = (
  fields: Record<string, string>,
  ip = '203.0.113.5',
): Request =>
  new Request('https://evil.aglyn.app/api/report-abuse', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': ip,
    },
    body: new URLSearchParams(fields).toString(),
  })

const jsonPost = (body: Record<string, unknown>, ip = '203.0.113.5'): Request =>
  new Request('https://evil.aglyn.app/api/report-abuse', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })

const PHISHING = {
  category: 'phishing',
  url: REPORTED,
  details: 'This page copies a bank sign-in and posts the credentials away.',
}

beforeEach(() => {
  mockStore = {}
  mockAllowed = true
  mockWriteThrows = false
  mockNotifications = []
  mockResolvedHost = { $id: 'host-evil', orgId: 'org-9' }
})

describe('an anonymous reporter can reach staff', () => {
  it('accepts a no-JavaScript form post and records it', async () => {
    const response = await POST(formPost(PHISHING))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    expect(reports()).toHaveLength(1)
    const [, row] = reports()[0]
    expect(row.status).toBe('open')
    expect(row.category).toBe('phishing')
    expect(row.severity).toBe('urgent')
    expect(row.url).toBe(REPORTED)
    // Resolved to the site staff would suspend — the field that makes the
    // report actionable rather than a piece of prose.
    expect(row.hostId).toBe('host-evil')
    expect(row.orgId).toBe('org-9')
    // No identity was given and none was demanded.
    expect(row.reporterEmail).toBeNull()
    expect(row.reporterName).toBeNull()

    // The reporter gets a reference back, in the page they can screenshot.
    const body = await response.text()
    expect(body).toContain(row.reference)
  })

  it('accepts a JSON post from an automated feed', async () => {
    const response = await POST(jsonPost(PHISHING))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.received).toBe(true)
    expect(body.reference).toMatch(/^AR-/)
    expect(reports()).toHaveLength(1)
  })

  it('serves the form to anyone, with no account and no token', async () => {
    const response = await GET(
      new Request('https://evil.aglyn.app/api/report-abuse'),
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    // Every category has to be offered, or a reporter picks the wrong one and
    // the queue mis-prioritises the urgent ones.
    for (const id of ['phishing', 'csam', 'malware', 'dmca']) {
      expect(body).toContain(`value="${id}"`)
    }
    // No script tag: the reporters this exists for are often on a hardened
    // browser, and a form that needs JS would refuse exactly them.
    expect(body).not.toContain('<script')
  })

  it('pre-fills the reported page behind two independent defenses', async () => {
    // `?url=` exists so the per-site affordance can carry the page the visitor
    // was looking at, which means an attacker controls it and it lands in an
    // HTML attribute. Two things stand in the way, and the test names both
    // because either alone would be enough to pass while the other rotted.
    const response = await GET(
      new Request(
        'https://evil.aglyn.app/api/report-abuse?url=' +
          encodeURIComponent('https://evil.aglyn.app/"><script>alert(1)</script>'),
      ),
    )
    const body = await response.text()
    expect(body).not.toContain('<script>alert(1)</script>')
    // 1. It is re-normalized through `new URL()`, which percent-encodes the
    //    breakout characters before escaping ever sees them.
    expect(body).toContain('%3Cscript%3E')
    expect(body).toContain('value="https://evil.aglyn.app/%22%3E')
  })

  it('pre-fills from the Referer, which is how the per-site badge carries the page', async () => {
    // The badge links to a bare `/api/report-abuse`. Reading
    // `window.location` to build a `?url=` would render '' on the server and
    // the real URL on the client — a hydration mismatch on every page that
    // shows the badge — so the header does the job instead.
    const response = await GET(
      new Request('https://evil.aglyn.app/api/report-abuse', {
        headers: { referer: 'https://evil.aglyn.app/signin?next=/account' },
      }),
    )
    const body = await response.text()
    expect(body).toContain(
      'value="https://evil.aglyn.app/signin?next=/account"',
    )
  })

  it('does not pre-fill with the report form itself', async () => {
    // Otherwise a reporter who navigated back to the form is shown its own
    // address as the thing they are reporting, and files a useless row.
    const response = await GET(
      new Request('https://evil.aglyn.app/api/report-abuse', {
        headers: { referer: 'https://evil.aglyn.app/api/report-abuse' },
      }),
    )
    expect(await response.text()).toContain('value=""')
  })

  it('drops a prefill that is not an http(s) URL rather than echoing it', async () => {
    // The second defense: anything `normalizeReportedUrl` refuses becomes an
    // empty value, so a `javascript:` prefill cannot be reflected at all.
    const response = await GET(
      new Request(
        'https://evil.aglyn.app/api/report-abuse?url=' +
          encodeURIComponent('javascript:alert(1)'),
      ),
    )
    const body = await response.text()
    expect(body).not.toContain('javascript:alert')
    expect(body).toContain('value=""')
  })

  it('records a report about a site we cannot resolve', async () => {
    // A mistyped subdomain, or a site already erased. Staff can read a wrong
    // URL; they cannot read a report that was refused.
    mockResolvedHost = null
    const response = await POST(formPost(PHISHING))
    expect(response.status).toBe(200)
    expect(reports()).toHaveLength(1)
    expect(reports()[0][1].hostId).toBeNull()
  })
})

describe('a takedown must not close the intake', () => {
  it('accepts a report about a host that is already suspended', async () => {
    // The single most likely subject of a report is a site staff has ALREADY
    // locked, and the most motivated reporter is the one who just saw the 503.
    // Every other public write on the tenant runtime refuses under lockdown
    // (`visitorWriteRefusal`); applying that here would be exactly backwards.
    mockResolvedHost = {
      $id: 'host-evil',
      orgId: 'org-9',
      ...({ suspendedAt: new Date(), suspendedReasonCode: 'abuse' } as any),
    }
    const response = await POST(formPost(PHISHING))
    expect(response.status).toBe(200)
    expect(reports()).toHaveLength(1)
  })

  it('never imports the visitor-write lockdown refusal', async () => {
    // The behavioural test above passes whether or not the refusal is wired,
    // because the fake host is not what a refusal would consult. This is the
    // assertion that actually bites: if someone "fixes" this route by adding
    // the standard guard every other public endpoint has, this goes red and
    // says why.
    const source: string = jest.requireActual('node:fs').readFileSync(
      require.resolve('../app/api/report-abuse/route'),
      'utf8',
    )
    expect(source).not.toMatch(/visitorWriteRefusal\s*\(/)
  })
})

describe('the flood is throttled without dropping the first report', () => {
  it('lands the first report and refuses the flood with a way out', async () => {
    // First: the limiter allows it, and it must land.
    const first = await POST(jsonPost(PHISHING))
    expect(first.status).toBe(200)
    expect(reports()).toHaveLength(1)

    // Then the limiter says no.
    mockAllowed = false
    const flooded = await POST(jsonPost({ ...PHISHING, url: REPORTED + '2' }))
    expect(flooded.status).toBe(429)
    expect(flooded.headers.get('retry-after')).toBeTruthy()
    // Nothing new was written…
    expect(reports()).toHaveLength(1)
    // …and the refused reporter is handed another route rather than a wall.
    // Anti-abuse that makes the abuse intake unreachable is a net loss.
    const body = await flooded.json()
    expect(body.contact).toBe('support@aglyn.com')
    expect(body.error).toContain('support@aglyn.com')
  })

  it('gives a throttled browser the form back with the message, not a blank 429', async () => {
    mockAllowed = false
    const response = await POST(formPost(PHISHING))
    expect(response.status).toBe(429)
    const body = await response.text()
    expect(body).toContain('support@aglyn.com')
    // The form is still on the page, so they can resubmit rather than
    // navigate back and retype everything.
    expect(body).toContain('name="details"')
  })
})

describe('the honeypot', () => {
  it('drops a bot silently and writes nothing', async () => {
    const response = await POST(
      formPost({ ...PHISHING, website: 'http://spam.example' }),
    )
    // Same shape as success, so a bot learns nothing from the difference.
    expect(response.status).toBe(200)
    expect(reports()).toHaveLength(0)
  })

  it('does not fire on an empty honeypot field', async () => {
    // A browser submits every field, including the hidden one, as ''. If an
    // empty string counted as a hit, the honeypot would silently eat every
    // real report — success-shaped, so nobody would ever notice.
    const response = await POST(formPost({ ...PHISHING, website: '' }))
    expect(response.status).toBe(200)
    expect(reports()).toHaveLength(1)
  })
})

describe('one reporter cannot make one site look widely reported', () => {
  it('merges a repeat of the same page and reason from the same source', async () => {
    await POST(jsonPost(PHISHING))
    await POST(jsonPost(PHISHING))
    await POST(jsonPost(PHISHING))
    expect(reports()).toHaveLength(1)
    expect(reports()[0][1].reportCount).toBe(3)
  })

  it('keeps reports from different sources apart', async () => {
    // `marketplaceReports` gets this property from the verified reporter uid.
    // There is no uid here, so it comes from the connection instead.
    await POST(jsonPost(PHISHING, '203.0.113.5'))
    await POST(jsonPost(PHISHING, '198.51.100.7'))
    expect(reports()).toHaveLength(2)
  })

  it('stores no IP address anywhere on the row', async () => {
    // The address is used for the rate-limit key and folded one-way into the
    // document id. It is personal data with no third use, so it is not kept.
    await POST(jsonPost(PHISHING, '203.0.113.5'))
    const serialized = JSON.stringify(reports()[0][1])
    expect(serialized).not.toContain('203.0.113.5')
  })
})

describe('a repeat cannot rewrite what staff already know', () => {
  it('stamps createdAt once, so "when did we first know" survives', async () => {
    // The merge-set this replaced re-stamped `createdAt` on every repeat, so a
    // row with reportCount 4 claimed to be created at the FOURTH report. That
    // is the one question the queue exists to answer afterwards, and the
    // reporter's own persistence was overwriting it.
    await POST(jsonPost(PHISHING))
    const [, first] = reports()[0]
    expect(first.createdAt).toBe('server-timestamp')

    // Second submission: `createdAt` must not be written at all this time.
    mockStore[reports()[0][0]].createdAt = 'FIRST-TIME-ONLY'
    await POST(jsonPost(PHISHING))
    expect(reports()[0][1].createdAt).toBe('FIRST-TIME-ONLY')
    expect(reports()[0][1].reportCount).toBe(2)
    // …while `updatedAt` does move, because a nudge is news.
    expect(reports()[0][1].updatedAt).toBe('server-timestamp')
  })

  it('does not re-open a report staff already closed', async () => {
    await POST(jsonPost(PHISHING))
    const id = reports()[0][0]
    // Staff dismiss it.
    mockStore[id].status = 'dismissed'
    // The same reporter files again. A resubmission must not undo the
    // decision and push the row back to the top of the queue.
    await POST(jsonPost(PHISHING))
    expect(reports()[0][1].status).toBe('dismissed')
    expect(reports()[0][1].reportCount).toBe(2)
  })
})

describe('urgent reports are pushed at staff, not left to be found', () => {
  it('notifies staff on a first urgent report', async () => {
    await POST(jsonPost(PHISHING))
    expect(mockNotifications).toHaveLength(1)
    expect(mockNotifications[0].type).toBe('system.abuseReportUrgent')
    expect(mockNotifications[0].link).toBe('/admin/abuse-reports')
    expect(mockNotifications[0].body).toContain('evil.aglyn.app')
  })

  it('stays quiet for the non-urgent categories', async () => {
    // The `formSubmissionsPaused` lesson: a flood of alerts IS the flood. If
    // spam reports notified, the notification would stop being read — and the
    // one it costs us is the phishing one.
    await POST(
      jsonPost({
        category: 'spam',
        url: 'https://junk.aglyn.app/',
        details: 'SEO doorway pages, nothing but keyword lists.',
      }),
    )
    expect(reports()).toHaveLength(1)
    expect(mockNotifications).toHaveLength(0)
  })

  it('does not let a reporter re-alert staff by resubmitting', async () => {
    await POST(jsonPost(PHISHING))
    await POST(jsonPost(PHISHING))
    await POST(jsonPost(PHISHING))
    expect(mockNotifications).toHaveLength(1)
  })
})

describe('the DMCA path', () => {
  const notice = {
    category: 'dmca',
    url: 'https://copycat.aglyn.app/gallery',
    details: 'Our photographs are republished here without a licence.',
    reporterEmail: 'legal@studio.example',
    dmcaWork: 'Photograph "Harbour at Dawn", VA 2-345-678.',
    dmcaSignature: 'Dana Reyes',
    dmcaGoodFaith: 'on',
    dmcaUnderPenalty: 'on',
  }

  it('records the statutory affirmations', async () => {
    const response = await POST(formPost(notice))
    expect(response.status).toBe(200)
    const [, row] = reports()[0]
    expect(row.category).toBe('dmca')
    expect(row.dmca.signature).toBe('Dana Reyes')
    expect(row.dmca.goodFaith).toBe(true)
    expect(row.dmca.underPenalty).toBe(true)
    expect(row.reporterEmail).toBe('legal@studio.example')
  })

  it('refuses an unsigned notice and says which field', async () => {
    const response = await POST(
      jsonPost({ ...notice, dmcaSignature: '', dmcaGoodFaith: true, dmcaUnderPenalty: true }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).field).toBe('dmcaSignature')
    expect(reports()).toHaveLength(0)
  })
})

describe('a storage failure is not silent', () => {
  it('tells the reporter to email us rather than pretending it landed', async () => {
    // The worst possible outcome for this endpoint is a receipt for a report
    // that was never stored — that is the AGL-1577 mail black hole, rebuilt
    // in HTTP.
    mockWriteThrows = true
    const response = await POST(jsonPost(PHISHING))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.contact).toBe('support@aglyn.com')
    expect(body.received).toBeUndefined()
  })
})
