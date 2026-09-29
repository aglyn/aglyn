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
  OUTREACH_OPEN_HUMAN_DELAY_MS,
  outreachOpenTrackedHtml,
} from './open-tracking'

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
