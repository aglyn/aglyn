/**
 * @jest-environment node
 *
 * (The pragma must live in the FIRST docblock — a separate license block
 * above it would shadow it and the suite would run in jsdom, which has no
 * `Request` constructor.)
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

const mockVerifyIdToken = jest.fn()
const mockConsumeRateLimit = jest.fn(async () => ({ allowed: true }))
jest.mock('@aglyn/tenant-data-admin', () => ({
  consumeRateLimit: (...args: unknown[]) =>
    mockConsumeRateLimit(...(args as [])),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => ({}),
    }),
  },
}))
// `after()` runs its callback immediately here so the alert send is
// observable synchronously in the spec.
jest.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => void fn(),
}))
const mockSendPasskeyAddedAlert = jest.fn(
  async (_details: unknown) => ({ sent: true }),
)
jest.mock('../../../../_lib/security-alerts', () => ({
  formatAlertTime: () => 'Aug 8, 2026, 8:00 PM UTC',
  sendPasskeyAddedAlert: (details: unknown) =>
    mockSendPasskeyAddedAlert(details as never),
}))
const mockVerifyAndStoreRegistration = jest.fn()
jest.mock('../../../../_lib/passkeys', () => {
  const actual = jest.requireActual('../../../../_lib/passkeys')
  return {
    PasskeyError: actual.PasskeyError,
    verifyAndStoreRegistration: (params: unknown) =>
      mockVerifyAndStoreRegistration(params as never),
  }
})

import { POST } from './route'
import { PasskeyError } from '../../../../_lib/passkeys'

function request(body: unknown, token = 'good-token'): Request {
  return new Request('https://app.aglyn.com/api/auth/passkeys/register/verify', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://app.aglyn.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = { challengeId: 'ch-1', response: { id: 'cred-1' } }

beforeEach(() => {
  jest.clearAllMocks()
  mockConsumeRateLimit.mockResolvedValue({ allowed: true } as never)
  mockVerifyIdToken.mockResolvedValue({
    uid: 'user-1',
    email: 'a@b.co',
    email_verified: true,
    firebase: {},
  })
  mockVerifyAndStoreRegistration.mockResolvedValue({
    credentialId: 'cred-1',
    label: 'My MacBook',
  })
})

describe('POST /api/auth/passkeys/register/verify', () => {
  it('verifies, stores, and TRIGGERS the passkey-added alert (AGL-665)', async () => {
    const response = await POST(request(VALID_BODY))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      credentialId: 'cred-1',
    })
    expect(mockSendPasskeyAddedAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.co', label: 'My MacBook' }),
    )
  })

  it('sends NO alert when verification fails', async () => {
    mockVerifyAndStoreRegistration.mockRejectedValue(
      new PasskeyError('verification-failed'),
    )
    const response = await POST(request(VALID_BODY))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'verification-failed',
    })
    expect(mockSendPasskeyAddedAlert).not.toHaveBeenCalled()
  })

  it('refuses a missing Bearer token', async () => {
    const response = await POST(
      new Request('https://app.aglyn.com/x', {
        method: 'POST',
        body: JSON.stringify(VALID_BODY),
      }),
    )
    expect(response.status).toBe(401)
    expect(mockVerifyAndStoreRegistration).not.toHaveBeenCalled()
  })

  it('refuses a GCIP tenant user — passkeys are project-pool only', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email: 'a@b.co',
      email_verified: true,
      firebase: { tenant: 'sso-tenant-1' },
    })
    const response = await POST(request(VALID_BODY))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'sso-tenant-unsupported',
    })
    expect(mockVerifyAndStoreRegistration).not.toHaveBeenCalled()
  })

  it('refuses an unverified email, matching the session-mint gate', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email: 'a@b.co',
      email_verified: false,
      firebase: {},
    })
    const response = await POST(request(VALID_BODY))
    expect(response.status).toBe(403)
  })

  it('rate limits per uid', async () => {
    mockConsumeRateLimit.mockResolvedValue({ allowed: false } as never)
    const response = await POST(request(VALID_BODY))
    expect(response.status).toBe(429)
    expect(mockVerifyAndStoreRegistration).not.toHaveBeenCalled()
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      'passkey-register:user-1',
      expect.anything(),
    )
  })

  it('refuses a body without a challenge id or response', async () => {
    const response = await POST(request({ response: { id: 'x' } }))
    expect(response.status).toBe(400)
  })
})
