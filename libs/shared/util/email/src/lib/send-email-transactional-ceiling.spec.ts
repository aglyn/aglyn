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
 * `sendEmail` × the daily transactional ceiling (AGL-4145): the ONE seam a
 * site's mail crosses, so a receipt, a booking reminder, a workflow step and
 * a review ask are all counted against their organization's day without any
 * of them calling anything.
 *
 * The decision of WHICH messages are governed is real; the counter is an
 * in-memory fake with the durable gate's semantics (claim, refuse at N+1,
 * release), and `fetch` refuses anything but the recorder, so no real mail
 * leaves this file.
 */

import { sendEmail, sendFailureReason, rateLimitedRetryAtMs } from './send-email'
import type { SendingWorkspace } from './outbound-screen-gate'
import type { SendingIdentityVerdict } from './sending-domain'
import { resetEmailSendGovernorForTests, setEmailSendGovernor } from './send-rate'
import {
  isTransactionalCeilingExempt,
  resetTransactionalSendCeilingGateForTests,
  setTransactionalSendCeilingGate,
  transactionalCeilingDayKey,
  transactionalCeilingResetMs,
  transactionalCeilingSubject,
  type TransactionalSendCeilingClaim,
  type TransactionalSendCeilingRequest,
  type TransactionalSendCeilingVerdict,
} from './transactional-send-ceiling'

const FROM = 'Acme <hello@acme.example.com>'
let requests: unknown[] = []
let providerOk = true

function installFetchGuard() {
  global.fetch = jest.fn(async (url: any, init: any) => {
    if (!String(url).startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${url}`)
    }
    requests.push(JSON.parse(init.body))
    return providerOk
      ? { ok: true, status: 200, json: async () => ({ id: 'email_test' }), text: async () => '' }
      : { ok: false, status: 422, json: async () => ({}), text: async () => 'invalid' }
  }) as unknown as typeof fetch
}

const workspace = (ceiling: number | null | undefined, orgId: string | null = 'org-1'): SendingWorkspace => ({
  hostId: 'host-1',
  orgId,
  ageDays: 400,
  ownNames: ['Acme'],
  ownDomains: ['acme.example.com'],
  ...(ceiling === undefined ? {} : { transactionalEmailsPerDay: ceiling }),
})

/** What `hostSendingIdentity` hands a site's sender, ceiling stamped. */
const identity = (ceiling: number | null | undefined, orgId?: string | null): SendingIdentityVerdict => ({
  from: 'hello@acme.example.com',
  source: 'custom',
  domain: 'acme.example.com',
  summary: 'acme.example.com',
  refusal: null,
  workspace: workspace(ceiling, orgId),
})

/**
 * The durable gate's semantics in memory: one count per (org, UTC day),
 * `used + count > ceiling` refused with nothing written, a release handing
 * the claim back.
 */
function fakeGate() {
  const counts = new Map<string, number>()
  const claims: TransactionalSendCeilingRequest[] = []
  const releases: TransactionalSendCeilingClaim[] = []
  const refusals: Array<{ request: TransactionalSendCeilingRequest; verdict: TransactionalSendCeilingVerdict }> = []
  const key = (orgId: string, dayKey: string) => `${orgId}/${dayKey}`
  setTransactionalSendCeilingGate({
    async claim(request) {
      claims.push(request)
      const dayKey = transactionalCeilingDayKey(request.nowMs)
      const used = counts.get(key(request.orgId, dayKey)) ?? 0
      if (used + request.count > request.ceiling) {
        return {
          allowed: false,
          used,
          ceiling: request.ceiling,
          retryAtMs: transactionalCeilingResetMs(request.nowMs),
        }
      }
      counts.set(key(request.orgId, dayKey), used + request.count)
      return {
        allowed: true,
        used,
        ceiling: request.ceiling,
        claim: { orgId: request.orgId, dayKey, count: request.count },
      }
    },
    async release(claim) {
      releases.push(claim)
      const k = key(claim.orgId, claim.dayKey)
      counts.set(k, Math.max(0, (counts.get(k) ?? 0) - claim.count))
    },
    async refused(request, verdict) {
      refusals.push({ request, verdict })
    },
  })
  return {
    claims,
    releases,
    refusals,
    used: (orgId = 'org-1', nowMs = Date.now()) =>
      counts.get(key(orgId, transactionalCeilingDayKey(nowMs))) ?? 0,
  }
}

describe('sendEmail × the daily transactional ceiling (AGL-4145)', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    requests = []
    providerOk = true
    installFetchGuard()
    process.env.RESEND_API_KEY = 're_test_key_not_real'
    process.env.USAGE_EMAIL_FROM = FROM
    resetTransactionalSendCeilingGateForTests()
    resetEmailSendGovernorForTests()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    resetTransactionalSendCeilingGateForTests()
    resetEmailSendGovernorForTests()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const receipt = (ceiling: number | null | undefined, extra: Record<string, unknown> = {}) =>
    sendEmail({
      to: 'buyer@example.com',
      subject: 'Your order',
      text: 'Thanks for your order.',
      audience: 'tenant',
      sendingIdentity: identity(ceiling),
      owedFor: 'order',
      context: 'receipt',
      ...extra,
    })

  it('sends the Nth message and refuses the N+1th, as a rate a sweep can defer', async () => {
    const gate = fakeGate()
    for (let i = 0; i < 3; i += 1) {
      expect((await receipt(3)).sent).toBe(true)
    }
    expect(requests).toHaveLength(3)
    expect(gate.used()).toBe(3)

    const refused = await receipt(3)
    expect(refused.sent).toBe(false)
    expect(sendFailureReason(refused)).toBe('rate-limited')
    // Tomorrow, at 00:00 UTC, is when it sends again.
    expect(rateLimitedRetryAtMs(refused)).toBe(transactionalCeilingResetMs(Date.now()))
    expect((refused as { detail?: string }).detail).toContain('3/day')
    // Nothing left, and the refused message did not move the count.
    expect(requests).toHaveLength(3)
    expect(gate.used()).toBe(3)
  })

  it('records every refusal with the gate before returning it — never a silent drop', async () => {
    const gate = fakeGate()
    await receipt(1)
    await receipt(1)
    expect(gate.refusals).toHaveLength(1)
    expect(gate.refusals[0]!.request).toMatchObject({
      orgId: 'org-1',
      hostId: 'host-1',
      count: 1,
      ceiling: 1,
      context: 'receipt',
    })
    expect(gate.refusals[0]!.verdict).toMatchObject({ allowed: false, used: 1 })
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('daily transactional ceiling'),
    )
  })

  it('counts every recipient, blind copies included', async () => {
    const gate = fakeGate()
    const result = await receipt(10, {
      to: ['a@example.com', 'b@example.com'],
      bcc: 'reviews@example.com',
    })
    expect(result.sent).toBe(true)
    expect(gate.claims[0]!.count).toBe(3)
    expect(gate.used()).toBe(3)
  })

  it('refuses everything governed at a ceiling of 0, which is never unlimited', async () => {
    fakeGate()
    expect(sendFailureReason(await receipt(0))).toBe('rate-limited')
    expect(requests).toHaveLength(0)
  })

  describe('security mail is never counted and never refused', () => {
    it.each([
      ['a site member password reset (owedFor account)', { owedFor: 'account', context: 'membership recovery' }],
      ['a password reset by context', { owedFor: undefined, context: 'password-reset' }],
      ['an email verification', { owedFor: undefined, context: 'email-verification' }],
      ['an invitation', { owedFor: undefined, context: 'invite' }],
      ['a lock notice to a banned account', { owedFor: undefined, context: 'notice', accountBanExempt: true }],
    ])('%s goes out at a ceiling already reached', async (_name, extra) => {
      const gate = fakeGate()
      await receipt(1)
      expect(sendFailureReason(await receipt(1))).toBe('rate-limited')
      const result = await receipt(1, extra)
      expect(result.sent).toBe(true)
      // The gate was never asked — so no installed gate could refuse it.
      expect(gate.claims).toHaveLength(2)
    })

    it('treats an "account" claim on a marketing message as no exemption', () => {
      // A marketing message is never owed, whatever it declares — the seam
      // passes no `owedFor` for one, so it is governed like any other.
      expect(isTransactionalCeilingExempt({ owedFor: null, context: 'member post' })).toBe(false)
      expect(isTransactionalCeilingExempt({ owedFor: 'account' })).toBe(true)
      expect(isTransactionalCeilingExempt({ owedFor: 'order', context: 'receipt' })).toBe(false)
    })
  })

  describe('what the ceiling does not govern', () => {
    it('leaves a campaign to its own monthly band', () => {
      expect(
        transactionalCeilingSubject({
          audience: 'tenant',
          workspace: workspace(1),
          priority: 'campaign',
          context: 'campaign',
        }),
      ).toBeNull()
    })

    it('governs a bulk sweep — abandoned-cart and review asks are a site\'s mail too', () => {
      expect(
        transactionalCeilingSubject({
          audience: 'tenant',
          workspace: workspace(5),
          priority: 'bulk',
          context: 'abandoned cart',
        }),
      ).toEqual({ orgId: 'org-1', hostId: 'host-1', ceiling: 5 })
    })

    it('never asks for platform mail, which carries no workspace', async () => {
      const gate = fakeGate()
      const result = await sendEmail({
        to: 'owner@example.com',
        subject: 'Your usage this month',
        text: 'summary',
        context: 'usage-summary',
      })
      expect(result.sent).toBe(true)
      expect(gate.claims).toHaveLength(0)
    })

    it('applies no ceiling when the workspace was resolved without its organization', async () => {
      const gate = fakeGate()
      expect((await receipt(null)).sent).toBe(true)
      expect((await receipt(undefined)).sent).toBe(true)
      expect(
        (
          await sendEmail({
            to: 'buyer@example.com',
            subject: 'Your order',
            text: 'x',
            audience: 'tenant',
            sendingIdentity: identity(5, null),
            context: 'receipt',
          })
        ).sent,
      ).toBe(true)
      expect(gate.claims).toHaveLength(0)
    })

    it('counts nothing for an unlimited organization', async () => {
      const gate = fakeGate()
      expect((await receipt(Number.POSITIVE_INFINITY)).sent).toBe(true)
      expect(gate.claims).toHaveLength(0)
    })
  })

  describe('a claim whose message did not leave is handed back', () => {
    it('when the provider refuses the message', async () => {
      const gate = fakeGate()
      providerOk = false
      const result = await receipt(5)
      expect(sendFailureReason(result)).toBe('rejected')
      expect(gate.releases).toHaveLength(1)
      expect(gate.used()).toBe(0)
    })

    it('when the network fails', async () => {
      const gate = fakeGate()
      global.fetch = jest.fn(async () => {
        throw new Error('socket hang up')
      }) as unknown as typeof fetch
      const result = await receipt(5)
      expect(sendFailureReason(result)).toBe('network')
      expect(gate.used()).toBe(0)
    })

    it('when the platform governor defers a bulk sweep — retries must not spend the day', async () => {
      const gate = fakeGate()
      setEmailSendGovernor(async () => ({ allowed: false, ceiling: 10, used: 10, retryAtMs: Date.now() + 1 }))
      for (let i = 0; i < 4; i += 1) {
        const result = await receipt(2, { priority: 'bulk', context: 'review request', owedFor: undefined })
        expect(sendFailureReason(result)).toBe('rate-limited')
      }
      // Four deferrals of the same backlog, and the day is untouched.
      expect(gate.claims).toHaveLength(4)
      expect(gate.used()).toBe(0)
    })
  })

  describe('it fails open', () => {
    it('sends when no gate is installed', async () => {
      expect((await receipt(0)).sent).toBe(true)
    })

    it('sends when the gate throws', async () => {
      setTransactionalSendCeilingGate({
        claim: async () => {
          throw new Error('firestore unavailable')
        },
        release: async () => undefined,
      })
      expect((await receipt(0)).sent).toBe(true)
    })

    it('sends when the gate does not answer in time', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
      setTransactionalSendCeilingGate({
        claim: () => new Promise(() => undefined),
        release: async () => undefined,
      })
      const pending = receipt(0)
      await jest.advanceTimersByTimeAsync(3_000)
      expect((await pending).sent).toBe(true)
    })
  })

  describe('the UTC day', () => {
    it('keys the count by UTC date, so 23:59 and 00:00 UTC are different days', () => {
      const lastMinute = Date.UTC(2026, 10, 3, 23, 59, 30)
      const nextDay = Date.UTC(2026, 10, 4, 0, 0, 0)
      expect(transactionalCeilingDayKey(lastMinute)).toBe('2026-11-03')
      expect(transactionalCeilingDayKey(nextDay)).toBe('2026-11-04')
      expect(transactionalCeilingResetMs(lastMinute)).toBe(nextDay)
      // Across a month end too.
      expect(transactionalCeilingResetMs(Date.UTC(2026, 10, 30, 12))).toBe(Date.UTC(2026, 11, 1))
    })

    it('sends again on the next UTC day after a refusal', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
      jest.setSystemTime(Date.UTC(2026, 10, 3, 23, 59, 0))
      const gate = fakeGate()
      expect((await receipt(1)).sent).toBe(true)
      expect(sendFailureReason(await receipt(1))).toBe('rate-limited')
      jest.setSystemTime(Date.UTC(2026, 10, 4, 0, 0, 1))
      expect((await receipt(1)).sent).toBe(true)
      expect(gate.claims.map((claim) => transactionalCeilingDayKey(claim.nowMs))).toEqual([
        '2026-11-03',
        '2026-11-03',
        '2026-11-04',
      ])
    })
  })
})
