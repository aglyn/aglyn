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
 *
 * @jest-environment node
 */

import { isMailerDaemonMessage, readOutreachDeliveryReport } from './delivery-status'
import {
  classifyOutreachMessage,
  decideOutreachThread,
  outreachAutoReplyEvidence,
} from './thread-classification'
import { outreachHeader, type OutreachThreadMessage } from './thread-message'

const SELF = ['Avery@Example.org', 'avery@example.net']
const context = { selfAddresses: SELF }

let sequence = 0
const msg = (overrides: Partial<OutreachThreadMessage> = {}): OutreachThreadMessage => {
  sequence += 1
  return {
    id: `m${sequence}`,
    internalDateMs: 1_789_400_000_000 + sequence * 60_000,
    from: 'Casey Morgan <casey@example.com>',
    to: 'Avery Quinn <avery@example.org>',
    subject: "Re: Example Agency's client sites",
    headers: {},
    textBody: 'Thanks — can you send the pricing sheet?',
    ...overrides,
  }
}

describe('headers', () => {
  it('are matched without regard to case', () => {
    const message = msg({ headers: { 'auto-submitted': 'auto-replied', 'X-AUTOREPLY': 'yes' } })
    expect(outreachHeader(message, 'Auto-Submitted')).toBe('auto-replied')
    expect(outreachHeader(message, 'x-autoreply')).toBe('yes')
    expect(outreachHeader(message, 'Precedence')).toBe('')
  })
})

describe('automatic replies', () => {
  it.each([
    [{ 'Auto-Submitted': 'auto-replied' }, 'Auto-Submitted: auto-replied'],
    [{ 'Auto-Submitted': 'auto-generated; owner-email="casey@example.com"' }, 'Auto-Submitted: auto-generated'],
    [{ 'X-Autoreply': 'yes' }, 'X-Autoreply: yes'],
    [{ 'X-Autorespond': 'Casey Morgan' }, 'X-Autorespond: Casey Morgan'],
    [{ Precedence: 'auto_reply' }, 'Precedence: auto_reply'],
    [{ Precedence: 'bulk' }, 'Precedence: bulk'],
    [{ Precedence: 'junk' }, 'Precedence: junk'],
  ])('reads %j as one', (headers, evidence) => {
    expect(outreachAutoReplyEvidence(msg({ headers }))).toBe(evidence)
    expect(classifyOutreachMessage(msg({ headers }), context)).toMatchObject({ kind: 'auto_reply', evidence })
  })

  it('does not read Auto-Submitted: no, or a mailing-list precedence, as one', () => {
    expect(outreachAutoReplyEvidence(msg({ headers: { 'Auto-Submitted': 'no' } }))).toBeNull()
    expect(outreachAutoReplyEvidence(msg({ headers: { Precedence: 'list' } }))).toBeNull()
  })

  it.each([
    'Automatic reply: Example Agency’s client sites',
    'Auto-Reply: Example Agency',
    'Autoreply',
    '[Auto-Reply] Re: client sites',
    'Out of Office: Example Agency',
    'Out of the office until Monday',
    'OOO until 9/21',
    "I'm out of the office",
    'Vacation reply',
    'Away from the office',
    'Abwesenheitsnotiz: Example Agency',
    'Réponse automatique : Example Agency',
    'Respuesta automática: Example Agency',
    'Risposta automatica: Example Agency',
    'Automatisch antwoord: Example Agency',
    'Autosvar: Example Agency',
    'Re: Out of Office',
  ])('reads the subject "%s" as one', (subject) => {
    expect(classifyOutreachMessage(msg({ subject }), context).kind).toBe('auto_reply')
  })

  it.each([
    "Re: Example Agency's client sites",
    'Re: back in the office — let’s talk',
    'Office hours next week?',
    'Re: automatic invoicing question',
  ])('does not read the subject "%s" as one', (subject) => {
    expect(classifyOutreachMessage(msg({ subject }), context).kind).toBe('reply')
  })

  it('reads an automatic reply before its words, so an absence notice is never an opt-out', () => {
    const notice = msg({
      headers: { 'Auto-Submitted': 'auto-replied' },
      textBody: 'I am away. Please stop by the front desk, or remove me from urgent threads.',
    })
    expect(classifyOutreachMessage(notice, context).kind).toBe('auto_reply')
  })
})

describe('real replies and opt-outs', () => {
  it('reads a message from anybody but the mailbox as a reply', () => {
    expect(classifyOutreachMessage(msg(), context)).toEqual({
      messageId: expect.any(String),
      atMs: expect.any(Number),
      kind: 'reply',
      from: 'casey@example.com',
      bounce: null,
      complaint: false,
      evidence: null,
    })
    expect(classifyOutreachMessage(msg({ from: 'Morgan <morgan@example.com>' }), context).kind).toBe('reply')
  })

  it("reads the mailbox's own address and its aliases as its own", () => {
    expect(classifyOutreachMessage(msg({ from: 'Avery Quinn <avery@example.org>' }), context).kind).toBe('self')
    expect(classifyOutreachMessage(msg({ from: 'AVERY@example.net' }), context).kind).toBe('self')
  })

  it('reads an opt-out in the body, and a complaint', () => {
    expect(classifyOutreachMessage(msg({ textBody: 'Please remove me from your list.' }), context)).toMatchObject({
      kind: 'opt_out',
      complaint: false,
      evidence: 'remove me',
    })
    expect(classifyOutreachMessage(msg({ textBody: 'Stop spamming me.' }), context)).toMatchObject({
      kind: 'opt_out',
      complaint: true,
    })
  })

  it('reads the HTML part when there is no text, and the snippet when there is neither', () => {
    expect(
      classifyOutreachMessage(msg({ textBody: undefined, htmlBody: '<div dir="ltr">Not interested.</div>' }), context)
        .kind,
    ).toBe('opt_out')
    expect(
      classifyOutreachMessage(msg({ textBody: undefined, htmlBody: undefined, snippet: 'unsubscribe' }), context).kind,
    ).toBe('opt_out')
  })

  it('reads a new subject on its own, and never the thread subject a reply keeps', () => {
    const fresh = msg({ subject: 'Unsubscribe', textBody: '' })
    expect(classifyOutreachMessage(fresh, { ...context, threadSubject: "Example Agency's client sites" })).toMatchObject({
      kind: 'opt_out',
      evidence: 'Subject: unsubscribe',
    })
    const kept = msg({ subject: 'Re: Stop losing leads', textBody: 'Interesting, tell me more.' })
    expect(classifyOutreachMessage(kept, { ...context, threadSubject: 'Stop losing leads' }).kind).toBe('reply')
    // Without the thread subject to compare, a reply's `Re:` still keeps it
    // from being read, and a headline is never a bare "stop".
    expect(classifyOutreachMessage(kept, context).kind).toBe('reply')
    expect(
      classifyOutreachMessage(msg({ subject: 'Stop losing leads', textBody: 'Interesting.' }), context).kind,
    ).toBe('reply')
    expect(classifyOutreachMessage(msg({ subject: 'Remove me', textBody: '' }), context).kind).toBe('opt_out')
  })

  it('reads a message to the unsubscribe address as an opt-out', () => {
    const unsubscribe = msg({ to: '<unsubscribe+abc@example.org>', subject: 'unsubscribe', textBody: '' })
    expect(
      classifyOutreachMessage(unsubscribe, { ...context, unsubscribeAddress: 'unsubscribe+abc@example.org' }),
    ).toMatchObject({ kind: 'opt_out', evidence: 'To: unsubscribe+abc@example.org' })
  })

  it('reads a mail system that reports no failure as neither a reply nor a bounce', () => {
    const notice = msg({ from: 'postmaster@example.com', subject: 'Mailbox quota notice', textBody: 'Your quota is fine.' })
    expect(classifyOutreachMessage(notice, context).kind).toBe('delivery_report')
    const delivered = msg({
      from: 'mailer-daemon@example.com',
      headers: { 'Content-Type': 'multipart/report; report-type=delivery-status; boundary="b"' },
      parts: [
        {
          mimeType: 'message/delivery-status',
          text: 'Reporting-MTA: dns; mx.example.com\n\nFinal-Recipient: rfc822; casey@example.com\nAction: delivered\nStatus: 2.0.0',
        },
      ],
    })
    expect(classifyOutreachMessage(delivered, context).kind).toBe('delivery_report')
  })
})

describe('delivery reports', () => {
  const report = (statusText: string, overrides: Partial<OutreachThreadMessage> = {}) =>
    msg({
      from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      subject: 'Delivery Status Notification (Failure)',
      headers: { 'Content-Type': 'multipart/report; boundary="x"; report-type="delivery-status"' },
      parts: [{ mimeType: 'message/delivery-status', text: statusText }],
      ...overrides,
    })

  it('knows a mail system by its address or its name', () => {
    expect(isMailerDaemonMessage({ from: 'MAILER-DAEMON@mx.example.net' })).toBe(true)
    expect(isMailerDaemonMessage({ from: 'postmaster@example.net' })).toBe(true)
    expect(isMailerDaemonMessage({ from: 'Mail Delivery System <bounces@example.net>' })).toBe(true)
    expect(isMailerDaemonMessage({ from: 'Casey <casey@example.com>' })).toBe(false)
  })

  it('reads hard and soft from the action and the status class', () => {
    const block = (action: string, status: string) =>
      readOutreachDeliveryReport(report(`Final-Recipient: rfc822; casey@example.com\nAction: ${action}\nStatus: ${status}`))
        ?.kind
    expect(block('failed', '5.2.1')).toBe('hard')
    expect(block('failed', '4.4.7')).toBe('soft')
    expect(block('delayed', '4.2.2')).toBe('soft')
    expect(block('delayed', '5.0.0')).toBe('soft')
    expect(block('delivered', '2.0.0')).toBeNull()
    expect(block('relayed', '2.0.0')).toBeNull()
  })

  it('takes the worst of several recipients, and the original recipient when no final one is given', () => {
    const parsed = readOutreachDeliveryReport(
      report(
        [
          'Reporting-MTA: dns; mx.example.com',
          '',
          'Original-Recipient: rfc822; casey@example.com',
          'Action: delayed',
          'Status: 4.4.1',
          '',
          'Final-Recipient: rfc822;riley@example.net',
          'Action: failed',
          'Status: 5.1.1 (bad destination mailbox address)',
          'Diagnostic-Code: X-Postfix; host mx.example.net said: 550 5.1.1',
          ' <riley@example.net>: Recipient address rejected',
        ].join('\r\n'),
      ),
    )
    expect(parsed).toEqual({
      kind: 'hard',
      recipients: [
        { address: 'casey@example.com', action: 'delayed', status: '4.4.1', diagnostic: null, kind: 'soft' },
        {
          address: 'riley@example.net',
          action: 'failed',
          status: '5.1.1',
          diagnostic: 'host mx.example.net said: 550 5.1.1 <riley@example.net>: Recipient address rejected',
          kind: 'hard',
        },
      ],
      // Casey's delay does not make Casey part of the hard bounce.
      failedAddresses: ['riley@example.net'],
      status: '5.1.1',
      diagnostic: 'host mx.example.net said: 550 5.1.1 <riley@example.net>: Recipient address rejected',
    })
  })

  it('falls back to X-Failed-Recipients and the prose when the status part is not inline', () => {
    const noPart = report('', {
      headers: {
        'Content-Type': 'multipart/report; report-type=delivery-status; boundary="x"',
        'X-Failed-Recipients': 'casey@example.com, riley@example.net',
      },
      parts: [{ mimeType: 'message/delivery-status' }],
      textBody: "Your message wasn't delivered to casey@example.com.\n\nThe response was:\n550 5.1.1 The email account does not exist.",
    })
    expect(readOutreachDeliveryReport(noPart)).toEqual({
      kind: 'hard',
      recipients: [],
      failedAddresses: ['casey@example.com', 'riley@example.net'],
      status: '5.1.1',
      diagnostic: null,
    })
  })

  it('reads a prose bounce that promises to retry as soft, and one with no code as hard', () => {
    const retrying = msg({
      from: 'MAILER-DAEMON@mx.example.net',
      subject: 'Warning: message delayed',
      textBody: 'Your message could not be delivered yet. The server will retry for 4 more days.',
    })
    expect(readOutreachDeliveryReport(retrying)?.kind).toBe('soft')
    const failed = msg({
      from: 'MAILER-DAEMON@mx.example.net',
      subject: 'Undelivered Mail Returned to Sender',
      textBody: 'This is the mail system at host mx.example.net. Your message could not be delivered to one or more recipients.',
    })
    expect(readOutreachDeliveryReport(failed)?.kind).toBe('hard')
  })

  it('is not read into a person’s reply that mentions a bounce', () => {
    const human = msg({ textBody: 'Your last email bounced from our old address — use this one. Status: 5.1.1 lol' })
    expect(readOutreachDeliveryReport(human)).toBeNull()
    expect(classifyOutreachMessage(human, context).kind).toBe('reply')
  })
})

describe('decideOutreachThread', () => {
  const recipient = 'casey@example.com'
  const hardBounce = (address: string | null, atMs: number) =>
    msg({
      from: 'mailer-daemon@googlemail.com',
      internalDateMs: atMs,
      headers: { 'Content-Type': 'multipart/report; report-type=delivery-status' },
      parts: [
        {
          mimeType: 'message/delivery-status',
          text: `${address ? `Final-Recipient: rfc822; ${address}\n` : ''}Action: failed\nStatus: 5.1.1`,
        },
      ],
    })

  it('is none for a thread that holds only its own steps', () => {
    expect(
      decideOutreachThread({ messages: [msg({ from: 'avery@example.org' })], selfAddresses: SELF, recipient }),
    ).toMatchObject({ outcome: 'none', decidedBy: null, hardBounces: 0, softBounces: 0, complaint: false })
  })

  it('ranks opted_out over replied over bounced over postpone, whatever order they arrived in', () => {
    const t = 1_789_500_000_000
    const autoReply = msg({ internalDateMs: t + 1, headers: { 'Auto-Submitted': 'auto-replied' } })
    const bounce = hardBounce(recipient, t + 2)
    const reply = msg({ internalDateMs: t + 3 })
    const optOut = msg({ internalDateMs: t, textBody: 'unsubscribe' })
    expect(decideOutreachThread({ messages: [autoReply], selfAddresses: SELF, recipient }).outcome).toBe('postpone')
    expect(decideOutreachThread({ messages: [reply, bounce, autoReply], selfAddresses: SELF, recipient }).outcome).toBe(
      'replied',
    )
    expect(decideOutreachThread({ messages: [bounce, autoReply], selfAddresses: SELF, recipient })).toMatchObject({
      outcome: 'bounced',
      hardBounces: 1,
    })
    const all = decideOutreachThread({ messages: [reply, optOut, bounce, autoReply], selfAddresses: SELF, recipient })
    expect(all.outcome).toBe('opted_out')
    expect(all.decidedBy?.messageId).toBe(optOut.id)
    expect(all.classifications.map((entry) => entry.messageId)).toEqual([optOut.id, autoReply.id, bounce.id, reply.id])
  })

  it('attributes a bounce that names no recipient to the thread it arrived in', () => {
    expect(
      decideOutreachThread({ messages: [hardBounce(null, 1)], selfAddresses: SELF, recipient }),
    ).toMatchObject({ outcome: 'bounced', hardBounces: 1 })
  })

  it('flags a complaint for the mailbox', () => {
    expect(
      decideOutreachThread({ messages: [msg({ textBody: 'This is spam.' })], selfAddresses: SELF, recipient }),
    ).toMatchObject({ outcome: 'opted_out', complaint: true })
  })
})
