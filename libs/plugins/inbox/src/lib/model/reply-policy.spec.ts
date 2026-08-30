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
  composeReplyBody,
  defaultReplySubject,
  isRoutableAddress,
  quoteSubmission,
  replyRecipient,
} from './reply-policy'

describe('replyRecipient', () => {
  it('reads the address off the submission, whatever the form called it', () => {
    expect(replyRecipient({ 'Email Address': 'Priya@Lumen.co' })).toEqual({
      email: 'priya@lumen.co',
    })
  })

  it('refuses a form with no email field rather than guessing one', () => {
    expect(replyRecipient({ name: 'Priya', message: 'hello' })).toEqual({
      refusal: 'no-address',
    })
  })

  it('refuses a value that is not a routable address', () => {
    expect(replyRecipient({ email: 'priya at lumen dot co' })).toEqual({
      refusal: 'unroutable-address',
    })
  })

  /**
   * The refusal has to survive an empty document, because a submission
   * predating the field sanitizer can arrive with no `fields` map at all.
   */
  it('refuses an absent fields map', () => {
    expect(replyRecipient(undefined)).toEqual({ refusal: 'no-address' })
  })

  /**
   * The row shows the same address it mails. Both halves go through
   * `submissionSender`, so a form whose name field wins the display does not
   * change where the message goes.
   */
  it('mails the email even when a name field supplies the display label', () => {
    expect(
      replyRecipient({ fullName: 'Priya Nair', email: 'priya@lumen.co' }),
    ).toEqual({ email: 'priya@lumen.co' })
  })
})

describe('isRoutableAddress', () => {
  it.each([
    'priya@lumen.co',
    'first.last+tag@sub.example.com',
  ])('accepts %s', (value) => {
    expect(isRoutableAddress(value)).toBe(true)
  })

  it.each([
    ['no at sign', 'priya.lumen.co'],
    ['no dot in the domain', 'priya@localhost'],
    ['a pasted mailto', 'mailto:priya@lumen.co'],
    ['a name in angle brackets', 'Priya <priya@lumen.co>'],
    ['two addresses in one field', 'a@b.co,c@d.co'],
    ['empty', ''],
  ])('refuses %s', (_label, value) => {
    expect(isRoutableAddress(value)).toBe(false)
  })
})

describe('defaultReplySubject', () => {
  it('leads with the site name, which is what the recipient recognizes', () => {
    expect(defaultReplySubject('Lumen Studio', 'Contact')).toBe(
      'Re: your message to Lumen Studio',
    )
  })

  it('falls back to the form name when the site has none', () => {
    expect(defaultReplySubject('', 'Contact')).toBe('Re: your message to Contact')
  })

  it('is never left dangling when neither is known', () => {
    expect(defaultReplySubject(undefined, undefined)).toBe(
      'Re: your message to your message',
    )
  })
})

describe('quoteSubmission', () => {
  it('keeps the author field order the visitor filled in', () => {
    expect(
      quoteSubmission({ name: 'Priya', email: 'priya@lumen.co', message: 'Hi' }),
    ).toBe('> name: Priya\n> email: priya@lumen.co\n> message: Hi')
  })

  it('drops empty values so the quote is not a broken template', () => {
    expect(quoteSubmission({ name: 'Priya', phone: '  ', message: 'Hi' })).toBe(
      '> name: Priya\n> message: Hi',
    )
  })
})

describe('composeReplyBody', () => {
  it('carries the original under the reply so the recipient knows what it answers', () => {
    const body = composeReplyBody({
      message: 'Thanks for getting in touch.',
      fields: { message: 'Do you ship to Ireland?' },
      siteName: 'Lumen Studio',
    })
    expect(body).toContain('Thanks for getting in touch.')
    expect(body).toContain('> message: Do you ship to Ireland?')
    expect(body).toContain(
      'This is a reply to the message you sent through Lumen Studio.',
    )
  })

  it('still says where the message came from when the site is unnamed', () => {
    expect(composeReplyBody({ message: 'Hello' })).toContain(
      'This is a reply to the message you sent through our website.',
    )
  })

  /**
   * `sendEmail` synthesizes the HTML part from this text, and it returns the
   * empty string for empty input — the shape that made click rates
   * structurally zero. A body that is never empty is what keeps that closed
   * from this side; the handler refuses a blank message before reaching here.
   */
  it('is never empty, so the synthesized HTML part is never empty either', () => {
    expect(composeReplyBody({ message: '' }).trim().length).toBeGreaterThan(0)
  })
})
