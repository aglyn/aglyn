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

import * as Aglyn from '@aglyn/aglyn'
import {
  resolveOrgIdForHost, firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Resolves a host's pinned plugin installs (AGL-45) into the compose-time
 * shape `attachPluginInstalls` stamps onto `communityPlugin` nodes, keyed
 * by listing id. The kill switch is folded in per install: a revoked pin
 * renders the disabled placeholder. Fail-open: on error an empty map is
 * returned and plugin nodes show a safe "not installed" placeholder rather
 * than taking the published screen down.
 */
export async function getPluginInstalls(options: {
  hostId: string
}): Promise<Record<string, Aglyn.ResolvedPluginInstall>> {
  const installs: Record<string, Aglyn.ResolvedPluginInstall> = {}
  try {
    const firestore = firebaseAdmin.app().firestore()
    // Org-tier installs apply to every host in the org (AGL-237); a
    // host-level pin of the same listing wins (host docs merge second).
    const orgId = await resolveOrgIdForHost(options.hostId)
    const [orgSnapshot, snapshot] = await Promise.all([
      orgId
        ? firestore
            .collection('orgs')
            .doc(orgId)
            .collection('installs')
            .limit(50)
            .get()
        : Promise.resolve(null),
      firestore
        .collection('hosts')
        .doc(options.hostId)
        .collection('installs')
        .limit(50)
        .get(),
    ])
    const merged = new Map()
    for (const docSnapshot of orgSnapshot?.docs ?? []) {
      merged.set(docSnapshot.id, docSnapshot)
    }
    for (const docSnapshot of snapshot.docs) {
      merged.set(docSnapshot.id, docSnapshot)
    }
    if (merged.size === 0) return installs

    await Promise.all(
      [...merged.values()].map(async (docSnapshot) => {
        const version = String(docSnapshot.get('version') ?? '')
        const sha256 = String(docSnapshot.get('sha256') ?? '')
        if (!version || !sha256) return
        const revocation = (
          await firestore
            .collection('revocations')
            .doc(docSnapshot.id)
            .get()
        ).data() as Aglyn.PluginRevocation | undefined
        installs[docSnapshot.id] = {
          listingId: docSnapshot.id,
          version,
          sha256,
          capabilities: docSnapshot.get('manifest')?.capabilities,
          revoked: Aglyn.isPluginRevoked(revocation, version),
        }
      }),
    )
  } catch (error) {
    console.error(error)
  }
  return installs
}

export default getPluginInstalls
