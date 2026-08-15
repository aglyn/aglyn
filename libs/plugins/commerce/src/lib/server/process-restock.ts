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
import {
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
} from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
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
    // White-label brand per host (White-Label Phase 3): resolved once per host
    // from the owning org doc through the one shared resolver.
    const brandingByHost = new Map<string, Aglyn.ResolvedBrandingProfile>()
    for (const docSnapshot of alerts.docs) {
      const hostRef = docSnapshot.ref.parent.parent
      if (!hostRef) continue
      const data = docSnapshot.data() as any
      // AGL-1774: `productId` is a STORED FIELD written by an unauthenticated
      // POST (`notify-restock.ts`), and this line is where it becomes a path
      // component. `.doc()` appends a slash-separated path and throws
      // SYNCHRONOUSLY on an even component count — a throw that landed here,
      // outside the loop body's own error handling, so it aborted the entire
      // run. The scan is a `collectionGroup`, so that run is platform-wide;
      // and because the offending alert was never stamped `notifiedAtMs` it
      // returned on every subsequent run, taking every alert ordered after it
      // down too. One anonymous request stopped back-in-stock email for every
      // merchant, permanently.
      //
      // `notify-restock.ts` now refuses such a value at the door, but this
      // guard is not redundant with that one: rows written BEFORE the fix are
      // already in the database, and a create-time check does nothing about
      // them. Treated as "no product" rather than as an error, which is the
      // correct refusal by AGL-1760's test — there is no product, so there is
      // no email owed and no work to discard — and it stamps the alert below
      // so a poisoned row is retired instead of re-scanned forever.
      const productId = isDocumentId(data.productId) ? data.productId : ''
      const cacheKey = `${hostRef.id}:${productId}`
      if (productId && !productCache.has(cacheKey)) {
        const productSnapshot = await hostRef
          .collection('products')
          .doc(productId)
          .get()
        productCache.set(
          cacheKey,
          productSnapshot.exists
            ? CommerceModel.liftLegacyProduct(productSnapshot.data() as any)
            : null,
        )
      }
      const product = productId ? productCache.get(cacheKey) : null
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
        brandingByHost.set(
          hostRef.id,
          Aglyn.resolveBrandingProfile(
            (await getOrgForHost(hostRef.id).catch(() => null))?.org as never,
          ),
        )
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
        fromName: brandingByHost.get(hostRef.id)?.fromName,
        context: 'restock alert',
      })
      // Cost meter (AGL-1438). One alert per shopper who asked to be told,
      // like the abandoned-checkout reminder beside it.
      await meterHostEmail(hostRef.id)
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
