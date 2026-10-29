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
import { buildQuotePageView, quotePayRefusal } from './commerce-quote-pay'
import {
  applyQuoteResponse,
  latestQuoteResponse,
  parseQuoteResponseInput,
  quoteProofChangeRefusal,
  quoteRespondRefusal,
  startQuoteRevision,
  withQuoteProofAdded,
  withQuoteProofRemoved,
  QUOTE_MAX_PROOFS,
  QUOTE_MAX_RESPONSES,
} from './commerce-quote-proofs'
import { quotePaymentBlockedByApproval, type OrderQuote, type QuoteProof } from './commerce-quotes'

/**
 * Proofs, revisions and the customer's answer (AGL-4096), pure: what each
 * change writes, what it refuses, and that approving is what lets a quote
 * that asks for approval be paid.
 */

const BY = { atMs: 5_000, by: 'owner@example.com' }
const CONTEXT = { atMs: 6_000, ip: '203.0.113.9', userAgent: 'Spec Browser' }

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
      customer: { name: 'Jordan Lee', email: 'jordan@example.com' },
      notes: 'Full color',
      terms: 'Net 15',
      tax: { kind: 'none', reason: 'not-collected' },
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...section,
    },
    ...overrides,
  } as HostOrder
}

describe('the business’s proofs', () => {
  it('adds a proof to the current revision as an edit of the quote', () => {
    const added = withQuoteProofAdded(order(), { id: 'p1', name: 'p1.png', contentType: 'image/png', size: 100, path: 'x' }, BY)
    if (!('order' in added)) throw new Error('refused')
    expect(added.proof).toMatchObject({ id: 'p1', revision: 1, addedAtMs: 5_000, addedBy: 'owner@example.com' })
    expect(added.order.quote?.proofs).toEqual([added.proof])
    expect(added.order.quote?.updatedAtMs).toBe(5_000)
    expect(added.order.timeline?.at(-1)).toMatchObject({ event: 'quote-proof-added' })
  })

  it('removes one while the revision is unanswered', () => {
    const removed = withQuoteProofRemoved(order({ proofs: [proof('p1'), proof('p2')] }), 'p1', BY)
    if (!('order' in removed)) throw new Error('refused')
    expect(removed.order.quote?.proofs?.map((entry) => entry.id)).toEqual(['p2'])
    expect(removed.proof.path).toContain('p1')
    expect(withQuoteProofRemoved(order({ proofs: [proof('p1')] }), 'gone', BY)).toEqual({ ok: false, reason: 'unknown-proof' })
  })

  it('refuses changes once the customer answered, once paid, and past the limit', () => {
    const answered = order({ proofs: [proof('p1')], responses: [{ action: 'approve', revision: 1, atMs: 3_000, name: 'J', ip: null, userAgent: null }] })
    expect(quoteProofChangeRefusal(answered, 'add')).toBe('answered')
    expect(quoteProofChangeRefusal(answered, 'remove')).toBe('answered')
    expect(quoteProofChangeRefusal(order({}, { status: 'paid' }), 'add')).toBe('paid')
    const full = order({ proofs: Array.from({ length: QUOTE_MAX_PROOFS }, (_, index) => proof(`p${index}`)) })
    expect(quoteProofChangeRefusal(full, 'add')).toBe('full')
    expect(quoteProofChangeRefusal(full, 'remove')).toBeNull()
    // An answer to an EARLIER revision does not lock the current one.
    expect(
      quoteProofChangeRefusal(
        order({ revision: 2, responses: [{ action: 'changes', revision: 1, atMs: 3_000, comment: 'x', ip: null, userAgent: null }] }),
        'add',
      ),
    ).toBeNull()
  })
})

describe('startQuoteRevision', () => {
  const answered = order({
    stage: 'changes_requested',
    proofs: [proof('p1')],
    responses: [
      { action: 'approve', revision: 1, atMs: 3_000, name: 'Jordan Lee', ip: '203.0.113.9', userAgent: 'UA' },
      { action: 'changes', revision: 1, atMs: 4_000, comment: 'Bigger logo', ip: '203.0.113.9', userAgent: 'UA' },
    ],
    discount: { kind: 'percent', pct: 10 },
  })

  it('snapshots the current revision whole and starts the next with no proofs and no answer', () => {
    const started = startQuoteRevision(answered, BY)
    if (!('snapshot' in started)) throw new Error('refused')
    expect(started.revision).toBe(1)
    expect(started.snapshot).toEqual({
      revision: 1,
      stage: 'changes_requested',
      lineItems: answered.lineItems,
      totals: answered.totals,
      taxMode: null,
      tax: { kind: 'none', reason: 'not-collected' },
      discount: { kind: 'percent', pct: 10 },
      shipping: null,
      notes: 'Full color',
      terms: 'Net 15',
      customer: { name: 'Jordan Lee', email: 'jordan@example.com' },
      billTo: null,
      shipTo: null,
      proofs: [proof('p1')],
      responses: answered.quote?.responses,
      approval: null,
      updatedAtMs: 2_000,
      closedAtMs: 5_000,
      closedBy: 'owner@example.com',
    })
    expect(started.order.quote).toMatchObject({
      revision: 2,
      stage: 'draft',
      proofs: [],
      responses: [],
      approval: null,
      updatedAtMs: 5_000,
      updatedBy: 'owner@example.com',
      notes: 'Full color',
    })
    expect(started.order.lineItems).toEqual(answered.lineItems)
    expect(started.order.timeline?.at(-1)).toMatchObject({ event: 'quote-revision-started', atMs: 5_000 })
  })

  it('leaves the pay link’s version alone: the send that delivers the revision decides that', () => {
    const started = startQuoteRevision(order({ linkVersion: 3 }), BY)
    expect('order' in started && started.order.quote?.linkVersion).toBe(3)
  })

  it('refuses a paid quote and anything that is not a quote', () => {
    expect(startQuoteRevision(order({}, { status: 'paid' }), BY)).toMatchObject({ ok: false, reason: 'paid' })
    expect(startQuoteRevision(order({}, { channel: 'online' }), BY)).toMatchObject({ ok: false, reason: 'not-a-quote' })
  })

  it('keeps an approval of the closing revision with it', () => {
    const approval = { revision: 1, name: 'Jordan Lee', atMs: 3_000, ip: null, userAgent: null }
    const started = startQuoteRevision(order({ approval, approvedRevision: 1, proofs: [proof('p1')] }), BY)
    if (!('snapshot' in started)) throw new Error('refused')
    expect(started.snapshot.approval).toEqual(approval)
    // The next revision needs its own approval before a gated Pay comes back.
    const next = { ...started.order.quote, requireProofApproval: true, proofs: [proof('p2', 2)] }
    expect(quotePaymentBlockedByApproval(next)).toBe(true)
  })
})

describe('the customer’s answer', () => {
  it('approving records the name, time, address and browser, and moves the quote to Approved', () => {
    const answered = applyQuoteResponse(order({ proofs: [proof('p1')] }), { action: 'approve', name: 'Jordan Lee' }, CONTEXT)
    if (!('order' in answered)) throw new Error('refused')
    expect(answered.order.quote).toMatchObject({
      stage: 'approved',
      approvedRevision: 1,
      approval: { revision: 1, name: 'Jordan Lee', atMs: 6_000, ip: '203.0.113.9', userAgent: 'Spec Browser' },
      // Not an edit of the quote: the page that answered can still pay it.
      updatedAtMs: 2_000,
    })
    expect(answered.order.timeline?.at(-1)).toMatchObject({ event: 'quote-approved' })
  })

  it('asking for changes keeps the comment and files, and the latest answer counts', () => {
    const files = [{ id: 'a1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: 'hosts/site1/private/uploads/quote-artwork/q-1/a1' }]
    const changed = applyQuoteResponse(
      order({ proofs: [proof('p1')] }),
      { action: 'changes', comment: 'Use the new logo', fileIds: ['a1'], files },
      CONTEXT,
    )
    if (!('order' in changed)) throw new Error('refused')
    expect(changed.order.quote).toMatchObject({ stage: 'changes_requested', approval: null })
    expect(latestQuoteResponse(changed.order.quote)).toMatchObject({ action: 'changes', comment: 'Use the new logo', files })
    // …and they may still approve after asking for changes.
    const approved = applyQuoteResponse(changed.order, { action: 'approve', name: 'Jordan Lee' }, { ...CONTEXT, atMs: 7_000 })
    if (!('order' in approved)) throw new Error('refused')
    expect(approved.order.quote?.stage).toBe('approved')
    expect(approved.order.quote?.responses).toHaveLength(2)
    // Changes after an approval withdraw it: the latest answer is what counts.
    const withdrawn = applyQuoteResponse(approved.order, { action: 'changes', comment: 'One more thing', fileIds: [] }, { ...CONTEXT, atMs: 8_000 })
    if (!('order' in withdrawn)) throw new Error('refused')
    expect(withdrawn.order.quote).toMatchObject({ stage: 'changes_requested', approvedRevision: null, approval: null })
  })

  it('refuses a paid quote, a revision with no proof, and an endless stream of answers', () => {
    expect(quoteRespondRefusal(order({ proofs: [proof('p1')] }, { status: 'paid' }))).toBe('paid')
    expect(quoteRespondRefusal(order())).toBe('no-proof')
    expect(quoteRespondRefusal(order({ proofs: [proof('p0', 0)] }))).toBe('no-proof')
    const many = Array.from({ length: QUOTE_MAX_RESPONSES }, (_, index) => ({
      action: 'changes' as const,
      revision: 1,
      atMs: index,
      comment: 'x',
      ip: null,
      userAgent: null,
    }))
    expect(quoteRespondRefusal(order({ proofs: [proof('p1')], responses: many }))).toBe('too-many')
  })

  it('checks what was sent: a typed name to approve, a comment to change, file ids only', () => {
    expect(parseQuoteResponseInput({ action: 'approve', name: '  Jordan   Lee ' })).toEqual({ ok: true, input: { action: 'approve', name: 'Jordan Lee' } })
    expect(parseQuoteResponseInput({ action: 'approve', name: 'J' })).toMatchObject({ ok: false })
    expect(parseQuoteResponseInput({ action: 'changes', comment: ' ' })).toEqual({ ok: false, error: 'Tell us what to change.' })
    expect(parseQuoteResponseInput({ action: 'changes', comment: 'x', fileIds: ['../etc'] })).toMatchObject({ ok: false })
    expect(parseQuoteResponseInput({ action: 'changes', comment: 'x', fileIds: ['a1', 'a1'] })).toEqual({
      ok: true,
      input: { action: 'changes', comment: 'x', fileIds: ['a1'] },
    })
    expect(parseQuoteResponseInput({ action: 'pay' })).toMatchObject({ ok: false })
  })
})

describe('approval and paying', () => {
  it('approving the current revision is what unlocks Pay when the business asks for approval', () => {
    const gated = order({ requireProofApproval: true, proofs: [proof('p1')] })
    expect(quotePayRefusal(gated, 'q-1')).toBe('approval-required')
    const approved = applyQuoteResponse(gated, { action: 'approve', name: 'Jordan Lee' }, CONTEXT)
    if (!('order' in approved)) throw new Error('refused')
    expect(quotePayRefusal(approved.order, 'q-1')).toBeNull()
  })

  it('never makes paying wait when the switch is off', () => {
    const open = order({ requireProofApproval: false, proofs: [proof('p1')] })
    expect(quotePayRefusal(open, 'q-1')).toBeNull()
    const changed = applyQuoteResponse(open, { action: 'changes', comment: 'x', fileIds: [] }, CONTEXT)
    expect('order' in changed && quotePayRefusal(changed.order, 'q-1')).toBeNull()
  })

  it('the page shows the proofs and the latest answer, never a path, an address or a browser', () => {
    const answered = applyQuoteResponse(order({ proofs: [proof('p1')] }), { action: 'approve', name: 'Jordan Lee' }, CONTEXT)
    if (!('order' in answered)) throw new Error('refused')
    const view = buildQuotePageView({ order: answered.order, orderId: 'q-1', storeName: 'Acme', currency: 'USD' })
    expect(view.revision).toBe(1)
    expect(view.proofs).toEqual([{ id: 'p1', name: 'p1.png', contentType: 'image/png', size: 100, image: true }])
    expect(view.response).toEqual({ action: 'approve', atMs: 6_000, name: 'Jordan Lee', comment: null, files: 0 })
    expect(view.respondable).toBe(true)
    const text = JSON.stringify(view)
    expect(text).not.toContain('private/uploads')
    expect(text).not.toContain('203.0.113.9')
    expect(text).not.toContain('Spec Browser')
    // Paid: the proofs stay on the page, with nothing to press.
    const paid = buildQuotePageView({ order: { ...answered.order, status: 'paid' }, orderId: 'q-1', storeName: 'Acme', currency: 'USD' })
    expect(paid.proofs).toHaveLength(1)
    expect(paid.respondable).toBe(false)
  })
})
