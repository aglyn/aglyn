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
  buildAllStarterTemplateDocs,
  type StarterTemplateDoc,
} from '../../constants/starter-templates'

/**
 * Starter-template seed (AGL-687).
 *
 * ## Why the starters are COPIED into each host's library
 *
 * A starter is a *starting point* — its entire value is that you then change
 * it. Serving the starters from a global, read-only collection would keep
 * one upstream copy that a fix reaches everywhere, but that advantage does
 * not apply to content the user is expected to fork the moment they touch
 * it; what it would actually reproduce is the two-lifecycle split this issue
 * exists to remove — a template you can see but not edit, version or
 * publish, sitting in the same grid as one you can.
 *
 * So the starters are seeded as real `hosts/{hostId}/templates` documents,
 * carrying `source.type = 'starter'` to record provenance. Every read stays
 * inside the host's own collections (no cross-org, cross-host reads) and the
 * existing Firestore rules already cover the collection unchanged — a seeded
 * starter is an ordinary template in every respect except the badge.
 *
 * ## Idempotency
 *
 * Document ids are DERIVED from the starter id and screen key
 * (`starterTemplateDocId`), never randomly generated, so a re-run addresses
 * the same documents. A document that already exists is left completely
 * alone: the user's edits to a seeded starter — and their deletion of one,
 * which is a `deletedAt` on a document that still exists — outrank anything
 * this would write. Seeding therefore only ever *adds what is missing*.
 *
 * A consequence, deliberately accepted: changing a starter's content in code
 * does NOT rewrite copies already seeded. Once seeded, the copy belongs to
 * the host, and silently rewriting someone's starting point is exactly the
 * surprise AGL-669 removed from marketplace installs.
 *
 * ## Quota
 *
 * Seeded starters are platform-provided, so they are excluded from the
 * `templatesPerHost` count enforced by /api/hosts/resources — a free plan's
 * ten-template allowance is for the user's own work, not for content we put
 * there.
 */

/**
 * Bumped only when the SET of starters changes (a starter added or
 * removed). It is a fast-path marker, not a content version: existing
 * documents are never rewritten, so a bump only makes the seed look for
 * newly-missing documents again.
 */
export const STARTER_TEMPLATE_SEED_VERSION = 1

/** Host-doc field holding the last seed version applied. */
export const STARTER_SEED_MARKER_FIELD = 'starterTemplatesSeedVersion'

/** Minimal firebase-admin Firestore surface the seed needs. */
export interface SeedDocumentSnapshot {
  readonly exists: boolean
  get(field: string): unknown
}
export interface SeedDocumentRef {
  get(): Promise<SeedDocumentSnapshot>
}
export interface SeedCollectionRef {
  doc(id: string): SeedDocumentRef
}
export interface SeedHostRef extends SeedDocumentRef {
  collection(name: string): SeedCollectionRef
}
export interface SeedWriteBatch {
  set(ref: SeedDocumentRef, data: Record<string, unknown>): void
  update(ref: SeedDocumentRef, data: Record<string, unknown>): void
  commit(): Promise<unknown>
}
export interface SeedFirestore {
  collection(name: string): { doc(id: string): SeedHostRef }
  batch(): SeedWriteBatch
}

export interface SeedStarterTemplatesResult {
  /** Documents written by this run. */
  created: number
  /** Documents already present and therefore untouched. */
  skipped: number
  /** True when the marker short-circuited the run before any read. */
  alreadySeeded: boolean
}

/**
 * Seeds any missing starter templates into a host's library.
 *
 * Safe to call on every host, repeatedly, in any order. Server-side only:
 * Firestore rules deny client `create` on `templates` (AGL-473), and
 * `source` is server-managed by design.
 */
export async function seedStarterTemplates(
  firestore: SeedFirestore,
  hostId: string,
  options: {
    /** Value stamped as createdAt/updatedAt. */
    now?: unknown
    /** Skip the marker fast-path and re-check every document. */
    force?: boolean
    /** Injectable for tests; defaults to the shipped starters. */
    docs?: StarterTemplateDoc[]
  } = {},
): Promise<SeedStarterTemplatesResult> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const docs = options.docs ?? buildAllStarterTemplateDocs()
  const now = options.now ?? new Date()

  if (!options.force) {
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return { created: 0, skipped: 0, alreadySeeded: false }
    }
    const seeded = Number(hostSnapshot.get(STARTER_SEED_MARKER_FIELD) ?? 0)
    if (seeded >= STARTER_TEMPLATE_SEED_VERSION) {
      return { created: 0, skipped: 0, alreadySeeded: true }
    }
  }

  const templates = hostRef.collection('templates')
  const existing = await Promise.all(
    docs.map(async (entry) => (await templates.doc(entry.id).get()).exists),
  )

  const batch = firestore.batch()
  let created = 0
  let skipped = 0
  docs.forEach((entry, index) => {
    if (existing[index]) {
      // Already there — including the case where it is there with
      // `deletedAt` set, i.e. the user removed it. Re-creating a starter
      // somebody deliberately deleted is not "seeding", it is undoing them.
      skipped += 1
      return
    }
    // `set`, not `create`: two seeds racing (host creation and a gallery
    // open, say) would both write byte-identical platform content, whereas
    // `create` would abort the whole batch and leave the loser's genuinely
    // missing documents unwritten.
    batch.set(templates.doc(entry.id), {
      ...entry.data,
      hostId,
      createdAt: now,
      updatedAt: now,
    })
    created += 1
  })
  // The marker rides the same batch as the documents it describes: written
  // separately, a failure between the two would leave a host marked seeded
  // with nothing in its library.
  batch.update(hostRef, {
    [STARTER_SEED_MARKER_FIELD]: STARTER_TEMPLATE_SEED_VERSION,
    updatedAt: now,
  })
  await batch.commit()

  return { created, skipped, alreadySeeded: false }
}

export default seedStarterTemplates
