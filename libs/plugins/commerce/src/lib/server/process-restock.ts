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
import * as CommerceModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  isEmailConfigured,
  loadHostEmail,
  renderLoadedHostEmail,
  sendEmail,
  type LoadedHostEmail,
} from '@aglyn/shared-util-email'
import { type PluginApiHandler } from '@aglyn/aglyn/server'

/**
 * Back-in-stock processor (AGL-326): cron-invoked beside the abandoned-
 * checkout pass; emails pending alerts whose products have stock again
 * and stamps them notified.
 */
export const processRestockHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!isEmailConfigured()) {
    return res.status(501).json({ error: 'Email is not configured.' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const alerts = await firestore
      .collectionGroup('restockAlerts')
      .where('notifiedAtMs', '==', null)
      .limit(200)
      .get()
    let sent = 0
    const productCache = new Map<string, CommerceModel.HostProduct | null>()
    // Resolve each host's designed template once per run (AGL-770).
    const templateCache = new Map<string, LoadedHostEmail | null>()
    for (const docSnapshot of alerts.docs) {
      const hostRef = docSnapshot.ref.parent.parent
      if (!hostRef) continue
      const data = docSnapshot.data() as any
      const cacheKey = `${hostRef.id}:${data.productId}`
      if (!productCache.has(cacheKey)) {
        const productSnapshot = await hostRef
          .collection('products')
          .doc(String(data.productId))
          .get()
        productCache.set(
          cacheKey,
          productSnapshot.exists
            ? CommerceModel.liftLegacyProduct(productSnapshot.data() as any)
            : null,
        )
      }
      const product = productCache.get(cacheKey)
      if (!product) {
        await docSnapshot.ref
          .set({ notifiedAtMs: Date.now(), skipped: true }, { merge: true })
          .catch(() => undefined)
        continue
      }
      const total = CommerceModel.productInventory(product)
      if (total != null && total <= 0) continue
      const productUrl = `/products/${product.slug}`
      let loaded = templateCache.get(hostRef.id)
      if (loaded === undefined) {
        loaded = await loadHostEmail(firestore, hostRef.id, 'back-in-stock')
        templateCache.set(hostRef.id, loaded)
      }
      const designed = loaded
        ? renderLoadedHostEmail(loaded, {
            'product.name': String(product.name ?? ''),
            'product.url': productUrl,
          })
        : null
      await sendEmail({
        to: String(data.email),
        subject: designed?.subject ?? `Back in stock: ${product.name}`,
        text:
          designed?.text ||
          `${product.name} is available again — grab it before it sells ` +
            `out:\n\n${productUrl}`,
        ...(designed?.html ? { html: designed.html } : {}),
        context: 'restock alert',
      })
      await docSnapshot.ref
        .set({ notifiedAtMs: Date.now() }, { merge: true })
        .catch(() => undefined)
      sent += 1
    }
    return res.status(200).json({ scanned: alerts.size, sent })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Processing failed' })
  }
}
