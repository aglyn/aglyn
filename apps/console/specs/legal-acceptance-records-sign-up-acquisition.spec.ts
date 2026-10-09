/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Response
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
 * The sign-up's legal acceptance records where the account came from, in the
 * same request (AGL-3706).
 *
 * Every sign-up door posts its acceptance first, and that is the write that
 * reliably arrives. On auth.aglyn.com, where nearly every sign-in and every
 * OAuth redirect lands by design, a Google sign-up's page was reloaded
 * seconds after its acceptance and before its own `/api/auth/acquisition`
 * call went out (2026-10-09, org YIZ2pYQehD), so the account and its
 * workspace carried no acquisition at all. These cases pin that the route
 * asks the writer with the verified provider, the page's door and first
 * touch — or the registrable-domain cookie — and that the acceptance never
 * depends on the answer.
 */

const mockRecordSignUpAcquisition = jest.fn()
const mockRecordLegalAcceptance = jest.fn()
const mockDecodedToken: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
    }),
  },
  featureLockdownRefusal: async () => null,
  getLegalAcceptanceStatus: async () => null,
  recordLegalAcceptance: (...args: unknown[]) => mockRecordLegalAcceptance(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/account-acquisition', () => ({
  __esModule: true,
  recordSignUpAcquisition: (...args: unknown[]) => mockRecordSignUpAcquisition(...args),
}))

import { POST } from '../app/api/auth/legal-acceptance/route'

const TOUCH = { v: 1, at: 1, host: 'aglyn.com', path: '/create-a-website', ref: 'www.google.com' }

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://auth.aglyn.com/api/auth/legal-acceptance', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', ...headers },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(mockDecodedToken)) delete mockDecodedToken[key]
  Object.assign(mockDecodedToken, {
    uid: 'u-google',
    email: 'ada@example.com',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  })
  mockRecordLegalAcceptance.mockResolvedValue({ recorded: true, version: 'v' })
  mockRecordSignUpAcquisition.mockResolvedValue({ status: 'recorded' })
})

describe('AGL-3706 · the sign-up acceptance records the acquisition beside it', () => {
  it("asks the writer with the verified provider, the page's door and its first touch", async () => {
    const response = await post({ context: 'signup-google-redirect', touch: TOUCH })

    expect(response.status).toBe(200)
    expect(mockRecordLegalAcceptance).toHaveBeenCalled()
    expect(mockRecordSignUpAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u-google',
        provider: 'google.com',
        email: 'ada@example.com',
        touch: TOUCH,
        doorHint: 'signup-google-redirect',
      }),
    )
  })

  it('falls back to the registrable-domain first-touch cookie when the page sent none', async () => {
    const cookie = `aglyn_ft=${encodeURIComponent(JSON.stringify(TOUCH))}`
    await post({ context: 'signup-google' }, { cookie })

    expect(mockRecordSignUpAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({ touch: TOUCH, doorHint: 'signup-google' }),
    )
  })

  it('still answers 200 for the acceptance when the record cannot be written', async () => {
    mockRecordSignUpAcquisition.mockRejectedValue(new Error('firestore down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await post({ context: 'signup-password', touch: TOUCH })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ ok: true }))
    quiet.mockRestore()
  })

  it('asks nothing when the acceptance itself could not be recorded', async () => {
    mockRecordLegalAcceptance.mockRejectedValue(new Error('firestore down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await post({ context: 'signup-google', touch: TOUCH })

    expect(response.status).toBe(500)
    expect(mockRecordSignUpAcquisition).not.toHaveBeenCalled()
    quiet.mockRestore()
  })
})
