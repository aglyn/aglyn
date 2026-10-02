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

// Its own subpath, never the plugin-manager barrel: the routes need this
// registry and nothing else.
import {
  ArtifactTypeOwnerUnavailableError,
  resolveArtifactTypeOwner,
  type ArtifactInstallStamp,
  type ArtifactRefusal,
  type PluginArtifactOwner,
} from '@aglyn/aglyn/plugin-manager/plugin-artifact-types'
import type { InstalledFrom } from '@aglyn/aglyn/app-utils/artifact-provenance'
import { ARTIFACT_TYPE_LABELS, type MarketplaceArtifactType } from '../model/marketplace'

/**
 * The plugin that keeps a listing type's copies, for the doors that publish,
 * install and update one (AGL-3080).
 *
 * Some of what the marketplace sells lands in another plugin's storage: a
 * dataset schema installs as a dataset. The doors keep everything that is the
 * marketplace's (who may act, the listing and its gates, the purchase, the
 * provenance stamp and the tally) and ask the type's owner for the rest,
 * through `plugin-manager/plugin-artifact-types`. They never read the owner's
 * collections and never import it.
 *
 * Asked before a door writes anything, so a missing owner refuses the whole
 * request:
 *
 * - no plugin in this deployment declares the type: `501`, the type is not
 *   available here;
 * - the declared owner did not start in this process, even after the app's
 *   declarations step ran again: `503`, logged.
 */
export async function artifactTypeOwnerOrRefusal(
  type: MarketplaceArtifactType,
): Promise<{ ok: true; owner: PluginArtifactOwner } | ArtifactRefusal> {
  const label = ARTIFACT_TYPE_LABELS[type] ?? type
  try {
    const owner = await resolveArtifactTypeOwner(type)
    if (owner) return { ok: true, owner }
    return {
      ok: false,
      status: 501,
      error: `${label}s are not available here: no plugin in this deployment keeps them`,
    }
  } catch (error) {
    if (!(error instanceof ArtifactTypeOwnerUnavailableError)) throw error
    console.error('[marketplace] an artifact type has no owner in this process', error)
    return {
      ok: false,
      status: 503,
      error: `${label}s cannot be handled right now: the plugin that keeps them did not start`,
    }
  }
}

/**
 * Where a copy came from, as the marketplace stamps every copy it installs:
 * the provenance (AGL-1015), and the legacy `source` the console still reads.
 * The owner writes both onto the copy and composes neither.
 */
export function marketplaceInstallStamp(input: {
  installedFrom: InstalledFrom
  listingId: string
  version: unknown
}): ArtifactInstallStamp {
  return {
    installedFrom: input.installedFrom,
    source: {
      type: 'marketplace',
      listingId: input.listingId,
      version: input.version ?? null,
    },
  }
}
