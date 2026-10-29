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

import { sanitizeAuthorHtml } from '@aglyn/aglyn/app-utils/author-html'
import { buildDefaultEmailNodeMap, EMAIL_NODE_ROOT_ID, renderEmailHtml } from '@aglyn/shared-util-email'
import type { HostOrder, QuoteProof } from '../model'
import { commerceTenantEmails } from '../tenant-emails'
import { QUOTE_EMAIL_KEY, quoteEmailContent, type QuoteEmailContentInput } from './quote-email-content'

/**
 * The quote email (AGL-4097), rendered from the catalog's built-in copy with
 * the tokens a send composes, through the sanitizer every site email passes.
 */

const proof = (id: string, name: string, contentType: string, revision = 1): QuoteProof => ({
  id,
  revision,
  name,
  contentType,
  size: 1_000,
  path: `hosts/site1/private/uploads/quote-proof/q1/${id}`,
  addedAtMs: 1,
  addedBy: 'owner@example.com',
})

function order(quote: Partial<NonNullable<HostOrder['quote']>> = {}): HostOrder {
  return {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [],
    totals: { itemsCents: 125_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 125_000 },
    quote: {
      stage: 'draft',
      revision: 1,
      customer: { name: 'Jane Doe', email: 'jane@example.com' },
      tax: { kind: 'none', reason: 'not-collected' },
      createdAtMs: 1,
      updatedAtMs: 1,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...quote,
    },
  } as HostOrder
}

const PAY_URL = 'https://northwind.example/pay-quote?q=q1&t=1.abc'

function input(over: Partial<QuoteEmailContentInput> = {}): QuoteEmailContentInput {
  return {
    order: order(),
    quoteId: 'q1',
    businessName: 'Northwind Signs',
    currency: 'USD',
    subject: 'Quote #1042 from Northwind Signs',
    message: 'Thanks for stopping by.\nHere is the banner we talked about.',
    payUrl: PAY_URL,
    proofUrl: (id) => `https://northwind.example/api/commerce/quote-proof?hostId=site1&q=q1&t=1.abc&file=${id}`,
    linkReplaced: false,
    colors: { border: '#d0d7de', muted: '#57606a' },
    radius: 6,
    ...over,
  }
}

function render(content: ReturnType<typeof quoteEmailContent>) {
  const entry = commerceTenantEmails().find((email) => email.key === QUOTE_EMAIL_KEY)
  if (!entry) throw new Error('no quote-sent entry')
  return renderEmailHtml({
    nodes: buildDefaultEmailNodeMap(entry) as never,
    rootId: EMAIL_NODE_ROOT_ID,
    subject: content.tokens['quote.subject'],
    merge: { 'host.businessName': 'Northwind Signs', ...content.tokens },
    sanitize: sanitizeAuthorHtml,
  })
}

describe('the quote email says what it is and what to do next (AGL-4097)', () => {
  it('approval first: names the quote, shows the proof, and asks for the approval before the payment', () => {
    const content = quoteEmailContent(
      input({
        order: order({
          requireProofApproval: true,
          proofs: [
            proof('p1', 'banner-front.png', 'image/png'),
            proof('p2', 'banner-back.jpg', 'image/jpeg'),
            proof('p3', 'banner.ai', 'application/postscript'),
          ],
        }),
      }),
    )
    expect(content.approvalFirst).toBe(true)
    const { html, text } = render(content)
    expect(text).toContain('Northwind Signs · Quote #1042')
    expect(text).toContain('Your quote from Northwind Signs')
    expect(text).toContain('Northwind Signs put together a quote for you. The details are below, and the quote is attached as a PDF.')
    expect(text).toContain('Thanks for stopping by.\nHere is the banner we talked about.')
    expect(text).toContain('Quote: #1042')
    expect(text).toContain('Revision: 1')
    expect(text).toContain('Total: $1,250.00')
    expect(text).toContain('Also with this revision: banner.ai. See it on your quote page.')
    expect(text).toContain('Look over the proof, then approve it on your quote page. Once you approve it, you can pay there.')
    expect(text).toContain(`Review and approve: ${PAY_URL}`)
    expect(text).toContain('Reply to this email to reach Northwind Signs.')
    expect(text).not.toContain('View and pay')
    // Both pictures survive the sanitizer, each linked to the quote page.
    expect(html).toContain('file=p1')
    expect(html).toContain('file=p2')
    expect(html).not.toContain('file=p3')
    expect(html).toContain('alt="Proof: banner-front.png"')
    expect(html).toContain('border:1px solid #d0d7de')
  })

  it('pay: with no approval needed the button names the total, and the proof can still be answered', () => {
    const content = quoteEmailContent(
      input({ order: order({ requireProofApproval: false, proofs: [proof('p1', 'banner.png', 'image/png')] }) }),
    )
    expect(content.approvalFirst).toBe(false)
    const { text } = render(content)
    expect(text).toContain(`View and pay $1,250.00: ${PAY_URL}`)
    expect(text).toContain('On your quote page you can approve the proof or ask for changes, and pay whenever you’re ready.')
    expect(text).not.toContain('Review and approve')
  })

  it('pay: an approved proof, and a quote with no proof at all', () => {
    const approved = render(
      quoteEmailContent(
        input({
          order: order({ requireProofApproval: true, approvedRevision: 1, proofs: [proof('p1', 'banner.png', 'image/png')] }),
        }),
      ),
    ).text
    expect(approved).toContain('You approved the proof. Pay on your quote page whenever you’re ready.')
    expect(approved).toContain('View and pay $1,250.00')

    const bare = quoteEmailContent(input({ order: order({ requireProofApproval: true }) }))
    // A revision with no proof never holds a payment.
    expect(bare.approvalFirst).toBe(false)
    expect(bare.tokens['quote.proofImages']).toBe('')
    expect(bare.tokens['quote.proofFiles']).toBe('')
    expect(render(bare).text).toContain('Look over your quote, and pay it on your quote page whenever you’re ready.')
  })

  it('revision 2 and later: says the quote was updated, and that the earlier link stopped working when it did', () => {
    const replaced = render(
      quoteEmailContent(input({ order: order({ revision: 2 }), linkReplaced: true, message: '' })),
    ).text
    expect(replaced).toContain('Your updated quote')
    expect(replaced).toContain(
      'Northwind Signs updated your quote. This is revision 2, and it replaces the one sent before. ' +
        'The link in the earlier email no longer opens the quote, so use the button below. The new version is attached as a PDF.',
    )
    expect(replaced).toContain('Revision: 2')
    // No message typed: no empty paragraph for it.
    expect(replaced).not.toMatch(/\n\s*\n\s*\n/)

    const kept = render(quoteEmailContent(input({ order: order({ revision: 3 }), linkReplaced: false }))).text
    expect(kept).toContain('This is revision 3, and it replaces the one sent before. The new version is attached as a PDF.')
    expect(kept).not.toContain('no longer opens')
  })

  it('draws three pictures at most, names the rest, and leaves WebP to the quote page', () => {
    const content = quoteEmailContent(
      input({
        order: order({
          proofs: [
            proof('p1', 'a.png', 'image/png'),
            proof('p2', 'b.gif', 'image/gif'),
            proof('p3', 'c.jpg', 'image/jpeg'),
            proof('p4', 'd.png', 'image/png'),
            proof('p5', 'e.webp', 'image/webp'),
            proof('p6', 'old.png', 'image/png', 0),
          ],
        }),
      }),
    )
    expect((content.tokens['quote.proofImages'].match(/<img /g) ?? []).length).toBe(3)
    expect(content.tokens['quote.proofImages']).not.toContain('old.png')
    expect(content.tokens['quote.proofFiles']).toBe('Also with this revision: e.webp and 1 more file. See them on your quote page.')
  })

  it('says tax comes at payment when Stripe works it out', () => {
    const content = quoteEmailContent(input({ order: order({ tax: { kind: 'at-payment' } }) }))
    expect(content.tokens['quote.total']).toBe('$1,250.00 before tax')
    expect(content.tokens['quote.buttonLabel']).toBe('View and pay $1,250.00 plus tax')
  })

  it('escapes what the business named, and carries no price in the composed markup', () => {
    const content = quoteEmailContent(
      input({ order: order({ proofs: [proof('p1', '<script>x</script>.png', 'image/png')] }) }),
    )
    expect(content.tokens['quote.proofImages']).not.toContain('<script>')
    expect(content.tokens['quote.proofImages']).not.toContain('$')
    expect(content.tokens['quote.intro']).not.toContain('$')
    expect(content.tokens['quote.nextStep']).not.toContain('$')
  })

  it('declares every token it supplies, and the catalog supplies nothing the send does not', () => {
    const entry = commerceTenantEmails().find((email) => email.key === QUOTE_EMAIL_KEY)
    const declared = new Set((entry?.mergeTokens ?? []).map((token) => token.name))
    const supplied = Object.keys(quoteEmailContent(input()).tokens)
    expect(new Set(supplied)).toEqual(declared)
    const used = JSON.stringify(entry?.defaultBody ?? []).match(/\{\{\s*([^}\s]+)\s*\}\}/g) ?? []
    for (const token of used) {
      const name = token.replace(/[{}\s]/g, '')
      if (!name.startsWith('host.')) expect(declared.has(name)).toBe(true)
    }
  })
})
