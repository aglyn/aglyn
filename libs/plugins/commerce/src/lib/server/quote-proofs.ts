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

import { claimAttempt, type PluginApiHandler, type PluginApiRequest } from '@aglyn/aglyn/server'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { VISITOR_UPLOAD_HONEYPOT_FIELD, visitorUploadFileView } from '@aglyn/aglyn/app-utils/visitor-upload'
import { notifyHostManagers } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { orderStatusUrl } from './order-status-token'
import {
  defaultQuotePayDeps,
  limitedQuoteLink,
  loadLinkedQuote,
  quoteLinkParams,
  sendQuoteLinkOutcome,
  type QuoteLinkOutcome,
  type QuotePayDeps,
} from './quote-pay'
import { keepSentQuoteUploads, quoteUploadKeyRef, recordPendingQuoteUpload } from './quote-upload-keys'
import { quoteUploadCalls, type QuoteUploadCalls } from './quote-uploads'

/*==========================================
 * THE CUSTOMER'S SIDE OF A PROOF (AGL-4096), on the business's site, behind
 * the quote's signed pay link like the page itself:
 *
 *   GET  /api/commerce/quote-proof?hostId=&q=&t=&file=<proofId>
 *        → the current revision's proof (a picture inline, anything else as a
 *          download) | 404 | 410 replaced | 429
 *   POST /api/commerce/quote-upload  { hostId, q, t, action: 'ticket', file: { name, contentType, size } }
 *        → { ticket, upload: { url, fields }, file }
 *   POST /api/commerce/quote-upload  { hostId, q, t, action: 'finalize', ticket }
 *        → { file: { id, name, contentType, size, uploadedAtMs } }
 *   POST /api/commerce/quote-respond { hostId, q, t, v, action: 'approve', name }
 *                                    { hostId, q, t, v, action: 'changes', comment, fileIds? }
 *        + Idempotency-Key → 200 { view } | 409 { error, reason } | 410 { replaced } | 404 | 400 | 429
 *
 * Every route spends a per-address rate limit on the site BEFORE the token is
 * checked, answers a wrong token exactly as a missing quote, and answers a
 * link to an older version as replaced. The uploads are the shared visitor
 * upload (`@aglyn/tenant-data-admin/server/visitor-upload`), scoped to this
 * quote's artwork; the answer names the files by id and the server reads
 * them back from that scope, so nothing else can be attached.
 *
 * `v` is the edit of the quote the page showed, as Pay sends it: an answer to
 * proofs the customer has not seen is refused and the page is shown again.
 *
 * A file goes up before the answer does, so each one is recorded as pending
 * under its quote from its ticket on, and the answer that sends it takes it
 * off; one never sent is deleted a day later (`quote-upload-keys.ts`).
 *=========================================*/

/** Proofs one address may load per site, per ten minutes: every thumbnail of a few visits. */
export const QUOTE_PROOF_LOADS_PER_WINDOW = 120
/** Upload calls (tickets and finalizes) one address may make per site, per ten minutes, before the upload's own limits. */
export const QUOTE_UPLOAD_CALLS_PER_WINDOW = 80
/** Answers one address may send per site, per ten minutes. */
export const QUOTE_RESPONSES_PER_WINDOW = 20

export interface QuoteProofDeps extends QuotePayDeps {
  uploads(): Promise<QuoteUploadCalls>
  notify(...args: Parameters<typeof notifyHostManagers>): Promise<void>
}

export function defaultQuoteProofDeps(): QuoteProofDeps {
  return {
    ...defaultQuotePayDeps(),
    uploads: async () => quoteUploadCalls(),
    notify: (...args) => notifyHostManagers(...args),
  }
}

function bodyOf(req: PluginApiRequest): Record<string, unknown> {
  const raw = req.body
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function headerOf(req: PluginApiRequest, name: string): string {
  const headers = (req.headers ?? {}) as Record<string, unknown>
  const value = headers[name.toLowerCase()] ?? headers[name]
  return String(Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim()
}

const clientIp = (req: PluginApiRequest): string | null =>
  readClientIp(req.headers as never, { remoteAddress: req.socket?.remoteAddress })

const reasonRefusal = (status: number, reason: string, error: string): QuoteLinkOutcome => ({
  status,
  body: { error, reason },
})

/** What a proof route answers: a JSON outcome, or a file to stream. */
export type QuoteProofOutcome = QuoteLinkOutcome & { file?: { path: string; name: string; contentType: string } }

/** `GET /api/commerce/quote-proof`: one of the current revision's proofs. */
export async function handleQuoteProof(deps: QuoteProofDeps, req: PluginApiRequest): Promise<QuoteProofOutcome> {
  if (req.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } }
  const query = (req.query ?? {}) as Record<string, unknown>
  const { hostId, quoteId, token, complete } = quoteLinkParams(query)
  const fileId = String(query['file'] ?? '').slice(0, 200)
  if (!complete || !fileId) return { status: 400, body: { error: 'This link is incomplete.' } }
  const limited = await limitedQuoteLink(deps, req, `commerce-quote-proof:${hostId}`, QUOTE_PROOF_LOADS_PER_WINDOW)
  if (limited) return limited
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token)
  if ('outcome' in linked) return linked.outcome
  const proof = CommerceModel.currentQuoteProofs(linked.loaded.order.quote).find((entry) => entry.id === fileId)
  if (!proof?.path) return { status: 404, body: { error: 'That proof is no longer on this quote.' } }
  return { status: 200, body: {}, file: { path: proof.path, name: proof.name, contentType: proof.contentType } }
}

/** `POST /api/commerce/quote-upload`: a ticket for one of the customer's files, or its finalize. */
export async function handleQuoteUpload(deps: QuoteProofDeps, req: PluginApiRequest): Promise<QuoteLinkOutcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = bodyOf(req)
  const { hostId, quoteId, token, complete } = quoteLinkParams(body)
  if (!complete) return { status: 400, body: { error: 'This link is incomplete.' } }
  // A form a person fills never fills this; a bot that did learns nothing.
  const honeypot = body[VISITOR_UPLOAD_HONEYPOT_FIELD]
  if (typeof honeypot === 'string' && honeypot.trim()) return { status: 200, body: { received: true } }
  const limited = await limitedQuoteLink(deps, req, `commerce-quote-upload:${hostId}`, QUOTE_UPLOAD_CALLS_PER_WINDOW)
  if (limited) return limited
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token)
  if ('outcome' in linked) return linked.outcome
  const { order, storeName } = linked.loaded
  // Artwork rides an answer; a quote that cannot be answered takes none.
  const refused = CommerceModel.quoteRespondRefusal(order)
  if (refused) return reasonRefusal(409, refused, CommerceModel.quoteRespondRefusalMessage(refused, storeName))

  const scope = { hostId, purpose: CommerceModel.QUOTE_ARTWORK_PURPOSE, purposeId: quoteId }
  const caller = { ip: clientIp(req) ?? 'no-address' }
  const uploads = await deps.uploads()
  if (body['action'] === 'ticket') {
    const minted = await uploads.mint({ scope, request: body['file'], caller })
    if ('error' in minted) {
      return {
        status: minted.status,
        body: { error: minted.error, code: minted.code },
        ...(minted.retryAfterSeconds ? { headers: { 'Retry-After': String(minted.retryAfterSeconds) } } : {}),
      }
    }
    // Pending before a byte can arrive, so a file kept and never sent is always swept.
    await recordPendingQuoteUpload(deps.firestore(), { hostId, quoteId, fileId: minted.file.id, nowMs: deps.now() })
    return { status: 200, body: { ticket: minted.ticket, upload: minted.upload, file: minted.file } }
  }
  if (body['action'] === 'finalize') {
    const kept = await uploads.finalize({ scope, ticket: body['ticket'], caller })
    if ('error' in kept) return { status: kept.status, body: { error: kept.error, code: kept.code } }
    // Its day starts again from the latest file.
    await recordPendingQuoteUpload(deps.firestore(), { hostId, quoteId, fileId: kept.file.id, nowMs: deps.now() })
    return { status: 200, body: { file: visitorUploadFileView(kept.file) } }
  }
  return { status: 400, body: { error: 'Unknown action' } }
}

const UPDATED_MESSAGE = 'This quote was updated since you opened it. Look it over again before you answer.'

/** The managers' notice of an answer: who, which quote and revision, what they said, and what to do next. */
function noticeOf(input: {
  hostId: string
  quoteId: string
  order: CommerceModel.HostOrder
  response: CommerceModel.QuoteCustomerResponse
}) {
  const { hostId, quoteId, order, response } = input
  const quote = order.quote as CommerceModel.OrderQuote
  const number = CommerceModel.formatQuoteNumber(order, quoteId)
  const customer = quote.customer?.name || quote.customer?.company || quote.customer?.email || 'The customer'
  const revision = response.revision
  const files = response.files ?? []
  const approving = response.action === 'approve'
  const payNote = quote.requireProofApproval === true ? ' They can pay the quote now.' : ''
  const details = [
    { label: 'Quote', value: number },
    { label: 'Customer', value: [quote.customer?.name, quote.customer?.company, quote.customer?.email].filter(Boolean).join(', ') },
    { label: 'Revision', value: String(revision) },
    ...(approving
      ? [{ label: 'Approved as', value: response.name ?? '' }]
      : [
          { label: 'What to change', value: response.comment ?? '' },
          ...(files.length ? [{ label: 'Files sent', value: files.map((file) => file.name).join(', ') }] : []),
        ]),
  ]
  const email = String(quote.customer?.email ?? '').trim()
  return {
    payload: {
      type: 'content.order' as const,
      title: approving ? `Proof approved — ${number} on {site}` : `Changes requested — ${number} on {site}`,
      body: approving
        ? `${customer} approved the proof for revision ${revision} of ${number}.${payNote} The approval, with the name, time and address it was given from, is on the quote.`
        : `${customer} asked for changes to revision ${revision} of ${number}` +
          (files.length ? ` and sent ${files.length} file${files.length === 1 ? '' : 's'}` : '') +
          `. Read what they asked for on the quote, then start revision ${revision + 1} with new proofs.`,
      link: `/${hostId}/products/orders?quote=${encodeURIComponent(quoteId)}`,
    },
    options: {
      emailDetails: details,
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { replyTo: email } : {}),
    },
  }
}

/** `POST /api/commerce/quote-respond`: the customer approves the proof or asks for changes. */
export async function handleQuoteRespond(deps: QuoteProofDeps, req: PluginApiRequest): Promise<QuoteLinkOutcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = bodyOf(req)
  const { hostId, quoteId, token, complete } = quoteLinkParams(body)
  if (!complete) return { status: 400, body: { error: 'This link is incomplete.' } }
  const honeypot = body[VISITOR_UPLOAD_HONEYPOT_FIELD]
  if (typeof honeypot === 'string' && honeypot.trim()) return { status: 200, body: { received: true } }
  const idempotencyKey = headerOf(req, 'idempotency-key').slice(0, 200)
  if (!idempotencyKey) return { status: 400, body: { error: 'An answer needs an Idempotency-Key header.' } }
  const limited = await limitedQuoteLink(deps, req, `commerce-quote-respond:${hostId}`, QUOTE_RESPONSES_PER_WINDOW)
  if (limited) return limited
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token)
  if ('outcome' in linked) return linked.outcome
  const { hostRef, host, order, storeName, store } = linked.loaded

  // Everything the customer can be refused is decided before the claim, so
  // none of it spends the attempt.
  const seen = Number(body['v'])
  const version = Number(order.quote?.updatedAtMs) || 0
  if (!Number.isFinite(seen) || seen !== version) return reasonRefusal(409, 'updated', UPDATED_MESSAGE)
  const parsed = CommerceModel.parseQuoteResponseInput(body)
  if ('error' in parsed) return { status: 400, body: { error: parsed.error } }
  const refused = CommerceModel.quoteRespondRefusal(order)
  if (refused) return reasonRefusal(409, refused, CommerceModel.quoteRespondRefusalMessage(refused, storeName))

  // The files are read back from this quote's artwork, by id: nothing the
  // browser says about a file is believed, and no other record's file can
  // be named.
  let files: CommerceModel.QuoteResponseFile[] = []
  if (parsed.input.action === 'changes' && parsed.input.fileIds.length) {
    const uploads = await deps.uploads()
    const scope = { hostId, purpose: CommerceModel.QUOTE_ARTWORK_PURPOSE, purposeId: quoteId }
    const read = await Promise.all(parsed.input.fileIds.map((id) => uploads.read(scope, id)))
    if (read.some((file) => !file)) {
      return { status: 400, body: { error: 'One of your files did not finish sending. Send it again.' } }
    }
    files = read.map((file) => ({
      id: file!.id,
      name: file!.name,
      contentType: file!.contentType,
      size: file!.size,
      path: file!.path,
    }))
  }

  const claimed = await claimAttempt(deps.firestore(), {
    kind: 'commerce-quote-respond',
    scopeId: `${hostId}:${quoteId}`,
    orgId: '',
    key: idempotencyKey,
    busyMessage: 'Your answer is already being sent',
  })
  if ('replay' in claimed) {
    return { status: claimed.replay.status, body: claimed.replay.body as Record<string, unknown> }
  }
  const claim = claimed.claim
  const now = deps.now()
  try {
    const ref = hostRef.collection('orders').doc(quoteId)
    const pendingRef = quoteUploadKeyRef(deps.firestore(), hostId, quoteId)
    const settled = await deps.firestore().runTransaction(
      async (transaction): Promise<{ outcome: QuoteLinkOutcome; order?: CommerceModel.HostOrder; response?: CommerceModel.QuoteCustomerResponse }> => {
        const snapshot = await transaction.get(ref)
        // The files this answer sends leave the pending record with it.
        const pending = files.length ? await transaction.get(pendingRef) : null
        const current = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
        if (!current || !CommerceModel.isQuote(current) || !current.quote) {
          return { outcome: { status: 404, body: { error: 'We could not find that quote. Check the link you were sent.' } } }
        }
        if (CommerceModel.quoteLinkVersion(current.quote) !== CommerceModel.quoteLinkVersion(order.quote)) {
          return {
            outcome: {
              status: 410,
              body: { replaced: true, error: `This quote was updated, and ${storeName || 'the business'} sent you a newer link.` },
            },
          }
        }
        if ((Number(current.quote.updatedAtMs) || 0) !== version) {
          return { outcome: reasonRefusal(409, 'updated', UPDATED_MESSAGE) }
        }
        const answered = CommerceModel.applyQuoteResponse(
          current,
          { ...parsed.input, ...(files.length ? { files } : {}) },
          { atMs: now, ip: clientIp(req), userAgent: headerOf(req, 'user-agent') || null },
        )
        if ('reason' in answered) {
          return {
            outcome: reasonRefusal(409, answered.reason, CommerceModel.quoteRespondRefusalMessage(answered.reason, storeName)),
          }
        }
        transaction.set(ref, answered.order)
        if (pending) keepSentQuoteUploads(transaction, pending, pendingRef, files.map((file) => file.id))
        return { outcome: { status: 200, body: {} }, order: answered.order, response: answered.response }
      },
    )
    if (!settled.order || !settled.response) {
      await claim.release()
      return settled.outcome
    }
    const view = CommerceModel.buildQuotePageView({
      order: settled.order,
      orderId: quoteId,
      storeName,
      currency: String(store.get('currency') ?? 'USD'),
      receiptUrl: CommerceModel.isUnpaidQuote(settled.order) ? null : orderStatusUrl(host, hostId, quoteId),
    })
    const outcome = { status: 200, body: { view } as Record<string, unknown> }
    await claim.record(200, outcome.body)
    const notice = noticeOf({ hostId, quoteId, order: settled.order, response: settled.response })
    void deps.notify(hostId, notice.payload, notice.options)
    return outcome
  } catch (error) {
    console.error('quote respond failed', error)
    await claim.release()
    return { status: 500, body: { error: 'Your answer could not be sent. Try again.' } }
  }
}

/** `GET /api/commerce/quote-proof`. */
export const quoteProofHandler: PluginApiHandler = async (req, res) => {
  const deps = defaultQuoteProofDeps()
  try {
    const outcome = await handleQuoteProof(deps, req)
    if (!outcome.file) return sendQuoteLinkOutcome(res, outcome)
    const uploads = await deps.uploads()
    return await uploads.send(res as never, outcome.file)
  } catch (error) {
    console.error('quote proof failed', error)
    return sendQuoteLinkOutcome(res, { status: 500, body: { error: 'This proof could not be loaded. Try again.' } })
  }
}

/** `POST /api/commerce/quote-upload`. */
export const quoteUploadHandler: PluginApiHandler = async (req, res) => {
  try {
    return sendQuoteLinkOutcome(res, await handleQuoteUpload(defaultQuoteProofDeps(), req))
  } catch (error) {
    console.error('quote upload failed', error)
    return sendQuoteLinkOutcome(res, { status: 500, body: { error: 'The file could not be sent. Try again.' } })
  }
}

/** `POST /api/commerce/quote-respond`. */
export const quoteRespondHandler: PluginApiHandler = async (req, res) =>
  sendQuoteLinkOutcome(res, await handleQuoteRespond(defaultQuoteProofDeps(), req))
