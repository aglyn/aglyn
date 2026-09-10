/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Response.json` is undefined.
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
 * A throttle the route answers correctly is not logged as a failure (AGL-2803).
 *
 * Identity Platform refuses a link mint that follows another for the same
 * account with a 400 `auth/internal-error` whose upstream body names
 * `TOO_MANY_ATTEMPTS_TRY_LATER`, and `/api/auth/send-verification` answers it
 * with the 429 AGL-2584 designed. The catch logged the raw error FIRST, so
 * every handled throttle wrote an error-level entry headed by firebase-admin's
 * generic "An internal error has occurred." — the text of a real fault — plus
 * the upstream response and its headers. Measured on production 2026-09-10
 * (request `w9vkd-1789068406479-7998e787a074`), when the signup canary's own
 * Admin SDK mint beat the page's automatic send.
 *
 * The handler is invoked for real, with the production error shape: the
 * throttle must answer 429 and log one warning that names it; a genuine
 * failure must still answer 500 and log the error.
 */

const mockVerifyIdToken = jest.fn()
const mockGenerateLink = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
    }),
  },
  consumeRateLimit: async () => ({ allowed: true }),
  consumeVerifyEmailAutoSend: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  meterPlatformEmail: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async () => ({ sent: true }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  PLATFORM_BRAND_NAME: 'Aglyn',
  pluginRequestFromWeb: (request: Request) =>
    (
      jest.requireActual('@aglyn/aglyn/app-utils/api-adapter') as {
        pluginRequestFromWeb: (r: Request) => Promise<unknown>
      }
    ).pluginRequestFromWeb(request),
}))

jest.mock('../app/api/_lib/auth-action-link', () => ({
  __esModule: true,
  generateAuthActionLink: (...args: unknown[]) => mockGenerateLink(...args),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

import { POST } from '../app/api/auth/send-verification/route'

const { IdTokenRevokedError } = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/token-revocation',
) as typeof import('../../../libs/tenant/data/admin/src/lib/server/token-revocation')

/** The error firebase-admin raised for the throttled production request. */
function identityPlatformThrottle() {
  return Object.assign(new Error('An internal error has occurred.'), {
    code: 'auth/internal-error',
    httpResponse: { status: 400, headers: { server: 'ESF' } },
    cause: {
      response: {
        status: 400,
        text:
          '{\n  "error": {\n    "code": 400,\n    "message": "TOO_MANY_ATTEMPTS_TRY_LATER",\n' +
          '    "errors": [{ "message": "TOO_MANY_ATTEMPTS_TRY_LATER", "domain": "global", "reason": "invalid" }]\n  }\n}\n',
      },
    },
  })
}

const send = () =>
  POST(
    new Request('https://app.aglyn.com/api/auth/send-verification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer caller-id-token',
        origin: 'https://app.aglyn.com',
      },
      body: JSON.stringify({ auto: true }),
    }),
  )

let errorSpy: jest.SpyInstance
let warnSpy: jest.SpyInstance

beforeEach(() => {
  mockVerifyIdToken.mockReset().mockResolvedValue({
    uid: 'uid-1',
    email: 'person@example.com',
    email_verified: false,
  })
  mockGenerateLink.mockReset().mockResolvedValue('https://app.aglyn.com/verify-email?oobCode=x')
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('/api/auth/send-verification logging (AGL-2803)', () => {
  it('answers the throttle with 429 and logs no error', async () => {
    mockGenerateLink.mockRejectedValue(identityPlatformThrottle())

    const response = await send()

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: 'Too many requests — wait a moment before requesting another link.',
    })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('names the throttle in one warning, without the generic text or the raw response', async () => {
    mockGenerateLink.mockRejectedValue(identityPlatformThrottle())

    await send()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const logged = warnSpy.mock.calls[0]
      .map((part: unknown) => (typeof part === 'string' ? part : JSON.stringify(part)))
      .join(' ')
    expect(logged).toContain('TOO_MANY_ATTEMPTS_TRY_LATER')
    expect(logged).not.toContain('An internal error has occurred')
    expect(logged).not.toContain('ESF')
  })

  it('still answers 500 and logs the error for an internal failure that is not the throttle', async () => {
    mockGenerateLink.mockRejectedValue(
      Object.assign(new Error('An internal error has occurred.'), {
        code: 'auth/internal-error',
        cause: { response: { status: 500, text: '{"error":{"message":"BACKEND_ERROR"}}' } },
      }),
    )

    const response = await send()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Sending the email failed' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('logs nothing for a refused credential, which is a 401 and not a failure', async () => {
    mockVerifyIdToken.mockRejectedValue(new IdTokenRevokedError('The user record no longer exists.'))

    const response = await send()

    expect(response.status).toBe(401)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
