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
import { listingArtifactType, newestApprovedVersion } from '../model/community'
import { compareArtifactVersions } from '@aglyn/aglyn/server'
import { versionCollectionFor } from './version-stats'

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
    const listingRef = firebaseAdmin
      .app()
      .firestore()
      .collection('communityListings')
      .doc(listingId)
    // Every artifact type has a version history now (AGL-1036), not just
    // plugins: the per-version install counts are worth the same to whoever
    // publishes a component as to whoever publishes a plugin. The collection
    // differs — plugins keep publish internals in `pluginVersions`, everything
    // else keeps content snapshots in `versions` — so the type decides which
    // to read, and the buyer-safe projection below stays the same either way.
    const listingSnapshot = await listingRef.get()
    const artifactType = listingArtifactType(listingSnapshot.data() ?? {})
    const isPlugin = artifactType === 'plugin'
    const snapshot = await listingRef
      .collection(versionCollectionFor(artifactType))
      .orderBy('publishedAt', 'desc')
      .limit(20)
      .get()
    const versions = snapshot.docs.map((doc) => ({
      version: String(doc.get('version') ?? doc.id),
      // Per-version install counts (AGL-1036). `installCount` is every install
      // that ever landed on this version; `activeInstalls` is how many are on
      // it now — the one that answers "who is still on the old version".
      installCount: Number(doc.get('installCount') ?? 0),
      activeInstalls: Number(doc.get('activeInstalls') ?? 0),
      ...(doc.get('changelog') ? { changelog: String(doc.get('changelog')) } : {}),
      ...(doc.get('trust') ? { trust: String(doc.get('trust')) } : {}),
      ...(Number.isInteger(doc.get('manifest')?.hostAbi)
        ? { hostAbi: Number(doc.get('manifest').hostAbi) }
        : {}),
      // Declared network allowlist (AGL-879 follow-up): the plugin origin
      // builds the /load CSP `connect-src` from this, so the sandbox only
      // reaches origins the manifest declared. Already buyer-visible in
      // review ("Capabilities: network N"), so exposing the origins here
      // leaks nothing new.
      ...(Array.isArray(doc.get('manifest')?.capabilities?.network)
        ? {
            network: (doc.get('manifest').capabilities.network as unknown[])
              .map((entry) => String(entry))
              .filter((entry) => /^https:\/\/[^\s/]+$/.test(entry))
              .slice(0, 20),
          }
        : {}),
      publishedAtMs: doc.get('publishedAt')?.toMillis?.() ?? null,
    }))

    // Repair `latestApprovedVersion` when it is missing or behind (AGL-1016).
    //
    // The field is written by the approval route, so every plugin approved
    // before it existed carries none — and the console would report those as
    // "no published version to compare against" forever, which is a worse lie
    // than the one it replaced. The approved set is already in hand here and
    // `pluginVersions` is server-only, so this is the one place that can
    // repair it. Idempotent, and it only ever moves the value forward.
    // Plugins only: `reviewState` and the approved-version guarantee are a
    // plugin concept, and a copied artifact's `versions` docs carry neither.
    const newest = !isPlugin
      ? null
      : (newestApprovedVersion(
          snapshot.docs.map((doc) => ({
            version: String(doc.get('version') ?? doc.id),
            reviewState: doc.get('reviewState'),
            publishedAt: doc.get('publishedAt'),
          })) as never,
        ) as { version?: string } | null)
    if (newest?.version) {
      const stored = listingSnapshot.get('latestApprovedVersion')
      if (
        stored == null ||
        (compareArtifactVersions(String(stored), newest.version) ?? 0) < 0
      ) {
        await listingRef
          .set({ latestApprovedVersion: newest.version }, { merge: true })
          .catch(() => undefined)
      }
    }

    return res.status(200).json({ versions })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Version lookup failed' })
  }
}
