/**
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
 * `sendEmail` × the platform send-rate governor (AGL-2409).
 *
 * ## No real mail leaves this file
 *
 * `global.fetch` is replaced with a stub that THROWS on any host other than
 * the in-memory recorder, so a test that accidentally reached Resend fails
 * loudly instead of spending sending reputation — which is the exact asset
 * this issue exists to protect. The env vars are set and deleted explicitly
 * rather than trusted, because `nx test` injects the root `.env` and would
 * otherwise hand these tests a live key.
 *
 * ## The assertion that matters
 *
 * A governor is INJECTED, so a wrong one is reachable. The tests below prove
 * the send path itself cannot drop a transactional message however badly the
 * installed governor behaves — refusing everything, throwing, or returning
 * nonsense.
 */

import { rateLimitedRetryAtMs, sendEmail } from './send-email'
import {
  resetEmailSendGovernorForTests,
  setEmailSendGovernor,
  type EmailSendGovernorRequest,
} from './send-rate'

const FROM = 'Aglyn <noreply@aglyn.com>'

/** Every request the stub saw, so "nothing was sent" is checkable. */
let requests: Array<{ url: string; body: any }> = []

/**
 * A fetch that refuses to talk to anything real.
 *
 * Deliberately not `jest.fn()` alone: a bare mock would happily "succeed"
 * against `api.resend.com` and the file would pass while doing the one thing
 * it must never do.
 */
function installFetchGuard() {
  const stub = jest.fn(async (url: any, init: any) => {
    const target = String(url)
    if (!target.startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${target}`)
    }
    requests.push({ url: target, body: JSON.parse(init.body) })
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_test' }),
      text: async () => '',
    }
  })
  global.fetch = stub as unknown as typeof fetch
  return stub
}

describe('sendEmail × send-rate governor', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }
  let fetchStub: jest.Mock

  beforeEach(() => {
    requests = []
    fetchStub = installFetchGuard()
    process.env.RESEND_API_KEY = 're_test_key_not_real'
    process.env.USAGE_EMAIL_FROM = FROM
    resetEmailSendGovernorForTests()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    resetEmailSendGovernorForTests()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('the fetch guard itself fails on a non-Resend target', async () => {
    // The guard is a control; a control that cannot fail proves nothing.
    await expect(
      (global.fetch as any)('https://smtp.example.com/send', { body: '{}' }),
    ).rejects.toThrow('Blocked outbound request')
  })

  it('sends normally when no governor is installed', async () => {
    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'x' })
    expect(result.sent).toBe(true)
    expect(requests).toHaveLength(1)
  })

  describe('a governor that refuses EVERYTHING', () => {
    beforeEach(() => {
      setEmailSendGovernor(async () => ({
        allowed: false,
        ceiling: 10,
        used: 10,
        remaining: 0,
        retryAtMs: 1_755_104_400_000,
      }))
    })

    it('STILL SENDS a password reset — a transactional message is never refused', async () => {
      const result = await sendEmail({
        to: 'locked-out@example.com',
        subject: 'Reset your password',
        text: 'link',
        context: 'password-reset',
      })
      expect(result.sent).toBe(true)
      expect(requests).toHaveLength(1)
    })

    it('STILL SENDS an order receipt', async () => {
      const result = await sendEmail({
        to: 'buyer@example.com',
        subject: 'Your order',
        text: 'receipt',
        context: 'order-confirmation',
      })
      expect(result.sent).toBe(true)
    })

    it('refuses a campaign, and calls Resend not at all', async () => {
      const result = await sendEmail({
        to: 'subscriber@example.com',
        subject: 'Sale',
        text: 'buy',
        context: 'campaign',
      })
      expect(result.sent).toBe(false)
      expect((result as any).reason).toBe('rate-limited')
      expect(rateLimitedRetryAtMs(result)).toBe(1_755_104_400_000)
      expect(fetchStub).not.toHaveBeenCalled()
    })

    it('refuses an explicit bulk send', async () => {
      const result = await sendEmail({
        to: 'owner@example.com',
        subject: 'Usage summary',
        text: 'numbers',
        context: 'usage summary (org-1)',
        priority: 'bulk',
      })
      expect(result.sent).toBe(false)
      expect(rateLimitedRetryAtMs(result)).toBe(1_755_104_400_000)
      expect(fetchStub).not.toHaveBeenCalled()
    })

    it('sends the SAME message when the caller does not claim bulk', async () => {
      // The polarity check: an omitted priority is transactional, so a sender
      // that forgot to declare itself is ungoverned rather than silenced.
      const result = await sendEmail({
        to: 'owner@example.com',
        subject: 'Usage summary',
        text: 'numbers',
        context: 'usage summary (org-1)',
      })
      expect(result.sent).toBe(true)
    })
  })

  it('fails OPEN when the governor throws — a broken control does not stop mail', async () => {
    setEmailSendGovernor(async () => {
      throw new Error('firestore is down')
    })
    const result = await sendEmail({
      to: 'subscriber@example.com',
      subject: 'Sale',
      text: 'buy',
      context: 'campaign',
    })
    expect(result.sent).toBe(true)
    expect(requests).toHaveLength(1)
  })

  it('sends when the governor allows, and reports the batch size it was asked about', async () => {
    const seen: EmailSendGovernorRequest[] = []
    setEmailSendGovernor(async (request) => {
      seen.push(request)
      return { allowed: true }
    })
    await sendEmail({
      to: ['a@example.com', 'b@example.com', 'not-an-address'],
      subject: 'Sale',
      text: 'buy',
      context: 'campaign',
    })
    // The count is the NORMALISED recipient list — the governor must be told
    // what will actually be delivered, not what the caller passed.
    expect(seen).toEqual([
      { priority: 'campaign', count: 2, context: 'campaign' },
    ])
  })

  it('does not ask the governor at all when there is no valid recipient', async () => {
    const governor = jest.fn(async () => ({ allowed: true }))
    setEmailSendGovernor(governor)
    const result = await sendEmail({ to: 'nope', subject: 'x', text: 'y' })
    expect(result.sent).toBe(false)
    expect((result as any).reason).toBe('no-recipient')
    expect(governor).not.toHaveBeenCalled()
  })

  it('does not ask the governor when email is unconfigured', async () => {
    delete process.env.RESEND_API_KEY
    const governor = jest.fn(async () => ({ allowed: true }))
    setEmailSendGovernor(governor)
    const result = await sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' })
    expect((result as any).reason).toBe('unconfigured')
    expect(governor).not.toHaveBeenCalled()
  })
})

describe('rateLimitedRetryAtMs', () => {
  it('is null for every outcome that is not a deferral', () => {
    expect(rateLimitedRetryAtMs(null)).toBeNull()
    expect(rateLimitedRetryAtMs({ sent: true, id: 'x' })).toBeNull()
    expect(rateLimitedRetryAtMs({ sent: false, reason: 'rejected' })).toBeNull()
    expect(rateLimitedRetryAtMs({ sent: false, reason: 'network' })).toBeNull()
    expect(rateLimitedRetryAtMs({ sent: false, reason: 'unconfigured' })).toBeNull()
  })

  it('is a number — including 0 — for a deferral', () => {
    expect(
      rateLimitedRetryAtMs({ sent: false, reason: 'rate-limited', retryAtMs: 42 }),
    ).toBe(42)
    // Distinguishable from `null`: a deferral with no instant is still a
    // deferral, and a caller testing `!== null` must see it.
    expect(rateLimitedRetryAtMs({ sent: false, reason: 'rate-limited' })).toBe(0)
  })
})
