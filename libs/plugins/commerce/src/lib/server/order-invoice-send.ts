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

import { checkEntitlement, claimAttempt, type PluginApiHandler, type PluginApiRequest } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import * as CommerceModel from '../model'
import { commerceSitePermissionRefusal } from '../model/plugin-permissions'
import { holdsCommerceSiteKey } from './commerce-site-keys'
import type { InvoiceMailer } from './invoice-email'
import { quotePayLinkUrl } from './quote-link-token'

/*==========================================
 * SEND INVOICE (AGL-4099): `POST /api/commerce/order-invoice-send`.
 *
 *   { hostId, orderId, to?, subject?, message? } + Idempotency-Key
 *     → { sent: true, to, atMs, paid, linkVersion }
 *
 * Emails the invoice for an order or a quote, under "Send quotes and
 * invoices to customers" (`commerce.quotes.send`), the key a quote's send
 * already asks: its label names invoices, and an invoice for an order is the
 * same act toward the same customer.
 *
 * - UNPAID (a draft order, or a quote), the email asks for payment with one
 *   button to the order's lasting pay link (`/pay-quote`, its version on
 *   `quote.linkVersion` for a quote and `payLink.version` otherwise); the
 *   link opens a fresh payment from the stored order whenever it is pressed.
 * - PAID, the email is the record: no button.
 *
 * Refused, in the console's words: an unknown order, a canceled or refunded
 * one, one with nothing on it, an unpaid one its link cannot take payment
 * for (a register sale still open, a quote waiting on the proof's approval,
 * tax not set up, under 50 cents, a draft older than invoices), no address
 * or a bad one, a site with no web address for the link, selling not on,
 * email not set up, and an address that bounced or complained.
 *
 * The send is recorded on the order (`invoiceSends`), on its timeline, and as
 * the conversation it moved on: the quote's for a quote, the order's own
 * otherwise. One attempt per Idempotency-Key, so a retried press is answered
 * from the first and the customer never gets two.
 *=========================================*/

export interface OrderInvoiceSendDeps {
  verifyIdToken(token: string): Promise<{ uid: string; email?: string | null }>
  firestore(): FirebaseFirestore.Firestore
  orgForHost(hostId: string): Promise<{ id?: string; org?: unknown } | null>
  /** The order's pay link at a link version, or null when the site has no address or no signing secret. */
  payLinkUrl(host: Record<string, unknown>, hostId: string, orderId: string, version: number): string | null
  /** The invoice email: the renderer, the PDF and sharp, loaded only by a send. */
  mailer(): Promise<InvoiceMailer>
  now(): number
}

export function defaultOrderInvoiceSendDeps(): OrderInvoiceSendDeps {
  return {
    verifyIdToken: (token) => firebaseAdmin.app().auth().verifyIdToken(token),
    firestore: () => firebaseAdmin.app().firestore(),
    orgForHost: async (hostId) => {
      const found = await getOrgForHost(hostId)
      return found ? { id: found.orgId, org: found.org } : null
    },
    payLinkUrl: (host, hostId, orderId, version) => quotePayLinkUrl(host, hostId, orderId, version),
    mailer: async () => (await import('./invoice-email')).invoiceMailer(),
    now: () => Date.now(),
  }
}

type Outcome = { status: number; body: Record<string, unknown> }

const refuse = (status: number, error: string): Outcome => ({ status, body: { error } })

const DOC_ID = /^(?!__.*__$)[^/]{1,200}$/

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

const NO_ADDRESS = 'This site has no web address yet, so its invoices have no pay link. Publish the site first.'

export async function handleOrderInvoiceSend(deps: OrderInvoiceSendDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method !== 'POST') return refuse(405, 'Method not allowed')
  const authorization = headerOf(req, 'authorization')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!idToken) return refuse(401, 'Unauthenticated')
  const body = bodyOf(req)
  const hostId = String(body['hostId'] ?? '')
  const orderId = String(body['orderId'] ?? '')
  if (!DOC_ID.test(hostId)) return refuse(400, 'Missing hostId')
  if (!DOC_ID.test(orderId)) return refuse(400, 'Missing orderId')

  let decoded: { uid: string; email?: string | null }
  try {
    decoded = await deps.verifyIdToken(idToken)
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return refuse(401, 'Unauthenticated')
  }
  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) return refuse(404, 'Unknown site')
  if (!holdsCommerceSiteKey(hostSnapshot, decoded.uid, 'commerce.quotes.send')) {
    return refuse(403, commerceSitePermissionRefusal('commerce.quotes.send'))
  }
  const host = (hostSnapshot.data() ?? {}) as Record<string, unknown>
  const actor = String(decoded.email || decoded.uid)

  const parsed = CommerceModel.parseQuoteSendInput(body)
  if ('error' in parsed) return refuse(400, parsed.error)
  const idempotencyKey = headerOf(req, 'idempotency-key').slice(0, 200)
  if (!idempotencyKey) return refuse(400, 'Sending an invoice needs an Idempotency-Key header.')

  const ref = hostRef.collection('orders').doc(orderId)
  const [snapshot, store] = await Promise.all([ref.get(), hostRef.collection('settings').doc('store').get()])
  const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
  const to = CommerceModel.invoiceSendRecipient(order, parsed.input.to)
  const refused = CommerceModel.invoiceSendRefusal(order, orderId, to)
  if (refused) {
    return refuse(CommerceModel.invoiceSendRefusalStatus(refused), CommerceModel.invoiceSendRefusalMessage(refused))
  }
  const current = order as CommerceModel.HostOrder
  const paid = CommerceModel.invoiceIsPaid(current)
  const linkVersion = paid ? null : CommerceModel.orderPayLinkVersion(current)
  const payUrl = linkVersion === null ? null : deps.payLinkUrl(host, hostId, orderId, linkVersion)
  if (linkVersion !== null && !payUrl) return refuse(409, NO_ADDRESS)

  const owner = await deps.orgForHost(hostId)
  if (!checkEntitlement(owner?.org as never, 'commerce')) return refuse(403, 'Selling is not enabled')
  const mailer = await deps.mailer()
  if (!mailer.configured()) {
    return refuse(503, 'Email isn’t set up here, so invoices can’t be emailed.')
  }
  // The bounce and complaint list only: an invoice is transactional, so an
  // unsubscribe from the site's newsletter does not stop it, as it does not
  // stop a receipt.
  if (await mailer.suppression(to)) {
    return refuse(409, `${to} bounced or reported an email as spam, so it can’t be emailed. Send the invoice another way.`)
  }

  const claimed = await claimAttempt(firestore, {
    kind: 'commerce-order-invoice-send',
    scopeId: `${hostId}:${orderId}`,
    orgId: owner?.id ?? '',
    key: idempotencyKey,
    busyMessage: 'This invoice is already being sent',
  })
  if ('replay' in claimed) {
    return { status: claimed.replay.status, body: claimed.replay.body as Record<string, unknown> }
  }
  const claim = claimed.claim
  const now = deps.now()

  let delivered: Awaited<ReturnType<InvoiceMailer['deliver']>>
  try {
    delivered = await mailer.deliver({
      hostId,
      orderId,
      order: current,
      host,
      store: (store.data() ?? null) as Record<string, unknown> | null,
      owner: owner ? { id: owner.id, org: owner.org } : null,
      to,
      subject: parsed.input.subject,
      message: parsed.input.message,
      payUrl,
      senderEmail: decoded.email ? String(decoded.email) : null,
      atMs: now,
    })
  } catch (error) {
    console.error('commerce invoice send failed', error)
    await claim.release()
    return refuse(502, 'The invoice email could not be sent. Try again.')
  }
  // `strictNullChecks` is off, so the result does not narrow on `sent`.
  if ('error' in delivered) {
    await claim.release()
    return refuse(delivered.status, delivered.error)
  }
  const done = delivered as Extract<typeof delivered, { sent: true }>

  // The email is out: from here a failure is logged, never answered as one,
  // so a retry does not send it twice.
  const send: CommerceModel.OrderInvoiceSendRecord = {
    to,
    subject: done.subject,
    atMs: now,
    by: actor,
    messageId: done.messageId,
    providerId: done.providerId,
    paid: done.paid,
    linkVersion: done.paid ? null : linkVersion,
    totalCents: done.totalCents,
  }
  try {
    await firestore.runTransaction(async (transaction) => {
      const latest = await transaction.get(ref)
      if (!latest.exists) return
      const fresh = latest.data() as CommerceModel.HostOrder
      transaction.set(ref, CommerceModel.invoiceSendPatch(fresh, send, done.thread), { merge: true })
    })
  } catch (error) {
    console.error('commerce invoice sent but not recorded', { hostId, orderId, messageId: done.messageId, error })
  }
  const outcome: Outcome = {
    status: 200,
    body: { sent: true, to, atMs: now, paid: done.paid, linkVersion: send.linkVersion },
  }
  await claim.record(outcome.status, outcome.body)
  return outcome
}

/** `POST /api/commerce/order-invoice-send`. */
export const orderInvoiceSendHandler: PluginApiHandler = async (req, res) => {
  const outcome = await handleOrderInvoiceSend(defaultOrderInvoiceSendDeps(), req)
  return res.status(outcome.status).json(outcome.body)
}
