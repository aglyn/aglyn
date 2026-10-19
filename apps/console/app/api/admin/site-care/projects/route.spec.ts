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
 * `/api/admin/site-care/projects` (AGL-3970): the staff "Charge for work".
 * Staff only; each action reaches its one function with the staff member as
 * the actor and the workspace it names, and a refusal keeps its status.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mocks = {
  checkSiteCareProjectPayments: jest.fn(),
  createSiteCareProject: jest.fn(),
  editSiteCareProject: jest.fn(),
  launchSiteCareProject: jest.fn(),
  readSiteCareProjects: jest.fn(),
  recordSiteCareProjectAcceptance: jest.fn(),
  resendSiteCareProjectInvoice: jest.fn(),
  retrySiteCareProjectInvoice: jest.fn(),
  reverseSiteCareProjectInvoice: jest.fn(),
  sendSiteCareProjectInvoice: jest.fn(),
}
const mockReadOrgBilling = jest.fn()

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
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
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
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
  return { __esModule: true, SiteCareError }
})

jest.mock('@aglyn/tenant-data-admin/server/site-care-projects', () => {
  const forward =
    (name: string) =>
    (...args: unknown[]) =>
      (mocks as Record<string, jest.Mock>)[name](...args)
  const names = [
    'checkSiteCareProjectPayments',
    'createSiteCareProject',
    'editSiteCareProject',
    'launchSiteCareProject',
    'readSiteCareProjects',
    'recordSiteCareProjectAcceptance',
    'resendSiteCareProjectInvoice',
    'retrySiteCareProjectInvoice',
    'reverseSiteCareProjectInvoice',
    'sendSiteCareProjectInvoice',
  ]
  return Object.fromEntries([['__esModule', true], ...names.map((name) => [name, forward(name)])])
})

import { SiteCareError } from '@aglyn/tenant-data-admin/server/site-care-requests'
import { GET, POST } from './route'

const STAFF = { uid: 'staff-1', email: 'staff@aglyn.com' }
const FIRESTORE = { fake: 'firestore' }

function get(query: string) {
  return GET(
    new Request(`https://console.test/api/admin/site-care/projects${query}`, { headers: { authorization: 'Bearer t' } }),
  )
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://console.test/api/admin/site-care/projects', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ ...STAFF, email_verified: true, staff: true })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_1' })
})

describe('staff only', () => {
  it('refuses a signed-in customer, even the owner', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1', email_verified: true })
    expect((await get('?orgId=org-1')).status).toBe(403)
    expect((await post({ action: 'sendInvoice', orgId: 'org-1', projectId: 'p1' })).status).toBe(403)
    expect(mocks.sendSiteCareProjectInvoice).not.toHaveBeenCalled()
  })

  it('needs a token and a workspace', async () => {
    expect((await GET(new Request('https://console.test/api/admin/site-care/projects?orgId=org-1'))).status).toBe(401)
    expect((await get('')).status).toBe(400)
  })
})

describe('GET', () => {
  it('reads the workspace’s projects and whether it can be invoiced', async () => {
    mocks.readSiteCareProjects.mockResolvedValue([{ projectId: 'p1' }])
    expect(await (await get('?orgId=org-1')).json()).toEqual({ projects: [{ projectId: 'p1' }], canInvoice: true })
    expect(mocks.readSiteCareProjects).toHaveBeenCalledWith(FIRESTORE, 'org-1')
    mockReadOrgBilling.mockResolvedValue({})
    expect((await (await get('?orgId=org-1')).json()).canInvoice).toBe(false)
  })
})

describe('POST actions', () => {
  it('quotes and edits with what staff typed', async () => {
    mocks.createSiteCareProject.mockResolvedValue({ projectId: 'p1' })
    mocks.editSiteCareProject.mockResolvedValue({ title: 'x' })
    const quote = { title: 'Page', scope: 'A page', kind: 'landingPage', estimatedHours: 2, priceUsd: 300 }
    await post({ action: 'create', orgId: 'org-1', ...quote })
    expect(mocks.createSiteCareProject).toHaveBeenCalledWith(FIRESTORE, { orgId: 'org-1', actor: STAFF, ...quote })
    await post({ action: 'edit', orgId: 'org-1', projectId: 'p1', reason: 'scope grew', ...quote })
    expect(mocks.editSiteCareProject).toHaveBeenCalledWith(FIRESTORE, {
      orgId: 'org-1',
      projectId: 'p1',
      actor: STAFF,
      reason: 'scope grew',
      ...quote,
    })
  })

  it('records the owner’s yes, invoices, launches and checks payments as the staff member', async () => {
    mocks.recordSiteCareProjectAcceptance.mockResolvedValue({ version: 1 })
    mocks.sendSiteCareProjectInvoice.mockResolvedValue({ seq: 1, status: 'open' })
    mocks.launchSiteCareProject.mockResolvedValue({ project: {}, invoice: null })
    mocks.checkSiteCareProjectPayments.mockResolvedValue({ recorded: 1 })
    const acceptance = { channel: 'phone', approvedAtMs: 1 }
    await post({ action: 'accept', orgId: 'org-1', projectId: 'p1', acceptance })
    expect(mocks.recordSiteCareProjectAcceptance).toHaveBeenCalledWith(FIRESTORE, {
      orgId: 'org-1',
      projectId: 'p1',
      actor: STAFF,
      acceptance,
    })
    expect(await (await post({ action: 'sendInvoice', orgId: 'org-1', projectId: 'p1' })).json()).toEqual({
      invoice: { seq: 1, status: 'open' },
    })
    await post({ action: 'launch', orgId: 'org-1', projectId: 'p1' })
    expect(mocks.launchSiteCareProject).toHaveBeenCalledWith(FIRESTORE, { orgId: 'org-1', projectId: 'p1', actor: STAFF })
    expect(await (await post({ action: 'checkPayments', orgId: 'org-1', projectId: 'p1' })).json()).toEqual({ recorded: 1 })
  })

  it('passes the invoice, the reversal and its reason', async () => {
    mocks.reverseSiteCareProjectInvoice.mockResolvedValue({ status: 'voided' })
    mocks.retrySiteCareProjectInvoice.mockResolvedValue({ status: 'open' })
    mocks.resendSiteCareProjectInvoice.mockResolvedValue({ sent: true, to: 'owner@example.com', subject: 's' })
    await post({ action: 'reverse', orgId: 'org-1', projectId: 'p1', seq: 2, reversal: 'void', reason: 'wrong scope' })
    expect(mocks.reverseSiteCareProjectInvoice).toHaveBeenCalledWith(FIRESTORE, {
      orgId: 'org-1',
      projectId: 'p1',
      seq: 2,
      actor: STAFF,
      action: 'void',
      reason: 'wrong scope',
    })
    await post({ action: 'retryInvoice', orgId: 'org-1', projectId: 'p1', seq: 1 })
    expect(mocks.retrySiteCareProjectInvoice).toHaveBeenCalledWith(FIRESTORE, {
      orgId: 'org-1',
      projectId: 'p1',
      seq: 1,
      actor: STAFF,
    })
    expect(await (await post({ action: 'resendInvoice', orgId: 'org-1', projectId: 'p1', seq: 1 })).json()).toEqual({
      sent: true,
      to: 'owner@example.com',
      reason: null,
    })
  })

  it('keeps a refusal’s status, and refuses a missing project, invoice or action', async () => {
    mocks.sendSiteCareProjectInvoice.mockRejectedValue(
      new SiteCareError('Record how and when the owner said yes before anything is invoiced.', 409),
    )
    const refused = await post({ action: 'sendInvoice', orgId: 'org-1', projectId: 'p1' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'Record how and when the owner said yes before anything is invoiced.' })
    expect((await post({ action: 'launch', orgId: 'org-1' })).status).toBe(400)
    expect((await post({ action: 'retryInvoice', orgId: 'org-1', projectId: 'p1' })).status).toBe(400)
    expect((await post({ action: 'delete', orgId: 'org-1', projectId: 'p1' })).status).toBe(400)
    expect(mocks.launchSiteCareProject).not.toHaveBeenCalled()
    expect(mocks.retrySiteCareProjectInvoice).not.toHaveBeenCalled()
  })

  it('hides an unexpected failure behind a 500', async () => {
    mocks.checkSiteCareProjectPayments.mockRejectedValue(new Error('boom: sk_live_secret'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await post({ action: 'checkPayments', orgId: 'org-1', projectId: 'p1' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Project action failed' })
    spy.mockRestore()
  })
})
