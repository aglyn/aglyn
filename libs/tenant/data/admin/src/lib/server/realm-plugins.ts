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
import { tenantDataTag, withRenderCache } from '../render-cache'

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
 * 2. Join each pin with its `marketplaceListings/{id}/pluginVersions/{v}`
 *    doc; only versions carrying `trust: 'realm'` survive.
 * 3. Drop revoked versions (`revocations/{listingId}` kill switch) — a
 *    revocation beats a still-present trust grant.
 * 4. Drop hidden listings (AGL-948) — `resolveMarketplacePluginVersion`
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
export async function resolveMarketplacePluginVersion(
  listingId: string,
  version: string,
): Promise<{
  sha256: string
  signature?: string
  trust?: string
  hostAbi?: number
} | null> {
  const firestore = firebaseAdmin.app().firestore()
  const listingRef = firestore.collection('marketplaceListings').doc(listingId)
  // THE REVOCATION READ IS IN THIS `Promise.all`, NOT AFTER IT (2026-08-26).
  //
  // It is keyed on `listingId` alone, so it never depended on the two reads
  // above — awaiting it below them cost a SECOND sequential Firestore round
  // trip on every resolution, and `resolveRealmPluginInstalls` calls this
  // once per pinned install. That is the shape that grows with the number of
  // plugins an org has installed: `/api/orgs/realm-plugins` is deliberately
  // uncached (see the TTL note below), and at a P75 of 907ms it was already
  // the slowest org-scoped console route before anyone uploaded in volume.
  //
  // The trade is one extra read on the paths that exit early (a hidden
  // listing, a missing version doc) in exchange for halving the round trips
  // on the path that actually happens. The kill switch is UNCHANGED: the
  // check below still runs before any value is returned, and it still reads
  // live — this moves when the read is issued, never whether it is honored.
  const [listing, snapshot, revocationSnapshot] = await Promise.all([
    listingRef.get(),
    listingRef.collection('pluginVersions').doc(version).get(),
    firestore.collection('revocations').doc(listingId).get(),
  ])
  // A missing listing doc is NOT a blocker: Firestore does not cascade to
  // subcollections, so a hard-deleted listing leaves working installs
  // resolving off an orphaned version doc. Only an explicit takedown stops
  // them.
  if (listing.get('hiddenAt')) return null
  const data = snapshot.data()
  if (!data?.sha256) return null
  // THE KILL SWITCH BELONGS AT THE CHOKEPOINT (AGL-2307).
  //
  // It used to live one level up, in `resolveRealmPluginInstalls` — which is
  // the path the tenant render and the console gate take, and NOT the path
  // remote SERVER bundles take. `loadRemoteServerBundles` resolves through
  // this function and nothing else, so a per-version revocation left a realm
  // server handler running: `hiddenAt` caught a full takedown, but a targeted
  // revocation deliberately does not hide the listing, which is the whole
  // difference between the two controls.
  //
  // Placed here rather than added as a second copy at the server loader, for
  // the reason this file's own comment gives about `hiddenAt`: this is the
  // one function every realm consumer funnels through, and a control that has
  // to be remembered per consumer is one that will be missed by the next one.
  const revocation = revocationSnapshot.data() as PluginRevocation | undefined
  if (isPluginRevoked(revocation, version)) return null
  const hostAbi = Number(data.manifest?.hostAbi)
  return {
    sha256: String(data.sha256),
    ...(data.signature ? { signature: String(data.signature) } : {}),
    ...(data.trust ? { trust: String(data.trust) } : {}),
    ...(Number.isInteger(hostAbi) && hostAbi > 0 ? { hostAbi } : {}),
  }
}

/**
 * SECURITY-RELEVANT TTL (AGL-1302): the join drops revoked and taken-down
 * versions, so this cache bounds how long a killed plugin keeps loading on
 * published sites — 60s, on par with the page ISR window that already
 * bounded it. Only the HOST-scoped call (the tenant render path) is cached;
 * the console's org-scoped call stays fresh so an install shows up in the
 * workspace the moment it lands.
 */
const REALM_PLUGIN_INSTALLS_TTL_SECONDS = 60

export async function getRealmPluginInstalls(options: {
  orgId?: string
  hostId?: string
}): Promise<RealmPluginInstall[]> {
  const hostId = options.hostId
  if (!hostId || options.orgId) return resolveRealmPluginInstalls(options)
  try {
    return await withRenderCache({
      key: ['tenant-realm-plugins', hostId],
      revalidate: REALM_PLUGIN_INSTALLS_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read: () => resolveRealmPluginInstalls(options),
    })
  } catch (error) {
    console.error(error)
    return resolveRealmPluginInstalls(options)
  }
}

async function resolveRealmPluginInstalls(options: {
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
      const pinned = await resolveMarketplacePluginVersion(
        pin.listingId,
        pin.version,
      )
      // The revocation check moved INTO `resolveMarketplacePluginVersion`
      // (AGL-2307) so the remote-server loader — which resolves through that
      // function and never reaches this join — gets it too. A `null` here
      // therefore already means "taken down, unknown, or killed".
      if (!pinned || pinned.trust !== 'realm' || !pinned.signature) return null
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
