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

import type { OutreachEmailStep, OutreachTaskStep } from '../model/outreach.types'
import {
  type ComposeOutreachEmailInput,
  composeOutreachEmail,
  composeOutreachFooter,
  OUTREACH_OPT_OUT_LINE,
  outreachMessageIdHeader,
} from './compose'

const GROUP = 'group-site-1'

const ORG = {
  legalName: 'Example Co LLC',
  brandName: 'Example Co',
  postalAddress: 'PO Box 12345\nAnytown, TX 75001',
}

const FOOTER =
  'Example Co LLC · PO Box 12345, Anytown, TX 75001\n' +
  'This is a sales email from Example Co. Not interested? Reply "no" and I won\'t email again.'

const first: OutreachEmailStep = {
  id: 'email-1',
  kind: 'email',
  delayBusinessDays: 0,
  subject: "{{contact.company}}'s client sites",
  replyInThread: false,
  body: 'Hi {{contact.firstName}},\n\n{{enrollment.personalLine}}\n\nWorth 20 minutes?\n\n{{sender.firstName}}',
  templateId: null,
}
const followUp: OutreachEmailStep = {
  ...first,
  id: 'email-2',
  subject: '',
  replyInThread: true,
  delayBusinessDays: 3,
  body: '{{contact.firstName}} — did the math for a portfolio your size.',
}
const task: OutreachTaskStep = { id: 'task-1', kind: 'task', taskKind: 'call', title: 'Call', delayBusinessDays: 1 }
const fromTemplate: OutreachEmailStep = { ...followUp, id: 'email-3', body: '', templateId: 'template-1', delayBusinessDays: 5 }

const input = (overrides: Partial<ComposeOutreachEmailInput> = {}): ComposeOutreachEmailInput => ({
  sequence: { steps: [first, followUp, task, fromTemplate] },
  enrollment: {
    email: 'Casey@Example.com',
    stepIndex: 0,
    personalLine: 'Saw the portfolio launch last week.',
    threadSubject: null,
    messageIds: [],
    gmailThreadId: null,
  },
  orgSettings: ORG,
  merge: {
    contact: {
      email: 'casey@example.com',
      name: 'Casey Morgan',
      facets: { [GROUP]: { companyName: 'Example Agency', sources: {}, interactions: [] } },
    },
    contactGroupId: GROUP,
    sender: { name: 'Avery Quinn', email: 'avery@example.org' },
    site: { name: 'Example Co' },
  },
  ...overrides,
})

const inThread = {
  email: 'casey@example.com',
  stepIndex: 1,
  personalLine: 'Saw the portfolio launch last week.',
  threadSubject: "Example Agency's client sites",
  messageIds: ['<step-1@example.org>'],
  gmailThreadId: 'thread-1',
}

describe('the footer', () => {
  it('names the organization, its postal address, what the email is, and the way out', () => {
    expect(composeOutreachFooter(ORG)).toEqual({ footer: FOOTER, error: null })
  })

  it('uses the legal name in the solicitation sentence when there is no brand name', () => {
    expect(composeOutreachFooter({ ...ORG, brandName: '  ' }).footer).toBe(
      'Example Co LLC · PO Box 12345, Anytown, TX 75001\n' +
        `This is a sales email from Example Co LLC. ${OUTREACH_OPT_OUT_LINE}`,
    )
  })

  it('prints a multi-line address on one line', () => {
    expect(
      composeOutreachFooter({ ...ORG, postalAddress: '  100 Example Ave,\r\nSuite 200\n\nAnytown, TX 75001 ' }).footer,
    ).toMatch(/^Example Co LLC · 100 Example Ave, Suite 200, Anytown, TX 75001\n/)
  })

  it('refuses without a postal address, with a typed error', () => {
    for (const postalAddress of ['', '   ', '\n\n']) {
      expect(composeOutreachFooter({ ...ORG, postalAddress })).toEqual({
        footer: null,
        error: {
          code: 'missing_postal_address',
          message: "This email can't be sent without your organization's postal address. Add it in Sequences settings.",
        },
      })
    }
    expect(composeOutreachFooter(null).error?.code).toBe('missing_postal_address')
  })

  it('refuses without a legal name', () => {
    expect(composeOutreachFooter({ ...ORG, legalName: '' }).error?.code).toBe('missing_legal_name')
  })
})

describe('composeOutreachEmail: the first email', () => {
  it('fills the merge fields, the personal line among them, and appends the footer', () => {
    expect(composeOutreachEmail(input())).toEqual({
      email: {
        to: 'casey@example.com',
        trackedLinks: [],
        subject: "Example Agency's client sites",
        text:
          'Hi Casey,\n\nSaw the portfolio launch last week.\n\nWorth 20 minutes?\n\nAvery\n\n' + FOOTER,
      },
      error: null,
      unresolvedFields: [],
    })
  })

  it('refuses to write any email without the footer', () => {
    const result = composeOutreachEmail(input({ orgSettings: { ...ORG, postalAddress: '' } }))
    expect(result).toEqual({
      email: null,
      error: expect.objectContaining({ code: 'missing_postal_address' }),
      unresolvedFields: [],
    })
  })

  it('keeps the footer out of reach of the template and the merge', () => {
    const result = composeOutreachEmail(
      input({
        sequence: { steps: [{ ...first, body: 'Short note.\n\n{{site.name}}' }] },
        orgSettings: { ...ORG, legalName: '{{contact.email}} LLC' },
      }),
    )
    expect(result.email?.text.endsWith(
      '{{contact.email}} LLC · PO Box 12345, Anytown, TX 75001\n' +
        `This is a sales email from Example Co. ${OUTREACH_OPT_OUT_LINE}`,
    )).toBe(true)
  })

  it('returns the fields that rendered empty, for the runtime to decide on', () => {
    const result = composeOutreachEmail(
      input({ merge: { contact: { email: 'casey@example.com' }, contactGroupId: GROUP } }),
    )
    expect(result.email?.subject).toBe("'s client sites")
    expect(result.unresolvedFields).toEqual(['contact.company', 'contact.firstName', 'sender.firstName'])
  })

  it('writes the text with LF line breaks and no trailing blanks', () => {
    const result = composeOutreachEmail(
      input({ sequence: { steps: [{ ...first, body: '\r\n\r\nLine one   \r\nLine two\t\r\n\r\n' }] } }),
    )
    expect(result.email?.text).toBe(`Line one\nLine two\n\n${FOOTER}`)
  })

  it('refuses a subject that is empty or starts with a reply prefix once merged', () => {
    expect(composeOutreachEmail(input({ sequence: { steps: [{ ...first, subject: '{{deal.name}}' }] } })).error).toEqual({
      code: 'missing_subject',
      message: 'This email has no subject.',
    })
    const deceptive = composeOutreachEmail(
      input({
        sequence: { steps: [{ ...first, subject: '{{deal.name}}' }] },
        merge: { deal: { title: 'Re: our call' } },
      }),
    )
    expect(deceptive.error?.code).toBe('subject_reply_prefix')
  })

  it('keeps a header free of line breaks a merged value carried', () => {
    const result = composeOutreachEmail(
      input({
        merge: {
          contact: { email: 'casey@example.com', facets: { [GROUP]: { companyName: 'Example\r\nBcc: someone@example.net' } } },
          contactGroupId: GROUP,
        },
      }),
    )
    expect(result.email?.subject).toBe("Example Bcc: someone@example.net's client sites")
    expect(result.email?.subject).not.toMatch(/[\r\n]/)
  })

  it('refuses a step that sends no email, a recipient that is not an address, and an empty body', () => {
    expect(composeOutreachEmail(input({ enrollment: { ...input().enrollment, stepIndex: 2 } })).error?.code).toBe(
      'not_an_email_step',
    )
    expect(composeOutreachEmail(input({ enrollment: { ...input().enrollment, email: 'casey' } })).error?.code).toBe(
      'invalid_recipient',
    )
    expect(
      composeOutreachEmail(input({ sequence: { steps: [{ ...first, body: '{{contact.title}}' }] } })).error?.code,
    ).toBe('missing_body')
  })
})

describe('composeOutreachEmail: threading', () => {
  it('replies in the thread: Re: the thread subject, In-Reply-To the last message, References them all', () => {
    const result = composeOutreachEmail(
      input({
        enrollment: {
          ...inThread,
          messageIds: ['<step-1@example.org>', 'step-2@example.org'],
        },
      }),
    )
    expect(result.error).toBeNull()
    expect(result.email).toEqual({
      to: 'casey@example.com',
      subject: "Re: Example Agency's client sites",
      text: `Casey — did the math for a portfolio your size.\n\n${FOOTER}`,
      threadId: 'thread-1',
      inReplyTo: '<step-2@example.org>',
      references: '<step-1@example.org> <step-2@example.org>',
      trackedLinks: [],
    })
  })

  it('never stacks prefixes on a thread subject', () => {
    const result = composeOutreachEmail(
      input({ enrollment: { ...inThread, threadSubject: 'RE: Fwd: Example Agency' } }),
    )
    expect(result.email?.subject).toBe('Re: Example Agency')
  })

  it('refuses a reply step with no thread to answer rather than borrow a Re:', () => {
    for (const enrollment of [
      { ...inThread, messageIds: [] },
      { ...inThread, threadSubject: null },
      { ...inThread, gmailThreadId: null },
      { ...inThread, messageIds: ['not an id'] },
    ]) {
      expect(composeOutreachEmail(input({ enrollment })).error).toEqual({
        code: 'missing_thread',
        message: 'This email replies in the thread, and no earlier email in the thread was sent.',
      })
    }
  })

  it('sends a template body the caller resolved, still merged and footed', () => {
    const result = composeOutreachEmail(
      input({
        enrollment: { ...inThread, stepIndex: 3 },
        templateBody: 'Hi {{contact.firstName}}, closing the loop on my last note.',
      }),
    )
    expect(result.email?.text).toBe(`Hi Casey, closing the loop on my last note.\n\n${FOOTER}`)
    expect(composeOutreachEmail(input({ enrollment: { ...inThread, stepIndex: 3 } })).error?.code).toBe('missing_body')
  })

  it('writes Message-IDs in their header form', () => {
    expect(outreachMessageIdHeader('abc@example.org')).toBe('<abc@example.org>')
    expect(outreachMessageIdHeader(' <<abc@example.org>> ')).toBe('<abc@example.org>')
    expect(outreachMessageIdHeader('two words@example.org')).toBeNull()
    expect(outreachMessageIdHeader('')).toBeNull()
  })
})

describe('composeOutreachEmail: unsubscribe headers', () => {
  it('passes a signed https URL and a mailto through', () => {
    const result = composeOutreachEmail(
      input({
        listUnsubscribeUrl: 'https://app.example.com/u/outreach?token=abc.def',
        listUnsubscribeMailto: 'unsubscribe+abc@example.org',
      }),
    )
    expect(result.email).toMatchObject({
      listUnsubscribeUrl: 'https://app.example.com/u/outreach?token=abc.def',
      listUnsubscribeMailto: 'mailto:unsubscribe+abc@example.org?subject=unsubscribe',
    })
    expect(
      composeOutreachEmail(input({ listUnsubscribeMailto: 'mailto:unsubscribe%2Babc@example.org?subject=stop' })).email
        ?.listUnsubscribeMailto,
    ).toBe('mailto:unsubscribe%2Babc@example.org?subject=stop')
  })

  it('leaves both out when none is given', () => {
    const { email } = composeOutreachEmail(input({ listUnsubscribeUrl: '', listUnsubscribeMailto: null }))
    expect(email).not.toHaveProperty('listUnsubscribeUrl')
    expect(email).not.toHaveProperty('listUnsubscribeMailto')
  })

  it('refuses a link that is not https, and an address that is not one', () => {
    for (const listUnsubscribeUrl of ['http://app.example.com/u', 'javascript:alert(1)', 'not a url', 'https://example.com/u\r\nX: y']) {
      expect(composeOutreachEmail(input({ listUnsubscribeUrl })).error?.code).toBe('invalid_unsubscribe_url')
    }
    for (const listUnsubscribeMailto of ['unsubscribe', 'mailto:nobody', 'mailto:%E0%A4%A@example.org']) {
      expect(composeOutreachEmail(input({ listUnsubscribeMailto })).error?.code).toBe('invalid_unsubscribe_mailto')
    }
  })
})

describe('click tracking (AGL-3239)', () => {
  /** A minter that wraps every link, so the composer's boundary is what is measured. */
  const wrap = (link: { url: string; index: number }) => `https://console.example.com/api/outreach/click?t=${link.index}`

  const withLink = (body: string): Partial<ComposeOutreachEmailInput> => ({
    sequence: { steps: [{ ...first, body }] },
  })

  it('leaves every link alone when no minter is given', () => {
    // What a PREVIEW passes, and what a sequence with tracking off passes.
    // A preview that minted live links would count the rep's own click.
    const result = composeOutreachEmail(input(withLink('Read https://aglyn.com/pricing first.')))
    expect(result.email?.text).toContain('https://aglyn.com/pricing')
    expect(result.email?.trackedLinks).toEqual([])
  })

  it('rewrites the step’s links and reports them in token order', () => {
    const result = composeOutreachEmail(
      input({ ...withLink('One https://a.example two https://b.example'), rewriteLink: wrap }),
    )
    expect(result.email?.text).toContain('click?t=0')
    expect(result.email?.text).toContain('click?t=1')
    expect(result.email?.trackedLinks).toEqual(['https://a.example', 'https://b.example'])
  })

  it('never rewrites the footer', () => {
    // The organization's identification and the way out are appended AFTER
    // the rewrite, so no minter can reach them however a step is written.
    const result = composeOutreachEmail(
      input({ ...withLink('Read https://aglyn.com/pricing.'), rewriteLink: wrap }),
    )
    expect(result.email?.text.endsWith(FOOTER)).toBe(true)
    expect(result.email?.text).toContain(OUTREACH_OPT_OUT_LINE)
  })

  it('does not put a tracking link in the unsubscribe header', () => {
    // The one-click link is minted by the runtime and rides in
    // `List-Unsubscribe`; it never appears in a body, so no rewriter can
    // reach it and route a recipient's opt-out through our own counter.
    const result = composeOutreachEmail(
      input({
        ...withLink('Read https://aglyn.com/pricing.'),
        rewriteLink: wrap,
        listUnsubscribeUrl: 'https://console.example.com/api/outreach/unsubscribe?t=abc.def',
      }),
    )
    expect(result.email?.listUnsubscribeUrl).toBe(
      'https://console.example.com/api/outreach/unsubscribe?t=abc.def',
    )
    expect(result.email?.text).not.toContain('outreach/unsubscribe')
  })
})
