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

import type { HostOrder } from '../model'
import {
  defaultQuoteMailerDeps,
  quoteMailer,
  quoteReplyTo,
  type QuoteDeliveryInput,
  type QuoteMailerDeps,
} from './quote-email'

// The mailer's own imports, none of which these cases reach.
jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

// The lazily loaded PDF module: the send loads it only to make the file.
const mockQuotePdfFile = jest.fn()
jest.mock('./commerce-pdf', () => ({ quotePdfFile: (...args: unknown[]) => mockQuotePdfFile(...args) }))

/**
 * The quote email's send (AGL-4097): the PDF from the lazy module attached,
 * who a reply reaches, the conversation's headers, and the refusals.
 */

const ORDER = {
  number: 1042,
  status: 'pending',
  channel: 'quote',
  lineItems: [],
  totals: { itemsCents: 5_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 5_000 },
  quote: {
    stage: 'draft',
    revision: 1,
    customer: { email: 'jane@example.com' },
    tax: { kind: 'none' },
    createdAtMs: 1,
    updatedAtMs: 1,
    createdBy: 'a',
    updatedBy: 'a',
  },
} as unknown as HostOrder

const sent: Array<Parameters<QuoteMailerDeps['send']>[0]> = []
const metered: string[] = []

function deps(over: Partial<QuoteMailerDeps> = {}): QuoteMailerDeps {
  return {
    ...defaultQuoteMailerDeps(),
    configured: () => true,
    sendingIdentity: async () =>
      ({ from: 'Northwind Signs <hello@mail.northwind.test>', source: 'site', domain: 'mail.northwind.test', summary: '', refusal: null }) as never,
    render: async (_hostId, key, tokens) => ({ subject: tokens['quote.subject'], html: `<p>${key}</p>`, text: tokens['quote.heading'] }),
    theme: async () => null,
    send: async (options) => {
      sent.push(options)
      return { sent: true, id: 're_123' }
    },
    meter: async (hostId) => void metered.push(hostId),
    suppression: async () => null,
    ...over,
  }
}

function delivery(over: Partial<QuoteDeliveryInput> = {}): QuoteDeliveryInput {
  return {
    hostId: 'site1',
    quoteId: 'q1',
    order: ORDER,
    host: { displayName: 'Northwind Signs', subdomain: 'northwind' },
    store: { currency: 'USD' },
    owner: null,
    to: 'jane@example.com',
    subject: '',
    message: '',
    payUrl: 'https://northwind.aglyn.app/pay-quote?q=q1&t=1.abc',
    proofUrl: () => null,
    linkReplaced: false,
    senderEmail: 'owner@example.com',
    atMs: 1_000,
    ...over,
  }
}

beforeEach(() => {
  sent.length = 0
  metered.length = 0
  mockQuotePdfFile.mockReset()
  mockQuotePdfFile.mockImplementation(async () => ({ bytes: new Uint8Array([37, 80, 68, 70, 45]), filename: 'northwind-signs-quote-1042.pdf' }))
})

describe('the quote email’s send (AGL-4097)', () => {
  it('attaches the quote’s PDF from the lazily loaded module, made with the link the email carries', async () => {
    const outcome = await quoteMailer(deps()).deliver(delivery())
    expect(outcome).toMatchObject({ sent: true, providerId: 're_123', subject: 'Quote #1042 from Northwind Signs' })
    expect(mockQuotePdfFile).toHaveBeenCalledTimes(1)
    expect(mockQuotePdfFile.mock.calls[0][0]).toMatchObject({
      hostId: 'site1',
      quoteId: 'q1',
      payUrl: 'https://northwind.aglyn.app/pay-quote?q=q1&t=1.abc',
    })
    expect(sent[0].attachments).toEqual([
      { filename: 'northwind-signs-quote-1042.pdf', contentType: 'application/pdf', content: 'JVBERi0=' },
    ])
    expect(sent[0]).toMatchObject({ audience: 'tenant', context: 'quote', html: '<p>quote-sent</p>' })
    expect(metered).toEqual(['site1'])
  })

  it('sends nothing when the PDF cannot be made, since the email says it is attached', async () => {
    mockQuotePdfFile.mockRejectedValueOnce(new Error('sharp'))
    const outcome = await quoteMailer(deps()).deliver(delivery())
    expect(outcome).toEqual({ sent: false, status: 500, error: 'The quote’s PDF could not be made, so nothing was sent. Try again.' })
    expect(sent).toEqual([])
    expect(metered).toEqual([])
  })

  it('answers to the site’s contact email, else the support email, else the person sending', () => {
    expect(quoteReplyTo({ seo: { entity: { email: 'hello@northwind.test' } }, business: { supportEmail: 'help@northwind.test' } }, 'owner@example.com')).toBe(
      'hello@northwind.test',
    )
    expect(quoteReplyTo({ business: { supportEmail: 'help@northwind.test' } }, 'owner@example.com')).toBe('help@northwind.test')
    expect(quoteReplyTo({ seo: { entity: { email: 'call us' } } }, 'owner@example.com')).toBe('owner@example.com')
    expect(quoteReplyTo({}, null)).toBeNull()
  })

  it('starts the conversation under its root, then replies into it, minting each id on the sending domain', async () => {
    const mailer = quoteMailer(deps())
    const first = await mailer.deliver(delivery())
    if (!('thread' in first)) throw new Error('not sent')
    expect(first.messageId).toMatch(/@mail\.northwind\.test>$/)
    // The root every message of the conversation shares, even when the
    // provider replaces the Message-ID it was handed.
    const root = `<thread.${first.messageId.slice(1)}`
    expect(sent[0].headers).toEqual({ 'Message-ID': first.messageId, References: root })
    expect(first.thread.references).toEqual([root, first.messageId])
    const order = { ...ORDER, quote: { ...ORDER.quote, emailThread: first.thread } } as HostOrder
    const second = await mailer.deliver(delivery({ order }))
    if (!('thread' in second)) throw new Error('not sent')
    expect(sent[1].headers).toEqual({
      'Message-ID': second.messageId,
      'In-Reply-To': first.messageId,
      References: `${root} ${first.messageId}`,
    })
    expect(sent[1].subject).toBe('Quote #1042 from Northwind Signs')
    expect(second.thread.references).toEqual([root, first.messageId, second.messageId])
  })

  it('takes the site’s own domain for the id when the identity names none', async () => {
    await quoteMailer(deps({ sendingIdentity: async () => ({ from: null, domain: null, refusal: null }) as never })).deliver(
      delivery({ host: { displayName: 'Northwind Signs', cname: 'northwind.example' } }),
    )
    expect(String(sent[0].headers?.['Message-ID'])).toMatch(/@northwind\.example>$/)
  })

  it.each([
    [{ sent: false, reason: 'unconfigured' }, 503],
    [{ sent: false, reason: 'rate-limited', retryAtMs: 1 }, 429],
    [{ sent: false, reason: 'suppressed' }, 409],
    [{ sent: false, reason: 'undeliverable' }, 409],
    [{ sent: false, reason: 'unverified-domain' }, 409],
    [{ sent: false, reason: 'suspended' }, 423],
    [{ sent: false, reason: 'held-for-review', detail: 'Reference HS-1.' }, 409],
    [{ sent: false, reason: 'rejected', status: 422 }, 502],
  ])('a refused send (%o) is answered in words, and is not metered', async (answer, status) => {
    const outcome = await quoteMailer(deps({ send: async () => answer as never })).deliver(delivery())
    expect(outcome).toMatchObject({ sent: false, status })
    expect(String((outcome as { error: string }).error)).not.toMatch(/undefined/)
    expect(metered).toEqual([])
  })
})
