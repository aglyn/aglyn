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

import {
  RESEND_SEND_ENDPOINT,
  applyFromName,
  contextTag,
  isEmailConfigured,
  postResendEmail,
  sendEmail,
} from './send-email'

const FROM = 'Aglyn <noreply@aglyn.com>'

/**
 * Every test sets or deletes both vars explicitly rather than trusting the
 * ambient environment: `nx test` injects the root `.env`, which would
 * otherwise hand the "unconfigured" cases a real key and turn a genuinely
 * broken guard green.
 */
function configure(apiKey: string | null, from: string | null) {
  if (apiKey === null) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = apiKey
  if (from === null) delete process.env.USAGE_EMAIL_FROM
  else process.env.USAGE_EMAIL_FROM = from
}

function mockFetch(response: Partial<Response> & { json?: () => unknown }) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'email_123' }),
    text: async () => '',
    ...response,
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function lastBody(fetchMock: jest.Mock) {
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

describe('sendEmail', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
  })

  describe('configuration guard', () => {
    it('skips without an API key and does not call Resend', async () => {
      configure(null, FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'unconfigured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips without a from address and does not call Resend', async () => {
      configure('re_test', null)
      const fetchMock = mockFetch({})

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'unconfigured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('treats empty-string env vars as unset', async () => {
      configure('', '')
      const fetchMock = mockFetch({})

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'unconfigured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports isEmailConfigured only when both vars are present', () => {
      configure(null, null)
      expect(isEmailConfigured()).toBe(false)
      configure('re_test', null)
      expect(isEmailConfigured()).toBe(false)
      configure(null, FROM)
      expect(isEmailConfigured()).toBe(false)
      configure('re_test', FROM)
      expect(isEmailConfigured()).toBe(true)
    })

    it('reads env at call time, not at module load', async () => {
      configure(null, null)
      expect(isEmailConfigured()).toBe(false)

      configure('re_test', FROM)
      const fetchMock = mockFetch({})
      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: true, id: 'email_123' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('recipients', () => {
    beforeEach(() => configure('re_test', FROM))

    it('normalizes a single address into an array', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({ to: 'a@example.com', subject: 'Hi' })
      expect(lastBody(fetchMock).to).toEqual(['a@example.com'])
    })

    it('trims and drops entries that are not addresses', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: [' a@example.com ', '', 'not-an-address', 'b@example.com'],
        subject: 'Hi',
      })
      expect(lastBody(fetchMock).to).toEqual([
        'a@example.com',
        'b@example.com',
      ])
    })

    it('skips the send when no recipient survives normalization', async () => {
      const fetchMock = mockFetch({})
      const result = await sendEmail({ to: ['', 'nope'], subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'no-recipient' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('request shape', () => {
    beforeEach(() => configure('re_test', FROM))

    it('posts to Resend with the configured sender and bearer auth', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Body' })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(RESEND_SEND_ENDPOINT)
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer re_test')
      expect(init.headers['Content-Type']).toBe('application/json')
      expect(lastBody(fetchMock)).toEqual({
        from: FROM,
        to: ['a@example.com'],
        subject: 'Hi',
        text: 'Body',
        html: expect.stringContaining('<p style="margin:0 0 16px;">Body</p>'),
      })
    })

    it('omits optional fields that were not supplied', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      const body = lastBody(fetchMock)
      expect(body).not.toHaveProperty('html')
      expect(body).not.toHaveProperty('headers')
      expect(body).not.toHaveProperty('tags')
      expect(body).not.toHaveProperty('reply_to')
    })

    /*
     * THE SYNTHESIZED HTML PART.
     *
     * Every send in the product went out as `"html": ""`, because twelve
     * senders have no HTML path and the other twenty-seven only produce one
     * when a staff-designed template is published. A message with no HTML
     * part has no anchors, so Resend's click tracking — which works by
     * rewriting `<a href>` — could never record a single click no matter how
     * long anyone waited, and the URLs arrived as inert text.
     *
     * Asserted on the POSTED BODY, for the same reason the `context` tag
     * above is: HTML rendered correctly and never attached is exactly the
     * shape the defect had.
     */
    it('synthesizes an html part from text when the caller supplies none', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Reset your password',
        text: 'Choose a new one here:\n\nhttps://app.aglyn.com/reset?a=1&b=2',
      })

      const html = String(lastBody(fetchMock).html)
      // The link is an anchor, and the query separator is an entity rather
      // than a raw `&` — which is what an href attribute must carry.
      expect(html).toContain(
        '<a href="https://app.aglyn.com/reset?a=1&amp;b=2"',
      )
      expect(html).toContain('<title>Reset your password</title>')
    })

    it('never overrides html the caller built', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        text: 'Body https://example.com',
        html: '<p>Designed</p>',
      })

      expect(lastBody(fetchMock).html).toBe('<p>Designed</p>')
    })

    it('passes through html, headers, tags and reply-to', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        text: 'Body',
        html: '<p>Body</p>',
        headers: { 'List-Unsubscribe': '<https://example.com/u>' },
        tags: [{ name: 'hostId', value: 'host_1' }],
        replyTo: 'hello@aglyn.com',
      })

      expect(lastBody(fetchMock)).toEqual({
        from: FROM,
        to: ['a@example.com'],
        subject: 'Hi',
        text: 'Body',
        html: '<p>Body</p>',
        headers: { 'List-Unsubscribe': '<https://example.com/u>' },
        tags: [{ name: 'hostId', value: 'host_1' }],
        reply_to: 'hello@aglyn.com',
      })
    })

    /*
     * THE `context` TAG (AGL-2407).
     *
     * Until this, `campaign-send.ts` was the only sender in the product that
     * set any tag, so a bounce on an invite, a password reset, a receipt or a
     * usage summary reached the Resend webhook carrying NOTHING to identify
     * it and was answered `200 {ignored:true}` — the address was re-mailed
     * forever. Asserted on the POSTED BODY rather than on `contextTag` alone,
     * because a tag computed correctly and never attached is precisely the
     * shape the bug had.
     */
    it('stamps the context as a tag on a send that set none', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({ to: 'a@example.com', subject: 'Hi', context: 'invite' })

      expect(lastBody(fetchMock).tags).toEqual([
        { name: 'context', value: 'invite' },
      ])
    })

    it('keeps the caller’s own tags alongside it', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        tags: [{ name: 'hostId', value: 'host_1' }],
        context: 'campaign',
      })

      // The campaign sender's attribution tags are what the opens/clicks
      // webhook runs on; losing them to make room for this one would trade
      // one dropped event class for another.
      expect(lastBody(fetchMock).tags).toEqual([
        { name: 'hostId', value: 'host_1' },
        { name: 'context', value: 'campaign' },
      ])
    })

    it('does not duplicate a context tag the caller already set', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        tags: [{ name: 'context', value: 'explicit' }],
        context: 'derived',
      })

      // Two tags of one name is not a shape worth discovering in production,
      // and the explicit one is the more specific.
      expect(lastBody(fetchMock).tags).toEqual([
        { name: 'context', value: 'explicit' },
      ])
    })

    it('sanitises a context Resend would reject', async () => {
      const fetchMock = mockFetch({})
      // The real value `usage-email/route.ts` passes. Resend restricts tag
      // values to ASCII letters, digits, `_` and `-`; a rejected tag fails
      // the WHOLE send, so a mail-delivery module must not hand one over
      // untouched.
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        context: 'usage summary (org-1)',
      })

      expect(lastBody(fetchMock).tags).toEqual([
        { name: 'context', value: 'usage-summary-org-1' },
      ])
    })

    it('adds no tag at all for a context that sanitises to nothing', () => {
      // No tag beats an invalid one: an empty value would be rejected and
      // take the message with it.
      expect(contextTag('   ')).toEqual([])
      expect(contextTag('!!!')).toEqual([])
      expect(contextTag(undefined)).toEqual([])
    })

    it('ignores a from the caller passes anyway', async () => {
      // The option is gone from the type, so a TypeScript caller cannot write
      // this — but a marketplace plugin bundle reaches `sendEmail` as
      // JavaScript and is typechecked against nothing. The close has to hold
      // at RUNTIME, which is what the cast is here to drive.
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        from: 'Support <help@elsewhere.com>',
      } as Parameters<typeof sendEmail>[0])

      expect(lastBody(fetchMock).from).toBe(FROM)
    })

    it('does not let a from stand in for an unconfigured sender', async () => {
      // The deployment has no verified address, and the caller offers one.
      // Answering `unconfigured` is the operator's problem being reported to
      // the operator; sending would be the caller choosing our sender for us.
      configure('re_test', null)
      const fetchMock = mockFetch({})
      const result = await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        from: 'Support <help@elsewhere.com>',
      } as Parameters<typeof sendEmail>[0])

      expect(fetchMock).not.toHaveBeenCalled()
      expect((result as { reason?: string }).reason).toBe('unconfigured')
    })

    it('applies a white-label fromName to the configured verified address', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        fromName: 'Acme Sites',
      })
      // Keeps the verified address, swaps only the display name.
      expect(lastBody(fetchMock).from).toBe('"Acme Sites" <noreply@aglyn.com>')
    })

    it('keeps the verified address when a from and a fromName arrive together', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        from: 'Support <help@elsewhere.com>',
        fromName: 'Acme Sites',
      } as Parameters<typeof sendEmail>[0])

      // The display name is the only thing a caller may choose.
      expect(lastBody(fetchMock).from).toBe('"Acme Sites" <noreply@aglyn.com>')
    })
  })

  describe('applyFromName', () => {
    it('swaps the display name on an RFC-5322 sender, keeping the address', () => {
      expect(applyFromName('Aglyn <noreply@aglyn.com>', 'Acme')).toBe(
        '"Acme" <noreply@aglyn.com>',
      )
    })

    it('wraps a bare address with the display name', () => {
      expect(applyFromName('noreply@aglyn.com', 'Acme')).toBe(
        '"Acme" <noreply@aglyn.com>',
      )
    })

    it('leaves the sender untouched for a blank name or missing address', () => {
      expect(applyFromName('Aglyn <noreply@aglyn.com>', '')).toBe(
        'Aglyn <noreply@aglyn.com>',
      )
      expect(applyFromName('Aglyn <noreply@aglyn.com>', '   ')).toBe(
        'Aglyn <noreply@aglyn.com>',
      )
      expect(applyFromName(undefined, 'Acme')).toBeUndefined()
      expect(applyFromName('not-an-address', 'Acme')).toBe('not-an-address')
    })

    it('strips embedded quotes so the mailbox stays well-formed', () => {
      expect(applyFromName('noreply@aglyn.com', 'Ac"me')).toBe(
        '"Acme" <noreply@aglyn.com>',
      )
    })
  })

  /**
   * The send path's own refusal, independent of the campaign route's.
   *
   * Every assertion here is about the WIRE, not the return value: a refusal
   * that still called Resend would be a refusal in name only, and the return
   * shape would look identical either way.
   */
  describe('sending identity', () => {
    const unverified = {
      from: null,
      source: null,
      domain: 'acme.com',
      summary: 'Blocked: acme.com is not verified.',
      refusal: {
        code: 'domain-unverified' as const,
        domain: 'acme.com',
        missing: ['TXT:send.acme.com'],
        message: 'acme.com has not been verified yet.',
      },
    }

    it('refuses an unverified domain and never reaches Resend', async () => {
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Hi',
        text: 'Hi',
        sendingIdentity: unverified,
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result).toEqual({
        sent: false,
        reason: 'unverified-domain',
        detail: 'acme.com has not been verified yet.',
      })
    })

    it('does not silently fall back to the configured platform sender', async () => {
      // The platform identity is fully configured and usable here. That is
      // the whole point: the refusal must not be a side effect of there being
      // nothing else to send as.
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Hi',
        text: 'Hi',
        sendingIdentity: unverified,
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.sent).toBe(false)
      expect(JSON.stringify(result)).not.toContain('noreply@aglyn.com')
    })

    it('refuses even when a from was supplied anyway', async () => {
      // A verdict is the server's answer to whether this may leave at all; an
      // options-level address is not a way around it — and since the option
      // was deleted it is not a way around anything, which this drives at
      // runtime rather than trusting the type to have removed the risk.
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Hi',
        text: 'Hi',
        from: 'anything@elsewhere.com',
        sendingIdentity: unverified,
      } as Parameters<typeof sendEmail>[0])

      expect(fetchMock).not.toHaveBeenCalled()
      expect((result as { reason?: string }).reason).toBe('unverified-domain')
    })

    it('reports a refusal as unverified-domain, never as unconfigured', async () => {
      // Opposite owners, opposite fixes: `unconfigured` is the operator's,
      // this is the customer's DNS. Asserted with the env ALSO empty, which is
      // the case a precedence mistake would collapse into `unconfigured`.
      configure(null, null)

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Hi',
        text: 'Hi',
        sendingIdentity: unverified,
      })

      expect((result as { reason?: string }).reason).toBe('unverified-domain')
    })

    it('sends from the verified custom address when the verdict allows it', async () => {
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Hi',
        text: 'Hi',
        sendingIdentity: {
          from: 'hello@acme.com',
          source: 'custom' as const,
          domain: 'acme.com',
          summary: 'Sending as hello@acme.com on your verified domain acme.com.',
          refusal: null,
        },
      })

      expect(result.sent).toBe(true)
      expect(lastBody(fetchMock).from).toBe('hello@acme.com')
    })

    it('sends on the verdict, not a from, on the allowed path too', async () => {
      // The refusal arm returns early, so refusing with a `from` present
      // proves nothing about what the address would have been. This is the
      // case that does: a verdict that ALLOWS, with an options-level address
      // competing. Winning here would move mail off the verified identity
      // while verification still reported success.
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      await sendEmail({
        to: 'a@b.com',
        subject: 'Hi',
        text: 'Hi',
        from: 'anything@elsewhere.com',
        sendingIdentity: {
          from: 'hello@acme.com',
          source: 'custom' as const,
          domain: 'acme.com',
          summary: 'Sending as hello@acme.com on your verified domain acme.com.',
          refusal: null,
        },
      } as Parameters<typeof sendEmail>[0])

      expect(lastBody(fetchMock).from).toBe('hello@acme.com')
    })

    it('applies the white-label display name to the custom address', async () => {
      // The `applyFromName` invariant carried onto the new identity: the
      // display name varies, the address stays on the verified domain.
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      await sendEmail({
        to: 'a@b.com',
        subject: 'Hi',
        text: 'Hi',
        fromName: 'Acme',
        sendingIdentity: {
          from: 'hello@acme.com',
          source: 'custom' as const,
          domain: 'acme.com',
          summary: 'Sending as hello@acme.com on your verified domain acme.com.',
          refusal: null,
        },
      })

      expect(lastBody(fetchMock).from).toBe('"Acme" <hello@acme.com>')
    })

    it('leaves every caller that passes no identity exactly as it was', async () => {
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      await sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Hi' })

      expect(lastBody(fetchMock).from).toBe(FROM)
    })
  })

  /*==========================================
   * MARKETING MAIL ON THE POOLED IDENTITY.
   *
   * The pool carries campaigns for every site that has no domain of its own.
   * What bounds one site's spending of a shared reputation is the grading in
   * `sender-reputation.ts`, applied where the campaign is sent; the only thing
   * refused here is bulk mail a recipient cannot stop.
   *=========================================*/
  describe('marketing on the pooled identity', () => {
    const pooled = {
      from: 'notifications@shared1.mail.aglyn.app',
      source: 'shared' as const,
      domain: 'shared1.mail.aglyn.app',
      summary: 'Sending as notifications@shared1.mail.aglyn.app.',
      refusal: null,
    }

    /**
     * ⛔ THE CONTROL. A campaign from a site with no domain of its own leaves,
     * on the pool member it is assigned. Refusing this made the whole campaign
     * feature unreachable for every merchant who had not bought a domain.
     */
    it('sends a campaign on the pool member', async () => {
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Sale',
        text: 'Sale',
        context: 'campaign',
        audience: 'tenant',
        sendingIdentity: pooled,
        // The campaign sender composes its own one-click pair upstream and
        // passes no marketing context, which is the shape this must admit.
        headers: {
          'List-Unsubscribe': '<https://shop.example/u/abc>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })

      expect(result.sent).toBe(true)
      expect(lastBody(fetchMock).from).toBe(
        'notifications@shared1.mail.aglyn.app',
      )
    })

    /**
     * ⛔ AND THE ONE THAT STAYS REFUSED. The same campaign with its unsubscribe
     * link gone does not go out at other sites' expense.
     */
    it('refuses a pooled campaign carrying no unsubscribe', async () => {
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Sale',
        text: 'Sale',
        context: 'campaign',
        audience: 'tenant',
        sendingIdentity: pooled,
      })

      expect(result.sent).toBe(false)
      expect((result as { reason?: string }).reason).toBe('unverified-domain')
      expect((result as { detail?: string }).detail).toMatch(/unsubscribe/i)
      // Refused BEFORE the provider call. A message that reached Resend and
      // was then reported as refused would already have been delivered.
      expect(fetchMock).not.toHaveBeenCalled()
    })

    /**
     * The same message on a domain the merchant owns SENDS. The refusal is
     * about a shared reputation, so it must not follow the message onto a
     * reputation that is nobody else's.
     */
    it('sends the same unsubscribe-less campaign on a custom domain', async () => {
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Sale',
        text: 'Sale',
        context: 'campaign',
        audience: 'tenant',
        sendingIdentity: {
          from: 'hello@acme.com',
          source: 'custom' as const,
          domain: 'acme.com',
          summary: 'Sending as hello@acme.com on your verified domain acme.com.',
          refusal: null,
        },
      })

      expect(result.sent).toBe(true)
      expect(lastBody(fetchMock).from).toBe('hello@acme.com')
    })

    /**
     * A TRANSACTIONAL message is never asked the question. A receipt has no
     * unsubscribe link by design, and refusing one on a pool member would turn
     * a deliverability control into an outage on somebody's checkout.
     */
    it('never refuses a receipt for want of an unsubscribe link', async () => {
      configure('re_test', FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({
        to: 'a@b.com',
        subject: 'Your order',
        text: 'Thanks',
        context: 'order-receipt',
        audience: 'tenant',
        sendingIdentity: pooled,
      })

      expect(result.sent).toBe(true)
      expect(lastBody(fetchMock).from).toBe(
        'notifications@shared1.mail.aglyn.app',
      )
    })
  })


  describe('failure handling', () => {
    beforeEach(() => configure('re_test', FROM))

    it('reports a rejection with status and detail', async () => {
      mockFetch({
        ok: false,
        status: 422,
        text: async () => 'The aglyn.com domain is not verified',
      })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({
        sent: false,
        reason: 'rejected',
        status: 422,
        detail: 'The aglyn.com domain is not verified',
      })
    })

    it('reports an invalid key as a rejection rather than throwing', async () => {
      mockFetch({ ok: false, status: 401, text: async () => 'Invalid key' })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toMatchObject({
        sent: false,
        reason: 'rejected',
        status: 401,
      })
    })

    it('never rejects when fetch itself throws', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('socket hang up')) as unknown as
        typeof fetch

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({
        sent: false,
        reason: 'network',
        detail: 'socket hang up',
      })
    })

    it('still reports sent when the success body has no id', async () => {
      mockFetch({ json: async () => ({}) })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: true, id: null })
    })

    it('still reports sent when the success body is not json', async () => {
      mockFetch({
        json: async () => {
          throw new Error('not json')
        },
      })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: true, id: null })
    })

    it('labels log output with the caller context', async () => {
      const warn = jest.spyOn(console, 'warn')
      configure(null, null)

      await sendEmail({ to: 'a@example.com', subject: 'Hi', context: 'invite' })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invite email'))
    })
  })

  /*
   * THE TRANSPORT BOUNDARY.
   *
   * `sendEmail` filters recipients before it gets here, so these cases are
   * unreachable through it. They matter for the other way to the send
   * endpoint: `RESEND_SEND_ENDPOINT` is exported, so a module can POST to it
   * directly and skip every check above — which is how a recipientless
   * request reached Resend and came back 422, visible only in the vendor
   * dashboard.
   */
  describe('postResendEmail', () => {
    it('refuses a payload with no recipient before the network', async () => {
      const fetchMock = mockFetch({})

      await expect(
        postResendEmail('re_test', { from: FROM, subject: 'Hi' }),
      ).rejects.toThrow(/no `to` field/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses an empty recipient list and a blank address', async () => {
      const fetchMock = mockFetch({})

      await expect(
        postResendEmail('re_test', { from: FROM, to: [] }),
      ).rejects.toThrow()
      await expect(
        postResendEmail('re_test', { from: FROM, to: '  ' }),
      ).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('names the caller so the refusal identifies the sender', async () => {
      mockFetch({})

      await expect(
        postResendEmail('re_test', { from: FROM }, 'usage-summary'),
      ).rejects.toThrow(/usage-summary/)
    })

    /*
     * The control for this block: the guard refuses one specific shape, not
     * every request. Without it the three refusals above would all pass on a
     * transport that had stopped working entirely.
     */
    it('puts a well-formed payload on the wire', async () => {
      const fetchMock = mockFetch({})

      await postResendEmail(
        're_test',
        { from: FROM, to: ['a@example.com'], subject: 'Hi' },
        'invite',
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(RESEND_SEND_ENDPOINT)
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer re_test')
      expect(JSON.parse(init.body)).toMatchObject({
        to: ['a@example.com'],
        subject: 'Hi',
      })
    })
  })
})

describe('whose mail is this', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
  })

  /**
   * THE LAST LINE BEFORE A MESSAGE LEAVES.
   *
   * `USAGE_EMAIL_FROM` is an address on `aglyn.com`, where Aglyn's own
   * billing, account and console mail leaves from. A SITE's mail reaching it
   * means that site's complaint rate is charged against the domain every other
   * customer's password reset depends on.
   *
   * `resolveHostSendingIdentity` refuses first and the coverage sweep makes
   * sure every tenant sender declares itself; this is the arm for a sender
   * that declared itself and resolved nothing. The environment is deliberately
   * CONFIGURED, so what is asserted is that a usable platform address was not
   * reached — not that none existed.
   */
  it('refuses a tenant message that resolved no identity', async () => {
    configure('re_test', FROM)
    const fetchMock = mockFetch({})

    const result = await sendEmail({
      to: 'buyer@example.com',
      subject: 'Your receipt',
      text: 'Thanks',
      audience: 'tenant',
      context: 'receipt',
    })

    expect(result).toMatchObject({
      sent: false,
      reason: 'unverified-domain',
    })
    // Nothing reached the wire. A refusal that still sent would be the whole
    // bug wearing a false negative.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a tenant message on the identity it resolved', async () => {
    configure('re_test', FROM)
    const fetchMock = mockFetch({})

    const result = await sendEmail({
      to: 'buyer@example.com',
      subject: 'Your receipt',
      text: 'Thanks',
      audience: 'tenant',
      sendingIdentity: {
        from: 'hello@acme.mail.aglyn.app',
        source: 'custom',
        domain: 'acme.mail.aglyn.app',
        summary: 'Sending as hello@acme.mail.aglyn.app.',
        refusal: null,
      },
      context: 'receipt',
    })

    expect(result.sent).toBe(true)
    expect(lastBody(fetchMock).from).toBe('hello@acme.mail.aglyn.app')
    expect(lastBody(fetchMock).from).not.toContain('aglyn.com')
  })

  /**
   * The other half, and the control: without it the refusal above would pass
   * against a `sendEmail` that had stopped sending anything at all. Aglyn's
   * own mail to its own customers still leaves on `aglyn.com`.
   */
  it('still sends platform mail on the configured address', async () => {
    configure('re_test', FROM)
    const fetchMock = mockFetch({})

    const result = await sendEmail({
      to: 'owner@example.com',
      subject: 'Your invoice',
      text: 'Invoice attached',
      context: 'billing',
    })

    expect(result.sent).toBe(true)
    expect(lastBody(fetchMock).from).toBe(FROM)
  })
})
