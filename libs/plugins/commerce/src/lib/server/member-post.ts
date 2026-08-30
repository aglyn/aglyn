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

import {
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
} from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  hostPublicOrigin,
  type PluginApiHandler,
  resolveBrandingProfile,
} from '@aglyn/aglyn/server'

// Which member subscribers are live enough to email (AGL-316). The list itself
// now lives in the model as `isTenantSubscriptionLive` (AGL-1849) — it was a
// private copy here and a second private copy in `gate.ts`, which is the drift
// AGL-1715 guards against on the org side.

/**
 * Member post publish (AGL-316): manager-gated; writes the post and
 * optionally emails the entitled subscribers (product-scoped or all
 * live subscribers) through the env-gated Resend pipeline.
 */
export const memberPostHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const title = String(body.title ?? '').trim().slice(0, 160)
  const postBody = String(body.body ?? '').trim().slice(0, 5000)
  const productId = String(body.productId ?? '').trim()
  const emailSubscribers = Boolean(body.emailSubscribers)
  if (!hostId || !title) {
    return res.status(400).json({ error: 'Missing hostId or title' })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    // AN ALLOWLIST (AGL-2372), matching `gift-cards.ts` and the AGL-2262
    // correction to the register. The old `!role || role === 'viewer'`
    // denylist admitted every string that was not literally `viewer` — and
    // since AGL-2334 that includes `author`, a real grantable role, on a route
    // that publishes to paying subscribers and sends them mail on the
    // merchant's brand. A denylist that widens whenever the role union grows
    // is the defect; the set is the fix. Absent is refused, not permitted.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not permitted' })
    }
    const postRef = await hostRef.collection('memberPosts').add({
      title,
      body: postBody,
      ...(productId ? { productId } : {}),
      createdAtMs: Date.now(),
      createdBy: decoded.uid,
    })

    let emailed = 0
    if (emailSubscribers && isEmailConfigured()) {
      /*
       * ORDERED (D1). This was `limit(500)` with no `orderBy`, and Firestore
       * answers an unordered limit in DOCUMENT-ID order — so a site past the
       * ceiling mailed whichever five hundred subscriptions happened to hash
       * low, and the same five hundred every time. `__name__` is the order it
       * was already getting; stating it makes the window a decision rather
       * than an accident, and makes it the same window on every publish.
       */
      const subscriptions = await hostRef
        .collection('subscriptions')
        .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
        .limit(500)
        .get()
      const recipients = [
        ...new Set(
          subscriptions.docs
            .filter(
              (docSnapshot) =>
                CommerceModel.isTenantSubscriptionLive(
                  docSnapshot.get('status'),
                ) &&
                (!productId ||
                  docSnapshot.get('productId') === productId) &&
                docSnapshot.get('customerEmail'),
            )
            .map((docSnapshot) => String(docSnapshot.get('customerEmail'))),
        ),
      ].slice(0, 200)
      // White-label sender identity (White-Label Phase 3): the store's brand
      // via the one shared resolver, from the owning org doc.
      const branding = resolveBrandingProfile(
        (await getOrgForHost(hostId).catch(() => null))?.org as never,
      )
      // The site's own origin, for the unsubscribe link the gate mints. Read
      // from the host document already in hand rather than assembled from an
      // apex: a post is mailed and read later, and a wrong origin sends a
      // subscriber's opt-out to a domain the merchant does not control.
      const siteBase =
        hostPublicOrigin({
          cname: hostSnapshot.get('cname'),
          subdomain: hostSnapshot.get('subdomain'),
        }) ?? ''
      for (const to of recipients) {
        /*
         * MARKETING. A member post is a merchant mailing their audience, so
         * it carries the unsubscribe header pair and a visible link, it is
         * checked against both suppression lists, and it counts against how
         * much mail one person receives from this site.
         *
         * Priority stays transactional — this handler answers a click and has
         * nowhere to put a message the hourly governor deferred, and the rule
         * on `'bulk'` is that only a resumable sweep may use it.
         */
        const result = await sendEmail({
          to,
          subject: title,
          text: postBody || title,
          fromName: branding.fromName,
          context: 'member post',
          marketing: { hostId, siteBase },
        })
        // The cost meter counts messages that LEFT. A suppressed or capped
        // recipient produced no message and therefore no cost, and counting
        // one would bill a merchant for the control working.
        if (result.sent) emailed += 1
      }
      // Cost meter (AGL-1438), once for the batch rather than per recipient —
      // same number, one write. Transactional: a member post is content the
      // subscriber is paying for, not a discretionary campaign, so it counts
      // toward cost and is never refused by the campaign cap.
      await meterHostEmail(hostId, emailed)
    }
    return res.status(200).json({ postId: postRef.id, emailed })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Publish failed' })
  }
}
