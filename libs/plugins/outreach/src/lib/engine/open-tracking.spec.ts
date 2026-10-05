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
  escapeOutreachHtml,
  judgeOutreachOpen,
  OUTREACH_OPEN_AGENT_MAX,
  OUTREACH_OPEN_HUMAN_DELAY_MS,
  outreachOpenAgentEvidence,
  outreachOpenTrackedHtml,
} from './open-tracking'
import { outreachOpenSourceOf, type OutreachOpenSource } from './open-source'

const PIXEL = 'https://links.acme.io/Ab3dE9xK2q'
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

describe('the HTML part (AGL-3395)', () => {
  it('is the same text, escaped, with line breaks and one image at the end', () => {
    const html = outreachOpenTrackedHtml('Hi <Keith> & co,\nIs "this" week good?', PIXEL)
    expect(html).toContain('Hi &lt;Keith&gt; &amp; co,<br>\nIs &quot;this&quot; week good?')
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain(`<img src="${PIXEL}" width="1" height="1" alt=""`)
    // No markup of its own beyond the image: no styling of the words.
    expect(html).not.toMatch(/<(table|style|font|span|p)\b/i)
  })

  it('keeps every link the plain text offers as a link to the same address', () => {
    const html = outreachOpenTrackedHtml(
      'Book here: https://links.acme.io/Zz9yY8xX7w. Or https://acme.io/a?b=1&c=2',
      PIXEL,
    )
    expect(html).toContain('<a href="https://links.acme.io/Zz9yY8xX7w">https://links.acme.io/Zz9yY8xX7w</a>.')
    expect(html).toContain('<a href="https://acme.io/a?b=1&amp;c=2">https://acme.io/a?b=1&amp;c=2</a>')
  })

  it('cannot be closed out of by the image address or the text', () => {
    const html = outreachOpenTrackedHtml('x"><script>alert(1)</script>', 'https://a.example/"onerror="x')
    expect(html).not.toContain('<script>')
    expect(html).toContain('src="https://a.example/&quot;onerror=&quot;x"')
    expect(escapeOutreachHtml(`'`)).toBe('&#39;')
  })
})

describe('who opened: a person, or a machine (AGL-3395)', () => {
  const judge = (userAgent: string | null, sinceSentMs: number | null = 3_600_000, method = 'GET') =>
    judgeOutreachOpen({ method, userAgent, sinceSentMs })

  it('counts a mail client loading the image an hour after the send', () => {
    expect(judge(CHROME)).toEqual({ human: true, machineReason: null })
  })

  it('counts Gmail’s image proxy as the reader’s open, outside the delivery window', () => {
    // Gmail fetches through its proxy only when the message is opened.
    const gmail = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)'
    expect(judge(gmail)).toEqual({ human: true, machineReason: null })
    expect(judge(gmail, OUTREACH_OPEN_HUMAN_DELAY_MS - 1)).toEqual({ human: false, machineReason: 'too_soon' })
    expect(judge(gmail, 3_600_000, 'HEAD')).toEqual({ human: false, machineReason: 'method' })
  })

  it('sets apart Apple Mail Privacy Protection and Yahoo’s image proxy', () => {
    expect(judge('Mozilla/5.0')).toEqual({ human: false, machineReason: 'privacy_proxy' })
    expect(judge('YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html')).toEqual({
      human: false,
      machineReason: 'image_proxy',
    })
  })

  it('sets apart scanners, a missing agent, a HEAD, and a fetch within seconds of delivery', () => {
    expect(judge('Mimecast-Scanner/1.0').machineReason).toBe('agent')
    expect(judge(null).machineReason).toBe('agent')
    expect(judge(CHROME, 3_600_000, 'HEAD').machineReason).toBe('method')
    expect(judge(CHROME, OUTREACH_OPEN_HUMAN_DELAY_MS - 1).machineReason).toBe('too_soon')
    expect(judge(CHROME, OUTREACH_OPEN_HUMAN_DELAY_MS).human).toBe(true)
    // A clock a second behind is a person, not a time traveller.
    expect(judge(CHROME, -1_000).human).toBe(true)
  })
})

describe('who opened, by where the fetch came from (AGL-3488)', () => {
  const GMAIL = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)'
  const PREFETCH =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
  const judge = (userAgent: string | null, source: OutreachOpenSource | null, sinceSentMs = 3_600_000) =>
    judgeOutreachOpen({ method: 'GET', userAgent, sinceSentMs, source })

  it('reads the network from the address, and says unknown rather than other when there is none', () => {
    expect(outreachOpenSourceOf('66.249.84.10')).toBe('google')
    expect(outreachOpenSourceOf('2a00:1450:4864:20::12b')).toBe('google')
    // Google Cloud customer space is somebody's VM, not Google's mail.
    expect(outreachOpenSourceOf('34.120.1.1')).toBe('other')
    expect(outreachOpenSourceOf('40.107.22.5')).toBe('microsoft_filter')
    expect(outreachOpenSourceOf('2a01:111:f403:c200::1')).toBe('microsoft_filter')
    expect(outreachOpenSourceOf('52.97.1.1')).toBe('microsoft')
    expect(outreachOpenSourceOf('172.225.9.1')).toBe('apple')
    expect(outreachOpenSourceOf('2a09:bac3:1::1')).toBe('apple')
    expect(outreachOpenSourceOf('17.58.1.1')).toBe('apple')
    expect(outreachOpenSourceOf('98.139.1.1')).toBe('yahoo')
    expect(outreachOpenSourceOf('::ffff:66.249.84.10')).toBe('google')
    expect(outreachOpenSourceOf('203.0.113.9')).toBe('other')
    expect(outreachOpenSourceOf(null)).toBeNull()
    expect(outreachOpenSourceOf('not an address')).toBe('other')
  })

  it('reads the bare Mozilla/5.0 as Apple only from Apple’s relay, and as a scanner from a mail network', () => {
    expect(judge('Mozilla/5.0', 'apple').machineReason).toBe('privacy_proxy')
    expect(judge('Mozilla/5.0', 'google').machineReason).toBe('scanner')
    expect(judge('Mozilla/5.0', 'microsoft_filter').machineReason).toBe('scanner')
    expect(judge('Mozilla/5.0', 'microsoft').machineReason).toBe('scanner')
    expect(judge('Mozilla/5.0', 'other').machineReason).toBe('scanner')
    // No address, no evidence against Apple: judged as it always was.
    expect(judge('Mozilla/5.0', null).machineReason).toBe('privacy_proxy')
  })

  it('keeps Gmail’s image proxy the reader’s open from Google, and sets apart its prefetch', () => {
    expect(judge(GMAIL, 'google')).toEqual({ human: true, machineReason: null })
    expect(judge(GMAIL, null)).toEqual({ human: true, machineReason: null })
    expect(judge(GMAIL, 'other').machineReason).toBe('agent')
    expect(judge(PREFETCH, 'google').machineReason).toBe('scanner')
    expect(judge(PREFETCH, null).machineReason).toBe('scanner')
  })

  it('sets apart anything else from Google’s network or Microsoft’s mail filter, whatever it calls itself', () => {
    expect(judge(CHROME, 'google').machineReason).toBe('scanner')
    expect(judge(CHROME, 'microsoft_filter').machineReason).toBe('scanner')
    // Outlook on the web loads a reader's images through Microsoft's network.
    expect(judge(CHROME, 'microsoft')).toEqual({ human: true, machineReason: null })
    expect(judge(CHROME, 'other')).toEqual({ human: true, machineReason: null })
    expect(judge(CHROME, 'yahoo').machineReason).toBe('image_proxy')
  })

  it('keeps the agent as evidence: one line, trimmed, bounded', () => {
    expect(outreachOpenAgentEvidence('  Mozilla/5.0\r\nX: y ')).toBe('Mozilla/5.0 X: y')
    expect(outreachOpenAgentEvidence('')).toBeNull()
    expect(outreachOpenAgentEvidence(null)).toBeNull()
    expect(outreachOpenAgentEvidence('a'.repeat(1000))).toHaveLength(OUTREACH_OPEN_AGENT_MAX)
  })
})
