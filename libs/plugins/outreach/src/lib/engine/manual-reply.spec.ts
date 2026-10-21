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
 * @jest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OutreachInboundMessage } from '../model/outreach.types'
import { gmailApiMessageFromMime } from '../transport/mime-message'
import {
  composeOutreachManualReply,
  mergeOutreachInboundMessages,
  OUTREACH_MANUAL_REPLY_BODY_MAX,
  outreachDisplayNameOf,
  outreachEnrollmentHasInbound,
  outreachInboundMessagesOf,
  outreachManualReplyRefusal,
  outreachMessageIdList,
  outreachMessageToAnswer,
  outreachReplyReferences,
  outreachReplySubject,
} from './manual-reply'
import { outreachThreadMessageFromGmail } from './thread-message'

/**
 * ANSWERING A PERSON WHO WROTE BACK (AGL-4020): what the enrollment keeps of
 * their messages, read from the same fixtures the classifier is held to, and
 * the answer as the transport is handed it.
 */

const FIXTURES = join(__dirname, 'fixtures')
const SELF = ['avery@example.org']
const AT = Date.parse('2026-09-15T16:42:18Z')

const message = (name: string, id: string, internalDateMs = AT) =>
  outreachThreadMessageFromGmail(
    gmailApiMessageFromMime(readFileSync(join(FIXTURES, name), 'utf8').replace(/\r?\n/g, '\r\n'), {
      id,
      threadId: 'thread-1',
      internalDateMs,
    }),
  )

const kept = (fields: Partial<OutreachInboundMessage> = {}): OutreachInboundMessage => ({
  id: 'in-1',
  threadId: 'thread-1',
  messageId: '<CAProspectReply-p7q8r9@mail.gmail.com>',
  references: ['<CAOutreachStep1-a1b2c3@mail.gmail.com>'],
  from: 'casey@example.com',
  fromName: 'Casey Morgan',
  replyTo: null,
  subject: "Re: Example Agency's client sites",
  atMs: AT,
  kind: 'reply',
  body: "Hi Avery,\n\nWhat would that land at?\n\nCasey",
  ...fields,
})

describe('what the person wrote, as the enrollment keeps it', () => {
  it('keeps a reply’s sender, time, threading ids and words — the quoted history below them trimmed', () => {
    const [reply] = outreachInboundMessagesOf([message('gmail-real-reply.eml', 'in-1')], { selfAddresses: SELF })
    expect(reply).toMatchObject({
      id: 'in-1',
      threadId: 'thread-1',
      messageId: '<CAProspectReply-p7q8r9@mail.gmail.com>',
      references: ['<CAOutreachStep1-a1b2c3@mail.gmail.com>'],
      from: 'casey@example.com',
      fromName: 'Casey Morgan',
      replyTo: null,
      subject: "Re: Example Agency's client sites",
      atMs: AT,
      kind: 'reply',
    })
    expect(reply.body).toContain('We run 14 client sites today')
    expect(reply.body).not.toContain('Saw the portfolio launch last week')
    expect(reply.body).not.toMatch(/wrote:/)
  })

  it('keeps an automatic answer and an opt-out as what they are, and never the mailbox’s own mail or a bounce', () => {
    const found = outreachInboundMessagesOf(
      [
        message('gmail-sent-step.eml', 'out-1', AT - 60_000),
        message('outlook-automatic-reply.eml', 'in-auto', AT),
        message('gmail-opt-out-reply.eml', 'in-stop', AT + 60_000),
        message('gmail-hard-bounce-no-such-user.eml', 'bounce', AT + 120_000),
      ],
      { selfAddresses: SELF },
    )
    expect(found.map((entry) => [entry.id, entry.kind])).toEqual([
      ['in-auto', 'auto_reply'],
      ['in-stop', 'opt_out'],
    ])
  })

  it('merges a re-read over the earlier copy, oldest first, and keeps the last twenty', () => {
    const stored = Array.from({ length: 20 }, (_, index) => kept({ id: `in-${index}`, atMs: AT + index }))
    const merged = mergeOutreachInboundMessages(stored, [
      kept({ id: 'in-5', atMs: AT + 5, body: 'read again' }),
      kept({ id: 'in-new', atMs: AT + 100 }),
    ])
    expect(merged).toHaveLength(20)
    expect(merged.at(-1)?.id).toBe('in-new')
    expect(merged.find((entry) => entry.id === 'in-5')?.body).toBe('read again')
    expect(merged[0].id).toBe('in-1')
  })

  it('reads display names, Message-ID lists, and who may be answered', () => {
    expect(outreachDisplayNameOf('"Morgan, Casey" <casey@example.com>')).toBe('Morgan, Casey')
    expect(outreachDisplayNameOf('casey@example.com')).toBe('')
    expect(outreachMessageIdList('<a@x.com> <b@x.com>\r\n <a@x.com> junk')).toEqual(['<a@x.com>', '<b@x.com>'])
    expect(outreachEnrollmentHasInbound({ inboundMessages: [], stopReason: 'reply', status: 'replied' })).toBe(true)
    expect(outreachEnrollmentHasInbound({ inboundMessages: [kept()], stopReason: null, status: 'active' })).toBe(true)
    expect(outreachEnrollmentHasInbound({ stopReason: null, status: 'active' })).toBe(false)
    expect(outreachMessageToAnswer([kept({ id: 'a', atMs: 2 }), kept({ id: 'b', atMs: 1 })])?.id).toBe('a')
    expect(outreachMessageToAnswer([kept({ id: 'a' })], 'missing')).toBeNull()
  })
})

describe('the answer', () => {
  const enrollment = {
    messageIds: ['<step-1@rep.example.org>', '<step-2@rep.example.org>'],
    threadSubject: "Example Agency's client sites",
  }

  it('answers the message in its thread: Re: its subject, In-Reply-To it, References the whole chain, their words quoted', () => {
    const { reply, error } = composeOutreachManualReply({
      enrollment,
      answering: kept(),
      body: 'Hi Casey,\r\n\r\nFourteen sites would be $490 a month.  \n\n',
      timeZone: 'America/Chicago',
    })
    expect(error).toBeNull()
    expect(reply).toMatchObject({
      to: 'casey@example.com',
      subject: "Re: Example Agency's client sites",
      threadId: 'thread-1',
      inReplyTo: '<CAProspectReply-p7q8r9@mail.gmail.com>',
      references: [
        '<step-1@rep.example.org>',
        '<step-2@rep.example.org>',
        '<CAOutreachStep1-a1b2c3@mail.gmail.com>',
        '<CAProspectReply-p7q8r9@mail.gmail.com>',
      ],
      body: 'Hi Casey,\n\nFourteen sites would be $490 a month.',
    })
    expect(reply?.text).toBe(
      [
        'Hi Casey,',
        '',
        'Fourteen sites would be $490 a month.',
        '',
        'On Tue, Sep 15, 2026, 11:42 AM, Casey Morgan <casey@example.com> wrote:',
        '> Hi Avery,',
        '>',
        '> What would that land at?',
        '>',
        '> Casey',
      ].join('\n'),
    )
  })

  it('goes to the Reply-To they asked for, and keeps a long chain’s first id and its latest', () => {
    const many = Array.from({ length: 30 }, (_, index) => `<id-${index}@rep.example.org>`)
    const { reply } = composeOutreachManualReply({
      enrollment: { ...enrollment, messageIds: many },
      answering: kept({ replyTo: 'assistant@example.com' }),
      body: 'Thanks',
      timeZone: null,
    })
    expect(reply?.to).toBe('assistant@example.com')
    expect(reply?.references).toHaveLength(20)
    expect(reply?.references[0]).toBe('<id-0@rep.example.org>')
    expect(reply?.references.at(-1)).toBe('<CAProspectReply-p7q8r9@mail.gmail.com>')
    expect(outreachReplyReferences([], kept({ references: [], messageId: null }))).toEqual([])
  })

  it('takes the subject of the thread when the message has none, and refuses an empty or overlong answer', () => {
    expect(outreachReplySubject({ subject: '' }, 'Hello there')).toBe('Re: Hello there')
    expect(outreachReplySubject({ subject: 'RE: Re: Hello there' }, null)).toBe('Re: Hello there')
    expect(composeOutreachManualReply({ enrollment, answering: kept(), body: '  \n ', timeZone: null }).error?.code).toBe(
      'empty',
    )
    expect(
      composeOutreachManualReply({
        enrollment,
        answering: kept(),
        body: 'x'.repeat(OUTREACH_MANUAL_REPLY_BODY_MAX + 1),
        timeZone: null,
      }).error?.code,
    ).toBe('too_long')
  })
})

describe('what still refuses an answer', () => {
  const connected = { status: 'connected' as const, sendAs: 'zach@tryaglyn.example', email: 'zach@tryaglyn.example' }
  const base = {
    enrollment: { status: 'replied' as const, email: 'casey@example.com' },
    doNotContact: false,
    doNotContactDomain: false,
    mailbox: connected,
    mayUseMailbox: true,
  }

  it('lets an answer go to someone who wrote first, whatever the cold rules would have said', () => {
    expect(outreachManualReplyRefusal(base)).toBeNull()
  })

  it('refuses for the lists, the person, the mailbox and who may send from it — each in a sentence', () => {
    expect(outreachManualReplyRefusal({ ...base, doNotContact: true })).toMatchObject({
      code: 'do-not-contact',
      message: expect.stringContaining('casey@example.com is on your do-not-contact list'),
    })
    expect(outreachManualReplyRefusal({ ...base, doNotContactDomain: true })?.message).toContain('example.com is on')
    expect(outreachManualReplyRefusal({ ...base, doNotContact: null })?.code).toBe('unchecked')
    expect(outreachManualReplyRefusal({ ...base, enrollment: { ...base.enrollment, status: 'opted_out' } })?.code).toBe(
      'opted-out',
    )
    expect(outreachManualReplyRefusal({ ...base, enrollment: { ...base.enrollment, status: 'bounced' } })?.code).toBe(
      'bounced',
    )
    expect(outreachManualReplyRefusal({ ...base, mailbox: { ...connected, status: 'paused' } })?.message).toBe(
      'zach@tryaglyn.example is paused. Resume it on the Mailboxes page to answer from it.',
    )
    expect(outreachManualReplyRefusal({ ...base, mailbox: { ...connected, status: 'reconnect_required' } })?.message).toBe(
      'zach@tryaglyn.example needs to be connected again. Reconnect it on the Mailboxes page to answer from it.',
    )
    expect(outreachManualReplyRefusal({ ...base, mailbox: null })?.code).toBe('mailbox-unavailable')
    expect(outreachManualReplyRefusal({ ...base, mayUseMailbox: false })?.code).toBe('permission')
  })
})
