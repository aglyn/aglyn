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
 * OPENING A SYSTEM EMAIL FOR DESIGN, FROM A CLIENT THAT CANNOT ENCODE NODES.
 *
 * The staff Emails page makes two Firestore writes in the browser the first
 * time an email is designed. The native staff screens cannot encode the stored
 * nodes, so this route makes them. What is held here: staff only, an email
 * already designed is answered and not rewritten, and the first design writes
 * the version and the pointer together and is audited.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockTemplateGet = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn(async () => undefined)
const mockAudit = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: () => mockTemplateGet(),
            collection: () => ({ doc: () => ({ path: 'versions' }) }),
          }),
        }),
        batch: () => ({
          set: (...args: unknown[]) => mockBatchSet(...args),
          commit: () => mockBatchCommit(),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAudit(...args),
}))

import { POST } from '../app/api/admin/emails/open-version/route'

function request(body: unknown, token = 'token') {
  return new Request('https://app.aglyn.com/api/admin/emails/open-version', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
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

// An email Aglyn itself sends, so it has a body to design.
const EDITABLE_KEY = 'email-verification'

beforeEach(() => {
  jest.clearAllMocks()
  asStaff()
  mockTemplateGet.mockResolvedValue({
    exists: false,
    get: () => undefined,
  })
})

describe('POST /api/admin/emails/open-version', () => {
  it('refuses a caller who is not staff', async () => {
    asStaff(false)
    const response = await POST(request({ templateKey: EDITABLE_KEY }))
    expect(response.status).toBe(403)
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('refuses a key that is not an email Aglyn sends', async () => {
    const response = await POST(request({ templateKey: 'no-such-email' }))
    expect(response.status).toBe(400)
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('answers the version of an email already designed and writes nothing', async () => {
    mockTemplateGet.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'versionId' ? 'v-existing' : undefined),
    })
    const response = await POST(request({ templateKey: EDITABLE_KEY }))
    expect(await response.json()).toEqual({ versionId: 'v-existing', created: false })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('writes the version and the pointer together on the first design, and audits it', async () => {
    const response = await POST(request({ templateKey: EDITABLE_KEY }))
    const answer = await response.json()
    expect(answer.created).toBe(true)
    expect(typeof answer.versionId).toBe('string')
    // The version document and the template pointer, in one batch.
    expect(mockBatchSet).toHaveBeenCalledTimes(2)
    const [, version] = mockBatchSet.mock.calls[0]
    expect(version.templateKey).toBe(EDITABLE_KEY)
    expect(Buffer.isBuffer(version.nodes)).toBe(true)
    expect(mockBatchSet.mock.calls[1][1].versionId).toBe(answer.versionId)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'systemEmail.openVersion' }),
    )
  })
})
