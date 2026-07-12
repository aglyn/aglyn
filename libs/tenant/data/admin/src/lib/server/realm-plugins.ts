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

import type { RealmPluginInstall } from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'
import { resolveOrgIdForHost } from './organizations'

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
 *
 * The returned sha256/signature come from the VERSION doc, not the install
 * copy, so a tampered install doc cannot smuggle different bytes past the
 * loader's content check.
 */

interface InstallPin {
  listingId: string
  version: string
}

/** One version-doc read, shaped for the remote loaders' `resolveVersion`. */
export async function resolveCommunityPluginVersion(
  listingId: string,
  version: string,
): Promise<{ sha256: string; signature?: string; trust?: string } | null> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('communityListings')
    .doc(listingId)
    .collection('pluginVersions')
    .doc(version)
    .get()
  const data = snapshot.data()
  if (!data?.sha256) return null
  return {
    sha256: String(data.sha256),
    ...(data.signature ? { signature: String(data.signature) } : {}),
    ...(data.trust ? { trust: String(data.trust) } : {}),
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
      ).data()
      if (
        revocation &&
        (revocation.versions === 'all' ||
          (Array.isArray(revocation.versions) &&
            revocation.versions.includes(pin.version)))
      ) {
        return null
      }
      return {
        listingId: pin.listingId,
        version: pin.version,
        sha256: pinned.sha256,
        trust: 'realm',
        signature: pinned.signature,
      }
    }),
  )
  return installs.filter((install): install is RealmPluginInstall =>
    Boolean(install),
  )
}
