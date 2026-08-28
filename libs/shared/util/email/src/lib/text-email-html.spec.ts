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

import { renderTextEmailHtml } from './text-email-html'

describe('renderTextEmailHtml', () => {
  describe('links', () => {
    /*
     * The property the whole module exists for. Resend measures clicks by
     * rewriting `<a href>`; a URL that stays plain text is invisible to it
     * forever, which is why the click rate read 0% with click tracking
     * switched on.
     */
    it('turns a bare url into an anchor', () => {
      const html = renderTextEmailHtml('See https://app.aglyn.com/billing')
      expect(html).toContain('<a href="https://app.aglyn.com/billing"')
      expect(html).toContain('>https://app.aglyn.com/billing</a>')
    })

    it('escapes a query separator into an entity, not a raw ampersand', () => {
      const html = renderTextEmailHtml(
        'https://app.aglyn.com/verify?mode=verifyEmail&oobCode=abc',
      )
      expect(html).toContain(
        'href="https://app.aglyn.com/verify?mode=verifyEmail&amp;oobCode=abc"',
      )
      expect(html).not.toMatch(/href="[^"]*[^p];?&(?!amp;)/)
    })

    /*
     * A period is a legal URL character, so the regex cannot tell the end of
     * a sentence from the end of a path. Left in, the auth link in every
     * password-reset mail would carry a trailing `.` and 404.
     */
    it('leaves sentence punctuation outside the href', () => {
      const html = renderTextEmailHtml('Open https://app.aglyn.com/billing.')
      expect(html).toContain('href="https://app.aglyn.com/billing"')
      expect(html).toContain('</a>.')
    })

    it('keeps a closing paren the url actually owns', () => {
      const html = renderTextEmailHtml('https://example.com/a_(b)')
      expect(html).toContain('href="https://example.com/a_(b)"')
    })

    it('drops a closing paren that belongs to the prose', () => {
      const html = renderTextEmailHtml('(see https://example.com/a)')
      expect(html).toContain('href="https://example.com/a"')
      expect(html).toContain('</a>)')
    })

    it('links every url in a body, not just the first', () => {
      const html = renderTextEmailHtml(
        'One https://a.example.com and two https://b.example.com',
      )
      expect(html).toContain('href="https://a.example.com"')
      expect(html).toContain('href="https://b.example.com"')
    })

    it('leaves prose that merely mentions a domain alone', () => {
      const html = renderTextEmailHtml('Reply to us at aglyn.com any time.')
      expect(html).not.toContain('<a ')
    })
  })

  describe('escaping', () => {
    /*
     * Several senders interpolate customer-supplied values straight into
     * their text bodies — an org name, a member name, an abuse-report
     * subject. Those were harmless while the body was `text/plain`; the
     * moment it is also markup they are an injection site.
     */
    it('escapes markup in the body rather than emitting it', () => {
      const html = renderTextEmailHtml(
        'You joined <img src=x onerror="alert(1)">',
      )
      expect(html).not.toContain('<img')
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    })

    it('escapes the subject it puts in the title', () => {
      const html = renderTextEmailHtml('Body', 'A & B </title><script>')
      expect(html).toContain('<title>A &amp; B &lt;/title&gt;&lt;script&gt;')
    })
  })

  describe('shape', () => {
    it('makes a paragraph per blank-line-separated block', () => {
      const html = renderTextEmailHtml('First block.\n\nSecond block.')
      expect(html).toContain('>First block.</p>')
      expect(html).toContain('>Second block.</p>')
    })

    it('keeps a single newline as a line break inside one paragraph', () => {
      const html = renderTextEmailHtml('Line one\nLine two')
      expect(html).toContain('Line one<br />Line two')
    })

    /*
     * Empty rather than a bare shell, so `sendEmail` can treat "no text" and
     * "no html" identically and post neither field. An empty `html` would
     * still be an HTML part in the eyes of a mail client.
     */
    it('renders nothing for empty or blank input', () => {
      expect(renderTextEmailHtml('')).toBe('')
      expect(renderTextEmailHtml('   \n  ')).toBe('')
      expect(renderTextEmailHtml(null as never)).toBe('')
    })
  })
})
