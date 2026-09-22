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
  judgeOutreachClick,
  OUTREACH_CLICK_HUMAN_DELAY_MS,
  outreachBodyLinks,
  rewriteOutreachBodyLinks,
} from './click-tracking'

/** A minter that wraps every link, so the rewrite itself is what is measured. */
const wrap = (link: { url: string; index: number }) => `https://c.example.com/${link.index}`

describe('outreachBodyLinks', () => {
  it('finds http and https links and leaves everything else alone', () => {
    const text = 'See https://aglyn.com/pricing and http://example.org, or mail me@aglyn.com.'
    expect(outreachBodyLinks(text).map((link) => link.url)).toEqual([
      'https://aglyn.com/pricing',
      'http://example.org',
    ])
  })

  it('stops a URL before the punctuation that ends the sentence', () => {
    // The failure this guards is silent and total: a trailing full stop taken
    // into the URL forwards the recipient to a page that does not exist.
    for (const [text, expected] of [
      ['Try https://aglyn.com/pricing.', 'https://aglyn.com/pricing'],
      ['Try https://aglyn.com/pricing, then call.', 'https://aglyn.com/pricing'],
      ['Read it (https://aglyn.com/docs) first.', 'https://aglyn.com/docs'],
      ['Is https://aglyn.com/docs right?', 'https://aglyn.com/docs'],
    ] as const) {
      expect(outreachBodyLinks(text)[0]?.url).toBe(expected)
    }
  })

  it('keeps a closing bracket the URL itself opened, and drops the sentence’s', () => {
    expect(outreachBodyLinks('https://en.wikipedia.org/wiki/Aglyn_(name)')[0]?.url).toBe(
      'https://en.wikipedia.org/wiki/Aglyn_(name)',
    )
    expect(
      outreachBodyLinks('See (https://en.wikipedia.org/wiki/Aglyn_(name)) for it.')[0]?.url,
    ).toBe('https://en.wikipedia.org/wiki/Aglyn_(name)')
  })

  it('reports each occurrence of a repeated destination separately', () => {
    const links = outreachBodyLinks('https://a.example https://a.example')
    expect(links).toHaveLength(2)
    expect(links[0].start).not.toBe(links[1].start)
  })

  it('slices back to exactly the URL it reported', () => {
    const text = 'Before https://aglyn.com/pricing. After.'
    const link = outreachBodyLinks(text)[0]
    expect(text.slice(link.start, link.end)).toBe(link.url)
  })
})

describe('rewriteOutreachBodyLinks', () => {
  it('replaces every link and reports them in minting order', () => {
    const result = rewriteOutreachBodyLinks(
      'One https://a.example and two https://b.example.',
      wrap,
    )
    expect(result.text).toBe(
      'One https://c.example.com/0 and two https://c.example.com/1.',
    )
    expect(result.links).toEqual(['https://a.example', 'https://b.example'])
  })

  it('leaves the body untouched when the minter can sign nothing', () => {
    // The minter answers `null` when there is no secret or no console origin.
    // An email whose links do not work is far worse than an unmeasured one.
    const body = 'Read https://aglyn.com/pricing first.'
    expect(rewriteOutreachBodyLinks(body, () => null)).toEqual({ text: body, links: [] })
  })

  it('does not shift the numbering when the minter skips one', () => {
    // `links[i]` is what a click token indexes, so an index that counted a
    // link the minter refused would attribute every later click to the wrong
    // destination.
    const result = rewriteOutreachBodyLinks(
      'a https://skip.example b https://keep.example',
      (link) => (link.url.includes('skip') ? null : `https://c.example.com/${link.index}`),
    )
    expect(result.text).toBe('a https://skip.example b https://c.example.com/0')
    expect(result.links).toEqual(['https://keep.example'])
  })

  it('leaves a body with no links exactly as it was', () => {
    const body = 'No links here at all.'
    expect(rewriteOutreachBodyLinks(body, wrap)).toEqual({ text: body, links: [] })
  })
})

describe('judgeOutreachClick', () => {
  const human = { method: 'GET', userAgent: 'Mozilla/5.0 (Macintosh) Safari/605', sinceSentMs: 3_600_000 }

  it('counts a browser following a link hours after the send', () => {
    expect(judgeOutreachClick(human)).toEqual({ human: true, machineReason: null })
  })

  it('reads a named scanner as a machine however long it waited', () => {
    for (const agent of ['Proofpoint-Urlrewrite/2.0', 'curl/8.4.0', 'Mozilla/5.0 HeadlessChrome/120']) {
      expect(judgeOutreachClick({ ...human, userAgent: agent }).machineReason).toBe('agent')
    }
  })

  it('reads a request with no user agent as a machine', () => {
    expect(judgeOutreachClick({ ...human, userAgent: null }).machineReason).toBe('agent')
    expect(judgeOutreachClick({ ...human, userAgent: '  ' }).machineReason).toBe('agent')
  })

  it('reads a HEAD as a machine — no mail client sends one for a person', () => {
    expect(judgeOutreachClick({ ...human, method: 'HEAD' }).machineReason).toBe('method')
  })

  it('reads a click that arrives before a person could have read the mail as a machine', () => {
    // The gateway fetch that would otherwise report a 60% click rate on an
    // email nobody opened.
    expect(judgeOutreachClick({ ...human, sinceSentMs: 900 }).machineReason).toBe('too_soon')
    expect(
      judgeOutreachClick({ ...human, sinceSentMs: OUTREACH_CLICK_HUMAN_DELAY_MS - 1 }).machineReason,
    ).toBe('too_soon')
    expect(judgeOutreachClick({ ...human, sinceSentMs: OUTREACH_CLICK_HUMAN_DELAY_MS }).human).toBe(true)
  })

  it('counts a click it cannot time, rather than discarding it', () => {
    // No send to compare against — a step record trimmed away, a token from
    // an email older than the records kept. Counting it is the error that
    // undercounts nobody.
    expect(judgeOutreachClick({ ...human, sinceSentMs: null }).human).toBe(true)
  })

  it('counts a click that appears to precede its own send', () => {
    // Two machines' clocks disagreeing, not a scanner.
    expect(judgeOutreachClick({ ...human, sinceSentMs: -5_000 }).human).toBe(true)
  })
})
