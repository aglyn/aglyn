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
  isDeferrableSendResult,
  isEmailConfigured,
  loadHostEmail,
  renderLoadedHostEmail,
  sendEmail,
  type LoadedHostEmail,
} from '@aglyn/shared-util-email'
import {
  type PluginApiHandler,
  type PluginJobHostGate,
  pluginJobHostGate,
} from '@aglyn/aglyn/server'

export interface RestockScanResult {
  scanned: number
  sent: number
  /** Alerts left unstamped because their site is locked (AGL-2495). */
  skippedLocked: number
}

/**
 * The back-in-stock pass itself, separated from its HTTP door (AGL-2227).
 *
 * Same finding as `process-abandoned.ts` beside it: `x-cron-secret`-gated and
 * **never invoked by anything**. `commerce/notify-restock` accepts the
 * shopper's "tell me when it's back" from the storefront and writes
 * `hosts/{hostId}/restockAlerts`; this is the only thing that would ever mail
 * them. Shoppers have been entering an address into a queue with no drain.
 *
 * Exported so `server.ts` can put it on the platform job beat.
 */
export async function scanRestockAlerts(
  /** The lockdown gate, injected by the caller (AGL-2495). Not optional. */
  gate: PluginJobHostGate,
): Promise<RestockScanResult> {
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
  /** Each site's public origin, for the unsubscribe link on the alert. */
  const siteBaseByHost = new Map<string, string>()
  let skippedLocked = 0
  for (const docSnapshot of alerts.docs) {
    const hostRef = docSnapshot.ref.parent.parent
    if (!hostRef) continue
    // LOCKDOWN (AGL-2495), before anything in this body writes. The poisoned-
    // row retirement below stamps `notifiedAtMs`, which is a write, and the
    // email is a message sent in a suspended merchant's name — both wait.
    //
    // SKIPPED, NOT DROPPED: an alert that is not stamped is re-scanned on the
    // next beat, which is exactly the behaviour the `notifiedAtMs == null`
    // query already relies on.
    if (await gate.isLocked(hostRef.id)) {
      skippedLocked += 1
      continue
    }
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
      // The site's own origin, for the unsubscribe link. Resolved once per
      // host beside the branding, because this sweep is a `collectionGroup`
      // over every site's alerts and a read per alert would be a read per
      // shopper.
      const hostSnapshot = await hostRef.get().catch(() => null)
      siteBaseByHost.set(
        hostRef.id,
        Aglyn.hostPublicOrigin({
          cname: hostSnapshot?.get('cname'),
          subdomain: hostSnapshot?.get('subdomain'),
        }) ?? '',
      )
    }
    const designed = loaded
      ? renderLoadedHostEmail(
          loaded,
          {
            'product.name': String(product.name ?? ''),
            'product.url': productUrl,
          },
          Aglyn.sanitizeAuthorHtml,
        )
      : null
    /*
     * MARKETING, and `'bulk'` priority, which this sweep is entitled to
     * because it is resumable: an alert left unstamped is re-scanned by the
     * `notifiedAtMs == null` query on the next beat, so a refusal means "not
     * this hour" rather than a shopper who asked to be told and never was.
     *
     * The gate adds the unsubscribe header pair and a visible link, checks
     * both suppression lists, and counts this against how much mail the
     * shopper has had from this site today.
     */
    const result = await sendEmail({
      to: String(data.email),
      subject: designed?.subject ?? `Back in stock: ${product.name}`,
      text:
        designed?.text ||
        `${product.name} is available again — grab it before it sells ` +
          `out:\n\n${productUrl}`,
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: brandingByHost.get(hostRef.id)?.fromName,
      context: 'restock alert',
      priority: 'bulk',
      marketing: { hostId: hostRef.id, siteBase: siteBaseByHost.get(hostRef.id) ?? '' },
    })
    /*
     * SKIPPED, NOT DROPPED — the lockdown rule above, applied to the two
     * refusals a later beat can pass.
     *
     * `notifiedAtMs` is what retires an alert from this sweep. Stamping it
     * after the hourly ceiling or the frequency cap refused would drop a
     * request from a shopper who asked to be told; NOT stamping it after a
     * suppression or a rejection would re-read the same doomed row forever,
     * inside a window of two hundred, starving every alert behind it.
     */
    if (isDeferrableSendResult(result)) continue
    // Cost meter (AGL-1438). One alert per shopper who asked to be told,
    // like the abandoned-checkout reminder beside it, and on the DELIVERED
    // message only — a suppressed recipient produced no message and no cost.
    if (result.sent) await meterHostEmail(hostRef.id)
    await docSnapshot.ref
      .set({ notifiedAtMs: Date.now() }, { merge: true })
      .catch(() => undefined)
    if (result.sent) sent += 1
  }
  return { scanned: alerts.size, sent, skippedLocked }
}

/**
 * HTTP door for the pass above (AGL-326), kept for manual/ops invocation and
 * for the console's "send now" control.
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
    // The manual door asks the same question the beat does (AGL-2495).
    return res.status(200).json(await scanRestockAlerts(pluginJobHostGate()))
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Processing failed' })
  }
}
