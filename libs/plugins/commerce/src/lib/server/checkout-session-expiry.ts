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

/**
 * Closing a Checkout Session so it can no longer be paid, and saying what it
 * was (AGL-4094).
 *
 * Stripe answers 200 to `expire` for a session that was open, and 400 for one
 * that is not — already expired, or already PAID. Those two must not be read
 * alike: a caller about to open a fresh session for the same quote has to
 * know that the old one was paid a moment ago, or it hands the customer a
 * second way to pay. So a refused expiry reads the session back and answers
 * its status.
 *
 * - `expired`: it can no longer be paid (it was open and is now closed, or it
 *   had expired already).
 * - `complete`: it was paid; the webhook has, or will, record it.
 * - `missing`: Stripe does not know it (another mode's id, or never created).
 * - `open`: it could not be closed and may still be paid. The caller treats
 *   this as a failure to retry, never as closed.
 */
export type CheckoutSessionExpiry = 'expired' | 'complete' | 'missing' | 'open'

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{8,255}$/

export async function expireCheckoutSession(sessionId: string): Promise<CheckoutSessionExpiry> {
  if (!SESSION_ID.test(String(sessionId ?? ''))) return 'missing'
  const secretKey = String(process.env.STRIPE_SECRET_KEY ?? '').trim()
  if (!secretKey) return 'open'
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  try {
    const expired = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
      method: 'POST',
      headers,
    })
    if (expired.ok) return 'expired'
    const read = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers })
    if (read.status === 404) return 'missing'
    if (!read.ok) return 'open'
    const session = (await read.json().catch(() => ({}))) as { status?: string }
    if (session.status === 'complete') return 'complete'
    if (session.status === 'expired') return 'expired'
    return 'open'
  } catch {
    return 'open'
  }
}
