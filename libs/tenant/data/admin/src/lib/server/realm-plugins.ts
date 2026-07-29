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
  getPluginConfigSchema,
  isPluginRevoked,
  mergePluginConfig,
  type PluginRevocation,
  type RealmPluginInstall,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'
import { resolveOrgIdForHost } from './organizations'

/**
 * Server-side plugin config read (AGL-428): the org's stored overrides
 * merged over the plugin's declared defaults (type-coerced — the doc is
 * manager-writable). Without a registered schema the raw doc (or {})
 * comes back, so handlers degrade to their own fallbacks.
 */
export async function getPluginConfig(
  orgId: string | null | undefined,
  pluginId: string,
): Promise<Record<string, unknown>> {
  const schema = getPluginConfigSchema(pluginId)
  if (!orgId) return schema ? mergePluginConfig(schema, null) : {}
  let stored: Record<string, unknown> | undefined
  try {
    stored = (
      await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .collection('pluginSettings')
        .doc(pluginId)
        .get()
    ).data()
  } catch {
    stored = undefined
  }
  return schema ? mergePluginConfig(schema, stored) : (stored ?? {})
}

/**
 * Server-side resolution of a workspace's TRUSTED-REALM plugin installs
 * (AGL-420). Install docs pin `{version, sha256}`, but the trust grant
 * (`trust: 'realm'` + the platform Ed25519 `signature`) lives on the
 * server-only version doc — staff sign AFTER review, possibly long after
 * the install — so this join is the single source the loaders consume:
 *
 * 1. Read the org's installs (and the host's, when a host is in scope).
 * 2. Join each pin with its `communityListings/{id}/pluginVersions/{v}`
 *    doc; only versions carrying `trust: 'realm'` survive.
 * 3. Drop revoked versions (`revocations/{listingId}` kill switch) — a
 *    revocation beats a still-present trust grant.
 * 4. Drop hidden listings (AGL-948) — `resolveCommunityPluginVersion`
 *    returns null for a listing under staff takedown. `deletedAt` is not
 *    a blocker; see that function for why the two differ.
 *
 * The returned sha256/signature come from the VERSION doc, not the install
 * copy, so a tampered install doc cannot smuggle different bytes past the
 * loader's content check.
 */

interface InstallPin {
  listingId: string
  version: string
}

/**
 * One version-doc read, shaped for the remote loaders' `resolveVersion`.
 *
 * Also the staff-takedown gate (AGL-948): a listing carrying `hiddenAt`
 * resolves to null, so an already-installed plugin stops loading the
 * moment staff hide it. Takedown used to only de-list — a plugin pulled
 * for abuse kept executing in every workspace that had installed it until
 * someone separately wrote a revocation. It lives HERE rather than in the
 * join because every remote path funnels through this function: the
 * console and site realm joins, and both apps' remote-server-bundle
 * loaders.
 *
 * `deletedAt` is deliberately NOT a blocker. A publisher retiring a
 * listing must not break the sites already paying for it; unpublish
 * blocks new installs (`install-plugin`) and that is all it means.
 */
export async function resolveCommunityPluginVersion(
  listingId: string,
  version: string,
): Promise<{
  sha256: string
  signature?: string
  trust?: string
  hostAbi?: number
} | null> {
  const listingRef = firebaseAdmin
    .app()
    .firestore()
    .collection('communityListings')
    .doc(listingId)
  const [listing, snapshot] = await Promise.all([
    listingRef.get(),
    listingRef.collection('pluginVersions').doc(version).get(),
  ])
  // A missing listing doc is NOT a blocker: Firestore does not cascade to
  // subcollections, so a hard-deleted listing leaves working installs
  // resolving off an orphaned version doc. Only an explicit takedown stops
  // them.
  if (listing.get('hiddenAt')) return null
  const data = snapshot.data()
  if (!data?.sha256) return null
  const hostAbi = Number(data.manifest?.hostAbi)
  return {
    sha256: String(data.sha256),
    ...(data.signature ? { signature: String(data.signature) } : {}),
    ...(data.trust ? { trust: String(data.trust) } : {}),
    ...(Number.isInteger(hostAbi) && hostAbi > 0 ? { hostAbi } : {}),
  }
}

export async function getRealmPluginInstalls(options: {
  orgId?: string
  hostId?: string
}): Promise<RealmPluginInstall[]> {
  const firestore = firebaseAdmin.app().firestore()
  const orgId =
    options.orgId ??
    (options.hostId ? await resolveOrgIdForHost(options.hostId) : null)

  // Switchboard gate (AGL-424): a workspace with an EXPLICIT
  // `enabledPlugins` list only realm-loads listings on it (install sync
  // keeps the list in step; toggling one off disables it without
  // uninstalling). Absent field = default-open, so pre-switchboard
  // installs keep loading.
  let enabledFilter: readonly string[] | null = null
  if (orgId) {
    const configured = (
      await firestore.collection('orgs').doc(orgId).get()
    ).get('enabledPlugins')
    if (Array.isArray(configured)) enabledFilter = configured.map(String)
  }

  const pins = new Map<string, InstallPin>()
  const collect = async (
    ref: FirebaseFirestore.CollectionReference,
  ): Promise<void> => {
    const snapshot = await ref.get()
    for (const doc of snapshot.docs) {
      const version = doc.get('version')
      if (typeof version === 'string' && version) {
        pins.set(doc.id, { listingId: doc.id, version })
      }
    }
  }
  if (orgId) {
    await collect(firestore.collection('orgs').doc(orgId).collection('installs'))
  }
  if (options.hostId) {
    // Host pins win over org pins for the same listing (more specific).
    await collect(
      firestore.collection('hosts').doc(options.hostId).collection('installs'),
    )
  }
  if (enabledFilter) {
    for (const listingId of [...pins.keys()]) {
      if (!enabledFilter.includes(listingId)) pins.delete(listingId)
    }
  }
  if (!pins.size) return []

  const installs = await Promise.all(
    [...pins.values()].map(async (pin): Promise<RealmPluginInstall | null> => {
      const pinned = await resolveCommunityPluginVersion(
        pin.listingId,
        pin.version,
      )
      if (!pinned || pinned.trust !== 'realm' || !pinned.signature) return null
      const revocation = (
        await firestore.collection('revocations').doc(pin.listingId).get()
      ).data() as PluginRevocation | undefined
      // Through the shared predicate (AGL-1085) rather than a fourth inline
      // copy: a reader that disagreed with the others about this doc's shape
      // is how a kill switch stops killing in exactly one place.
      if (isPluginRevoked(revocation, pin.version)) {
        return null
      }
      return {
        listingId: pin.listingId,
        version: pin.version,
        sha256: pinned.sha256,
        trust: 'realm',
        signature: pinned.signature,
        ...(pinned.hostAbi !== undefined ? { hostAbi: pinned.hostAbi } : {}),
      }
    }),
  )
  return installs.filter((install): install is RealmPluginInstall =>
    Boolean(install),
  )
}
