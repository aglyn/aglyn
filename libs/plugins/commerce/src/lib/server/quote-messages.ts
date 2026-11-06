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
import { checkEntitlement } from '@aglyn/aglyn/server'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { VISITOR_UPLOAD_HONEYPOT_FIELD } from '@aglyn/aglyn/app-utils/visitor-upload'
import * as CommerceModel from '../model'
import type { QuoteDeps } from './quote'
import type { QuoteMailer } from './quote-email'
import { limitedQuoteLink, loadLinkedQuote, quoteLinkParams, sendQuoteLinkOutcome, type QuoteLinkOutcome } from './quote-pay'
import { defaultQuoteProofDeps, type QuoteProofDeps } from './quote-proofs'

/*==========================================
 * A QUOTE'S CONVERSATION (AGL-4207), both halves:
 *
 *   console  POST /api/commerce/quote { action: 'messages', quoteId }
 *              → { messages }                         ("Create and edit quotes")
 *            POST /api/commerce/quote { action: 'reply', quoteId, message } + Idempotency-Key
 *              → { sent, to, atMs }                   ("Send quotes and invoices to customers")
 *   site     POST /api/commerce/quote-message { hostId, q, t, message } + Idempotency-Key
 *              → 200 { messages } | 400 | 404 | 410 | 429
 *
 * A reply goes by email in the quote's own conversation (`quote.emailThread`)
 * and is kept under the quote; what the customer writes on the quote page is
 * kept there too, and the business is told in Aglyn and by email. Nothing
 * receives mail: an answer to the email reaches the business's own mailbox
 * (its Reply-To), as an Inbox reply's does.
 *=========================================*/

type Outcome = { status: number; body: Record<string, unknown> }

const refuse = (status: number, error: string): Outcome => ({ status, body: { error } })

/** Messages the customer may send per address per site, per ten minutes. */
export const QUOTE_MESSAGES_PER_WINDOW = 20

function headerOf(req: PluginApiRequest, name: string): string {
  const headers = (req.headers ?? {}) as Record<string, unknown>
  const value = headers[name.toLowerCase()] ?? headers[name]
  return String(Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim()
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

/** The quote's messages, newest {@link CommerceModel.QUOTE_MESSAGES_SHOWN}, as stored (the page's view reads the same, in `payLinkPageView`). */
export async function readQuoteMessages(
  orderRef: FirebaseFirestore.DocumentReference,
): Promise<Array<{ id: string; data: Partial<CommerceModel.QuoteMessage> }>> {
  const listed = await orderRef.collection('messages').orderBy('atMs', 'desc').limit(CommerceModel.QUOTE_MESSAGES_SHOWN).get()
  return listed.docs.map((entry) => ({ id: entry.id, data: entry.data() as Partial<CommerceModel.QuoteMessage> }))
}

/*------------------------------------------
 * The console: read the conversation, and reply
 *-----------------------------------------*/

export async function handleQuoteMessagesAction(
  deps: QuoteDeps,
  context: {
    action: 'messages' | 'reply'
    req: PluginApiRequest
    body: Record<string, unknown>
    hostId: string
    quoteId: string
    hostRef: FirebaseFirestore.DocumentReference
    host: Record<string, unknown>
    actor: string
    senderEmail: string | null
  },
): Promise<Outcome> {
  const { action, req, body, hostId, quoteId, hostRef, host, actor } = context
  const firestore = deps.firestore()
  const ref = hostRef.collection('orders').doc(quoteId)

  if (action === 'messages') {
    const snapshot = await ref.get()
    const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
    if (!order || !CommerceModel.isQuote(order) || !order.quote) return refuse(404, 'Unknown quote')
    const messages = CommerceModel.quoteConsoleMessages(await readQuoteMessages(ref))
    return { status: 200, body: { messages, to: CommerceModel.quoteReplyRecipient(order) } }
  }

  const parsed = CommerceModel.parseQuoteMessageBody(body['message'])
  if ('error' in parsed) return refuse(400, parsed.error)
  const idempotencyKey = headerOf(req, 'idempotency-key').slice(0, 200)
  if (!idempotencyKey) return refuse(400, 'Sending a reply needs an Idempotency-Key header.')
  const snapshot = await ref.get()
  const stored = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
  const refused = CommerceModel.quoteReplyRefusal(stored)
  if (refused || !stored) {
    const reason = refused ?? 'not-a-quote'
    return refuse(reason === 'not-a-quote' ? 404 : 409, CommerceModel.quoteReplyRefusalMessage(reason))
  }
  const to = CommerceModel.quoteReplyRecipient(stored)
  const url = deps.payLinkUrl(host, hostId, quoteId, CommerceModel.quoteLinkVersion(stored.quote))
  if (!url) return refuse(409, 'This site has no web address yet, so its quotes have no link to reply with. Publish the site first.')
  const owner = await deps.orgForHost(hostId)
  if (!checkEntitlement(owner?.org as never, 'commerce')) return refuse(403, 'Selling is not enabled')
  const mailer = await deps.mailer()
  if (!mailer.configured()) return refuse(503, 'Email isn’t set up here, so replies can’t be emailed.')
  // The bounce and complaint list only: the customer is in a conversation they started.
  if (await mailer.suppression(to)) {
    return refuse(409, `${to} bounced or reported an email as spam, so it can’t be emailed.`)
  }

  const claimed = await claimAttempt(firestore, {
    kind: 'commerce-quote-reply',
    scopeId: `${hostId}:${quoteId}`,
    orgId: owner?.id ?? '',
    key: idempotencyKey,
    busyMessage: 'This reply is already being sent',
  })
  if ('replay' in claimed) return { status: claimed.replay.status, body: claimed.replay.body as Record<string, unknown> }
  const claim = claimed.claim
  const now = deps.now()
  let delivered: Awaited<ReturnType<QuoteMailer['deliverMessage']>>
  try {
    delivered = await mailer.deliverMessage({
      hostId,
      quoteId,
      order: stored,
      host,
      owner: owner ? { id: owner.id, org: owner.org } : null,
      to,
      body: parsed.body,
      url,
      senderEmail: context.senderEmail,
      atMs: now,
    })
  } catch (error) {
    console.error('commerce quote reply failed', error)
    await claim.release()
    return refuse(502, 'The reply could not be sent. Try again.')
  }
  // `strictNullChecks` is off, so the result does not narrow on `sent`.
  if ('error' in delivered) {
    await claim.release()
    return refuse(delivered.status, delivered.error)
  }
  const done = delivered as Extract<typeof delivered, { sent: true }>

  // The email is out: from here a failure is logged, never answered as one, so a retry does not send it twice.
  const message: CommerceModel.QuoteMessage = {
    direction: 'out',
    body: parsed.body,
    atMs: now,
    revision: Math.max(1, Number(stored.quote?.revision ?? 1) || 1),
    by: actor,
    to,
    messageId: done.messageId,
    providerId: done.providerId,
  }
  try {
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      const latest = current.exists ? (current.data() as CommerceModel.HostOrder) : null
      transaction.set(ref.collection('messages').doc(), message)
      if (!latest?.quote) return
      transaction.set(ref, CommerceModel.quoteAfterReply(latest, { to, by: actor, atMs: now }, done.thread))
    })
  } catch (error) {
    console.error('commerce quote reply sent but not recorded', { hostId, quoteId, messageId: done.messageId, error })
  }
  const outcome: Outcome = { status: 200, body: { sent: true, to, atMs: now } }
  await claim.record(outcome.status, outcome.body)
  return outcome
}

/*------------------------------------------
 * The site: the customer writes on the quote page
 *-----------------------------------------*/

/** The managers' notice of a customer's message: who, which quote, what they said, and how to answer. */
export function quoteMessageNotice(input: {
  hostId: string
  quoteId: string
  order: CommerceModel.HostOrder
  body: string
}) {
  const { hostId, quoteId, order, body } = input
  const quote = order.quote as CommerceModel.OrderQuote
  const number = CommerceModel.formatQuoteNumber(order, quoteId)
  const customer = quote.customer?.name || quote.customer?.company || quote.customer?.email || 'The customer'
  const email = String(quote.customer?.email ?? '').trim()
  const excerpt = body.length > 1_000 ? `${body.slice(0, 1_000)}…` : body
  return {
    payload: {
      type: 'content.order' as const,
      level: 'info' as const,
      label: 'Customer message',
      actionLabel: 'View quote',
      title: `${customer} wrote about ${number} on {site}`,
      body: `${excerpt}\n\nReply from the quote, or reply to this email to reach them.`,
      link: `/${hostId}/products/orders?quote=${encodeURIComponent(quoteId)}`,
    },
    options: {
      emailDetails: [
        { label: 'Quote', value: number },
        { label: 'Customer', value: [quote.customer?.name, quote.customer?.company, email].filter(Boolean).join(', ') },
        { label: 'Message', value: excerpt },
      ],
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { replyTo: email } : {}),
    },
  }
}

/** `POST /api/commerce/quote-message`: the customer writes to the business on the quote page. */
export async function handleQuoteMessage(deps: QuoteProofDeps, req: PluginApiRequest): Promise<QuoteLinkOutcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = bodyOf(req)
  const { hostId, quoteId, token, complete } = quoteLinkParams(body)
  if (!complete) return { status: 400, body: { error: 'This link is incomplete.' } }
  // A form a person fills never fills this; a bot that did learns nothing.
  const honeypot = body[VISITOR_UPLOAD_HONEYPOT_FIELD]
  if (typeof honeypot === 'string' && honeypot.trim()) return { status: 200, body: { received: true } }
  const idempotencyKey = headerOf(req, 'idempotency-key').slice(0, 200)
  if (!idempotencyKey) return { status: 400, body: { error: 'A message needs an Idempotency-Key header.' } }
  const limited = await limitedQuoteLink(deps, req, `commerce-quote-message:${hostId}`, QUOTE_MESSAGES_PER_WINDOW)
  if (limited) return limited
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token)
  if ('outcome' in linked) return linked.outcome
  const { hostRef, order } = linked.loaded
  if (linked.loaded.kind !== 'quote' || !order.quote) return { status: 404, body: { error: 'We could not find that quote. Check the link you were sent.' } }
  const parsed = CommerceModel.parseQuoteMessageBody(body['message'])
  if ('error' in parsed) return { status: 400, body: { error: parsed.error } }

  const claimed = await claimAttempt(deps.firestore(), {
    kind: 'commerce-quote-message',
    scopeId: `${hostId}:${quoteId}`,
    orgId: '',
    key: idempotencyKey,
    busyMessage: 'Your message is already being sent',
  })
  if ('replay' in claimed) return { status: claimed.replay.status, body: claimed.replay.body as Record<string, unknown> }
  const claim = claimed.claim
  const now = deps.now()
  const ref = hostRef.collection('orders').doc(quoteId)
  const ip = readClientIp(req.headers as never, { remoteAddress: req.socket?.remoteAddress })
  const message: CommerceModel.QuoteMessage = {
    direction: 'in',
    body: parsed.body,
    atMs: now,
    revision: Math.max(1, Number(order.quote.revision ?? 1) || 1),
    name: String(order.quote.customer?.name ?? '').trim() || String(order.quote.customer?.company ?? '').trim(),
    ip: ip ? ip.slice(0, 64) : null,
    userAgent: headerOf(req, 'user-agent').slice(0, 400) || null,
  }
  try {
    await ref.collection('messages').doc().set(message)
  } catch (error) {
    console.error('quote message failed', error)
    await claim.release()
    return { status: 500, body: { error: 'Your message could not be sent. Try again.' } }
  }
  const messages = CommerceModel.quotePageMessages(await readQuoteMessages(ref))
  const outcome = { status: 200, body: { messages } as Record<string, unknown> }
  await claim.record(200, outcome.body)
  const notice = quoteMessageNotice({ hostId, quoteId, order, body: parsed.body })
  void deps.notify(hostId, notice.payload, notice.options)
  return outcome
}

/** `POST /api/commerce/quote-message`. */
export const quoteMessageHandler: PluginApiHandler = async (req, res) => {
  try {
    return sendQuoteLinkOutcome(res, await handleQuoteMessage(defaultQuoteProofDeps(), req))
  } catch (error) {
    console.error('quote message failed', error)
    return sendQuoteLinkOutcome(res, { status: 500, body: { error: 'Your message could not be sent. Try again.' } })
  }
}
