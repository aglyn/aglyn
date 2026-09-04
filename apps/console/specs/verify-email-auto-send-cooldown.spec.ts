/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, the trap every other spec in this directory carries a
 * note about.
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
 * AGL-2584 — a mount inside the cooldown must not mint another link.
 *
 * `/verify-email` asked for a link every time it mounted, so leaving the tab
 * and coming back to see whether the mail arrived asked for a second one.
 * Identity Platform throttles minting per account ahead of this route's own
 * hourly budget, and the collision reported a mail that HAD been sent as
 * `Sending the email failed`. The sibling spec covers the relabelling that
 * shipped first; this one covers not causing the collision.
 *
 * The handler is invoked for real. What it does with the cooldown — when it
 * asks, in what order, and what it answers — is the contract; the cooldown's
 * own arithmetic is pinned in verify-email-cooldown.spec.ts.
 */

const mockVerifyIdToken = jest.fn()
const mockConsumeRateLimit = jest.fn(async () => ({
  allowed: true,
  limit: 5,
  remaining: 4,
  resetMs: Date.now() + 3_600_000,
  degraded: false,
  contended: false,
}))
const mockConsumeAutoSend = jest.fn(async () => ({
  allowed: true,
  retryAfterSeconds: 0,
  degraded: false,
}))
const mockSendEmail = jest.fn(async () => ({ sent: true }))
const mockGenerateLink = jest.fn(async () => 'https://app.aglyn.com/verify')
const mockMeter = jest.fn(async () => undefined)

/** Records the order the two budgets are consulted in. */
const calls: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
    }),
  },
  consumeRateLimit: (...args: unknown[]) => {
    calls.push('hourly-budget')
    return mockConsumeRateLimit(...(args as []))
  },
  consumeVerifyEmailAutoSend: (...args: unknown[]) => {
    calls.push('cooldown')
    return mockConsumeAutoSend(...(args as []))
  },
  meterPlatformEmail: (...args: unknown[]) => mockMeter(...(args as [])),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: (...args: unknown[]) => mockSendEmail(...(args as [])),
}))

// The REAL request adapter, reached by its deep path: the flag under test
// arrives in the POST body, so the parsing that reads it has to be the
// production one rather than a double that always finds what it looks for.
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
  generateAuthActionLink: (...args: unknown[]) =>
    mockGenerateLink(...(args as [])),
}))
jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

import { POST } from '../app/api/auth/send-verification/route'

const post = (body: unknown) =>
  POST(
    new Request('https://app.aglyn.com/api/auth/send-verification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer token',
        origin: 'https://app.aglyn.com',
      },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  calls.length = 0
  mockVerifyIdToken.mockResolvedValue({
    uid: 'uid-1',
    email: 'person@example.com',
    email_verified: false,
  })
  mockConsumeRateLimit.mockResolvedValue({
    allowed: true,
    limit: 5,
    remaining: 4,
    resetMs: Date.now() + 3_600_000,
    degraded: false,
    contended: false,
  })
  mockConsumeAutoSend.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    degraded: false,
  })
})

describe('the automatic send is held by a cooldown', () => {
  it('a first arrival gets its email immediately', async () => {
    const response = await post({ auto: true })

    expect(response.status).toBe(200)
    expect(mockConsumeAutoSend).toHaveBeenCalledWith('uid-1')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it('a mount inside the cooldown sends nothing, and says nothing is wrong', async () => {
    mockConsumeAutoSend.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 540,
      degraded: false,
    })

    const response = await post({ auto: true })

    expect(mockSendEmail).not.toHaveBeenCalled()
    // Not 429 and not 500: a link is already on its way, so the page shows
    // the "we sent a link" state it would have shown anyway. An error here
    // is the whole thing being fixed.
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload).toMatchObject({ ok: true, alreadySent: true })
    expect(payload.error).toBeUndefined()
  })

  it('a suppressed mount does not spend the hourly budget', async () => {
    mockConsumeAutoSend.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 540,
      degraded: false,
    })

    await post({ auto: true })

    // The 5/hour budget belongs to the deliberate resends. A mount that was
    // never going to send must not eat one of them.
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(calls).toEqual(['cooldown'])
  })

  it('the cooldown is consulted before the hourly budget', async () => {
    await post({ auto: true })
    expect(calls).toEqual(['cooldown', 'hourly-budget'])
  })
})

describe('the explicit resend is not a mount', () => {
  it('sends even while the cooldown would hold', async () => {
    mockConsumeAutoSend.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 540,
      degraded: false,
    })

    const response = await post({})

    // The button is the affordance for a mail that genuinely did not arrive.
    // Gating it on the cooldown would remove the only remedy this page has.
    expect(mockConsumeAutoSend).not.toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
  })

  it('still answers to the per-uid hourly limit', async () => {
    mockConsumeRateLimit.mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetMs: Date.now() + 3_600_000,
      degraded: false,
      contended: false,
    })

    const response = await post({})

    expect(response.status).toBe(429)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('the cooldown does not reach past the automatic send', () => {
  it('an already-verified caller is answered before it is consulted', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-1',
      email: 'person@example.com',
      email_verified: true,
    })

    const response = await post({ auto: true })

    expect(await response.json()).toMatchObject({ alreadyVerified: true })
    expect(mockConsumeAutoSend).not.toHaveBeenCalled()
  })

  it('is keyed on the uid from the TOKEN, not from the body', async () => {
    // The body is trusted for one flag and nothing else. A cooldown keyed on
    // a body-supplied uid would be one account able to silence another's mail.
    await post({ auto: true, uid: 'somebody-else' })
    expect(mockConsumeAutoSend).toHaveBeenCalledWith('uid-1')
  })
})
