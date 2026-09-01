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
 * MARKETING MAIL — the policy half, and the chokepoint that applies it.
 *
 * The first half of this file exercises the pure policy; the second drives
 * `sendEmail` with a gate installed, because the properties that matter are
 * the ones a caller cannot see: that a suppressed recipient produces no HTTP
 * request at all, that the header pair and the visible link are both present,
 * and that a gate outage does not become a mail outage.
 */

import {
  MARKETING_CADENCE_INTERVAL_MS,
  MARKETING_FREQUENCY_DEFAULT_PER_WINDOW,
  MARKETING_FREQUENCY_WINDOW_MS,
  UNSUBSCRIBE_FOOTER_LABEL,
  appendUnsubscribeHtml,
  appendUnsubscribeText,
  marketingCadenceVerdict,
  marketingFrequencyCap,
  marketingFrequencyVerdict,
  marketingSunsetDays,
  marketingSunsetVerdict,
  normalizeMarketingCadence,
  resetMarketingSendGateForTests,
  setMarketingSendGate,
  unsubscribeHeaders,
  type MarketingSendGateRequest,
} from './marketing-send'
import { isDeferrableSendResult, sendEmail } from './send-email'
import {
  resetEmailSendGovernorForTests,
  setEmailSendGovernor,
} from './send-rate'

const URL =
  'https://shop.example.com/api/email/unsubscribe?hostId=h&email=a%40b.co&sig=abc'
const NOW = 1_800_000_000_000

describe('marketingFrequencyVerdict', () => {
  const cap = 3

  it('allows while the window has room, and refuses when it is full', () => {
    // BOTH directions in one test on purpose: a ceiling proven only by its
    // refusal would pass over a verdict that refuses everybody.
    const two = [NOW - 1_000, NOW - 2_000]
    expect(marketingFrequencyVerdict(two, NOW, cap).allowed).toBe(true)
    expect(
      marketingFrequencyVerdict([...two, NOW - 3_000], NOW, cap).allowed,
    ).toBe(false)
  })

  it('counts only what is still inside the window', () => {
    const stale = Array.from(
      { length: cap },
      () => NOW - MARKETING_FREQUENCY_WINDOW_MS - 1,
    )
    const verdict = marketingFrequencyVerdict(stale, NOW, cap)
    expect(verdict.allowed).toBe(true)
    expect(verdict.used).toBe(0)
    // The trimmed window is what a caller writes back, so a record cannot
    // grow forever.
    expect(verdict.inWindow).toEqual([])
  })

  it('treats an instant exactly on the boundary as expired', () => {
    const onEdge = [NOW - MARKETING_FREQUENCY_WINDOW_MS]
    expect(marketingFrequencyVerdict(onEdge, NOW, 1).used).toBe(0)
    expect(marketingFrequencyVerdict([NOW - 1], NOW, 1).used).toBe(1)
  })

  it('discards a future instant rather than reserving a slot with it', () => {
    expect(marketingFrequencyVerdict([NOW + 60_000], NOW, cap).used).toBe(0)
  })

  it('ignores a stored value that is not a number', () => {
    const verdict = marketingFrequencyVerdict(
      [NaN, Number.POSITIVE_INFINITY, NOW - 1] as number[],
      NOW,
      cap,
    )
    expect(verdict.used).toBe(1)
  })

  it('keeps the NEWEST instants when a record has grown past the cap', () => {
    const overfull = [NOW - 5, NOW - 4, NOW - 3, NOW - 2, NOW - 1]
    expect(marketingFrequencyVerdict(overfull, NOW, 2).inWindow).toEqual([
      NOW - 2,
      NOW - 1,
    ])
  })
})

describe('marketingFrequencyCap', () => {
  const original = process.env.AGLYN_EMAIL_MARKETING_CAP_PER_DAY
  afterEach(() => {
    if (original === undefined)
      delete process.env.AGLYN_EMAIL_MARKETING_CAP_PER_DAY
    else process.env.AGLYN_EMAIL_MARKETING_CAP_PER_DAY = original
  })

  it('uses the platform default when nothing is configured', () => {
    delete process.env.AGLYN_EMAIL_MARKETING_CAP_PER_DAY
    expect(marketingFrequencyCap()).toBe(MARKETING_FREQUENCY_DEFAULT_PER_WINDOW)
  })

  it('honors an operator’s own number', () => {
    process.env.AGLYN_EMAIL_MARKETING_CAP_PER_DAY = '2'
    expect(marketingFrequencyCap()).toBe(2)
  })

  it('refuses to be switched off by a typo', () => {
    // A control a slipped character can disable is not a control. Each of
    // these falls back to the default rather than to "no ceiling".
    for (const value of ['0', '-1', 'lots', '', '999999']) {
      process.env.AGLYN_EMAIL_MARKETING_CAP_PER_DAY = value
      expect(marketingFrequencyCap()).toBe(
        MARKETING_FREQUENCY_DEFAULT_PER_WINDOW,
      )
    }
  })
})

describe('the visible opt-out', () => {
  it('adds the RFC 8058 pair, or neither', () => {
    expect(unsubscribeHeaders(URL)).toEqual({
      'List-Unsubscribe': `<${URL}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    // `List-Unsubscribe-Post` with no URL advertises a verb nothing serves.
    expect(unsubscribeHeaders('')).toEqual({})
  })

  it('appends a link to the text part', () => {
    expect(appendUnsubscribeText('Hello', URL)).toContain(
      `${UNSUBSCRIBE_FOOTER_LABEL}: ${URL}`,
    )
  })

  it('names the CHOICE, not only the exit', () => {
    // The link opens the preference page, where leaving one stream sits
    // beside leaving all of them. A footer that says only "Unsubscribe" is
    // the one place a recipient would have learned that, so it never gets
    // said — and the word stays in the line because that is what a recipient
    // scans a footer for.
    const text = appendUnsubscribeText('Hello', URL)
    expect(text).toContain('Choose which emails you get')
    expect(text).toContain('unsubscribe')
    expect(appendUnsubscribeHtml('<p>Hello</p>', URL)).toContain(
      `>${UNSUBSCRIBE_FOOTER_LABEL}</a>`,
    )
  })

  it('leaves a body that already carries the link alone', () => {
    // A designed template rendering `{{unsubscribeUrl}}` keeps its own
    // placement instead of getting a second footer.
    const body = `Hello — leave any time: ${URL}`
    expect(appendUnsubscribeText(body, URL)).toBe(body)
    const html = `<p>bye <a href="${URL}">out</a></p>`
    expect(appendUnsubscribeHtml(html, URL)).toBe(html)
  })

  it('recognizes the link a RENDERER escaped into an href', () => {
    /*
     * The check that keeps a merchant's own placement used to compare
     * against the unescaped URL only. A signed link carries `&` between its
     * query parameters and every renderer escapes that into an `href`, so
     * `{{unsubscribeUrl}}` in a designed template produced `&amp;` — which
     * matched nothing, and the templates that DID carry an opt-out were the
     * ones that got a second one.
     */
    const html = `<p>bye <a href="${URL.replace(/&/g, '&amp;')}">out</a></p>`
    expect(appendUnsubscribeHtml(html, URL)).toBe(html)
  })

  it('appends an ANCHOR to the html part, not bare characters', () => {
    const appended = appendUnsubscribeHtml('<p>Hello</p>', URL)
    expect(appended).toContain('<p>Hello</p>')
    // Escaped, because an `&` sitting raw in an `href` is not valid HTML —
    // and because appending twice must find its own link the second time.
    expect(appended).toContain(`href="${URL.replace(/&/g, '&amp;')}"`)
    expect(appendUnsubscribeHtml(appended, URL)).toBe(appended)
  })

  it('changes nothing when there is no URL to offer', () => {
    expect(appendUnsubscribeText('Hello', '')).toBe('Hello')
    expect(appendUnsubscribeHtml('<p>Hello</p>', '')).toBe('<p>Hello</p>')
  })
})

/**
 * THE PACE A RECIPIENT ASKED FOR — `docs/specs/email-competitive-gaps.md`
 * G10's preference-center half.
 *
 * A minimum interval since the last message, not a second rolling window: the
 * cap guards against a burst and this guards against a drip, and a drip is
 * answered by one stored instant rather than a month of them.
 */
describe('marketingCadenceVerdict', () => {
  const DAY = 86_400_000
  const NOW = 1_800_000_000_000

  it('never holds a message at the default pace', () => {
    expect(marketingCadenceVerdict('all', NOW - 1, NOW).allowed).toBe(true)
  })

  it('holds a weekly recipient inside the week and releases them after it', () => {
    expect(marketingCadenceVerdict('weekly', NOW - 6 * DAY, NOW).allowed).toBe(
      false,
    )
    expect(marketingCadenceVerdict('weekly', NOW - 8 * DAY, NOW).allowed).toBe(
      true,
    )
  })

  it('releases exactly at the interval, not a moment later', () => {
    const last = NOW - MARKETING_CADENCE_INTERVAL_MS['weekly']
    expect(marketingCadenceVerdict('weekly', last, NOW).allowed).toBe(true)
    expect(marketingCadenceVerdict('weekly', last + 1, NOW).allowed).toBe(false)
  })

  it('says when the next one may go', () => {
    const last = NOW - DAY
    expect(
      marketingCadenceVerdict('weekly', last, NOW).nextAllowedAtMs,
    ).toBe(last + MARKETING_CADENCE_INTERVAL_MS['weekly'])
  })

  it('allows somebody this site has never mailed', () => {
    for (const last of [null, undefined, 0, Number.NaN]) {
      expect(marketingCadenceVerdict('monthly', last, NOW).allowed).toBe(true)
    }
  })

  /**
   * Clocks disagree across processes. A record written a few seconds ahead
   * must not hold a recipient's mail for a whole interval, which is a far
   * larger error than the one refusing would prevent.
   */
  it('allows rather than refusing when the stored instant is in the future', () => {
    expect(marketingCadenceVerdict('monthly', NOW + 60_000, NOW).allowed).toBe(
      true,
    )
  })

  it('orders the intervals the way the words do', () => {
    expect(MARKETING_CADENCE_INTERVAL_MS['all']).toBe(0)
    expect(MARKETING_CADENCE_INTERVAL_MS['daily']).toBeLessThan(
      MARKETING_CADENCE_INTERVAL_MS['weekly'],
    )
    expect(MARKETING_CADENCE_INTERVAL_MS['weekly']).toBeLessThan(
      MARKETING_CADENCE_INTERVAL_MS['monthly'],
    )
  })
})

describe('normalizeMarketingCadence', () => {
  it('keeps the three real choices', () => {
    for (const value of ['daily', 'weekly', 'monthly'] as const) {
      expect(normalizeMarketingCadence(value)).toBe(value)
    }
  })

  /**
   * The opposite direction from the consent policy's coercion, deliberately.
   * A malformed consent value must not switch enforcement off; a malformed
   * cadence falling to `'monthly'` would withhold mail from everybody whose
   * record got corrupted, and nobody asked for that either.
   */
  it('reads anything else as no preference expressed', () => {
    for (const value of [
      'hourly',
      'ALL',
      '',
      null,
      undefined,
      7,
      {},
      ['weekly'],
    ]) {
      expect(normalizeMarketingCadence(value)).toBe('all')
    }
  })
})

describe('isDeferrableSendResult', () => {
  it('is true only for the two refusals a later attempt can pass', () => {
    expect(
      isDeferrableSendResult({ sent: false, reason: 'rate-limited' }),
    ).toBe(true)
    expect(
      isDeferrableSendResult({ sent: false, reason: 'frequency-capped' }),
    ).toBe(true)
  })

  it('is false for a delivery and for every terminal refusal', () => {
    // A sweep that treated a suppression as deferrable would re-read the same
    // doomed row on every beat, forever.
    expect(isDeferrableSendResult({ sent: true, id: 'x' })).toBe(false)
    for (const reason of [
      'suppressed',
      'rejected',
      'network',
      'unconfigured',
      'no-recipient',
      'unverified-domain',
      'unengaged',
    ] as const) {
      expect(isDeferrableSendResult({ sent: false, reason })).toBe(false)
    }
    expect(isDeferrableSendResult(null)).toBe(false)
  })
})

describe('sendEmail with a marketing context', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }
  let asked: MarketingSendGateRequest[]

  const mockFetch = () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_123' }),
      text: async () => '',
    })
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  const marketing = { hostId: 'host-1', siteBase: 'https://shop.example.com' }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    process.env.RESEND_API_KEY = 'key'
    process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.com>'
    asked = []
  })

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    resetMarketingSendGateForTests()
    resetEmailSendGovernorForTests()
  })

  const installGate = (
    verdict:
      | Record<string, unknown>
      | ((request: MarketingSendGateRequest) => unknown),
  ) =>
    setMarketingSendGate(async (request) => {
      asked.push(request)
      return (
        typeof verdict === 'function' ? verdict(request) : verdict
      ) as never
    })

  it('carries the header pair and a visible link the gate minted', async () => {
    installGate({ allowed: true, unsubscribeUrl: URL })
    const fetchMock = mockFetch()

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'member post',
      marketing,
    })

    expect(result.sent).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.headers['List-Unsubscribe']).toBe(`<${URL}>`)
    expect(body.headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    )
    // Both parts, because a header is not a mechanism a person can see and a
    // text-only part has no anchors for a client to render. The synthesized
    // HTML escapes the query string, so the anchor is what is asserted rather
    // than the raw URL — a link is only a link once it is an `<a href>`.
    expect(body.text).toContain(URL)
    expect(body.html).toContain(
      '<a href="https://shop.example.com/api/email/unsubscribe',
    )
    expect(body.html).toContain('sig=abc"')
  })

  it('tells the gate which site, which person, and whether a cap may refuse', () => {
    installGate({ allowed: true, unsubscribeUrl: URL })
    mockFetch()
    return sendEmail({
      to: '  A@B.co ',
      subject: 'News',
      text: 'Hello',
      context: 'campaign',
      marketing: { ...marketing, capped: false },
    }).then(() => {
      expect(asked).toEqual([
        {
          hostId: 'host-1',
          siteBase: 'https://shop.example.com',
          email: 'A@B.co',
          context: 'campaign',
          capped: false,
        },
      ])
    })
  })

  it('does not call Resend at all for a suppressed recipient', async () => {
    installGate({ allowed: false, refusal: 'suppressed', detail: 'gone' })
    const fetchMock = mockFetch()

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'restock alert',
      marketing,
    })

    expect(result).toMatchObject({ sent: false, reason: 'suppressed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a frequency refusal as its own reason, not as a failure', async () => {
    installGate({ allowed: false, refusal: 'frequency-capped', detail: 'full' })
    mockFetch()

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'abandoned cart',
      marketing,
    })

    expect(result).toMatchObject({ sent: false, reason: 'frequency-capped' })
    // The distinction a resumable sweep acts on.
    expect(isDeferrableSendResult(result)).toBe(true)
  })

  /**
   * A recipient who asked for weekly mail asked to receive it LATER, not
   * never. A sweep that read this as terminal would stamp the subject and
   * discard the message.
   */
  it('reports the recipient’s own pace as deferrable, not as a suppression', async () => {
    installGate({
      allowed: false,
      refusal: 'cadence-limited',
      detail: 'asked for weekly',
    })
    const fetchMock = mockFetch()

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'abandoned cart',
      marketing,
    })

    expect(result).toMatchObject({
      sent: false,
      reason: 'frequency-capped',
      // The gate's own sentence, carried out rather than replaced by a
      // generic one — it is what a console readout has to show.
      detail: 'asked for weekly',
    })
    expect(isDeferrableSendResult(result)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the gate BEFORE the hourly governor', async () => {
    // A message that must never leave should not spend platform budget being
    // refused — the rest of the hour's mail would no longer have it.
    const governor = jest.fn().mockResolvedValue({ allowed: true })
    setEmailSendGovernor(governor as never)
    installGate({ allowed: false, refusal: 'suppressed' })
    mockFetch()

    await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'member post',
      marketing,
    })

    expect(asked).toHaveLength(1)
    expect(governor).not.toHaveBeenCalled()
  })

  it('sends unchanged when NO gate is installed', async () => {
    // Nothing installed is UNGATED, not refused: a preview build and a
    // self-host that never installs one must still send.
    const fetchMock = mockFetch()
    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'member post',
      marketing,
    })

    expect(result.sent).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).headers).toBeUndefined()
  })

  it('sends when the gate THROWS', async () => {
    // An outage on the control must not become an outage on the product.
    setMarketingSendGate(async () => {
      throw new Error('gate is down')
    })
    const fetchMock = mockFetch()

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'member post',
      marketing,
    })

    expect(result.sent).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('uses an unsubscribe URL the caller already minted', async () => {
    // The campaign sender builds its own, because the same link has to reach
    // a designed template as a merge value long before the send.
    installGate({ allowed: true, unsubscribeUrl: 'https://gate.example/wrong' })
    const fetchMock = mockFetch()

    await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'campaign',
      marketing: { ...marketing, unsubscribeUrl: URL },
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.headers['List-Unsubscribe']).toBe(`<${URL}>`)
    expect(body.headers['List-Unsubscribe']).not.toContain('gate.example')
  })

  it('never replaces a header the caller set', async () => {
    installGate({ allowed: true, unsubscribeUrl: URL })
    const fetchMock = mockFetch()

    await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: `Hello ${URL}`,
      context: 'campaign',
      marketing,
      headers: { 'List-Unsubscribe': '<https://caller.example/out>' },
    })

    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).headers['List-Unsubscribe'],
    ).toBe('<https://caller.example/out>')
  })

  it('refuses a marketing send addressed to more than one person', async () => {
    // The link is an HMAC over one address, so a batch would carry the first
    // recipient's signed link for everybody else.
    installGate({ allowed: true, unsubscribeUrl: URL })
    const fetchMock = mockFetch()

    const result = await sendEmail({
      to: ['a@b.co', 'c@d.co'],
      subject: 'News',
      text: 'Hello',
      context: 'member post',
      marketing,
    })

    expect(result).toMatchObject({ sent: false, reason: 'no-recipient' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(asked).toHaveLength(0)
  })

  it('leaves a send that declares NO marketing context untouched', async () => {
    // The four bulk paths opted in; a password reset did not, and nothing
    // about it may change.
    installGate({ allowed: false, refusal: 'suppressed' })
    const fetchMock = mockFetch()

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'Reset your password',
      text: 'Hello',
      context: 'password-reset',
    })

    expect(result.sent).toBe(true)
    expect(asked).toHaveLength(0)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).headers).toBeUndefined()
  })

  it('still sends when there is no unsubscribe URL to be had', async () => {
    // An unpublished site or a missing signing secret is an operator's
    // configuration, and refusing here would turn it into silence.
    installGate({ allowed: true })
    const fetchMock = mockFetch()

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'member post',
      marketing: { hostId: 'host-1', siteBase: '' },
    })

    expect(result.sent).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).headers).toBeUndefined()
  })
})

/*==========================================
 * THE SUNSET — the policy half.
 *
 * Every arm is checked in both directions. A refusal whose only test proves
 * it refuses would pass over a verdict that refuses everybody, which for this
 * control means a merchant's whole audience silently stops receiving mail.
 *=========================================*/

describe('marketingSunsetVerdict', () => {
  const NOW = 1_800_000_000_000
  const DAY = 86_400_000
  const OLD = NOW - 720 * DAY

  it('refuses somebody quiet for longer than the window', () => {
    expect(
      marketingSunsetVerdict(
        { firstSentAtMs: OLD, lastEngagedAtMs: NOW - 200 * DAY },
        NOW,
        180,
      ),
    ).toMatchObject({ allowed: false, days: 180, quietForDays: 200 })
  })

  it('allows somebody who engaged inside it', () => {
    expect(
      marketingSunsetVerdict(
        { firstSentAtMs: OLD, lastEngagedAtMs: NOW - 10 * DAY },
        NOW,
        180,
      ),
    ).toMatchObject({ allowed: true })
  })

  it('holds at the boundary in both directions', () => {
    const at = (engagedAtMs: number) =>
      marketingSunsetVerdict({ firstSentAtMs: OLD, lastEngagedAtMs: engagedAtMs }, NOW, 180)
        .allowed
    expect(at(NOW - 180 * DAY)).toBe(true)
    expect(at(NOW - 180 * DAY - 1)).toBe(false)
  })

  /**
   * ⚠️ The guard without which the sunset refuses everybody the day it is
   * switched on: a person cannot have been quiet for longer than we have been
   * mailing them.
   */
  it('allows a relationship younger than the window, however quiet', () => {
    expect(
      marketingSunsetVerdict(
        { firstSentAtMs: NOW - 10 * DAY, lastEngagedAtMs: null },
        NOW,
        180,
      ),
    ).toMatchObject({ allowed: true })
  })

  it('allows an address it holds no mailing record for', () => {
    expect(
      marketingSunsetVerdict(
        { firstSentAtMs: null, lastEngagedAtMs: null },
        NOW,
        180,
      ),
    ).toMatchObject({ allowed: true })
  })

  it('refuses somebody who has never engaged at all, once old enough', () => {
    const verdict = marketingSunsetVerdict(
      { firstSentAtMs: OLD, lastEngagedAtMs: null },
      NOW,
      180,
    )
    expect(verdict.allowed).toBe(false)
    // Quiet since the first message, because there is nothing later to
    // measure from — and 720 is the honest figure rather than the window.
    expect(verdict.quietForDays).toBe(720)
  })

  it('allows everybody when the window is zero', () => {
    expect(
      marketingSunsetVerdict({ firstSentAtMs: OLD, lastEngagedAtMs: null }, NOW, 0),
    ).toMatchObject({ allowed: true, days: 0 })
  })
})

describe('marketingSunsetDays', () => {
  const set = (value: string | undefined) => {
    if (value === undefined) delete process.env['AGLYN_EMAIL_SUNSET_AFTER_DAYS']
    else process.env['AGLYN_EMAIL_SUNSET_AFTER_DAYS'] = value
  }
  let previous: string | undefined
  beforeEach(() => {
    previous = process.env['AGLYN_EMAIL_SUNSET_AFTER_DAYS']
  })
  afterEach(() => set(previous))

  it('is off unless an operator sets it', () => {
    set(undefined)
    expect(marketingSunsetDays()).toBe(0)
  })

  it('honors a window inside the range', () => {
    set('180')
    expect(marketingSunsetDays()).toBe(180)
  })

  /*
   * The opposite handling from `marketingFrequencyCap`, which falls back to
   * its default. A typo there weakens a guard that is already on; a typo here
   * would switch on a refusal nobody asked for.
   */
  it.each(['0', '1', '99999', 'soon', ''])(
    'reads %p as off rather than as a default',
    (value) => {
      set(value)
      expect(marketingSunsetDays()).toBe(0)
    },
  )
})

describe('a sunset refusal is terminal, not deferrable', () => {
  const originalEnvironment = { ...process.env }
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    process.env.RESEND_API_KEY = 'key'
    process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.com>'
  })
  afterEach(() => {
    jest.restoreAllMocks()
    process.env = { ...originalEnvironment }
    resetMarketingSendGateForTests()
  })

  it('never leaves a sweep re-reading the same doomed row', async () => {
    setMarketingSendGate(async () => ({
      allowed: false,
      refusal: 'unengaged',
      detail: 'Quiet for 400 days.',
    }))

    const result = await sendEmail({
      to: 'a@b.co',
      subject: 'News',
      text: 'Hello',
      context: 'member post',
      marketing: { hostId: 'host-1', siteBase: 'https://shop.example.com' },
    })

    expect(result).toMatchObject({ sent: false, reason: 'unengaged' })
    // A frequency cap clears by the passage of time, so waiting works. A
    // sunset clears when the PERSON engages, which more mail from us cannot
    // bring about — so a sweep must retire the row rather than come back.
    expect(isDeferrableSendResult(result)).toBe(false)
  })
})
