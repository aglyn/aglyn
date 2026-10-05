/**
 * @jest-environment node
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
 * AGL-3466 — `/api/admin/org-upgrade-proposal`: only staff ask a workspace
 * to upgrade, and a refused proposal is a 4xx that says why. What the
 * proposal writes, audits and mails is pinned against the library in
 * `libs/tenant/data/admin/src/lib/server/upgrade-proposal.spec.ts`.
 */

const mockVerifyIdToken = jest.fn()
const mockPropose = jest.fn()
const mockWithdraw = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => {
  class UpgradeProposalError extends Error {
    readonly status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  }
  return {
    __esModule: true,
    UpgradeProposalError,
    emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
    isImpersonationSession: () => false,
    proposeOrgUpgrade: (...args: unknown[]) => mockPropose(...args),
    withdrawOrgUpgrade: (...args: unknown[]) => mockWithdraw(...args),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      }),
    },
  }
})
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers.entries()),
  }),
}))

import { UpgradeProposalError } from '@aglyn/tenant-data-admin'
import { POST } from '../app/api/admin/org-upgrade-proposal/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/admin/org-upgrade-proposal', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        origin: 'https://app.aglyn.com',
      },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'zed@aglyn.test',
    email_verified: true,
    staff: true,
  })
  mockPropose.mockResolvedValue({ proposal: { plan: 'starter' }, emailed: true })
  mockWithdraw.mockResolvedValue(true)
})

describe('asking a workspace to upgrade (AGL-3466)', () => {
  it('staff propose a plan, with the console origin for the email link', async () => {
    const response = await post({ action: 'propose', plan: 'starter', note: 'as agreed' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, emailed: true })
    expect(mockPropose).toHaveBeenCalledWith({
      orgId: 'org-1',
      plan: 'starter',
      note: 'as agreed',
      actor: { uid: 'staff-1', email: 'zed@aglyn.test' },
      origin: 'https://app.aglyn.com',
    })
  })

  it('staff withdraw it', async () => {
    const response = await post({ action: 'withdraw' })
    expect(await response.json()).toEqual({ ok: true, withdrawn: true })
  })

  it('nobody else can, owner included', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner', email_verified: true })
    expect((await post({ action: 'propose', plan: 'starter' })).status).toBe(403)
    expect((await post({ action: 'withdraw' })).status).toBe(403)
    expect(mockPropose).not.toHaveBeenCalled()
    expect(mockWithdraw).not.toHaveBeenCalled()
  })

  it('a refused proposal answers with its own status and reason', async () => {
    mockPropose.mockRejectedValue(
      new UpgradeProposalError('This workspace already has a live subscription', 409),
    )
    const response = await post({ action: 'propose', plan: 'starter' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'This workspace already has a live subscription',
    })
  })

  it('refuses an unknown action and a missing org', async () => {
    expect((await post({ action: 'grant' })).status).toBe(400)
    expect((await post({ action: 'propose', orgId: '' })).status).toBe(400)
  })
})
