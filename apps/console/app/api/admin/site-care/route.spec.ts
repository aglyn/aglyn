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
 * `/api/admin/site-care` (AGL-3959): every staff change to a Site Care
 * request. Staff only; each action reaches its one function with the staff
 * member as the actor, and a close blocked by the included hour answers 409
 * with `blocked`, which the panel reads as "Ask the owner first" / "Absorb it".
 */

export {}

const mockVerifyIdToken = jest.fn()
const mocks = {
  addSiteCareGoodwill: jest.fn(),
  closeSiteCareRequest: jest.fn(),
  correctSiteCareMinutes: jest.fn(),
  moveSiteCareRequest: jest.fn(),
  readSiteCareMonth: jest.fn(),
  readSiteCareRequestPanel: jest.fn(),
  recordSiteCareApproval: jest.fn(),
  retrySiteCareCharge: jest.fn(),
  reverseSiteCareCharge: jest.fn(),
  sendSiteCareQuote: jest.fn(),
  sendSiteCareStatement: jest.fn(),
  startSiteCareTimer: jest.fn(),
}

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
      firestore: () => ({ fake: 'firestore' }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
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
  const forward =
    (name: string) =>
    (...args: unknown[]) =>
      (mocks as Record<string, jest.Mock>)[name](...args)
  return {
    __esModule: true,
    SiteCareError,
    orgHasSiteCare: () => true,
    readSiteCareOrg: async () => ({ $id: 'org-1' }),
    addSiteCareGoodwill: forward('addSiteCareGoodwill'),
    closeSiteCareRequest: forward('closeSiteCareRequest'),
    correctSiteCareMinutes: forward('correctSiteCareMinutes'),
    moveSiteCareRequest: forward('moveSiteCareRequest'),
    readSiteCareMonth: forward('readSiteCareMonth'),
    readSiteCareRequestPanel: forward('readSiteCareRequestPanel'),
    recordSiteCareApproval: forward('recordSiteCareApproval'),
    retrySiteCareCharge: forward('retrySiteCareCharge'),
    reverseSiteCareCharge: forward('reverseSiteCareCharge'),
    sendSiteCareQuote: forward('sendSiteCareQuote'),
    sendSiteCareStatement: forward('sendSiteCareStatement'),
    startSiteCareTimer: forward('startSiteCareTimer'),
  }
})

import { SiteCareError } from '@aglyn/tenant-data-admin/server/site-care-requests'
import { GET, POST } from './route'

const STAFF = { uid: 'staff-1', email: 'staff@aglyn.com' }
const FIRESTORE = { fake: 'firestore' }

function get(query: string) {
  return GET(new Request(`https://console.test/api/admin/site-care${query}`, { headers: { authorization: 'Bearer t' } }))
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://console.test/api/admin/site-care', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ ...STAFF, email_verified: true, staff: true })
})

describe('staff only', () => {
  it('refuses a signed-in customer', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1', email_verified: true })
    expect((await get('?ticketId=t1')).status).toBe(403)
    expect((await post({ action: 'close', ticketId: 't1', minutes: 30 })).status).toBe(403)
    expect(mocks.closeSiteCareRequest).not.toHaveBeenCalled()
  })

  it('needs a token', async () => {
    const response = await GET(new Request('https://console.test/api/admin/site-care?ticketId=t1'))
    expect(response.status).toBe(401)
  })
})

describe('GET', () => {
  it('reads one request’s panel', async () => {
    mocks.readSiteCareRequestPanel.mockResolvedValue({ ticketId: 't1' })
    const response = await get('?ticketId=t1')
    expect(await response.json()).toEqual({ ticketId: 't1' })
    expect(mocks.readSiteCareRequestPanel).toHaveBeenCalledWith(FIRESTORE, 't1')
  })

  it('reads a workspace’s month, and refuses an unreadable one', async () => {
    mocks.readSiteCareMonth.mockResolvedValue({ orgId: 'org-1', month: '2026-10' })
    const response = await get('?orgId=org-1&month=2026-10')
    expect(await response.json()).toEqual({ orgId: 'org-1', month: '2026-10', siteCare: true })
    expect((await get('?orgId=org-1&month=October')).status).toBe(400)
    expect((await get('')).status).toBe(400)
  })
})

describe('POST actions', () => {
  it('starts the timer and closes as the staff member', async () => {
    mocks.startSiteCareTimer.mockResolvedValue({ state: 'open' })
    mocks.closeSiteCareRequest.mockResolvedValue({ request: { state: 'closed' }, statement: {} })
    await post({ action: 'start', ticketId: 't1' })
    expect(mocks.startSiteCareTimer).toHaveBeenCalledWith(FIRESTORE, { ticketId: 't1', actor: STAFF })
    await post({ action: 'close', ticketId: 't1', minutes: 45, absorb: true })
    expect(mocks.closeSiteCareRequest).toHaveBeenCalledWith(FIRESTORE, {
      ticketId: 't1',
      actor: STAFF,
      minutes: 45,
      absorb: true,
    })
  })

  it('answers a blocked close with 409 and the verdict', async () => {
    const blocked = { ok: false, reason: 'no-approval', requiredHours: 1, approvedHours: null }
    mocks.closeSiteCareRequest.mockRejectedValue(new SiteCareError('Ask the owner first, or absorb it.', 409, { blocked }))
    const response = await post({ action: 'close', ticketId: 't1', minutes: 90 })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Ask the owner first, or absorb it.', blocked })
  })

  it('records an approval with what staff typed', async () => {
    mocks.recordSiteCareApproval.mockResolvedValue({ hours: 2 })
    const approval = { hours: 2, channel: 'phone', approvedAtMs: 1 }
    const response = await post({ action: 'approve', ticketId: 't1', approval })
    expect(await response.json()).toEqual({ approval: { hours: 2 } })
    expect(mocks.recordSiteCareApproval).toHaveBeenCalledWith(FIRESTORE, { ticketId: 't1', actor: STAFF, approval })
  })

  it('passes the reason on every correction', async () => {
    mocks.correctSiteCareMinutes.mockResolvedValue({})
    mocks.reverseSiteCareCharge.mockResolvedValue({ status: 'voided' })
    mocks.addSiteCareGoodwill.mockResolvedValue({ goodwillMinutes: 30 })
    await post({ action: 'correctMinutes', ticketId: 't1', minutes: 60, reason: 'typo' })
    expect(mocks.correctSiteCareMinutes).toHaveBeenCalledWith(FIRESTORE, {
      ticketId: 't1',
      actor: STAFF,
      minutes: 60,
      reason: 'typo',
    })
    await post({ action: 'reverseCharge', ticketId: 't1', reason: 'ours' })
    expect(mocks.reverseSiteCareCharge).toHaveBeenCalledWith(FIRESTORE, {
      ticketId: 't1',
      actor: STAFF,
      reason: 'ours',
      absorb: false,
    })
    await post({ action: 'goodwill', orgId: 'org-1', month: '2026-10', minutes: 30, reason: 'slow week' })
    expect(mocks.addSiteCareGoodwill).toHaveBeenCalledWith(FIRESTORE, {
      orgId: 'org-1',
      month: '2026-10',
      minutes: 30,
      reason: 'slow week',
      actor: STAFF,
    })
  })

  it('sends a statement and a quote, saying whether each went', async () => {
    mocks.sendSiteCareStatement.mockResolvedValue({ sent: true, to: 'owner@example.com', subject: 's' })
    mocks.sendSiteCareQuote.mockResolvedValue({ sent: false, to: null, subject: 's', reason: 'no-recipient' })
    expect(await (await post({ action: 'sendStatement', orgId: 'org-1', month: '2026-10' })).json()).toEqual({
      sent: true,
      to: 'owner@example.com',
      reason: null,
    })
    expect((await post({ action: 'sendStatement', orgId: 'org-1', month: 'x' })).status).toBe(400)
    expect(
      await (await post({ action: 'sendQuote', ticketId: 't1', amountUsd: 450, scope: 'A new page' })).json(),
    ).toEqual({ sent: false, to: null, reason: 'no-recipient' })
  })

  it('moves a request to the workspace staff chose, and passes a refusal through', async () => {
    mocks.moveSiteCareRequest.mockResolvedValue({ request: { state: 'open' }, fromOrgId: 'org-1', orgId: 'org-2' })
    const response = await post({ action: 'move', ticketId: 't1', orgId: 'org-2' })
    expect(await response.json()).toEqual({ request: { state: 'open' }, fromOrgId: 'org-1', orgId: 'org-2' })
    expect(mocks.moveSiteCareRequest).toHaveBeenCalledWith(FIRESTORE, { ticketId: 't1', actor: STAFF, orgId: 'org-2' })
    mocks.moveSiteCareRequest.mockRejectedValue(new SiteCareError('This request is finished.', 409))
    const refused = await post({ action: 'move', ticketId: 't1', orgId: 'org-2' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'This request is finished.' })
    expect((await post({ action: 'move', orgId: 'org-2' })).status).toBe(400)
  })

  it('refuses an unknown action and a missing ticket', async () => {
    expect((await post({ action: 'delete', ticketId: 't1' })).status).toBe(400)
    expect((await post({ action: 'retryCharge' })).status).toBe(400)
    expect(mocks.retrySiteCareCharge).not.toHaveBeenCalled()
  })

  it('hides an unexpected failure behind a 500', async () => {
    mocks.retrySiteCareCharge.mockRejectedValue(new Error('boom: sk_live_secret'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await post({ action: 'retryCharge', ticketId: 't1' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Site Care action failed' })
    spy.mockRestore()
  })
})
