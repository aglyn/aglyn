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

import type { PluginApiHandler } from '@aglyn/aglyn/server'

/**
 * What became of a storefront Checkout Session, for the page Stripe returned
 * the shopper to (AGL-3606).
 *
 * ## Why the return page has to ask
 *
 * The in-page checkout sends every successful confirm to `return_url` — the
 * same `?order=success&session_id=…` the hosted redirect lands on. But a
 * redirect-based payment method (a bank redirect, a wallet that leaves the
 * page) comes back to that SAME url when the shopper abandons or fails the
 * bank step, with the session still open and nothing charged. The url alone
 * cannot tell the two apart, so a shopper whose bank step failed was shown a
 * store that said nothing at all, and had no reason to try again.
 *
 * ## What it answers, and what it never does
 *
 * Only the session's `status` and `payment_status`, and only for a session
 * this host created (`metadata[hostId]`, which both checkout routes set). No
 * email, no address, no amount, and no client secret: the session id rides a
 * url that lands in browser history and referrers, and must not become a key
 * to the shopper's details or to paying for their basket.
 *
 * It does not fulfil, and its answer fulfils nothing: the order is still
 * `checkout.session.completed` in `billing-webhook.ts`, and nothing here
 * writes anywhere.
 */

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{8,255}$/

export type CheckoutReturnStatus = 'open' | 'complete' | 'expired'

export const checkoutStatusHandler: PluginApiHandler = async (req, res) => {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query.hostId ?? '').trim()
  const sessionId = String(req.query.sessionId ?? '').trim()
  if (!hostId || !sessionId) {
    return res.status(400).json({ error: 'Missing hostId or sessionId' })
  }
  // Shape-checked before it is interpolated into a Stripe URL path.
  if (!SESSION_ID.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' })
  }
  const secretKey = String(process.env.STRIPE_SECRET_KEY ?? '').trim()
  if (!secretKey) {
    return res.status(501).json({ error: 'Payments are not configured' })
  }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    if (!response.ok) {
      // A test-mode id under a live key (or the reverse) is a 404 at Stripe,
      // and so is an id that never existed. Both are "not ours".
      return res.status(404).json({ error: 'Not found' })
    }
    const session = (await response.json()) as {
      status?: string
      payment_status?: string
      metadata?: Record<string, string>
    }
    // The same 404 as a missing session, so this route cannot be used to
    // learn that a session exists on ANOTHER merchant's storefront.
    if (String(session?.metadata?.hostId ?? '') !== hostId) {
      return res.status(404).json({ error: 'Not found' })
    }
    const status = String(session.status ?? '')
    if (status !== 'open' && status !== 'complete' && status !== 'expired') {
      return res.status(404).json({ error: 'Not found' })
    }
    return res.status(200).json({
      status: status as CheckoutReturnStatus,
      paymentStatus: String(session.payment_status ?? ''),
    })
  } catch (error) {
    console.error('checkout-status lookup failed', error)
    return res.status(502).json({ error: 'Lookup failed' })
  }
}
