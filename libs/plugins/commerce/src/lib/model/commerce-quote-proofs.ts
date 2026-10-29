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

import { appendOrderEvent, type HostOrder, type OrderAddress, type OrderLineItem, type OrderTotals } from './commerce-orders'
import {
  formatQuoteNumber,
  isQuote,
  isUnpaidQuote,
  type OrderQuote,
  type QuoteApproval,
  type QuoteCustomer,
  type QuoteCustomerResponse,
  type QuoteDiscount,
  type QuoteProof,
  type QuoteResponseFile,
  type QuoteShipping,
  type QuoteStage,
  type QuoteTaxBasis,
} from './commerce-quotes'
import type { StorefrontTaxMode } from './commerce-tax-decision'

/*==========================================
 * PROOFS, REVISIONS AND THE CUSTOMER'S ANSWER (AGL-4096).
 *
 * A quote's REVISION is the version the customer is looking at. The business
 * attaches proofs to the current revision; the customer approves them under
 * a typed name or asks for changes; the business then starts the next
 * revision, which keeps the one before exactly as it stood in
 * `hosts/{hostId}/orders/{id}/revisions/{n}` and starts the new one with no
 * proofs and no answer. Every revision is kept.
 *
 * Whether paying waits on an approval is the business's control
 * (`requireProofApproval`, AGL-4093) and `quotePaymentBlockedByApproval`
 * answers it; nothing here makes paying wait when it is off.
 *
 * Pure: the console route, the customer's route and (slice 5) the send that
 * starts a revision all call these, and write what they answer.
 *=========================================*/

/** The most proofs one revision holds. */
export const QUOTE_MAX_PROOFS = 10

/** The most answers the customer gives one revision; plenty for a change of mind. */
export const QUOTE_MAX_RESPONSES = 20

/** The longest comment a customer may leave. */
export const QUOTE_MAX_COMMENT = 5_000

/** The longest name an approval is signed with. */
export const QUOTE_MAX_APPROVER_NAME = 120

/** What the visitor uploads are called for a quote: its proofs, and the customer's artwork. */
export const QUOTE_PROOF_PURPOSE = 'quote-proof'
export const QUOTE_ARTWORK_PURPOSE = 'quote-artwork'

/** A revision as it stood when the next one started. */
export interface QuoteRevisionSnapshot {
  revision: number
  /** Where it stood with the business when it closed. */
  stage: QuoteStage
  lineItems: OrderLineItem[]
  totals: OrderTotals | null
  taxMode: StorefrontTaxMode | null
  tax: QuoteTaxBasis | null
  discount: QuoteDiscount | null
  shipping: QuoteShipping | null
  notes: string
  terms: string
  customer: QuoteCustomer | null
  billTo: OrderAddress | null
  shipTo: OrderAddress | null
  proofs: QuoteProof[]
  responses: QuoteCustomerResponse[]
  approval: QuoteApproval | null
  /** When the revision was last written by the business. */
  updatedAtMs: number
  /** When the next revision started, and who started it. */
  closedAtMs: number
  closedBy: string
}

/** The current revision's proofs. */
export function currentQuoteProofs(quote: Pick<OrderQuote, 'proofs' | 'revision'> | null | undefined): QuoteProof[] {
  const revision = Number(quote?.revision ?? 1)
  return (quote?.proofs ?? []).filter((proof) => Number(proof?.revision) === revision)
}

/** The customer's latest answer to the current revision, if they gave one. */
export function latestQuoteResponse(
  quote: Pick<OrderQuote, 'responses' | 'revision'> | null | undefined,
): QuoteCustomerResponse | null {
  const revision = Number(quote?.revision ?? 1)
  const answers = (quote?.responses ?? []).filter((response) => Number(response?.revision) === revision)
  return answers.length ? answers[answers.length - 1] : null
}

/** Whether the customer has answered the current revision. */
export function quoteRevisionAnswered(quote: Pick<OrderQuote, 'responses' | 'revision'> | null | undefined): boolean {
  return latestQuoteResponse(quote) !== null
}

/*------------------------------------------
 * The business's proofs
 *-----------------------------------------*/

export type QuoteProofRefusal = 'not-a-quote' | 'paid' | 'answered' | 'full' | 'unknown-proof'

/** Why the current revision's proofs cannot be changed now, if they cannot. */
export function quoteProofChangeRefusal(
  order: Pick<HostOrder, 'channel' | 'status' | 'quote'> | null | undefined,
  change: 'add' | 'remove',
): QuoteProofRefusal | null {
  if (!order || !isQuote(order) || !order.quote) return 'not-a-quote'
  if (!isUnpaidQuote(order)) return 'paid'
  if (quoteRevisionAnswered(order.quote)) return 'answered'
  if (change === 'add' && currentQuoteProofs(order.quote).length >= QUOTE_MAX_PROOFS) return 'full'
  return null
}

export function quoteProofRefusalMessage(reason: QuoteProofRefusal): string {
  switch (reason) {
    case 'not-a-quote':
      return 'Unknown quote'
    case 'paid':
      return 'This quote has been paid, so its proofs can no longer be changed.'
    case 'answered':
      return 'The customer has answered this revision. Start a new revision to send different proofs.'
    case 'full':
      return `A revision holds up to ${QUOTE_MAX_PROOFS} proofs. Remove one first.`
    case 'unknown-proof':
      return 'That proof is no longer on this quote.'
  }
}

/** The quote with a proof added to its current revision, edited by `by` at `atMs`. */
export function withQuoteProofAdded(
  order: HostOrder,
  proof: Omit<QuoteProof, 'revision' | 'addedAtMs' | 'addedBy'>,
  options: { atMs: number; by: string },
): { ok: true; order: HostOrder; proof: QuoteProof } | { ok: false; reason: QuoteProofRefusal } {
  const refused = quoteProofChangeRefusal(order, 'add')
  if (refused) return { ok: false, reason: refused }
  const quote = order.quote as OrderQuote
  const added: QuoteProof = {
    id: proof.id,
    revision: Number(quote.revision ?? 1),
    name: proof.name,
    contentType: proof.contentType,
    size: proof.size,
    path: proof.path,
    addedAtMs: options.atMs,
    addedBy: options.by,
  }
  return {
    ok: true,
    proof: added,
    order: {
      ...order,
      timeline: appendOrderEvent(
        order,
        'quote-proof-added',
        `Proof ${added.name} added to revision ${added.revision} by ${options.by}`,
        options.atMs,
      ),
      quote: {
        ...quote,
        proofs: [...currentQuoteProofs(quote).filter((entry) => entry.id !== added.id), added],
        updatedAtMs: options.atMs,
        updatedBy: options.by,
      },
    },
  }
}

/** The quote with one of the current revision's proofs taken off. */
export function withQuoteProofRemoved(
  order: HostOrder,
  proofId: string,
  options: { atMs: number; by: string },
): { ok: true; order: HostOrder; proof: QuoteProof } | { ok: false; reason: QuoteProofRefusal } {
  const refused = quoteProofChangeRefusal(order, 'remove')
  if (refused) return { ok: false, reason: refused }
  const quote = order.quote as OrderQuote
  const proofs = currentQuoteProofs(quote)
  const proof = proofs.find((entry) => entry.id === proofId)
  if (!proof) return { ok: false, reason: 'unknown-proof' }
  return {
    ok: true,
    proof,
    order: {
      ...order,
      timeline: appendOrderEvent(
        order,
        'quote-proof-removed',
        `Proof ${proof.name} removed from revision ${proof.revision} by ${options.by}`,
        options.atMs,
      ),
      quote: {
        ...quote,
        proofs: proofs.filter((entry) => entry.id !== proofId),
        updatedAtMs: options.atMs,
        updatedBy: options.by,
      },
    },
  }
}

/*------------------------------------------
 * Revisions
 *-----------------------------------------*/

export type QuoteRevisionRefusal = 'not-a-quote' | 'paid'

/**
 * Starts the quote's next revision. The current one is SNAPSHOTTED as it
 * stands (its lines, totals, notes, terms, proofs and the customer's
 * answers); the quote moves to revision N+1 with no proofs and no answer,
 * back at Draft, edited by `by` at `atMs`. A paid quote starts none.
 *
 * The caller writes `snapshot` to `hosts/{hostId}/orders/{id}/revisions/{revision}`
 * (`String(snapshot.revision)`, created, never overwritten) and `order` over
 * the quote, in one transaction. The pay link's version is not touched: the
 * send that hands the customer the new revision decides that.
 */
export function startQuoteRevision(
  order: HostOrder,
  options: { atMs: number; by: string },
):
  | { ok: true; snapshot: QuoteRevisionSnapshot; order: HostOrder; revision: number }
  | { ok: false; reason: QuoteRevisionRefusal; error: string } {
  if (!isQuote(order) || !order.quote) return { ok: false, reason: 'not-a-quote', error: 'Unknown quote' }
  if (!isUnpaidQuote(order)) {
    return { ok: false, reason: 'paid', error: 'This quote has been paid, so it takes no new revision.' }
  }
  const quote = order.quote
  const current = Math.max(1, Math.floor(Number(quote.revision ?? 1)) || 1)
  const responses = (quote.responses ?? []).filter((response) => Number(response?.revision) === current)
  const approval = quote.approval && Number(quote.approval.revision) === current ? quote.approval : null
  const snapshot: QuoteRevisionSnapshot = {
    revision: current,
    stage: quote.stage ?? 'draft',
    lineItems: order.lineItems ?? [],
    totals: order.totals ?? null,
    taxMode: order.taxMode ?? null,
    tax: quote.tax ?? null,
    discount: quote.discount ?? null,
    shipping: quote.shipping ?? null,
    notes: quote.notes ?? '',
    terms: quote.terms ?? '',
    customer: quote.customer ?? null,
    billTo: quote.billTo ?? null,
    shipTo: quote.shipTo ?? null,
    proofs: currentQuoteProofs(quote),
    responses,
    approval,
    updatedAtMs: Number(quote.updatedAtMs) || 0,
    closedAtMs: options.atMs,
    closedBy: options.by,
  }
  const next = current + 1
  return {
    ok: true,
    revision: current,
    snapshot,
    order: {
      ...order,
      timeline: appendOrderEvent(
        order,
        'quote-revision-started',
        `Revision ${next} started by ${options.by}; revision ${current} is kept with its proofs and answers`,
        options.atMs,
      ),
      quote: {
        ...quote,
        revision: next,
        stage: 'draft',
        proofs: [],
        responses: [],
        approval: null,
        updatedAtMs: options.atMs,
        updatedBy: options.by,
      },
    },
  }
}

/*------------------------------------------
 * The customer's answer
 *-----------------------------------------*/

export type QuoteRespondRefusal = 'not-a-quote' | 'paid' | 'no-proof' | 'too-many'

/** Why the customer cannot answer the current revision now, if they cannot. */
export function quoteRespondRefusal(
  order: Pick<HostOrder, 'channel' | 'status' | 'quote'> | null | undefined,
): QuoteRespondRefusal | null {
  if (!order || !isQuote(order) || !order.quote) return 'not-a-quote'
  if (!isUnpaidQuote(order)) return 'paid'
  if (currentQuoteProofs(order.quote).length === 0) return 'no-proof'
  const revision = Number(order.quote.revision ?? 1)
  const given = (order.quote.responses ?? []).filter((response) => Number(response?.revision) === revision)
  if (given.length >= QUOTE_MAX_RESPONSES) return 'too-many'
  return null
}

export function quoteRespondRefusalMessage(reason: QuoteRespondRefusal, storeName: string): string {
  const business = storeName || 'the business'
  switch (reason) {
    case 'not-a-quote':
      return 'We could not find that quote. Check the link you were sent.'
    case 'paid':
      return 'This quote has been paid, so it takes no more answers.'
    case 'no-proof':
      return `There is no proof on this quote to answer yet. ${storeName || 'The business'} will send one.`
    case 'too-many':
      return `This proof has had a lot of answers already. Contact ${business} directly.`
  }
}

/** What the customer sends: approve under a name, or changes with a comment and any files. */
export type QuoteResponseInput =
  | { action: 'approve'; name: string }
  | { action: 'changes'; comment: string; fileIds: string[] }

/** The customer's answer as the route received it, checked and trimmed, or what to fix. */
export function parseQuoteResponseInput(raw: unknown): { ok: true; input: QuoteResponseInput } | { ok: false; error: string } {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (source['action'] === 'approve') {
    const name = typeof source['name'] === 'string' ? source['name'].replace(/\s+/g, ' ').trim() : ''
    if (name.length < 2) return { ok: false, error: 'Type your name to approve the proof.' }
    return { ok: true, input: { action: 'approve', name: name.slice(0, QUOTE_MAX_APPROVER_NAME) } }
  }
  if (source['action'] === 'changes') {
    const comment = typeof source['comment'] === 'string' ? source['comment'].trim() : ''
    if (!comment) return { ok: false, error: 'Tell us what to change.' }
    const raws = Array.isArray(source['fileIds']) ? (source['fileIds'] as unknown[]) : []
    const named = raws.map((value) => String(value ?? '')).filter((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value))
    if (named.length !== raws.length) return { ok: false, error: 'One of the files could not be attached. Send it again.' }
    const fileIds = [...new Set(named)]
    if (fileIds.length > QUOTE_MAX_PROOFS) return { ok: false, error: `Send up to ${QUOTE_MAX_PROOFS} files at a time.` }
    return { ok: true, input: { action: 'changes', comment: comment.slice(0, QUOTE_MAX_COMMENT), fileIds } }
  }
  return { ok: false, error: 'Approve the proof or ask for changes.' }
}

/**
 * The quote with the customer's answer recorded on its current revision.
 * Approving names the revision approved and moves the quote to Approved;
 * asking for changes moves it to Changes requested and withdraws an approval
 * of the same revision. The latest answer is the one that counts. The
 * business's edit stamp (`updatedAtMs`) is not touched: the quote's content
 * did not change, and the page that sent the answer can still pay it.
 */
export function applyQuoteResponse(
  order: HostOrder,
  input: QuoteResponseInput & { files?: QuoteResponseFile[] },
  context: { atMs: number; ip: string | null; userAgent: string | null },
): { ok: true; order: HostOrder; response: QuoteCustomerResponse } | { ok: false; reason: QuoteRespondRefusal } {
  const refused = quoteRespondRefusal(order)
  if (refused) return { ok: false, reason: refused }
  const quote = order.quote as OrderQuote
  const revision = Number(quote.revision ?? 1)
  const ip = context.ip ? context.ip.slice(0, 64) : null
  const userAgent = context.userAgent ? context.userAgent.slice(0, 400) : null
  const response: QuoteCustomerResponse =
    input.action === 'approve'
      ? { action: 'approve', revision, atMs: context.atMs, name: input.name, ip, userAgent }
      : {
          action: 'changes',
          revision,
          atMs: context.atMs,
          comment: input.comment,
          ...(input.files?.length ? { files: input.files } : {}),
          ip,
          userAgent,
        }
  const responses = [...(quote.responses ?? []).filter((entry) => Number(entry?.revision) === revision), response]
  const number = formatQuoteNumber(order)
  const next: OrderQuote =
    response.action === 'approve'
      ? {
          ...quote,
          responses,
          stage: 'approved',
          approvedRevision: revision,
          approval: { revision, name: response.name ?? '', atMs: context.atMs, ip, userAgent },
        }
      : {
          ...quote,
          responses,
          stage: 'changes_requested',
          approvedRevision: Number(quote.approvedRevision) === revision ? null : (quote.approvedRevision ?? null),
          approval: null,
        }
  return {
    ok: true,
    response,
    order: {
      ...order,
      timeline: appendOrderEvent(
        order,
        response.action === 'approve' ? 'quote-approved' : 'quote-changes-requested',
        response.action === 'approve'
          ? `${number} revision ${revision} approved by the customer as ${response.name}`
          : `The customer asked for changes to ${number} revision ${revision}` +
              (response.files?.length ? ` and sent ${response.files.length} file${response.files.length === 1 ? '' : 's'}` : ''),
        context.atMs,
      ),
      quote: next,
    },
  }
}

/** One line on what the customer last said: `Approved by Jordan Lee`, `Changes requested`. */
export function describeQuoteResponse(response: Pick<QuoteCustomerResponse, 'action' | 'name'>): string {
  return response.action === 'approve' ? `Approved by ${response.name || 'the customer'}` : 'Changes requested'
}
