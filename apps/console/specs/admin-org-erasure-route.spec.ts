/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment (see admin-email-send-rate-route.spec.ts).
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
 * REQUESTING AN ORGANIZATION'S ERASURE FROM A CLIENT WITHOUT AN ATOMIC BATCH.
 *
 * The staff organization page writes the `erasureRequestedAt` flag and its
 * audit row in one browser batch. The native staff screens call this route for
 * the same two writes. What is held here: staff only, an action the org is
 * already in changes nothing, and a change writes the flag and the audit row
 * in ONE batch (so the flag never lands without its row).
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockOrgGet = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn(async () => undefined)
const mockAudit = jest.fn()
const mockNotify = jest.fn(async (..._args: unknown[]) =>
  Response.json({ ok: true, emailed: true }),
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: () => mockOrgGet() }) }),
        batch: () => ({
          set: (...args: unknown[]) => mockBatchSet(...args),
          commit: () => mockBatchCommit(),
        }),
      }),
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => 'NOW', delete: () => 'DELETE' },
    },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  setAdminAudit: (...args: unknown[]) => mockAudit(...args),
}))
jest.mock('../app/api/admin/erasure-request/route', () => ({
  __esModule: true,
  POST: (...args: unknown[]) => mockNotify(...args),
}))

import { POST } from '../app/api/admin/org-erasure/route'

function request(body: unknown) {
  return new Request('https://app.aglyn.com/api/admin/org-erasure', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function asStaff(staff = true) {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff,
  })
}

function orgWith(requested: boolean) {
  mockOrgGet.mockResolvedValue({
    exists: true,
    get: (field: string) => (field === 'erasureRequestedAt' && requested ? 'then' : undefined),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  asStaff()
  orgWith(false)
})

describe('POST /api/admin/org-erasure', () => {
  it('refuses a caller who is not staff', async () => {
    asStaff(false)
    const response = await POST(request({ orgId: 'o1', action: 'request' }))
    expect(response.status).toBe(403)
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('refuses an action it does not know', async () => {
    const response = await POST(request({ orgId: 'o1', action: 'delete' }))
    expect(response.status).toBe(400)
  })

  it('writes the flag and the audit row in one batch, then tells the owner', async () => {
    const response = await POST(request({ orgId: 'o1', action: 'request' }))
    expect(await response.json()).toEqual({ ok: true, changed: true, requested: true, emailed: true })
    expect(mockBatchSet).toHaveBeenCalledTimes(1)
    expect(mockBatchSet.mock.calls[0][1]).toMatchObject({ erasureRequestedAt: 'NOW' })
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'org.erasureRequested', target: 'orgs/o1' }),
    )
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('cancels a standing request without telling the owner', async () => {
    orgWith(true)
    const response = await POST(request({ orgId: 'o1', action: 'cancel' }))
    expect(await response.json()).toMatchObject({ changed: true, requested: false, emailed: null })
    expect(mockBatchSet.mock.calls[0][1]).toMatchObject({ erasureRequestedAt: 'DELETE' })
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'org.erasureCanceled' }),
    )
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('changes nothing when the organization is already where the action leads', async () => {
    orgWith(true)
    const response = await POST(request({ orgId: 'o1', action: 'request' }))
    expect(await response.json()).toEqual({ ok: true, changed: false, requested: true })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })
})
