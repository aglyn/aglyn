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
 * The two halves of a paused form's copy (AGL-1666).
 *
 * The interesting assertions here are the NEGATIVE ones. Both notices are
 * easy to write in a way that reads better and is wrong — the visitor's by
 * explaining itself, the owner's by reassuring — so what each one must not
 * say is pinned as hard as what it must.
 */

import {
  FORM_ABUSE_CEILING_CODE,
  FORM_UNAVAILABLE_MESSAGE,
  formCeilingResetAt,
  formSubmissionsPausedNotice,
  parseFormUnavailableRefusal,
  submissionMonthKey,
} from './form-abuse-ceiling'

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

describe('AGL-1666 · the owner’s notice', () => {
  /** Mid-August, so the reset is unambiguously 1 September. */
  const now = new Date('2026-08-14T12:00:00.000Z')

  it('renders nothing until something has actually been refused', () => {
    // The counter document survives the month that created it, so a stale
    // `{ceiling, lastRefusedAtMs}` with a zero (or absent) count for THIS
    // month must not paint a scary banner over a quiet inbox.
    expect(formSubmissionsPausedNotice({ refused: 0, ceiling: 5000 })).toBeNull()
    expect(
      formSubmissionsPausedNotice({ refused: undefined as any, ceiling: 5000 }),
    ).toBeNull()
  })

  it('gives the owner the count, the ceiling and the reset date', () => {
    const notice = formSubmissionsPausedNotice({
      refused: 1234,
      ceiling: 5000,
      now,
    })
    expect(notice?.title).toBe('Form submissions are paused')
    expect(notice?.message).toContain('1,234 submissions')
    expect(notice?.message).toContain('5,000 submissions')
    // Not billed is the fact the owner needs first and would otherwise
    // assume the opposite of.
    expect(notice?.message).toContain('not billed')
    expect(notice?.until).toContain('September')
    expect(notice?.until).toContain('2026')
  })

  it('says "1 submission", not "1 submissions"', () => {
    expect(
      formSubmissionsPausedNotice({ refused: 1, ceiling: 5000, now })?.message,
    ).toContain('1 submission ')
  })

  it('still renders without a ceiling in the counter document', () => {
    const notice = formSubmissionsPausedNotice({ refused: 7, now })
    expect(notice?.message).toContain('7 submissions')
    expect(notice?.message).not.toContain('after it passed')
  })

  it('resets on the FIRST of next month, in UTC, and rolls the year', () => {
    expect(formCeilingResetAt(now).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
    expect(
      formCeilingResetAt(new Date('2026-12-31T23:59:59.000Z')).toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z')
  })

  it('renders the reset day in UTC, not the reader’s zone', () => {
    // A reader in UTC-5 formatting the 1 September instant locally sees
    // 31 August — a date on which the form is still paused.
    const until = formSubmissionsPausedNotice({ refused: 3, now })?.until
    expect(until).toContain('September 1')
    expect(until).not.toContain('August')
  })
})

describe('AGL-1666 · the month key the console reads', () => {
  it('is exactly the key the submit route writes', () => {
    // `route.ts` keys both counters with `new Date().toISOString().slice(0,7)`.
    // A console reading a differently-derived key would silently show 0
    // refusals on precisely the sites that are being refused.
    const now = new Date('2026-08-14T12:00:00.000Z')
    expect(submissionMonthKey(now)).toBe(now.toISOString().slice(0, 7))
    expect(submissionMonthKey(now)).toBe('2026-08')
  })
})
