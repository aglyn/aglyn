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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Public version history for a plugin listing (AGL-431). The
 * `pluginVersions` docs are server-only (they carry publish internals),
 * but their changelog/trust/compat fields are exactly what a buyer needs
 * on the detail page — so this handler exposes THAT subset and nothing
 * else (no objectPath, no signature; sha stays out simply because the
 * client has no use for it).
 */
export const listingVersionsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.query?.listingId ?? '')
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('communityListings')
      .doc(listingId)
      .collection('pluginVersions')
      .orderBy('publishedAt', 'desc')
      .limit(20)
      .get()
    const versions = snapshot.docs.map((doc) => ({
      version: String(doc.get('version') ?? doc.id),
      ...(doc.get('changelog') ? { changelog: String(doc.get('changelog')) } : {}),
      ...(doc.get('trust') ? { trust: String(doc.get('trust')) } : {}),
      ...(Number.isInteger(doc.get('manifest')?.hostAbi)
        ? { hostAbi: Number(doc.get('manifest').hostAbi) }
        : {}),
      publishedAtMs: doc.get('publishedAt')?.toMillis?.() ?? null,
    }))
    return res.status(200).json({ versions })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Version lookup failed' })
  }
}
