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
import type { HostOrder } from './commerce-orders'
import { buildQuotePageView } from './commerce-quote-pay'
import {
  applyQuoteResponse,
  describeQuoteResponse,
  parseQuoteResponseInput,
  quoteCustomerAccountEmail,
  quoteProofAccess,
  quoteProofAccessMessage,
} from './commerce-quote-proofs'
import {
  cleanQuoteApprovalStatements,
  parseQuoteInput,
  quoteApprovalStatements,
  quoteRequiresProofSignInByDefault,
  QUOTE_DEFAULT_APPROVAL_STATEMENTS,
  QUOTE_STAGE_LABELS,
  QUOTE_MAX_APPROVAL_STATEMENT,
  QUOTE_MAX_APPROVAL_STATEMENTS,
  type OrderQuote,
  type QuoteProof,
} from './commerce-quotes'

/**
 * A deliberate approval and who may open a proof (AGL-4206), pure: the
 * statements a customer ticks before approving, the record an approval keeps,
 * and the sign-in a quote can ask of a customer with a site account.
 */

const CONTEXT = { atMs: 6_000, ip: '203.0.113.9', userAgent: 'Spec Browser' }
const STATEMENTS = ['I checked the spelling.', 'I checked the colors.']

function proof(id: string, revision = 1): QuoteProof {
  return {
    id,
    revision,
    name: `${id}.png`,
    contentType: 'image/png',
    size: 100,
    path: `hosts/site1/private/uploads/quote-proof/q-1/${id}`,
    addedAtMs: 1_500,
    addedBy: 'owner@example.com',
  }
}

function order(section: Partial<OrderQuote> = {}, overrides: Partial<HostOrder> = {}): HostOrder {
  return {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [{ productId: '', custom: true, name: 'Banner', productType: 'physical', quantity: 1, unitAmountCents: 40_000 }],
    totals: { itemsCents: 40_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 40_000 },
    timeline: [],
    quote: {
      stage: 'sent',
      revision: 1,
      customer: { name: 'Jordan Lee', email: 'Jordan@Example.com', emailLower: 'jordan@example.com' },
      tax: { kind: 'none', reason: 'not-collected' },
      proofs: [proof('p1')],
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...section,
    },
    ...overrides,
  } as HostOrder
}

describe('the statements a customer confirms', () => {
  it('starts with three suggestions, about the words, the look and production starting', () => {
    expect(quoteApprovalStatements(undefined)).toEqual([...QUOTE_DEFAULT_APPROVAL_STATEMENTS])
    expect(quoteApprovalStatements({ approvalStatements: [] })).toEqual([...QUOTE_DEFAULT_APPROVAL_STATEMENTS])
    expect(QUOTE_DEFAULT_APPROVAL_STATEMENTS).toHaveLength(3)
    expect(QUOTE_DEFAULT_APPROVAL_STATEMENTS.join(' ')).toMatch(/spelling.*colors.*production/)
  })

  it('takes the business’s own words, cleaned: one line each, no blanks or repeats, at most five', () => {
    expect(quoteApprovalStatements({ approvalStatements: ['  Sizes   are right ', '', 'Sizes are right', 7 as never] })).toEqual([
      'Sizes are right',
    ])
    const many = Array.from({ length: 9 }, (_, index) => `Statement ${index}`)
    expect(cleanQuoteApprovalStatements(many)).toHaveLength(QUOTE_MAX_APPROVAL_STATEMENTS)
    expect(cleanQuoteApprovalStatements(['x'.repeat(500)])[0]).toHaveLength(QUOTE_MAX_APPROVAL_STATEMENT)
    expect(cleanQuoteApprovalStatements('nope')).toEqual([])
  })
})

describe('approving needs every statement ticked', () => {
  it('accepts an approval that ticks each statement, and keeps them in the store’s words and order', () => {
    expect(
      parseQuoteResponseInput({ action: 'approve', name: 'Jordan Lee', confirmed: [STATEMENTS[1], STATEMENTS[0]] }, STATEMENTS),
    ).toEqual({ ok: true, input: { action: 'approve', name: 'Jordan Lee', confirmed: STATEMENTS } })
  })

  it('refuses an approval missing a tick, or with none', () => {
    expect(parseQuoteResponseInput({ action: 'approve', name: 'Jordan Lee', confirmed: [STATEMENTS[0]] }, STATEMENTS)).toEqual({
      ok: false,
      error: 'Tick each box to confirm you checked the proof.',
    })
    expect(parseQuoteResponseInput({ action: 'approve', name: 'Jordan Lee' }, STATEMENTS)).toMatchObject({ ok: false })
  })

  it('says the statements changed when the page showed words the store no longer asks for', () => {
    expect(
      parseQuoteResponseInput({ action: 'approve', name: 'Jordan Lee', confirmed: ['I checked the spelling', STATEMENTS[1]] }, STATEMENTS),
    ).toMatchObject({ ok: false, reason: 'statements-changed' })
  })

  it('still needs a typed name', () => {
    expect(parseQuoteResponseInput({ action: 'approve', name: ' J ', confirmed: STATEMENTS }, STATEMENTS)).toEqual({
      ok: false,
      error: 'Type your name to approve the proof.',
    })
  })

  it('asks a rejection for what to change and a name, and none of the statements', () => {
    expect(parseQuoteResponseInput({ action: 'changes', comment: 'Bigger logo', name: 'Jordan Lee' }, STATEMENTS)).toEqual({
      ok: true,
      input: { action: 'changes', comment: 'Bigger logo', name: 'Jordan Lee', fileIds: [] },
    })
    expect(parseQuoteResponseInput({ action: 'changes', comment: 'Bigger logo' }, STATEMENTS)).toEqual({
      ok: false,
      error: 'Type your name to reject the proof.',
    })
    expect(parseQuoteResponseInput({ action: 'changes', comment: '  ', name: 'Jordan Lee' }, STATEMENTS)).toEqual({
      ok: false,
      error: 'Tell us what to change.',
    })
  })

  it('records a rejection with the note, the name and the time, and calls it that', () => {
    const rejected = applyQuoteResponse(order(), { action: 'changes', comment: 'Bigger logo', name: 'Jordan Lee', fileIds: [] }, CONTEXT)
    if (!('order' in rejected)) throw new Error('refused')
    expect(rejected.response).toMatchObject({ action: 'changes', comment: 'Bigger logo', name: 'Jordan Lee', atMs: 6_000, revision: 1 })
    expect(rejected.order.quote?.stage).toBe('changes_requested')
    expect(QUOTE_STAGE_LABELS.changes_requested).toBe('Rejected with changes')
    expect(describeQuoteResponse(rejected.response)).toBe('Rejected with changes by Jordan Lee')
    expect(rejected.order.timeline?.at(-1)?.detail).toBe('Quote #1042 revision 1 rejected with changes by the customer as Jordan Lee')
    const view = buildQuotePageView({ order: rejected.order, orderId: 'q-1', storeName: 'Acme', currency: 'USD' })
    expect(view.response).toMatchObject({ action: 'changes', name: 'Jordan Lee', comment: 'Bigger logo' })
  })

  it('records what was confirmed, with the name and time, on the answer and as the approval', () => {
    const answered = applyQuoteResponse(order(), { action: 'approve', name: 'Jordan Lee', confirmed: STATEMENTS }, CONTEXT)
    if (!('order' in answered)) throw new Error('refused')
    expect(answered.response).toMatchObject({ action: 'approve', name: 'Jordan Lee', atMs: 6_000, confirmed: STATEMENTS })
    expect(answered.order.quote?.approval).toEqual({
      revision: 1,
      name: 'Jordan Lee',
      atMs: 6_000,
      confirmed: STATEMENTS,
      ip: '203.0.113.9',
      userAgent: 'Spec Browser',
    })
    const view = buildQuotePageView({ order: answered.order, orderId: 'q-1', storeName: 'Acme', currency: 'USD' })
    expect(view.response?.confirmed).toEqual(STATEMENTS)
  })
})

describe('the page’s statements', () => {
  it('carries the store’s statements while the proof can be answered, the defaults when none are given', () => {
    const page = buildQuotePageView({ order: order(), orderId: 'q-1', storeName: 'Acme', currency: 'USD', approvalStatements: STATEMENTS })
    expect(page.approvalStatements).toEqual(STATEMENTS)
    expect(buildQuotePageView({ order: order(), orderId: 'q-1', storeName: 'Acme', currency: 'USD' }).approvalStatements).toEqual([
      ...QUOTE_DEFAULT_APPROVAL_STATEMENTS,
    ])
  })

  it('carries none once the quote takes no answer', () => {
    const paid = buildQuotePageView({
      order: order({}, { status: 'paid' }),
      orderId: 'q-1',
      storeName: 'Acme',
      currency: 'USD',
      approvalStatements: STATEMENTS,
    })
    expect(paid.respondable).toBe(false)
    expect(paid.approvalStatements).toEqual([])
  })
})

describe('who may open the proof', () => {
  it('needs nothing when the quote does not ask, or the customer has no account', () => {
    expect(quoteProofAccess({ quote: { requireProofSignIn: false }, accountId: 'm1', signedInAccountId: null })).toBe('open')
    expect(quoteProofAccess({ quote: {}, accountId: 'm1', signedInAccountId: null })).toBe('open')
    expect(quoteProofAccess({ quote: { requireProofSignIn: true }, accountId: null, signedInAccountId: null })).toBe('open')
    expect(quoteProofAccess({ quote: { requireProofSignIn: true }, accountId: null, signedInAccountId: 'm9' })).toBe('open')
  })

  it('asks a customer with an account to sign in to that account, and no other', () => {
    const quote = { requireProofSignIn: true }
    expect(quoteProofAccess({ quote, accountId: 'm1', signedInAccountId: null })).toBe('sign-in')
    expect(quoteProofAccess({ quote, accountId: 'm1', signedInAccountId: 'm2' })).toBe('other-account')
    expect(quoteProofAccess({ quote, accountId: 'm1', signedInAccountId: 'm1' })).toBe('open')
  })

  it('finds the customer by the address on the quote, lower-cased, and a phone customer has none', () => {
    expect(quoteCustomerAccountEmail(order().quote)).toBe('jordan@example.com')
    expect(quoteCustomerAccountEmail({ customer: { email: ' Pat@Example.com ' } } as OrderQuote)).toBe('pat@example.com')
    expect(quoteCustomerAccountEmail({ customer: { name: 'Walk-in', phone: '555-0100' } } as OrderQuote)).toBe('')
  })

  it('shows nothing of the proof or the answer while it waits on a sign-in, and says what to do', () => {
    const answered = applyQuoteResponse(order(), { action: 'approve', name: 'Jordan Lee', confirmed: STATEMENTS }, CONTEXT)
    if (!('order' in answered)) throw new Error('refused')
    const page = buildQuotePageView({
      order: answered.order,
      orderId: 'q-1',
      storeName: 'Acme Signs',
      currency: 'USD',
      approvalStatements: STATEMENTS,
      proofAccess: 'sign-in',
    })
    expect(page.proofs).toEqual([])
    expect(page.response).toBeNull()
    expect(page.respondable).toBe(false)
    expect(page.approvalStatements).toEqual([])
    expect(page.proofAccess).toBe('sign-in')
    expect(page.proofAccessMessage).toBe(quoteProofAccessMessage('sign-in', 'Acme Signs'))
    expect(page.proofAccessMessage).toMatch(/Sign in to your account with Acme Signs/)
    // The quote itself still shows: its lines and total are not the proof.
    expect(page.lines).toHaveLength(1)
    expect(page.totals.totalCents).toBe(40_000)
  })

  it('has nothing to sign in for on a revision with no proof', () => {
    const page = buildQuotePageView({
      order: order({ proofs: [] }),
      orderId: 'q-1',
      storeName: 'Acme',
      currency: 'USD',
      proofAccess: 'sign-in',
    })
    expect(page.proofAccess).toBe('open')
    expect(page.proofAccessMessage).toBeNull()
  })

  it('tells someone signed in to another account which account to use', () => {
    expect(quoteProofAccessMessage('other-account', 'Acme')).toMatch(/different account.*Acme/)
  })
})

describe('the switch on a quote and its store default', () => {
  it('reads the store default as off unless it is on', () => {
    expect(quoteRequiresProofSignInByDefault(undefined)).toBe(false)
    expect(quoteRequiresProofSignInByDefault({ requireProofSignIn: true })).toBe(true)
  })

  it('takes the switch from a saved quote, and leaves it out when the editor did not send it', () => {
    const custom = { kind: 'custom', name: 'Banner', unitAmountCents: 100, quantity: 1 }
    const on = parseQuoteInput({ lines: [custom], requireProofSignIn: true })
    expect(on.ok && on.input.requireProofSignIn).toBe(true)
    const absent = parseQuoteInput({ lines: [custom] })
    expect(absent.ok && 'requireProofSignIn' in absent.input).toBe(false)
  })
})
