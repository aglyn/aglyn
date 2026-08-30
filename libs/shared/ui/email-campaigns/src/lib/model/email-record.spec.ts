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
 * The two facts about a message document that every surface reading one gets
 * wrong the same way: there is no single date field, and the audience is a
 * kind for four of the five cases and a NAME for the fifth.
 */

import {
  emailAudienceLabel,
  emailCreatedAtMs,
  emailIsUnsent,
  emailListTimeMs,
  emailSendTimeMs,
  emailStateLabel,
} from './email-record'

describe('when a message went out', () => {
  it('reads a sent message from its Timestamp', () => {
    expect(
      emailSendTimeMs({ sentAt: { toMillis: () => 1_700_000_000_000 } }),
    ).toBe(1_700_000_000_000)
  })

  it('reads a scheduled message from sendAtMs', () => {
    // The whole point: a scheduled message has no `sentAt` at all, and a list
    // that only knew how to read `sentAt` would sort every one of them last.
    expect(emailSendTimeMs({ status: 'scheduled', sendAtMs: 1_800_000 })).toBe(
      1_800_000,
    )
  })

  it('falls back to the Timestamp seconds when toMillis is absent', () => {
    expect(emailSendTimeMs({ sentAt: { seconds: 1_700 } })).toBe(1_700_000)
  })

  it('answers zero rather than throwing on a pending write', () => {
    // A cached document mid-write carries a sentinel with neither field.
    expect(emailSendTimeMs({ sentAt: {} })).toBe(0)
    expect(emailSendTimeMs(undefined)).toBe(0)
  })
})

/*==========================================
 * WHERE A MESSAGE SITS IN A LIST OF MESSAGES.
 *
 * A draft has neither `sentAt` nor `sendAtMs`, so a list ordered on the send
 * time gives every draft the key 0 and files the email a merchant is in the
 * middle of writing below mail sent years ago — behind whatever paging the
 * list has. This is the ordering with that one gap closed, and the assertions
 * are as much about what does NOT change.
 *=========================================*/
describe('the creation stamp', () => {
  it('reads the stamp every writer now leaves', () => {
    expect(emailCreatedAtMs({ createdAtMs: 1_700_000_000_000 })).toBe(
      1_700_000_000_000,
    )
  })

  it('answers null — not zero — for a message written before it', () => {
    // Zero is a real instant at the far end of the sort; "we do not know" is
    // not 1970, and the fallback below depends on telling them apart.
    expect(emailCreatedAtMs({ subject: 'Old' })).toBeNull()
    expect(emailCreatedAtMs({ createdAtMs: 0 })).toBeNull()
    expect(emailCreatedAtMs({ createdAtMs: 'yesterday' })).toBeNull()
    expect(emailCreatedAtMs(undefined)).toBeNull()
  })
})

describe('where a message sits in a list', () => {
  const SENT = { sentAt: { seconds: 1_600 }, createdAtMs: 900_000 }
  const DRAFT = { status: 'draft', createdAtMs: 1_500_000 }

  it('orders a draft by when it was created', () => {
    expect(emailListTimeMs(DRAFT)).toBe(1_500_000)
  })

  it('orders a SENT message by when it went out, never by its draft date', () => {
    // A message drafted in March and sent in June belongs in June: the list
    // is a record of what happened.
    expect(emailListTimeMs(SENT)).toBe(1_600_000)
  })

  it('puts a draft created after the last send ABOVE it', () => {
    const newest = [SENT, DRAFT].sort(
      (a, b) => emailListTimeMs(b) - emailListTimeMs(a),
    )[0]
    expect(newest).toBe(SENT)

    const later = { status: 'draft', createdAtMs: 1_900_000 }
    expect(
      [SENT, later].sort((a, b) => emailListTimeMs(b) - emailListTimeMs(a))[0],
    ).toBe(later)
  })

  it('leaves a scheduled message ordered on its send time', () => {
    // Its due date, not the moment somebody scheduled it — the same fallback
    // must not disturb an ordering that already worked.
    expect(
      emailListTimeMs({
        status: 'scheduled',
        sendAtMs: 2_000_000,
        createdAtMs: 5,
      }),
    ).toBe(2_000_000)
  })

  it('answers zero for a message with no time of any kind', () => {
    // A draft written before the stamp existed: it sorts last, exactly as it
    // did before, rather than being dated from nothing.
    expect(emailListTimeMs({ status: 'draft' })).toBe(0)
  })
})

describe('what state a message is in', () => {
  it('labels every state the send path writes', () => {
    expect(emailStateLabel('sent')).toBe('Sent')
    expect(emailStateLabel('scheduled')).toBe('Scheduled')
    expect(emailStateLabel('canceled')).toBe('Canceled')
    expect(emailStateLabel('draft')).toBe('Draft')
    // The claim the scheduled processor and the send-now route both take
    // before they mail. A merchant who reloads mid-send would otherwise be
    // shown the raw token.
    expect(emailStateLabel('sending')).toBe('Sending')
  })

  it('shows an unrecognized state as itself', () => {
    // Flattening it into one of the named ones would hide a state worth
    // seeing.
    expect(emailStateLabel('bounced-hard')).toBe('bounced-hard')
  })
})

describe('whether a message has gone to anybody', () => {
  /*
   * The distinction the report surfaces rest on. An unsent email carries no
   * `stats`, so a page that does not ask this question renders a column of
   * zeros and a delivery rate of 0% — which reads as "this reached nobody"
   * rather than "this has not been sent".
   */
  it('calls every pre-send state unsent', () => {
    expect(emailIsUnsent({ status: 'draft' })).toBe(true)
    expect(emailIsUnsent({ status: 'scheduled' })).toBe(true)
    expect(emailIsUnsent({ status: 'sending' })).toBe(true)
  })

  it('calls a sent email sent', () => {
    expect(emailIsUnsent({ status: 'sent' })).toBe(false)
  })

  it('does not call a canceled email unsent', () => {
    /*
     * A canceled email may have been canceled before it ever went out, but
     * `canceled` is also what a withdrawn send reads as — and the record is
     * the only thing that knows. Treating it as unsent would hide the figures
     * of a send that did happen, so it keeps its report.
     */
    expect(emailIsUnsent({ status: 'canceled' })).toBe(false)
  })
})

describe('which audience a message went to', () => {
  it('names the built-in kinds in words', () => {
    expect(emailAudienceLabel({ audience: 'leads' })).toBe('All leads')
    expect(emailAudienceLabel({ audience: 'members' })).toBe('All site members')
  })

  it('names a list by the name the SEND recorded', () => {
    expect(
      emailAudienceLabel({
        audience: 'list',
        listId: 'list_1',
        listName: 'Newsletter',
      }),
    ).toBe('Newsletter')
  })

  it('never prints a document id as if it were a list name', () => {
    const label = emailAudienceLabel({ audience: 'list', listId: 'list_1' })
    expect(label).not.toContain('list_1')
    expect(label).toContain('did not name')
  })

  it('distinguishes a list send that recorded no list at all', () => {
    expect(emailAudienceLabel({ audience: 'list' })).toContain(
      'did not record',
    )
  })
})
