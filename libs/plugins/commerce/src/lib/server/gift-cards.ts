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

import * as Aglyn from '@aglyn/aglyn/server'
import { randomBytes } from 'crypto'
import { firebaseAdmin, getOrgForHost, renderHostEmailWithTokens } from '@aglyn/tenant-data-admin'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { type PluginApiHandler } from '@aglyn/aglyn/server'

/** A merchant may not mint more than this in one card. */
const MAX_ISSUE_CENTS = 100_000

/** `GC-` + 12 uppercase hex, the shape `billing-webhook.ts` already mints. */
function mintCode(): string {
  return `GC-${randomBytes(6).toString('hex').toUpperCase()}`
}

/**
 * Gift-card issue / void (AGL-2226).
 *
 * The `giftCards` subcollection has existed since AGL-322 — minted by
 * `billing-webhook.ts` when a gift-card product is bought, decremented by
 * `cart-checkout.ts` at redemption. Neither end had a console: grepping for
 * that collection returned exactly those two server files, so a
 * merchant on Business (the tier that carries `giftCards`) could sell store
 * credit and then not see one cent of the liability they had taken on, help
 * a customer who lost a code, or void a leaked one.
 *
 * WRITES ARE SERVER-SIDE, and that is not a style preference. The Firestore
 * rules' host catch-all would happily grant an admin `create`/`update` on
 * `giftCards` — it is not in any exclusion list. A client-writable
 * `balanceCents` is a self-service discount machine: set it to any number,
 * redeem it at checkout, and `cart-checkout.ts` applies it as amount-off
 * against a Stripe coupon. The reads stay client-side (the catch-all's
 * `allow read` already grants them, and the card wants live updates), so
 * only the two operations that move money come through here.
 *
 * Re-checks the entitlement server-side for the same reason
 * `billing-webhook.ts:2285` does: a card issued while the plan was live is
 * honoured, but a lapsed plan must not mint new ones.
 */
export const giftCardsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const action = String(body.action ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  if (action !== 'issue' && action !== 'void') {
    return res.status(400).json({ error: 'Unknown action' })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    // Owner/admin/editor, not viewer — the same bar `member-post.ts` sets for
    // a write that leaves the console.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!memberRole || memberRole === 'viewer') {
      return res.status(403).json({ error: 'Not permitted' })
    }
    const owner = await getOrgForHost(hostId).catch(() => null)
    if (!Aglyn.checkEntitlement(owner?.org as never, 'giftCards')) {
      return res
        .status(402)
        .json({ error: 'Gift cards are not included on this plan' })
    }

    if (action === 'void') {
      const code = String(body.code ?? '').trim()
      if (!code) return res.status(400).json({ error: 'Missing code' })
      const cardRef = hostRef.collection('giftCards').doc(code)
      // Zero the balance rather than delete the document. AGL-1767 is the
      // reason: a deleted card that a checkout still had in flight was
      // RESURRECTED by the webhook's `increment(-cents)` into a NEGATIVE
      // balance, which then read as a card with money on it and understated
      // the outstanding total. A zeroed card decrements to a negative number
      // that no redemption path will ever accept, and the row stays
      // auditable.
      const existing = await cardRef.get()
      if (!existing.exists) {
        return res.status(404).json({ error: 'Unknown gift card' })
      }
      await cardRef.set(
        {
          balanceCents: 0,
          voidedAtMs: Date.now(),
          voidedBy: decoded.uid,
        },
        { merge: true },
      )
      return res.status(200).json({ ok: true, code })
    }

    const amountCents = Math.round(Number(body.amountCents ?? 0))
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: 'Amount must be above zero' })
    }
    if (amountCents > MAX_ISSUE_CENTS) {
      return res
        .status(400)
        .json({ error: `Amount may not exceed $${MAX_ISSUE_CENTS / 100}` })
    }
    const recipientEmail = String(body.recipientEmail ?? '').trim().slice(0, 200)
    const note = String(body.note ?? '').trim().slice(0, 200)
    const code = mintCode()
    await hostRef.collection('giftCards').doc(code).set({
      initialCents: amountCents,
      balanceCents: amountCents,
      recipientEmail: recipientEmail || null,
      // Null rather than absent: the field is what tells a reader whether a
      // card came from a sale or from the console, and `undefined` would
      // make an issued-by-hand card indistinguishable from a legacy row.
      orderId: null,
      issuedBy: decoded.uid,
      ...(note ? { note } : {}),
      createdAtMs: Date.now(),
    })

    let emailed = false
    if (recipientEmail && isEmailConfigured()) {
      const value = `$${(amountCents / 100).toFixed(2)}`
      // The same site-designed template the purchase path uses (AGL-771), so
      // a hand-issued card arrives looking like a bought one.
      const designed = await renderHostEmailWithTokens(
        firestore,
        hostId,
        'gift-card',
        { 'giftcard.code': code, 'giftcard.value': value },
      )
      await sendEmail({
        to: recipientEmail,
        subject: designed?.subject ?? 'Your gift card',
        text:
          designed?.text ||
          `Gift card code: ${code}\nValue: ${value}\n\n` +
            'Enter it at checkout to apply the balance.',
        ...(designed?.html ? { html: designed.html } : {}),
        fromName: Aglyn.resolveBrandingProfile(owner?.org as never).fromName,
        context: 'gift card',
      }).catch(() => undefined)
      emailed = true
    }

    return res.status(200).json({ ok: true, code, emailed })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Gift card operation failed' })
  }
}
