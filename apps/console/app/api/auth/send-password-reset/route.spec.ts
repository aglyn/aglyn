/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where `Request` is not a constructor.
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
 * The self-serve password-reset send path (AGL-751).
 *
 * Every send here is against a mocked transport — nothing in this file can put
 * a message on the wire. What it pins is the part that cannot be checked by
 * reading: that the link a stranger's request produces is built on OUR origin,
 * and that no failure downstream of the link turns into a failed recovery.
 */

const mockSendEmail = jest.fn<
  Promise<{ sent: boolean; reason?: string }>,
  [Record<string, unknown>]
>(async () => ({ sent: true }))
let mockEmailConfigured = true
jest.mock('@aglyn/shared-util-email', () => ({
  sendEmail: (options: unknown) =>
    mockSendEmail(options as Record<string, unknown>),
  isEmailConfigured: () => mockEmailConfigured,
}))

/** Records the `actionCodeSettings` Firebase is handed, continueUrl included. */
const mockGenerateLink = jest.fn<Promise<string>, [string, { url: string }]>(
  async () =>
    'https://aglyn-main.firebaseapp.com/__/auth/action' +
    '?mode=resetPassword&oobCode=CODE-abc_123&apiKey=AIzaSyFake',
)
let mockRateLimitAllowed = true
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        generatePasswordResetLink: (email: string, settings: { url: string }) =>
          mockGenerateLink(email, settings),
      }),
    }),
  },
  consumeRateLimit: async () => ({ allowed: mockRateLimitAllowed }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  pluginRequestFromWeb: async (request: Request) => {
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })
    const raw = await request.text()
    return { method: request.method, body: raw ? JSON.parse(raw) : {}, headers }
  },
}))

let mockDesigned: { subject: string; html: string; text: string } | null = null
jest.mock('../../_lib/render-system-email', () => ({
  renderSystemEmail: async (_key: string, merge: Record<string, string>) =>
    mockDesigned
      ? {
          subject: mockDesigned.subject,
          html: mockDesigned.html.replace('{{resetUrl}}', merge.resetUrl ?? ''),
          text: mockDesigned.text.replace('{{resetUrl}}', merge.resetUrl ?? ''),
        }
      : null,
}))

import { POST } from './route'

function post(headers: Record<string, string>, email = 'user@example.com') {
  return POST(
    new Request('https://app.aglyn.com/api/auth/send-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ email }),
    }),
  )
}

/** The URL that actually went in the mail. */
function sentLink(): string {
  const options = mockSendEmail.mock.calls.at(-1)?.[0] ?? {}
  return String(options.text ?? '')
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmailConfigured = true
  mockRateLimitAllowed = true
  mockDesigned = null
  process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://app.aglyn.com'
  delete process.env.AUTH_ACTION_ALLOWED_ORIGINS
  ;(process.env as Record<string, string>).NODE_ENV = 'production'
})

describe('send-password-reset link origin', () => {
  it('builds the link on the console even when the caller claims otherwise', async () => {
    // The attack this endpoint has to survive: anyone may POST any address
    // with any Origin. The mail is genuinely ours, so the recipient trusts
    // the link — and the oobCode in it is redeemable from wherever it lands.
    const response = await post({ origin: 'https://evil.example.com' })

    expect(response.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(sentLink()).toContain('https://app.aglyn.com/reset-password')
    expect(sentLink()).not.toContain('evil.example.com')
    expect(sentLink()).toContain('oobCode=CODE-abc_123')
  })

  it('does not let a spoofed Host through either', async () => {
    await post({ host: 'evil.example.com' })
    expect(sentLink()).toContain('https://app.aglyn.com/reset-password')
    expect(sentLink()).not.toContain('evil.example.com')
  })

  it('passes the resolved origin to Firebase as the continue URL', async () => {
    // The continueUrl must be an authorized domain or the mint is rejected.
    // Handing Firebase the caller's origin would make a stranger able to
    // decide whether reset works at all for a given address.
    await post({ origin: 'https://evil.example.com' })
    expect(mockGenerateLink).toHaveBeenCalledWith('user@example.com', {
      url: 'https://app.aglyn.com/signin',
      handleCodeInApp: false,
    })
  })

  it('still sends when the request carries no origin at all', async () => {
    // This used to return early and send nothing — a silent non-delivery on
    // the one flow whose users cannot tell us it is broken.
    await post({})
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(sentLink()).toContain('https://app.aglyn.com/reset-password')
  })

  it('honours an allowlisted preview origin', async () => {
    process.env.AUTH_ACTION_ALLOWED_ORIGINS = 'https://preview.aglyn.com'
    await post({ origin: 'https://preview.aglyn.com' })
    expect(sentLink()).toContain('https://preview.aglyn.com/reset-password')
  })
})

describe('send-password-reset template', () => {
  it('renders the mockDesigned template with the link substituted', async () => {
    mockDesigned = {
      subject: 'Reset your Aglyn password',
      html: '<a href="{{resetUrl}}">Choose a new password</a>',
      text: 'Choose a new password: {{resetUrl}}',
    }
    await post({ origin: 'https://app.aglyn.com' })

    const options = mockSendEmail.mock.calls[0][0]
    expect(options.subject).toBe('Reset your Aglyn password')
    expect(String(options.html)).toContain(
      'https://app.aglyn.com/reset-password?mode=resetPassword&oobCode=CODE-abc_123',
    )
    expect(String(options.text)).toContain('oobCode=CODE-abc_123')
  })

  it('falls back to built-in copy carrying the same link', async () => {
    // No published template. The recipient must still get a working link —
    // a broken template can never mean a customer gets no way back in.
    await post({ origin: 'https://app.aglyn.com' })
    const options = mockSendEmail.mock.calls[0][0]
    expect(options.html).toBeUndefined()
    expect(options.subject).toBe('Reset your Aglyn password')
    expect(String(options.text)).toContain(
      'https://app.aglyn.com/reset-password',
    )
  })
})

describe('send-password-reset fails soft', () => {
  it('answers 200 when the transport reports a failure', async () => {
    mockSendEmail.mockResolvedValueOnce({ sent: false, reason: 'resend down' })
    expect((await post({ origin: 'https://app.aglyn.com' })).status).toBe(200)
  })

  it('answers 200 when the transport throws', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('network'))
    expect((await post({ origin: 'https://app.aglyn.com' })).status).toBe(200)
  })

  it('answers 200 when the link cannot be minted', async () => {
    // Includes auth/user-not-found, the ordinary typo case. A different
    // status here would turn this endpoint into an account-existence oracle.
    mockGenerateLink.mockRejectedValueOnce(new Error('auth/user-not-found'))
    const response = await post({ origin: 'https://app.aglyn.com' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('answers 200, and sends nothing, when rate limited or unconfigured', async () => {
    mockRateLimitAllowed = false
    expect((await post({ origin: 'https://app.aglyn.com' })).status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()

    mockRateLimitAllowed = true
    mockEmailConfigured = false
    expect((await post({ origin: 'https://app.aglyn.com' })).status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('answers 200 for an address with no account, saying nothing either way', async () => {
    const good = await post({ origin: 'https://app.aglyn.com' })
    mockGenerateLink.mockRejectedValueOnce(new Error('auth/user-not-found'))
    const missing = await post({ origin: 'https://app.aglyn.com' }, 'nobody@example.com')
    expect(missing.status).toBe(good.status)
    expect(await missing.json()).toEqual(await good.json())
  })
})
