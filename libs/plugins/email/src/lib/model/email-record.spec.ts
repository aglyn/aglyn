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
  emailIsUnsent,
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
