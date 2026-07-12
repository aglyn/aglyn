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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

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
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!memberRole || memberRole === 'viewer') {
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
    const resendKey = process.env.RESEND_API_KEY
    const emailFrom = process.env.USAGE_EMAIL_FROM
    if (emailSubscribers && resendKey && emailFrom) {
      const subscriptions = await hostRef
        .collection('subscriptions')
        .limit(500)
        .get()
      const recipients = [
        ...new Set(
          subscriptions.docs
            .filter(
              (docSnapshot) =>
                LIVE_STATUSES.has(String(docSnapshot.get('status'))) &&
                (!productId ||
                  docSnapshot.get('productId') === productId) &&
                docSnapshot.get('customerEmail'),
            )
            .map((docSnapshot) => String(docSnapshot.get('customerEmail'))),
        ),
      ].slice(0, 200)
      for (const to of recipients) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: emailFrom,
            to: [to],
            subject: title,
            text: postBody || title,
          }),
        }).catch(() => undefined)
        emailed += 1
      }
    }
    return res.status(200).json({ postId: postRef.id, emailed })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Publish failed' })
  }
}
