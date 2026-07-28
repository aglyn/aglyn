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

import type { CommunityArtifactType } from './marketplace-provenance'
import { resolveProvenance } from './marketplace-provenance'

/**
 * "Is what I have installed still what the publisher ships?" (AGL-1016).
 *
 * This comparison was previously derived inline on the installed-plugins card
 * and nowhere else, so the Plugins index, the installation page and the
 * marketplace listing could each show a different answer — or none. It is
 * exactly the sort of thing that gets re-derived slightly differently in four
 * places, so it lives here, pure, and every surface asks it.
 */

export type UpdateState =
  /** Running the newest version the publisher offers. */
  | 'current'
  /** A newer version exists and can be taken. */
  | 'update-available'
  /**
   * Installed version is NEWER than what is offered. Not a bug: a publisher
   * installs their own unapproved version to test it, and a version can be
   * withdrawn after someone installed it.
   */
  | 'ahead'
  /** Not enough is known to say — no provenance, or nothing published to compare. */
  | 'unknown'

export interface UpdateStatus {
  state: UpdateState
  /** The version running, or null when provenance cannot say. */
  installedVersion: string | null
  /** The newest version on offer — for plugins, the newest APPROVED one. */
  availableVersion: string | null
  /**
   * Why the answer is `unknown`, for a UI that should say which kind of
   * silence this is rather than implying the artifact is current.
   */
  unknownReason?: 'no-provenance' | 'nothing-published' | 'incomparable'
}

/**
 * Orders two artifact versions, or returns null when they cannot be ordered.
 *
 * Two numbering schemes are in play and both are real: copied artifacts get a
 * monotonic integer from the publish route, plugins get the semver string off
 * their manifest. A single string compare handles neither ("10" < "9",
 * "1.10.0" < "1.9.0"), so both are parsed as dotted numbers — which covers the
 * integer case as a one-segment version.
 *
 * Anything non-numeric (a prerelease tag, a date-stamped build) is not ordered
 * by guesswork: unequal-and-incomparable is reported as such and surfaces as
 * `unknown`, which is honest, where a string compare would confidently point
 * an update button at an older build.
 */
export function compareArtifactVersions(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): -1 | 0 | 1 | null {
  if (a == null || b == null || a === '' || b === '') return null
  const left = String(a)
  const right = String(b)
  if (left === right) return 0
  const parse = (value: string): number[] | null => {
    const parts = value.split('.')
    const numbers: number[] = []
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null
      numbers.push(Number(part))
    }
    return numbers.length ? numbers : null
  }
  const leftParts = parse(left)
  const rightParts = parse(right)
  if (!leftParts || !rightParts) return null
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart < rightPart) return -1
    if (leftPart > rightPart) return 1
  }
  // Equal numerically but not as strings — "1.0" and "1.0.0" are the same
  // version written two ways.
  return 0
}

/** The installed side: a plugin pin, or any copied artifact's document. */
export interface UpdateComparableInstall {
  version?: unknown
  installedFrom?: Record<string, unknown> | null
  community?: { listingId?: string; version?: unknown } | null
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
 * For plugins the offer is the newest APPROVED version, never `latestVersion`.
 * Installs already resolve it that way; advertising `latestVersion` would leak
 * AGL-966's guarantee straight back out through a badge, telling a workspace an
 * update exists that the install route would then refuse to give them.
 */
export function resolveUpdateState(
  installed: UpdateComparableInstall | null | undefined,
  listing: UpdateComparableListing | null | undefined,
  artifactType?: CommunityArtifactType,
): UpdateStatus {
  const provenance = resolveProvenance(installed as never, artifactType)
  if (!installed || provenance.state === 'unknown' || !provenance.version) {
    return UNKNOWN
  }
  const installedVersion = provenance.version
  const type = provenance.artifactType ?? artifactType ?? null
  const available =
    type === 'plugin'
      ? listing?.latestApprovedVersion
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

/**
 * One sentence describing an update state, so four surfaces do not each invent
 * their own wording for the same fact.
 */
export function updateStateLabel(status: UpdateStatus): string {
  switch (status.state) {
    case 'update-available':
      return `You have v${status.installedVersion} · v${status.availableVersion} available`
    case 'current':
      return `Up to date · v${status.installedVersion}`
    case 'ahead':
      return `You have v${status.installedVersion}, newer than the published v${status.availableVersion}`
    default:
      return status.unknownReason === 'nothing-published'
        ? 'No published version to compare against'
        : status.unknownReason === 'incomparable'
          ? `You have v${status.installedVersion}; v${status.availableVersion} cannot be ordered against it`
          : 'Installed before update tracking — version unknown'
  }
}
