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
 * The visitor's half of a paused form's copy (AGL-1666). The interesting
 * assertions are the NEGATIVE ones: the sentence is easy to write in a way
 * that reads better and is wrong, by explaining itself.
 */

import {
  FORM_ABUSE_CEILING_CODE,
  FORM_UNAVAILABLE_MESSAGE,
  parseFormUnavailableRefusal,
} from './form-unavailable'

describe('AGL-1666 · the visitor’s refusal', () => {
  it('is recognised by the CODE, not the status it shares', () => {
    const notice = parseFormUnavailableRefusal({
      error: 'Submissions are paused for this site',
      code: FORM_ABUSE_CEILING_CODE,
    })
    expect(notice?.message).toBe(FORM_UNAVAILABLE_MESSAGE)
  })

  it('leaves the Free plan’s 429 alone — same status, different answer', () => {
    // The exact body `/api/forms/submit` sends when the monthly plan wall is
    // hit. It must fall through to the caller's generic branch: telling this
    // visitor the form is paused would be true of a DIFFERENT refusal, and
    // this one is fixed by the owner buying a plan, not by waiting.
    expect(
      parseFormUnavailableRefusal({ error: 'Submission limit reached' }),
    ).toBeNull()
  })

  it('leaves a real failure alone', () => {
    expect(parseFormUnavailableRefusal({ error: 'Submission failed' })).toBeNull()
    expect(parseFormUnavailableRefusal(null)).toBeNull()
    expect(parseFormUnavailableRefusal('form-abuse-ceiling')).toBeNull()
    expect(parseFormUnavailableRefusal({ code: 'some-other-code' })).toBeNull()
  })

  it('does not blame the visitor, explain the site, or imply delivery', () => {
    const message = FORM_UNAVAILABLE_MESSAGE.toLowerCase()
    // The visitor did nothing wrong and is not the subject of any sentence.
    for (const blame of ['you ', 'your message was sent', 'too many', 'spam']) {
      expect(message).not.toContain(blame)
    }
    // Nothing about the OWNER's account leaks to a stranger: not the volume,
    // not the ceiling, not the word for what tripped it.
    for (const leak of ['limit', 'abuse', 'unusual', 'volume', 'bot', 'quota', 'plan']) {
      expect(message).not.toContain(leak)
    }
    // And it cannot be mistaken for a receipt.
    for (const receipt of ['thank', 'received', 'we’ll', "we'll", 'get back']) {
      expect(message).not.toContain(receipt)
    }
    // It does say, plainly, that nothing arrived.
    expect(message).toContain('was not sent')
  })

  it('offers the site’s published support address when there is one', () => {
    expect(
      parseFormUnavailableRefusal({
        code: FORM_ABUSE_CEILING_CODE,
        contact: '  help@northwind.example  ',
      })?.contact,
    ).toBe('help@northwind.example')
  })

  it('drops a contact that is not a plausible address', () => {
    for (const junk of ['', '   ', 'not an email', 'help@', '@example.com', 'a@b']) {
      expect(
        parseFormUnavailableRefusal({
          code: FORM_ABUSE_CEILING_CODE,
          contact: junk,
        })?.contact,
      ).toBeUndefined()
    }
    // …and still renders the message. A missing door is not a missing notice.
    expect(
      parseFormUnavailableRefusal({
        code: FORM_ABUSE_CEILING_CODE,
        contact: 'not an email',
      })?.message,
    ).toBe(FORM_UNAVAILABLE_MESSAGE)
  })
})
