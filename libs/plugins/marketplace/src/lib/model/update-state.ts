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

import type { InstallableArtifactType as MarketplaceArtifactType } from '@aglyn/aglyn/app-utils/artifact-provenance'
import { resolveProvenance } from '@aglyn/aglyn/app-utils/artifact-provenance'
import {
  offeredPluginVersion,
  type PluginRevocation,
} from '@aglyn/aglyn/app-utils/plugin-manifest'

export {
  compareArtifactVersions,
  type UpdateState,
  type UpdateStatus,
  updateStateLabel,
} from './marketplace-catalog'
import { compareArtifactVersions, type UpdateStatus } from './marketplace-catalog'

/**
 * "Is what I have installed still what the publisher ships?" (AGL-1016).
 *
 * This comparison was previously derived inline on the installed-plugins card
 * and nowhere else, so the Plugins index, the installation page and the
 * marketplace listing could each show a different answer — or none. It is
 * exactly the sort of thing that gets re-derived slightly differently in four
 * places, so it lives here, pure, and every surface asks it.
 */

/** The installed side: a plugin pin, or any copied artifact's document. */
export interface UpdateComparableInstall {
  version?: unknown
  installedFrom?: Record<string, unknown> | null
  marketplace?: { listingId?: string; version?: unknown } | null
  source?: { listingId?: string; version?: unknown } | null
  listingId?: string
  pluginId?: string
  sha256?: string
}

/** The listing side, as the public listing document carries it. */
export interface UpdateComparableListing {
  artifactType?: string
  type?: string
  kind?: string
  latestVersion?: unknown
  /**
   * The newest version that PASSED REVIEW (AGL-966), denormalised onto the
   * listing by the approval route because `pluginVersions` is server-only.
   */
  latestApprovedVersion?: unknown
}

const UNKNOWN: UpdateStatus = {
  state: 'unknown',
  installedVersion: null,
  availableVersion: null,
  unknownReason: 'no-provenance',
}

/**
 * Compares what is installed against what the listing offers (AGL-1016).
 *
 * For plugins the offer is the newest INSTALLABLE version, never
 * `latestVersion`. Installs already resolve it that way; advertising
 * `latestVersion` would leak AGL-966's guarantee straight back out through a
 * badge, telling a workspace an update exists that the install route would
 * then refuse to give them.
 *
 * `revocation` is the same leak one state over (AGL-2368). Approval is a
 * review verdict and the kill switch does not clear it, so `latestApprovedVersion`
 * could name a stopped version — an "Update to vX" for bytes `install-plugin`
 * answers 409 to. Optional because it is a second document and not every
 * caller holds it; every writer of the mirror derives it from
 * `newestInstallableVersion` since AGL-2306, so a caller without one is
 * reading a cache that is correct except in the window between two writes.
 * A caller that HAS it should pass it.
 */
export function resolveUpdateState(
  installed: UpdateComparableInstall | null | undefined,
  listing: UpdateComparableListing | null | undefined,
  artifactType?: MarketplaceArtifactType,
  revocation?: PluginRevocation | null,
): UpdateStatus {
  const provenance = resolveProvenance(installed as never, artifactType)
  if (!installed || provenance.state === 'unknown' || !provenance.version) {
    return UNKNOWN
  }
  const installedVersion = provenance.version
  const type = provenance.artifactType ?? artifactType ?? null
  const available =
    type === 'plugin'
      ? offeredPluginVersion(listing, revocation)
      : listing?.latestVersion
  if (available == null || available === '') {
    return {
      state: 'unknown',
      installedVersion,
      availableVersion: null,
      unknownReason: 'nothing-published',
    }
  }
  const availableVersion = String(available)
  const order = compareArtifactVersions(installedVersion, availableVersion)
  if (order === null) {
    return {
      state: 'unknown',
      installedVersion,
      availableVersion,
      unknownReason: 'incomparable',
    }
  }
  return {
    state: order === 0 ? 'current' : order < 0 ? 'update-available' : 'ahead',
    installedVersion,
    availableVersion,
  }
}

