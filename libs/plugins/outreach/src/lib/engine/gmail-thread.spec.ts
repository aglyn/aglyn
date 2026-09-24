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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readOutreachDeliveryReport } from './delivery-status'
import { classifyOutreachMessage, decideOutreachThread } from './thread-classification'
import {
  type GmailApiHeader,
  type GmailApiMessage,
  type GmailApiMessagePart,
  outreachThreadMessageFromGmail,
} from './thread-message'

/**
 * Whole messages, as the Gmail API hands them over, through the adapter and
 * the classifier together.
 *
 * The fixtures in `./fixtures` are raw RFC 5322 messages modeled on what
 * lands in a Gmail mailbox: Gmail's own delivery status notifications — the
 * `multipart/report` with its `message/delivery-status` part, the human
 * text, the icon and the original message — a Microsoft 365 non-delivery
 * report, a prose bounce from a qmail server, automatic replies, a reply
 * with its quoted history. Every address is on an `example` domain.
 *
 * `gmailMessage` below turns a raw message into the Gmail API's `format=full`
 * resource the way the API builds it: headers as a list, every multipart
 * nested under `parts`, and each leaf body decoded from its transfer
 * encoding and re-encoded as base64url. That keeps the fixtures readable as
 * mail while the adapter still reads the API's wire shape.
 */

const SELF = ['avery@example.org']

function header(headers: GmailApiHeader[], name: string): string {
  return headers.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function parseHeaders(block: string): GmailApiHeader[] {
  const headers: GmailApiHeader[] = []
  for (const line of block.split('\n')) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].value += ` ${line.trim()}`
    } else {
      const colon = line.indexOf(':')
      if (colon > 0) headers.push({ name: line.slice(0, colon), value: line.slice(colon + 1).trim() })
    }
  }
  return headers
}

function decodeQuotedPrintable(text: string): Buffer {
  const joined = text.replace(/=\n/g, '')
  const bytes: number[] = []
  for (let index = 0; index < joined.length; index += 1) {
    const hex = joined.slice(index + 1, index + 3)
    if (joined[index] === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16))
      index += 2
    } else {
      bytes.push(...Buffer.from(joined[index], 'utf8'))
    }
  }
  return Buffer.from(bytes)
}

function parsePart(raw: string, partId: string): GmailApiMessagePart {
  const split = raw.indexOf('\n\n')
  const headers = parseHeaders(split >= 0 ? raw.slice(0, split) : raw)
  const body = split >= 0 ? raw.slice(split + 2) : ''
  const contentType = header(headers, 'Content-Type') || 'text/plain'
  const mimeType = contentType.split(';')[0].trim().toLowerCase()
  const filename = /filename="?([^";]+)"?/i.exec(header(headers, 'Content-Disposition'))?.[1] ?? ''
  if (mimeType.startsWith('multipart/')) {
    const boundary = /boundary="?([^";\s]+)"?/i.exec(contentType)?.[1] ?? ''
    const parts: GmailApiMessagePart[] = []
    for (const section of body.split(`--${boundary}`).slice(1)) {
      if (section.startsWith('--')) break
      const content = section.replace(/^\n/, '').replace(/\n$/, '')
      parts.push(parsePart(content, partId ? `${partId}.${parts.length}` : String(parts.length)))
    }
    return { partId, mimeType, filename, headers, body: { size: 0 }, parts }
  }
  const encoding = header(headers, 'Content-Transfer-Encoding').toLowerCase()
  const bytes =
    encoding === 'base64'
      ? Buffer.from(body.replace(/\s+/g, ''), 'base64')
      : encoding === 'quoted-printable'
        ? decodeQuotedPrintable(body)
        : Buffer.from(body, 'utf8')
  return {
    partId,
    mimeType,
    filename,
    headers,
    body: { size: bytes.length, data: bytes.toString('base64url') },
  }
}

const escapeSnippet = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;')

function gmailMessage(fixture: string, id: string, internalDate: string): GmailApiMessage {
  const raw = readFileSync(join(__dirname, 'fixtures', fixture), 'utf8').replace(/\r\n/g, '\n')
  const payload = parsePart(raw, '')
  const firstText = (part: GmailApiMessagePart): string | null => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf8')
    }
    for (const child of part.parts ?? []) {
      const text = firstText(child)
      if (text !== null) return text
    }
    return null
  }
  return {
    id,
    threadId: 'thread-1',
    labelIds: ['INBOX'],
    snippet: escapeSnippet((firstText(payload) ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)),
    internalDate,
    payload,
  }
}

const message = (fixture: string, id = fixture, internalDate = '1789398003000') =>
  outreachThreadMessageFromGmail(gmailMessage(fixture, id, internalDate))

describe('the Gmail API message adapter', () => {
  it('reads the headers, the decoded text, and every part of a delivery report', () => {
    const bounce = message('gmail-hard-bounce-no-such-user.eml', 'msg-bounce')
    expect(bounce).toMatchObject({
      id: 'msg-bounce',
      threadId: 'thread-1',
      internalDateMs: 1789398003000,
      from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      to: 'avery@example.org',
      subject: 'Delivery Status Notification (Failure)',
      labelIds: ['INBOX'],
    })
    expect(bounce.headers['X-Failed-Recipients']).toBe('casey@example.com')
    expect(bounce.textBody).toContain("Your message wasn't delivered to casey@example.com")
    expect(bounce.htmlBody).toContain('<p style="font-size:24px;">Address not found</p>')
    expect(bounce.parts?.map((part) => part.mimeType)).toEqual([
      'multipart/report',
      'multipart/related',
      'multipart/alternative',
      'text/plain',
      'text/html',
      'image/png',
      'message/delivery-status',
      'message/rfc822',
    ])
    const status = bounce.parts?.find((part) => part.mimeType === 'message/delivery-status')
    expect(status?.text).toContain('Final-Recipient: rfc822; casey@example.com')
    // The icon is an attachment and not text; the snippet arrives unescaped.
    expect(bounce.parts?.find((part) => part.mimeType === 'image/png')?.text).toBeUndefined()
    expect(bounce.snippet).toContain("wasn't delivered")
  })

  it('decodes quoted-printable bodies in their own character set', () => {
    const reply = message('gmail-real-reply.eml')
    expect(reply.textBody).toContain('We run 14 client sites today — what would that land at?')
    expect(reply.textBody).toContain('Example Co LLC · PO Box 12345')
  })

  it('never throws on a message with no payload or a body that does not decode', () => {
    expect(outreachThreadMessageFromGmail({ id: 'empty' })).toEqual({
      id: 'empty',
      internalDateMs: 0,
      from: '',
      to: '',
      subject: '',
      headers: {},
      parts: [],
    })
    const broken = outreachThreadMessageFromGmail({
      id: 'broken',
      internalDate: 'not a date',
      payload: { mimeType: 'text/plain', headers: [], body: { data: '%%%not base64%%%' } },
    })
    expect(broken.textBody).toBeUndefined()
    expect(broken.internalDateMs).toBe(0)
  })
})

describe("Gmail's own delivery status notifications", () => {
  it('reads a 5.1.1 for a mailbox that does not exist as a hard bounce', () => {
    const bounce = message('gmail-hard-bounce-no-such-user.eml')
    expect(readOutreachDeliveryReport(bounce)).toEqual({
      kind: 'hard',
      recipients: [
        {
          address: 'casey@example.com',
          action: 'failed',
          status: '5.1.1',
          diagnostic: expect.stringMatching(
            /^550-5\.1\.1 The email account that you tried to reach does not exist\. .*550 5\.1\.1/,
          ),
          remoteMta: expect.any(String),
          kind: 'hard',
        },
      ],
      failedAddresses: ['casey@example.com'],
      status: '5.1.1',
      diagnostic: expect.any(String),
      remoteMta: expect.any(String),
    })
    expect(classifyOutreachMessage(bounce, { selfAddresses: SELF })).toMatchObject({
      kind: 'hard_bounce',
      from: 'mailer-daemon@googlemail.com',
      bounce: { recipients: ['casey@example.com'], status: '5.1.1' },
    })
  })

  it('reads a delayed 4.7.0 as a soft bounce', () => {
    const delayed = message('gmail-soft-bounce-delayed.eml')
    expect(readOutreachDeliveryReport(delayed)).toMatchObject({
      kind: 'soft',
      status: '4.7.0',
      failedAddresses: ['casey@example.com'],
    })
    expect(classifyOutreachMessage(delayed, { selfAddresses: SELF }).kind).toBe('soft_bounce')
  })

  it('reads a 5.7.1 policy rejection as a hard bounce too', () => {
    const blocked = message('gmail-hard-bounce-policy-block.eml')
    expect(classifyOutreachMessage(blocked, { selfAddresses: SELF })).toMatchObject({
      kind: 'hard_bounce',
      bounce: { recipients: ['riley@example.net'], status: '5.7.1' },
    })
  })
})

describe('other servers’ reports', () => {
  it('reads a Microsoft 365 non-delivery report, whatever its sender is called', () => {
    const ndr = message('exchange-ndr-recipient-not-found.eml')
    expect(classifyOutreachMessage(ndr, { selfAddresses: SELF })).toMatchObject({
      kind: 'hard_bounce',
      bounce: {
        recipients: ['riley@example.net'],
        status: '5.1.10',
        diagnostic: '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient riley@example.net not found by SMTP address lookup',
      },
    })
  })

  it('reads a prose bounce from a mailer daemon by the code it quotes', () => {
    const notice = message('prose-bounce-failure-notice.eml')
    expect(readOutreachDeliveryReport(notice)).toEqual({
      kind: 'hard',
      recipients: [],
      failedAddresses: [],
      status: '5.1.1',
      diagnostic: null,
      remoteMta: null,
    })
  })
})

describe('replies', () => {
  it('reads an Outlook automatic reply by its header, and a responder by its subject', () => {
    expect(classifyOutreachMessage(message('outlook-automatic-reply.eml'), { selfAddresses: SELF })).toMatchObject({
      kind: 'auto_reply',
      evidence: 'Auto-Submitted: auto-generated',
    })
    expect(
      classifyOutreachMessage(message('vacation-responder-subject-only.eml'), { selfAddresses: SELF }),
    ).toMatchObject({ kind: 'auto_reply', evidence: 'Subject: Out of Office' })
  })

  it('reads a real reply as one, whatever its quoted history says', () => {
    expect(classifyOutreachMessage(message('gmail-real-reply.eml'), { selfAddresses: SELF })).toMatchObject({
      kind: 'reply',
      from: 'casey@example.com',
      complaint: false,
    })
  })

  it('reads "No thanks." above the quoted footer as an opt-out', () => {
    expect(classifyOutreachMessage(message('gmail-opt-out-reply.eml'), { selfAddresses: SELF })).toMatchObject({
      kind: 'opt_out',
      evidence: 'no thanks',
    })
  })

  it("reads the mailbox's own step as its own", () => {
    expect(classifyOutreachMessage(message('gmail-sent-step.eml'), { selfAddresses: SELF }).kind).toBe('self')
  })
})

describe('a whole thread', () => {
  const thread = (...entries: Array<[string, string]>) =>
    entries.map(([fixture, internalDate], index) => message(fixture, `m${index + 1}`, internalDate))

  it('stops for a hard bounce of this recipient and counts it for mailbox health', () => {
    const decision = decideOutreachThread({
      messages: thread(['gmail-sent-step.eml', '1789398001000'], ['gmail-hard-bounce-no-such-user.eml', '1789398003000']),
      selfAddresses: SELF,
      recipient: 'casey@example.com',
    })
    expect(decision).toMatchObject({ outcome: 'bounced', hardBounces: 1, softBounces: 0, complaint: false })
    expect(decision.decidedBy?.messageId).toBe('m2')
    expect(decision.classifications.map((entry) => entry.kind)).toEqual(['self', 'hard_bounce'])
  })

  it('postpones for an automatic reply, and lets a later real reply decide', () => {
    const away = decideOutreachThread({
      messages: thread(['gmail-sent-step.eml', '1789398001000'], ['outlook-automatic-reply.eml', '1789398009000']),
      selfAddresses: SELF,
      recipient: 'casey@example.com',
    })
    expect(away.outcome).toBe('postpone')
    const answered = decideOutreachThread({
      messages: thread(
        ['gmail-sent-step.eml', '1789398001000'],
        ['outlook-automatic-reply.eml', '1789398009000'],
        ['gmail-real-reply.eml', '1789490538000'],
      ),
      selfAddresses: SELF,
      recipient: 'casey@example.com',
    })
    expect(answered.outcome).toBe('replied')
    expect(answered.decidedBy?.messageId).toBe('m3')
  })

  it('lets an opt-out outrank the reply before it', () => {
    const decision = decideOutreachThread({
      messages: thread(
        ['gmail-real-reply.eml', '1789490538000'],
        ['gmail-soft-bounce-delayed.eml', '1789560310000'],
        ['gmail-opt-out-reply.eml', '1789653835000'],
      ),
      selfAddresses: SELF,
      recipient: 'casey@example.com',
    })
    expect(decision).toMatchObject({ outcome: 'opted_out', softBounces: 1, hardBounces: 0 })
    expect(decision.decidedBy?.messageId).toBe('m3')
  })

  it('ignores a bounce about somebody else, and what an earlier run handled', () => {
    const elsewhere = decideOutreachThread({
      messages: thread(['gmail-hard-bounce-policy-block.eml', '1789490000000']),
      selfAddresses: SELF,
      recipient: 'casey@example.com',
    })
    expect(elsewhere).toMatchObject({ outcome: 'none', hardBounces: 0 })
    const handled = decideOutreachThread({
      messages: thread(['gmail-real-reply.eml', '1789490538000'], ['gmail-opt-out-reply.eml', '1789653835000']),
      selfAddresses: SELF,
      recipient: 'casey@example.com',
      afterMs: 1789490538000,
    })
    expect(handled.classifications.map((entry) => entry.messageId)).toEqual(['m2'])
    const byId = decideOutreachThread({
      messages: thread(['gmail-real-reply.eml', '1789490538000']),
      selfAddresses: SELF,
      recipient: 'casey@example.com',
      handledMessageIds: ['m1'],
    })
    expect(byId).toMatchObject({ outcome: 'none', decidedBy: null, classifications: [] })
  })
})
