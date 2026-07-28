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

import { createHash } from 'node:crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { CommunityArtifactType } from '../model/community'
import {
  ARTIFACT_BASE_COLLECTION,
  ARTIFACT_BASE_MAX_BYTES,
  type InstalledFrom,
  stableStringify,
} from '@aglyn/aglyn/server'

/**
 * The one writer every install route uses to stamp provenance (AGL-1015).
 *
 * Shared deliberately: each route stamping its own shape is how the marketplace
 * ended up with four different provenance fields and no snapshot, and how
 * AGL-1006 came to depend on a mirror nobody wrote. There is one shape because
 * there is one function producing it.
 */

/** Content hash of an artifact, stable across field ordering. */
export function artifactContentHash(content: unknown): string {
  return createHash('sha256').update(stableStringify(content), 'utf8').digest('hex')
}

/**
 * The same stamp for an artifact that is already content-addressed elsewhere —
 * today only plugins, whose bundle bytes live immutably in the artifact bucket
 * and are integrity-checked at load.
 *
 * Copying those bytes into a Firestore base would be a second, weaker copy of
 * something that already cannot change, so the stamp records the hash and
 * points at the bundle. It goes through this module anyway so there is exactly
 * one place the shape is defined.
 */
export function pinnedProvenance(input: {
  listingId: string
  listing: { profileId?: string }
  version: string
  sha256: string
  artifactType: CommunityArtifactType
}): InstalledFrom {
  return {
    listingId: input.listingId,
    version: input.version,
    sha256: input.sha256,
    artifactType: input.artifactType,
    installedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    publisherOrgId: input.listing.profileId ?? null,
  }
}

export interface RecordProvenanceInput {
  firestore: FirebaseFirestore.Firestore
  listingId: string
  /** The listing document, for the version and publishing org. */
  listing: { profileId?: string; latestVersion?: unknown }
  /** The version actually installed — not always `listing.latestVersion`. */
  version: string | number | null | undefined
  artifactType: CommunityArtifactType
  /**
   * The content as installed, exactly as written to the user's document. What
   * goes in here is what "reset to the publisher's version" will restore, so it
   * must be the vendored content and nothing else — no ids, timestamps or
   * quota-derived fields, which differ per install and would read as user edits.
   */
  content: unknown
}

export interface RecordedProvenance {
  /** Write this onto the installed document. */
  installedFrom: InstalledFrom
  sha256: string
  /** False when the content was too large to snapshot; the install still proceeds. */
  baseStored: boolean
}

/**
 * Hashes the installed content, stores an immutable base snapshot keyed by that
 * hash, and returns the stamp to write on the installed document.
 *
 * The snapshot is written with `create` and a swallowed failure: the collection
 * is content-addressed, so a document that already exists holds byte-identical
 * content and re-installing the same version must reuse it rather than rewrite
 * it. Nothing here is on the install's critical path — a snapshot that cannot be
 * written leaves `baseStored: false` and an artifact that reports itself as not
 * updatable, which is the honest outcome and better than failing the install.
 */
export async function recordInstallProvenance(
  input: RecordProvenanceInput,
): Promise<RecordedProvenance> {
  const { firestore, listingId, listing, artifactType, content } = input
  const version =
    input.version == null || input.version === ''
      ? (listing.latestVersion == null ? null : String(listing.latestVersion))
      : String(input.version)
  const serialized = stableStringify(content)
  const sha256 = createHash('sha256').update(serialized, 'utf8').digest('hex')
  const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()

  let baseStored = false
  if (Buffer.byteLength(serialized, 'utf8') <= ARTIFACT_BASE_MAX_BYTES) {
    const baseRef = firestore.collection(ARTIFACT_BASE_COLLECTION).doc(sha256)
    try {
      await baseRef.create({
        sha256,
        artifactType,
        listingId,
        version,
        publisherOrgId: listing.profileId ?? null,
        content,
        createdAt: now,
      })
      baseStored = true
    } catch {
      // Already present (the common case on re-install), or unwritable. Either
      // way the base is only usable if it is really there, so confirm.
      baseStored = (await baseRef.get().catch(() => null))?.exists ?? false
    }
  }

  return {
    sha256,
    baseStored,
    installedFrom: {
      listingId,
      version,
      sha256: baseStored ? sha256 : null,
      artifactType,
      installedAt: now,
      publisherOrgId: listing.profileId ?? null,
    },
  }
}
