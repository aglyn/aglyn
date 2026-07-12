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
  loadRemoteServerBundles,
  remoteServerBundlesEnabled,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  resolveCommunityPluginVersion,
} from '@aglyn/tenant-data-admin'

/**
 * Remote SERVER handler bundles for the plugin API dispatcher (AGL-420).
 * Default OFF (`PLUGIN_REMOTE_SERVER=enabled` is the master switch); when
 * on, the core loader enforces the full chain — explicit per-deploy
 * allowlist, `trust: 'realm'` version docs, sha256 content pinning, and a
 * MANDATORY platform signature — before a bundle's `registerApi()` runs.
 * The version resolution reads the same staff-only Firestore docs the
 * client trust join uses.
 */
export async function ensureRemoteServerBundles(): Promise<void> {
  if (!remoteServerBundlesEnabled()) return
  const artifactsBase =
    process.env.PLUGIN_ARTIFACTS_BASE ??
    process.env.NEXT_PUBLIC_PLUGIN_ORIGIN ??
    ''
  if (!artifactsBase) {
    console.error(
      'PLUGIN_REMOTE_SERVER is enabled but no artifacts base is configured ' +
        '(PLUGIN_ARTIFACTS_BASE / NEXT_PUBLIC_PLUGIN_ORIGIN) — skipping.',
    )
    return
  }
  const loaded = await loadRemoteServerBundles({
    resolveVersion: resolveCommunityPluginVersion,
    artifactsBase,
  })
  // Audit trail (AGL-437): every remote server bundle this process runs
  // is on the record — once per process (the loader caches).
  if (loaded.length && !audited) {
    audited = true
    const firestore = firebaseAdmin.app().firestore()
    for (const bundle of loaded) {
      await firestore
        .collection('adminAudit')
        .add({
          actorUid: 'system',
          action: 'plugins.remoteServer.load',
          target: `communityListings/${bundle.listingId}/pluginVersions/${bundle.version}`,
          after: { sha256: bundle.sha256, app: 'console' },
          at: new Date(),
        })
        .catch(() => undefined)
    }
  }
}

let audited = false
