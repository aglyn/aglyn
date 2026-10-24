/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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
 * `/api/site-care/requests` (AGL-3959): the owner's side. Any member may ask
 * for a change and ask whether Site Care is on; only `billing.view` reads the
 * statement, and the statement never shows a staff address, a Stripe id or a
 * row about an email that did not go.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockMemberHasOrgPermission = jest.fn()
const mockOpen = jest.fn()
const mockReadMonth = jest.fn()
const mockReadProjects = jest.fn()
let mockOrg: Record<string, unknown> | null = null
let mockHasSiteCare = true

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/site-care'),
  pluginRequestFromWeb: jest.requireActual('@aglyn/aglyn/app-utils/api-adapter').pluginRequestFromWeb,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({}),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  memberHasOrgPermission: (...args: unknown[]) => mockMemberHasOrgPermission(...args),
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/site-care-requests', () => {
  class SiteCareError extends Error {
    constructor(
      message: string,
      readonly status = 400,
      readonly detail: Record<string, unknown> | null = null,
    ) {
      super(message)
    }
  }
  return {
    __esModule: true,
    SiteCareError,
    openSiteCareRequest: (...args: unknown[]) => mockOpen(...args),
    orgHasSiteCare: () => mockHasSiteCare,
    readSiteCareMonth: (...args: unknown[]) => mockReadMonth(...args),
    readSiteCareOrg: async () => mockOrg,
    siteCareStatementLine: (view: { subject: string }) => `${view.subject}: line`,
  }
})

jest.mock('@aglyn/tenant-data-admin/server/site-care-projects', () => ({
  __esModule: true,
  readSiteCareProjects: (...args: unknown[]) => mockReadProjects(...args),
}))

import { siteCareMonthStatement } from '@aglyn/aglyn/app-utils/site-care'
import { siteCareProjectQuote } from '@aglyn/aglyn/app-utils/site-care-project'
import { SiteCareError } from '@aglyn/tenant-data-admin/server/site-care-requests'
import { GET, POST } from './route'

function call(method: 'GET' | 'POST', query: string, body?: unknown, token = 'token') {
  return new Request(`https://console.test/api/site-care/requests${query}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1', email: 'owner@example.com', email_verified: true })
  mockResolveOrgMembership.mockResolvedValue({ orgId: 'org-1', member: { role: 'owner' } })
  mockMemberHasOrgPermission.mockResolvedValue(true)
  mockOrg = { $id: 'org-1', name: 'Acme Builders' }
  mockHasSiteCare = true
  mockOpen.mockResolvedValue({ ticketId: 'ticket-1', dueAtMs: Date.UTC(2026, 9, 21, 15) })
})

describe('who may call', () => {
  it('needs a token and a workspace', async () => {
    expect((await POST(call('POST', '?orgId=org-1', { subject: 'x' }, ''))).status).toBe(401)
    expect((await GET(call('GET', ''))).status).toBe(400)
  })

  it('refuses a non-member who is not staff', async () => {
    mockResolveOrgMembership.mockResolvedValue(null)
    expect((await GET(call('GET', '?orgId=org-1&view=status'))).status).toBe(403)
  })

  it('refuses an unverified address', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1', email_verified: false })
    expect((await GET(call('GET', '?orgId=org-1&view=status'))).status).toBe(403)
  })
})

describe('POST: request a change', () => {
  it('opens the request as the signed-in member, from the console', async () => {
    const response = await POST(call('POST', '', { orgId: 'org-1', hostId: 'host-1', subject: 'Hours', body: 'Now 9–6' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ticketId: 'ticket-1', dueAt: expect.stringContaining('Oct 21, 2026') })
    expect(mockOpen).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        orgId: 'org-1',
        hostId: 'host-1',
        subject: 'Hours',
        body: 'Now 9–6',
        requester: { uid: 'owner-1', email: 'owner@example.com' },
        source: 'console',
      }),
    )
  })

  it('refuses a workspace without Site Care', async () => {
    mockHasSiteCare = false
    expect((await POST(call('POST', '', { orgId: 'org-1', subject: 'Hours', body: 'x' }))).status).toBe(403)
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('answers a refusal with its own status', async () => {
    mockOpen.mockRejectedValue(new SiteCareError('Describe the change.', 400))
    const response = await POST(call('POST', '', { orgId: 'org-1', subject: 'Hours', body: '' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Describe the change.' })
  })

  it('404s an unknown workspace', async () => {
    mockOrg = null
    expect((await POST(call('POST', '', { orgId: 'org-1', subject: 'Hours', body: 'x' }))).status).toBe(404)
  })
})

describe('GET', () => {
  it('says whether Site Care is on, to any member', async () => {
    mockMemberHasOrgPermission.mockResolvedValue(false)
    const response = await GET(call('GET', '?orgId=org-1&view=status'))
    expect(await response.json()).toEqual({ siteCare: true })
  })

  it('needs billing.view for the statement', async () => {
    mockMemberHasOrgPermission.mockResolvedValue(false)
    expect((await GET(call('GET', '?orgId=org-1&month=2026-10'))).status).toBe(403)
    expect(mockReadMonth).not.toHaveBeenCalled()
  })

  it('refuses an unreadable month', async () => {
    expect((await GET(call('GET', '?orgId=org-1&month=2026-13'))).status).toBe(400)
  })

  it('tells the month in the owner’s words only', async () => {
    const row = (atMs: number, kind: string, summary: string) => ({
      $id: `r${atMs}`,
      atMs,
      kind,
      summary,
      reason: null,
      byUid: 'staff-1',
      byEmail: 'staff@aglyn.com',
      before: null,
      after: null,
      stripe: { object: 'invoiceitem', id: 'ii_secret' },
      subjectId: null,
    })
    mockReadMonth.mockResolvedValue({
      orgId: 'org-1',
      month: '2026-10',
      goodwillMinutes: 0,
      statement: siteCareMonthStatement({ month: '2026-10', goodwillMinutes: 0, requests: [] }),
      monthHistory: [row(3, 'goodwill.added', 'Added 30 min.')],
      requests: [
        {
          ticketId: 't1',
          subject: 'Hours',
          status: 'closed',
          request: { state: 'closed', closedAtMs: 2, minutesLogged: 90, includedMinutesUsed: 60, billedHours: 1, charge: { status: 'pending' } },
          history: [row(1, 'request.opened', 'Asked.'), row(2, 'email.notSent', 'Not sent.')],
        },
      ],
    })
    const response = await GET(call('GET', '?orgId=org-1&month=2026-10'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.history).toEqual([
      { atMs: 1, summary: 'Asked.', reason: null },
      { atMs: 3, summary: 'Added 30 min.', reason: null },
    ])
    expect(body.requests).toEqual([
      expect.objectContaining({ ticketId: 't1', title: 'Hours', charge: 'On your next invoice', line: 'Hours: line' }),
    ])
    const text = JSON.stringify(body)
    expect(text).not.toContain('staff@aglyn.com')
    expect(text).not.toContain('ii_secret')
  })
})

describe('GET view=projects (AGL-3970)', () => {
  const quote = (() => {
    const read = siteCareProjectQuote({ kind: 'redesign', estimatedHours: 2 })
    if (read.ok === false) throw new Error(read.error)
    return read.quote
  })()
  const invoice = (seq: number, status: string, url: string | null) => ({
    seq,
    kind: seq === 1 ? 'deposit' : 'final',
    status,
    amountCents: 37450,
    invoiceId: `in_secret_${seq}`,
    hostedInvoiceUrl: url,
    number: `N-${seq}`,
  })

  it('needs billing.view, with or without Site Care', async () => {
    mockMemberHasOrgPermission.mockResolvedValue(false)
    expect((await GET(call('GET', '?orgId=org-1&view=projects'))).status).toBe(403)
    expect(mockReadProjects).not.toHaveBeenCalled()
    mockMemberHasOrgPermission.mockResolvedValue(true)
    mockHasSiteCare = false
    mockReadProjects.mockResolvedValue([])
    expect(await (await GET(call('GET', '?orgId=org-1&view=projects'))).json()).toEqual({ projects: [] })
  })

  it('lists each project as a past charge in the owner’s words, with the pay link only while unpaid', async () => {
    mockReadProjects.mockResolvedValue([
      {
        projectId: 'p1',
        project: {
          title: 'New site',
          scope: ['Home page', 'About page'],
          quote,
          status: 'deposit-paid',
          createdAtMs: 1,
          invoices: [
            invoice(1, 'paid', 'https://invoice.stripe.com/i/paid'),
            invoice(2, 'open', 'https://invoice.stripe.com/i/open'),
            invoice(3, 'failed', null),
          ],
        },
        history: [
          { atMs: 1, kind: 'project.quoted', summary: 'Quoted.', reason: null, byEmail: 'staff@aglyn.com', stripe: null },
          { atMs: 2, kind: 'invoice.requested', summary: 'Raising.', reason: null, byEmail: 'staff@aglyn.com', stripe: null },
          { atMs: 3, kind: 'invoice.sent', summary: 'Sent.', reason: null, byEmail: 'staff@aglyn.com', stripe: { object: 'invoice', id: 'in_secret_1' } },
          { atMs: 4, kind: 'email.notSent', summary: 'Not sent.', reason: null, byEmail: null, stripe: null },
        ],
      },
    ])
    const body = await (await GET(call('GET', '?orgId=org-1&view=projects'))).json()
    expect(body.projects).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        title: 'New site',
        scope: ['Home page', 'About page'],
        split: '$749: half ($374.50) before work starts and half ($374.50) at launch.',
        statusLabel: 'Deposit paid',
        invoices: [
          { seq: 1, line: 'Deposit $374.50: paid', number: 'N-1', payUrl: null },
          { seq: 2, line: 'Balance $374.50: waiting for payment', number: 'N-2', payUrl: 'https://invoice.stripe.com/i/open' },
        ],
        history: [
          { atMs: 1, summary: 'Quoted.', reason: null },
          { atMs: 3, summary: 'Sent.', reason: null },
        ],
      }),
    ])
    const text = JSON.stringify(body)
    expect(text).not.toContain('staff@aglyn.com')
    expect(text).not.toContain('in_secret')
  })
})
