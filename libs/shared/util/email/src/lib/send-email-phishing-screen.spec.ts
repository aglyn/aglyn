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
 * `sendEmail` × the outbound phishing screen (AGL-3362): the ONE seam every
 * tenant sender crosses, so the CRM's one-off mail, inbox replies,
 * newsletters, member posts, sweeps and receipts are screened without any of
 * them calling anything. The screen and its tiers are real; the review store
 * is a recording fake, and `fetch` refuses anything but the recorder.
 */

import { sendEmail, sendFailureReason } from './send-email'
import {
  resetOutboundScreenGateForTests,
  setOutboundScreenGate,
  type OutboundScreenGateRequest,
  type SendingWorkspace,
} from './outbound-screen-gate'
import type { SendingIdentityVerdict } from './sending-domain'

const FROM = 'Acme <hello@acme.example.com>'
let requests: unknown[] = []
let asked: OutboundScreenGateRequest[] = []

function installFetchGuard() {
  global.fetch = jest.fn(async (url: any, init: any) => {
    if (!String(url).startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${url}`)
    }
    requests.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ id: 'email_test' }), text: async () => '' }
  }) as unknown as typeof fetch
}

const workspace = (ageDays: number | null): SendingWorkspace => ({
  hostId: 'host-1',
  orgId: 'org-1',
  ageDays,
  ownNames: ['Acme'],
  ownDomains: ['acme.example.com'],
})

/** What `hostSendingIdentity` hands a tenant sender, workspace stamped. */
const identity = (ageDays: number | null): SendingIdentityVerdict => ({
  from: 'hello@acme.example.com',
  source: 'custom',
  domain: 'acme.example.com',
  summary: 'acme.example.com',
  refusal: null,
  workspace: workspace(ageDays),
})

/** The incident's workflow mail: a Poshmark lookalike link. */
const LOOKALIKE = {
  subject: 'Poshmark Order #88213',
  text: 'An item from your Seller Account has finally sold: https://poshmark.id63835663.shop/o/1',
}
/** Soft-only: brand + lure + a link somewhere else, no lookalike. */
const SOFT = {
  subject: 'Your PayPal payment',
  text: 'Confirm your payment details at https://acme-billing.example.top/confirm',
}

describe('sendEmail × the outbound phishing screen', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    requests = []
    asked = []
    installFetchGuard()
    process.env.RESEND_API_KEY = 're_test_key_not_real'
    process.env.USAGE_EMAIL_FROM = FROM
    setOutboundScreenGate(async (request) => {
      asked.push(request)
      return { outcome: 'held', reference: 'HS-TEST' }
    })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    resetOutboundScreenGateForTests()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  const send = (
    content: { subject: string; text: string },
    ageDays: number | null,
    extra: Record<string, unknown> = {},
  ) =>
    sendEmail({
      to: 'buyer@example.com',
      ...content,
      audience: 'tenant',
      sendingIdentity: identity(ageDays),
      context: 'crm email',
      ...extra,
    })

  it('holds a lookalike link from an ESTABLISHED workspace — the strong tier is for everyone', async () => {
    const result = await send(LOOKALIKE, 400)
    expect(sendFailureReason(result)).toBe('held-for-review')
    expect((result as { detail?: string }).detail).toContain('HS-TEST')
    expect(requests).toHaveLength(0)
    expect(asked[0]).toMatchObject({
      workspace: { hostId: 'host-1' },
      signals: [expect.objectContaining({ code: 'lookalike-link', brand: 'poshmark' })],
      context: 'crm email',
    })
  })

  it('holds a lookalike link even in mail a customer is owed', async () => {
    const result = await send(LOOKALIKE, 400, { owedFor: 'order' })
    expect(sendFailureReason(result)).toBe('held-for-review')
    expect(requests).toHaveLength(0)
  })

  it('holds soft-rule mail from a YOUNG workspace', async () => {
    const result = await send(SOFT, 3)
    expect(sendFailureReason(result)).toBe('held-for-review')
    expect(asked[0].signals.map((signal) => signal.code)).toEqual(['brand-lure-link'])
  })

  it('never holds soft-rule mail from an established workspace', async () => {
    const result = await send(SOFT, 90)
    expect(result.sent).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('never holds soft-rule mail an order, booking or account owes, however young', async () => {
    for (const owedFor of ['order', 'booking', 'account'] as const) {
      const result = await send(SOFT, 1, { owedFor })
      expect(result.sent).toBe(true)
    }
    expect(asked).toHaveLength(0)
  })

  it('does not let a MARKETING message claim it is owed', async () => {
    const result = await send(SOFT, 1, {
      owedFor: 'order',
      marketing: { hostId: 'host-1', siteBase: 'https://acme.example.com' },
    })
    expect(sendFailureReason(result)).toBe('held-for-review')
  })

  it('sends clean mail without asking the store anything', async () => {
    const result = await send({ subject: 'Your order shipped', text: 'Track it at https://acme.example.com/t/1' }, 1)
    expect(result.sent).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('passes a caller’s release through, and sends when the store honors it', async () => {
    setOutboundScreenGate(async (request) => {
      asked.push(request)
      return request.releasedReviewId === 'row-1' ? { outcome: 'send' } : { outcome: 'held' }
    })
    const result = await send(LOOKALIKE, 400, { releasedReviewId: 'row-1' })
    expect(result.sent).toBe(true)
    expect(asked[0].releasedReviewId).toBe('row-1')
  })

  it('says a rejection is a rejection', async () => {
    setOutboundScreenGate(async () => ({ outcome: 'rejected', reference: 'HS-NO' }))
    const result = await send(LOOKALIKE, 400)
    expect(sendFailureReason(result)).toBe('held-for-review')
    expect((result as { detail?: string }).detail).toMatch(/rejected/i)
  })

  it('fails OPEN when the store throws or is not installed', async () => {
    setOutboundScreenGate(async () => {
      throw new Error('firestore unavailable')
    })
    expect((await send(LOOKALIKE, 400)).sent).toBe(true)
    resetOutboundScreenGateForTests()
    expect((await send(LOOKALIKE, 400)).sent).toBe(true)
  })

  it('does not screen platform mail, or tenant mail no host identity was resolved for', async () => {
    const platform = await sendEmail({ to: 'a@example.com', ...LOOKALIKE })
    expect(platform.sent).toBe(true)
    const unstamped = await sendEmail({
      to: 'a@example.com',
      ...LOOKALIKE,
      audience: 'tenant',
      sendingIdentity: { ...identity(400), workspace: undefined },
    })
    expect(unstamped.sent).toBe(true)
    expect(asked).toHaveLength(0)
  })
})
