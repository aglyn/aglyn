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
 * Reading a received email (AGL-2657): the address in a header value, the
 * thread a subject belongs to, the words of an HTML part, a forward's inner
 * message and the reply above the quoted history.
 */

import {
  EMAIL_EXCERPT_MAX,
  emailAddressOf,
  emailDomainOf,
  emailExcerpt,
  forwardedSection,
  htmlToPlainText,
  stripQuotedHistory,
  threadSubject,
} from './email-text'

describe('addresses and subjects', () => {
  it('reads the bare, normalized address out of a header value', () => {
    expect(emailAddressOf('Ada Lovelace <Ada@Example.com>')).toBe('ada@example.com')
    expect(emailAddressOf('  ada@example.com ')).toBe('ada@example.com')
    expect(emailAddressOf('not an address')).toBeNull()
    expect(emailAddressOf(null)).toBeNull()
    expect(emailDomainOf('Ada <ada@Example.com>')).toBe('example.com')
    expect(emailDomainOf('nope')).toBeNull()
  })

  it('strips stacked reply and forward prefixes down to the thread subject', () => {
    expect(threadSubject('Re: Fwd: RE: Renewal  quote')).toBe('Renewal quote')
    expect(threadSubject('FW: AW [2]: Hello')).toBe('Hello')
    expect(threadSubject('Renewal')).toBe('Renewal')
    expect(threadSubject(undefined)).toBe('')
  })
})

describe('the excerpt', () => {
  it('keeps the reply and drops the quoted history under "On … wrote:"', () => {
    const text = [
      'Thanks — Tuesday works.',
      '',
      'Ada',
      '',
      'On Mon, Sep 7, 2026 at 3:12 PM Sam Rep <sam@acme.com> wrote:',
      '> Would Tuesday suit?',
      '> Sam',
    ].join('\n')
    expect(emailExcerpt(text)).toBe('Thanks — Tuesday works.\n\nAda')
  })

  it('reads a wrapped "On … wrote:" intro across two lines', () => {
    const text = 'Yes please.\n\nOn Mon, Sep 7, 2026 at 3:12 PM Sam Rep\n<sam@acme.com> wrote:\n> Shall I?'
    expect(emailExcerpt(text)).toBe('Yes please.')
  })

  it('cuts at a quote mark, an Outlook rule and a reply header block', () => {
    expect(stripQuotedHistory('Hi\n> earlier')).toBe('Hi')
    expect(stripQuotedHistory('Hi\n-----Original Message-----\nFrom: x')).toBe('Hi')
    expect(stripQuotedHistory('Hi\n________________\nFrom: x')).toBe('Hi')
    expect(stripQuotedHistory('Hi\nFrom: Sam <sam@acme.com>\nSent: Monday')).toBe('Hi')
    expect(stripQuotedHistory('Hi\nSent from my iPhone')).toBe('Hi')
  })

  it("takes a forward's inner message and names the correspondent off its From line", () => {
    const text = [
      'FYI',
      '',
      '---------- Forwarded message ---------',
      'From: Ada Lovelace <ada@example.com>',
      'Date: Mon, Sep 7, 2026 at 2:00 PM',
      'Subject: Re: Renewal',
      'To: Sam Rep <sam@acme.com>',
      '',
      'Could we push the renewal to October?',
      '',
      'On Fri, Sep 4, 2026 Sam Rep <sam@acme.com> wrote:',
      '> Renewal is due in September.',
    ].join('\n')
    expect(forwardedSection(text)).toEqual({
      from: 'ada@example.com',
      body: 'Could we push the renewal to October?\n\nOn Fri, Sep 4, 2026 Sam Rep <sam@acme.com> wrote:\n> Renewal is due in September.',
    })
    expect(emailExcerpt(text)).toBe('Could we push the renewal to October?')
  })

  it('recognizes an Outlook forward with no marker, by its header run', () => {
    const text = [
      '',
      'From: Ada Lovelace <ada@example.com>',
      'Sent: Monday, September 7, 2026 2:00 PM',
      'To: Sam Rep <sam@acme.com>',
      'Subject: Renewal',
      '',
      'October, please.',
    ].join('\n')
    expect(forwardedSection(text)?.from).toBe('ada@example.com')
    expect(emailExcerpt(text)).toBe('October, please.')
  })

  it('falls back to the words of the HTML part when there is no text part', () => {
    const html =
      '<html><style>p{color:red}</style><body><p>Hello &amp; welcome</p><div>Line two<br>Line three</div></body></html>'
    expect(htmlToPlainText(html)).toBe('Hello & welcome\nLine two\nLine three\n')
    expect(emailExcerpt('', html)).toBe('Hello & welcome\nLine two\nLine three')
  })

  it('is bounded and settles whitespace', () => {
    const long = 'a'.repeat(EMAIL_EXCERPT_MAX + 50)
    expect(emailExcerpt(long)).toHaveLength(EMAIL_EXCERPT_MAX)
    expect(emailExcerpt('one  \r\n\r\n\r\n\r\ntwo   ')).toBe('one\n\ntwo')
  })
})
