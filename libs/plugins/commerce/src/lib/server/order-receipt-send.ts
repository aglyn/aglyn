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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { pluginSmsAvailable } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { consumeRateLimit, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isEmailConfigured } from '@aglyn/shared-util-email'
import { sendOrderReceipt } from './order-notifications'

/** Receipts one member may re-send per minute, across every order. */
export const RECEIPT_RESENDS_PER_MINUTE_PER_MEMBER = 10
/** Receipts one order may be re-sent per hour, by anybody. */
export const RECEIPT_RESENDS_PER_HOUR_PER_ORDER = 5

/**
 * "Resend receipt" from the order dialog (AGL-3610): the console route
 * `commerce/order-receipt-send`.
 *
 * GET answers which channels can carry a receipt right now —
 * `{ email, sms }` — so the dialog never OFFERS a text the platform cannot
 * send (no SMS provider configured) or an email it cannot (no mail rail).
 *
 * POST `{ hostId, orderId, channel, to }` sends the order's receipt to the
 * address or number the merchant typed, through `sendOrderReceipt`.
 *
 * Role gate: `admin` and `editor`, the roles that already see and act on the
 * order in the dialog (fulfil, cancel). Two rate limits, both durable: a
 * member's resends per minute, and an order's resends per hour by anybody —
 * the second is what stops the dialog becoming a way to mail one stranger the
 * same receipt fifty times.
 */
export const orderReceiptSendHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    req.method === 'POST'
      ? typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body ?? {})
      : {}
  const hostId = String(
    (req.method === 'GET' ? req.query.hostId : body.hostId) ?? '',
  )
  if (!hostId || /^__.*__$/.test(hostId)) {
    return res.status(400).json({ error: 'Missing hostId' })
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const hostSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not permitted' })
    }
    if (req.method === 'GET') {
      return res
        .status(200)
        .json({ email: isEmailConfigured(), sms: pluginSmsAvailable() })
    }

    const orderId = String(body.orderId ?? '')
    const channel = String(body.channel ?? 'email')
    const to = String(body.to ?? '').trim().slice(0, 200)
    if (!orderId || /^__.*__$/.test(orderId)) {
      return res.status(400).json({ error: 'Missing orderId' })
    }
    if (channel !== 'email' && channel !== 'sms') {
      return res.status(400).json({ error: 'channel must be email or sms' })
    }
    if (!to) {
      return res.status(400).json({
        error: channel === 'sms' ? 'Enter a phone number' : 'Enter an email address',
      })
    }
    const [member, order] = await Promise.all([
      consumeRateLimit(`commerce-receipt-send:uid:${decoded.uid}`, {
        limit: RECEIPT_RESENDS_PER_MINUTE_PER_MEMBER,
        windowMs: 60_000,
      }),
      consumeRateLimit(`commerce-receipt-send:order:${hostId}:${orderId}`, {
        limit: RECEIPT_RESENDS_PER_HOUR_PER_ORDER,
        windowMs: 60 * 60_000,
      }),
    ])
    if (!member.allowed || !order.allowed) {
      const resetMs = Math.max(
        member.allowed ? 0 : member.resetMs,
        order.allowed ? 0 : order.resetMs,
      )
      res.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))),
      )
      return res.status(429).json({
        error: order.allowed
          ? 'Too many receipts sent — wait a minute and try again.'
          : 'This receipt was re-sent several times in the last hour — try again later.',
      })
    }
    const outcome = await sendOrderReceipt(
      { hostId, orderId },
      { channel, to },
    )
    switch (outcome.outcome) {
      case 'sent':
        return res.status(200).json({ ok: true, channel })
      case 'no_such_order':
        return res.status(404).json({ error: 'Unknown order' })
      case 'not_configured':
        return res.status(409).json({
          error:
            channel === 'sms'
              ? 'Text messages are not set up on this platform.'
              : 'Email is not set up on this platform.',
        })
      case 'invalid_recipient':
        return res.status(400).json({
          error:
            channel === 'sms'
              ? 'That phone number could not be read.'
              : 'That email address could not be read.',
        })
      default:
        return res.status(502).json({
          error:
            outcome.error === 'suppressed'
              ? 'That number has opted out of texts.'
              : 'The receipt could not be sent. Try again.',
        })
    }
  } catch (error) {
    console.error('orderReceiptSend failed', error)
    return res.status(500).json({ error: 'The receipt could not be sent.' })
  }
}
