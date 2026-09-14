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
  buildCrmCapturedEmailActivity,
  CRM_INBOUND_DEFAULT_DOMAIN,
  CRM_INBOUND_EXCERPT_MAX,
  CRM_INBOUND_TOKEN_LENGTH,
  crmCapturedEmailKey,
  crmInboundAddress,
  crmInboundCandidates,
  crmInboundDomain,
  crmInboundExcerpt,
  crmInboundRoster,
  crmInboundTokenOf,
  crmInboundTokensIn,
  crmThreadSubject,
  emailAddressOf,
  emailDomainOf,
  forwardedSection,
  htmlToPlainText,
  isCrmInboundAddress,
  isCrmInboundToken,
  mintCrmInboundToken,
  stripQuotedHistory,
} from './crm-inbound'

const DOMAIN = 'in.aglyn.com'
const TOKEN = 'k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3'

describe('the capture address (AGL-2657)', () => {
  it('mints a lowercase url-safe token of the promised length, never the same one twice', () => {
    const first = mintCrmInboundToken()
    const second = mintCrmInboundToken()
    expect(first).toHaveLength(CRM_INBOUND_TOKEN_LENGTH)
    expect(first).toMatch(/^[a-z0-9]+$/)
    expect(isCrmInboundToken(first)).toBe(true)
    expect(first).not.toBe(second)
  })

  it('refuses a token that is short, uppercase or not a string', () => {
    expect(isCrmInboundToken('abc')).toBe(false)
    expect(isCrmInboundToken(TOKEN.toUpperCase())).toBe(false)
    expect(isCrmInboundToken(42)).toBe(false)
    expect(isCrmInboundToken(TOKEN)).toBe(true)
  })

  it('reads the domain off the environment and falls back to the platform default', () => {
    expect(crmInboundDomain({})).toBe(CRM_INBOUND_DEFAULT_DOMAIN)
    expect(crmInboundDomain({ CRM_INBOUND_DOMAIN: ' In.Example.COM ' })).toBe('in.example.com')
    // Not a hostname: the default, not a broken address.
    expect(crmInboundDomain({ CRM_INBOUND_DOMAIN: 'not a domain' })).toBe(
      CRM_INBOUND_DEFAULT_DOMAIN,
    )
  })

  it('spells the address as crm+<token>@<domain>', () => {
    expect(crmInboundAddress(TOKEN, DOMAIN)).toBe(`crm+${TOKEN}@in.aglyn.com`)
  })

  it('reads the token back off a recipient, display name and case folding included', () => {
    expect(crmInboundTokenOf(`crm+${TOKEN}@in.aglyn.com`, DOMAIN)).toBe(TOKEN)
    expect(crmInboundTokenOf(`Aglyn CRM <CRM+${TOKEN}@IN.AGLYN.COM>`, DOMAIN)).toBe(TOKEN)
    expect(isCrmInboundAddress(`crm+${TOKEN}@in.aglyn.com`, DOMAIN)).toBe(true)
  })

  it('answers nothing for an address on another domain, another local part, or a short token', () => {
    expect(crmInboundTokenOf(`crm+${TOKEN}@aglyn.com`, DOMAIN)).toBeNull()
    expect(crmInboundTokenOf(`support+${TOKEN}@in.aglyn.com`, DOMAIN)).toBeNull()
    expect(crmInboundTokenOf('crm+short@in.aglyn.com', DOMAIN)).toBeNull()
    expect(crmInboundTokenOf('crm@in.aglyn.com', DOMAIN)).toBeNull()
    expect(crmInboundTokenOf('', DOMAIN)).toBeNull()
  })

  it('collects every distinct token across the recipients, in order', () => {
    const other = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    expect(
      crmInboundTokensIn(
        [
          'ada@example.com',
          `crm+${TOKEN}@in.aglyn.com`,
          `crm+${other}@in.aglyn.com`,
          `crm+${TOKEN}@in.aglyn.com`,
        ],
        DOMAIN,
      ),
    ).toEqual([TOKEN, other])
  })
})

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
    expect(crmThreadSubject('Re: Fwd: RE: Renewal  quote')).toBe('Renewal quote')
    expect(crmThreadSubject('FW: AW [2]: Hello')).toBe('Hello')
    expect(crmThreadSubject('Renewal')).toBe('Renewal')
    expect(crmThreadSubject(undefined)).toBe('')
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
    expect(crmInboundExcerpt(text)).toBe('Thanks — Tuesday works.\n\nAda')
  })

  it('reads a wrapped "On … wrote:" intro across two lines', () => {
    const text = 'Yes please.\n\nOn Mon, Sep 7, 2026 at 3:12 PM Sam Rep\n<sam@acme.com> wrote:\n> Shall I?'
    expect(crmInboundExcerpt(text)).toBe('Yes please.')
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
    expect(crmInboundExcerpt(text)).toBe('Could we push the renewal to October?')
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
    expect(crmInboundExcerpt(text)).toBe('October, please.')
  })

  it('falls back to the words of the HTML part when there is no text part', () => {
    const html =
      '<html><style>p{color:red}</style><body><p>Hello &amp; welcome</p><div>Line two<br>Line three</div></body></html>'
    expect(htmlToPlainText(html)).toBe('Hello & welcome\nLine two\nLine three\n')
    expect(crmInboundExcerpt('', html)).toBe('Hello & welcome\nLine two\nLine three')
  })

  it('is bounded and settles whitespace', () => {
    const long = 'a'.repeat(CRM_INBOUND_EXCERPT_MAX + 50)
    expect(crmInboundExcerpt(long)).toHaveLength(CRM_INBOUND_EXCERPT_MAX)
    expect(crmInboundExcerpt('one  \r\n\r\n\r\n\r\ntwo   ')).toBe('one\n\ntwo')
  })
})

describe('who the message was with', () => {
  const members = [{ email: 'sam@acme.com' }, { email: 'Kim@Acme.com' }]
  const capture = `crm+${TOKEN}@in.aglyn.com`

  it('names a reply’s From first, as inbound, and never the capture address or a member', () => {
    const result = crmInboundCandidates({
      from: 'Ada <ada@example.com>',
      to: ['sam@acme.com', capture],
      cc: ['kim@acme.com', 'bob@other.example'],
      domain: DOMAIN,
      members,
    })
    expect(result.sender).toBe('ada@example.com')
    expect(result.senderIsMember).toBe(false)
    expect(result.candidates).toEqual([
      { email: 'ada@example.com', direction: 'inbound', via: 'from' },
      { email: 'bob@other.example', direction: 'inbound', via: 'cc' },
    ])
  })

  it('names the To of a message a member wrote, as outbound', () => {
    const result = crmInboundCandidates({
      from: 'Sam Rep <sam@acme.com>',
      to: ['Ada <ada@example.com>'],
      cc: [capture],
      domain: DOMAIN,
      members,
    })
    expect(result.senderIsMember).toBe(true)
    expect(result.candidates).toEqual([
      { email: 'ada@example.com', direction: 'outbound', via: 'to' },
    ])
  })

  it("tries a forward's inner From last, as inbound", () => {
    const result = crmInboundCandidates({
      from: 'sam@acme.com',
      to: [capture],
      forwardedFrom: 'ada@example.com',
      domain: DOMAIN,
      members,
    })
    expect(result.candidates).toEqual([
      { email: 'ada@example.com', direction: 'inbound', via: 'forwarded' },
    ])
  })

  it('lists each address once', () => {
    const result = crmInboundCandidates({
      from: 'ada@example.com',
      to: ['ADA@example.com'],
      forwardedFrom: 'ada@example.com',
      domain: DOMAIN,
      members: [],
    })
    expect(result.candidates).toHaveLength(1)
  })
})

describe("a member's confirmed alias is the member (AGL-2975)", () => {
  const capture = `crm+${TOKEN}@in.aglyn.com`
  // Avery signs in as avery@example.com and sends outreach from a send-as alias
  // on the outbound domain, copying the capture address in BCC.
  const avery = { email: 'avery@example.com', verifiedAliases: ['avery@example.org'] }
  const outreach = {
    from: 'Avery Quinn <avery@example.org>',
    to: ['Pat Prospect <pat@prospect.example>'],
    cc: [capture],
    domain: DOMAIN,
  }

  it('reads a send from a confirmed alias as the member’s: the prospect in To is the correspondent', () => {
    const result = crmInboundCandidates({ ...outreach, members: [avery] })
    expect(result.sender).toBe('avery@example.org')
    expect(result.senderIsMember).toBe(true)
    expect(result.candidates).toEqual([
      { email: 'pat@prospect.example', direction: 'outbound', via: 'to' },
    ])
  })

  it('leaves an alias the member has not confirmed a stranger, exactly as before', () => {
    const row = { $id: 'u-avery', email: 'avery@example.com' }
    const stored = (verifiedAtMs?: number) =>
      new Map<string, unknown>([
        ['u-avery', { aliases: [{ address: 'avery@example.org', addedAtMs: 1, ...(verifiedAtMs ? { verifiedAtMs } : {}) }] }],
      ])
    const unconfirmed = crmInboundCandidates({ ...outreach, members: crmInboundRoster([row], stored()) })
    const noAlias = crmInboundCandidates({ ...outreach, members: crmInboundRoster([row], new Map()) })
    expect(unconfirmed).toEqual(noAlias)
    expect(unconfirmed.senderIsMember).toBe(false)
    expect(unconfirmed.candidates).toEqual([
      { email: 'avery@example.org', direction: 'inbound', via: 'from' },
      { email: 'pat@prospect.example', direction: 'inbound', via: 'to' },
    ])
    // The same document, confirmed, and the alias is the member's.
    const confirmed = crmInboundCandidates({ ...outreach, members: crmInboundRoster([row], stored(2)) })
    expect(confirmed.senderIsMember).toBe(true)
  })

  it('never names an alias as the correspondent in To, Cc, Bcc or a forwarded From', () => {
    const result = crmInboundCandidates({
      from: 'pat@prospect.example',
      to: ['AVERY@EXAMPLE.ORG '],
      cc: ['avery@example.org', capture],
      forwardedFrom: 'Avery <avery@example.org>',
      domain: DOMAIN,
      members: [avery],
    })
    expect(result.senderIsMember).toBe(false)
    expect(result.candidates).toEqual([
      { email: 'pat@prospect.example', direction: 'inbound', via: 'from' },
    ])
  })

  it('normalizes an alias’s case, spacing and plus addressing the way a sign-in address is', () => {
    const shouting = { email: ' AVERY@EXAMPLE.COM ', verifiedAliases: ['  Avery@Example.ORG\t'] }
    expect(crmInboundCandidates({ ...outreach, members: [shouting] }).senderIsMember).toBe(true)
    // A plus-addressed variant is another address — for a sign-in address
    // and an alias alike.
    const plusAlias = crmInboundCandidates({ ...outreach, from: 'avery+news@example.org', members: [avery] })
    const plusSignIn = crmInboundCandidates({ ...outreach, from: 'avery+news@example.com', members: [avery] })
    expect(plusAlias.senderIsMember).toBe(false)
    expect(plusSignIn.senderIsMember).toBe(false)
  })
})

describe('the roster the filer matches against (AGL-2975)', () => {
  const rows = [
    { $id: 'u-avery', email: 'Avery@Example.com', displayName: 'Avery Quinn' },
    { $id: 'u-kim', email: 'kim@aglyn.com', displayName: 'Kim' },
    { $id: 'u-gone', email: 'gone@aglyn.com', orgSuspended: true },
    { $id: 'u-alias-only', email: null },
    { $id: 'u-nobody', email: '' },
  ]

  it('carries each member’s CONFIRMED aliases and none they only typed', () => {
    const roster = crmInboundRoster(
      rows,
      new Map<string, unknown>([
        [
          'u-avery',
          {
            aliases: [
              { address: 'avery@example.org', addedAtMs: 1, verifiedAtMs: 2 },
              { address: 'typo@aglyn.io', addedAtMs: 3 },
            ],
          },
        ],
        ['u-alias-only', { aliases: [{ address: 'ops@aglyn.io', addedAtMs: 1, verifiedAtMs: 2 }] }],
        ['u-stranger', { aliases: [{ address: 'left@aglyn.io', addedAtMs: 1, verifiedAtMs: 2 }] }],
      ]),
    )
    expect(roster).toEqual([
      { uid: 'u-avery', email: 'avery@example.com', name: 'Avery Quinn', verifiedAliases: ['avery@example.org'] },
      { uid: 'u-kim', email: 'kim@aglyn.com', name: 'Kim' },
      { uid: 'u-alias-only', email: '', name: null, verifiedAliases: ['ops@aglyn.io'] },
    ])
  })
})

describe('the row a captured message becomes', () => {
  it('keys on the Message-ID, then the provider id, then nothing', () => {
    expect(crmCapturedEmailKey(' <abc@mail.example> ', 'em_1')).toBe('mid:<abc@mail.example>')
    expect(crmCapturedEmailKey('', 'em_1')).toBe('provider:em_1')
    expect(crmCapturedEmailKey(undefined, '')).toBeNull()
  })

  it('builds an email activity with the direction, the excerpt, the thread facts and only the fixed links', () => {
    const row = buildCrmCapturedEmailActivity({
      direction: 'inbound',
      subject: '  Re:  Renewal ',
      excerpt: 'October, please.',
      from: 'ada@example.com',
      to: 'sam@acme.com',
      messageId: '<abc@mail.example>',
      inReplyTo: '<prev@acme.com>',
      atMs: 1_700_000_000_000,
      byUid: '',
      link: { contactId: 'con-1', companyId: null, leadId: undefined },
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
    })
    expect(row).toEqual({
      kind: 'email',
      subject: 'Re: Renewal',
      body: 'October, please.',
      direction: 'inbound',
      from: 'ada@example.com',
      to: 'sam@acme.com',
      messageId: '<abc@mail.example>',
      inReplyTo: '<prev@acme.com>',
      threadSubject: 'Renewal',
      atMs: 1_700_000_000_000,
      byUid: '',
      contactId: 'con-1',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
    })
    // No delivery state: the platform did not send it.
    expect('deliveryState' in row).toBe(false)
  })

  it('stamps the member who wrote a copied send, by uid and name', () => {
    const row = buildCrmCapturedEmailActivity({
      direction: 'outbound',
      subject: 'Renewal',
      excerpt: 'Shall we?',
      from: 'sam@acme.com',
      to: 'ada@example.com',
      messageId: '<xyz@acme.com>',
      atMs: 1,
      byUid: 'u-sam',
      byName: ' Sam Rep ',
      link: { leadId: 'lead-1' },
      hostId: 'site-1',
      visibleTo: [],
    })
    expect(row.byUid).toBe('u-sam')
    expect(row.byName).toBe('Sam Rep')
    expect(row.leadId).toBe('lead-1')
    expect(row.inReplyTo).toBeUndefined()
  })
})
