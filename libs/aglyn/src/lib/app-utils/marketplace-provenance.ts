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

/**
 * Everything an org can publish to the marketplace (AGL-654).
 *
 * The union lives in core rather than the community plugin because the
 * console reasons about installed artifacts too — a Plugins index that cannot
 * name an artifact type cannot render an update chip — and module boundaries
 * (rightly) forbid an app depending on an addon lib. The community model
 * re-exports it, so publishing code still reads it from one place.
 */
export type CommunityArtifactType =
  | 'component'
  | 'template'
  | 'plugin'
  | 'layout'
  | 'datasetSchema'
  | 'emailTemplate'

/**
 * Install provenance (AGL-1015): where an installed artifact came from, at
 * what version, and what it looked like when it arrived.
 *
 * Every install route used to stamp its own shape — plugins wrote a pin,
 * dataset schemas a `source`, email templates an `installedFrom`, components a
 * `community` — and none of them kept the content as installed. Without the
 * original there is no way to tell the publisher's change from the user's, so
 * an update can only overwrite. This module defines the one shape all install
 * routes write and the one reader everything else asks.
 */

/**
 * Immutable, content-addressed base snapshots — the content exactly as
 * installed, keyed by its own hash and stored outside the user's edit path.
 *
 * Top-level rather than per-host on purpose: the same listing version installed
 * onto twenty sites is one document, and re-installing it rewrites nothing.
 */
export const ARTIFACT_BASE_COLLECTION = 'communityArtifactBases'

/**
 * Firestore's per-document ceiling is 1 MiB. Snapshots are stored whole, so
 * anything near it is refused rather than truncated — a partial base is worse
 * than no base, because a diff would report the missing half as user edits.
 */
export const ARTIFACT_BASE_MAX_BYTES = 800 * 1024

/** The provenance stamp written on every installed artifact (AGL-1015). */
export interface InstalledFrom {
  listingId: string
  /** The listing version installed, as a string; null when unversioned. */
  version: string | null
  /** Content hash of the base snapshot — the key into {@link ARTIFACT_BASE_COLLECTION}. */
  sha256: string | null
  artifactType: CommunityArtifactType
  installedAt: unknown
  /** The publishing org (`listing.profileId`, org-owned since AGL-652). */
  publisherOrgId: string | null
}

/**
 * How much is actually known about where an artifact came from.
 *
 * `inferred` exists because the marketplace shipped before this stamp did:
 * pre-AGL-1015 installs carry a listing id somewhere but no hash and no base.
 * Calling those `recorded` would let an update think it has an origin to merge
 * against; calling them `unknown` would throw away a listing id we really do
 * have. They are their own state, and the UI says "installed before update
 * tracking" rather than implying either.
 */
export type ProvenanceState = 'recorded' | 'inferred' | 'unknown'

export interface ResolvedProvenance {
  state: ProvenanceState
  listingId: string | null
  version: string | null
  sha256: string | null
  artifactType: CommunityArtifactType | null
  publisherOrgId: string | null
  /**
   * A base snapshot exists, so this artifact can be diffed and safely updated.
   * False for everything installed before the stamp — and saying so plainly is
   * the point: a merge built on a fabricated origin destroys work silently.
   */
  updatable: boolean
}

const UNKNOWN_PROVENANCE: ResolvedProvenance = {
  state: 'unknown',
  listingId: null,
  version: null,
  sha256: null,
  artifactType: null,
  publisherOrgId: null,
  updatable: false,
}

function asVersion(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

/**
 * Reads provenance off an installed document, tolerating every shape the
 * install routes wrote before AGL-1015.
 *
 * The legacy fields are read rather than migrated: a batch backfill could only
 * ever recover the listing id and version, which is exactly what this recovers
 * lazily, and it cannot invent a base snapshot. Installs re-stamp themselves
 * properly the next time they are updated.
 */
export function resolveProvenance(
  doc:
    | {
        installedFrom?: Partial<InstalledFrom> | null
        /** Component installs (`hosts/{h}/components`). */
        community?: { listingId?: string; profileId?: string; version?: unknown } | null
        /** Template, layout and dataset-schema installs. */
        source?: { type?: string; listingId?: string; version?: unknown } | null
        /** Plugin pins are their own provenance: the pin IS the version. */
        pluginId?: string
        listingId?: string
        profileId?: string
        version?: unknown
        sha256?: string
      }
    | null
    | undefined,
  fallbackArtifactType?: CommunityArtifactType,
): ResolvedProvenance {
  if (!doc) return UNKNOWN_PROVENANCE

  const stamped = doc.installedFrom
  // A full stamp is the only thing that carries a base snapshot. Email
  // templates have written a partial `installedFrom` since AGL-789, so the
  // discriminator is the hash and the artifact type, not the field's presence.
  if (stamped?.listingId && stamped.sha256 && stamped.artifactType) {
    return {
      state: 'recorded',
      listingId: stamped.listingId,
      version: asVersion(stamped.version),
      sha256: stamped.sha256,
      artifactType: stamped.artifactType as CommunityArtifactType,
      publisherOrgId: stamped.publisherOrgId ?? null,
      updatable: true,
    }
  }

  const legacy = stamped?.listingId
    ? { listingId: stamped.listingId, version: stamped.version, profileId: null }
    : doc.community?.listingId
      ? {
          listingId: doc.community.listingId,
          version: doc.community.version,
          profileId: doc.community.profileId ?? null,
        }
      : doc.source?.listingId
        ? {
            listingId: doc.source.listingId,
            version: doc.source.version,
            profileId: null,
          }
        : // A plugin pin is flat: `{listingId, version, sha256}` on the install
          // doc itself. It is the one artifact that never needed a snapshot —
          // the bytes are immutable and content-addressed already — so a pin
          // resolves as fully recorded.
          doc.listingId
          ? {
              listingId: doc.listingId,
              version: doc.version,
              profileId: doc.profileId ?? null,
            }
          : null
  if (!legacy) return UNKNOWN_PROVENANCE

  const isPin = Boolean(doc.pluginId && doc.sha256)
  return {
    state: isPin ? 'recorded' : 'inferred',
    listingId: legacy.listingId,
    version: asVersion(legacy.version),
    sha256: doc.sha256 ?? null,
    artifactType: isPin ? 'plugin' : (fallbackArtifactType ?? null),
    publisherOrgId: legacy.profileId,
    updatable: isPin,
  }
}

/**
 * Deterministic JSON with object keys in sorted order, so the same content
 * hashes to the same id no matter what order Firestore handed the fields back.
 *
 * `undefined` members are dropped exactly as `JSON.stringify` drops them, which
 * keeps `{a: 1}` and `{a: 1, b: undefined}` — the same document after a
 * Firestore round-trip — hashing alike.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
  return `{${entries.join(',')}}`
}
