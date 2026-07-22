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
 * Starter-template materialization (AGL-687).
 *
 * ## Nothing is installed automatically
 *
 * Starters render in the gallery straight from the code definitions
 * (`constants/starter-templates.ts`). No document is written until a user
 * actually **uses** or **edits** one, and then only for that one starter.
 *
 * The first cut of AGL-687 seeded all of them eagerly — on host creation and
 * again on every gallery open. That is wrong for content we intend to keep
 * improving: an eager copy is a frozen snapshot, so once every host holds
 * one, no upstream change ever reaches anybody. Left virtual, an untouched
 * starter keeps tracking the definitions and picks up improvements for free;
 * only a user who has forked one by acting on it opts out of that, which is
 * exactly the moment they should.
 *
 * ## Why acting on one COPIES it into the host's library
 *
 * A starter is a *starting point* — its value is that you then change it.
 * Serving them read-only from a global collection would keep one upstream
 * copy, but a template you can see and not edit, version or publish, sitting
 * in the same grid as one you can, is the two-lifecycle split this issue
 * exists to remove. So the moment a user commits to a starter it becomes a
 * real `hosts/{hostId}/templates` document carrying `source.type = 'starter'`
 * for provenance. Every read stays inside the host's own collections, and the
 * existing Firestore rules cover the collection unchanged.
 *
 * ## Idempotency
 *
 * Document ids are DERIVED from the starter id and screen key
 * (`starterTemplateDocId`), never randomly generated, so materializing twice
 * — a double-click, a use after an edit — addresses the same documents. An
 * existing document is left completely alone: the user's edits, and their
 * deletion of one (a `deletedAt` on a document that still exists), outrank
 * anything this would write. It only ever *adds what is missing*.
 *
 * A consequence, deliberately accepted: changing a starter in code does NOT
 * rewrite copies already materialized. Once materialized the copy belongs to
 * the host, and silently rewriting someone's starting point is the surprise
 * AGL-669 removed from marketplace installs. Untouched starters, which are
 * now the overwhelming majority, do get the update.
 *
 * ## Quota
 *
 * Materialized starters stay excluded from the `templatesPerHost` count in
 * /api/hosts/resources. That mattered more when fifteen were installed
 * unasked; it still holds, because the copy is platform-authored content the
 * user adopted rather than something they built, and a free plan's ten
 * templates are for their own work.
 */

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

export interface MaterializeStarterResult {
  /** Documents written by this run. */
  created: number
  /** Documents already present and therefore untouched. */
  skipped: number
}

/**
 * Materializes ONE starter into a host's template library.
 *
 * Called only when a user uses or edits that starter — never on a schedule,
 * never on host creation, never on gallery open. See the module comment for
 * why nothing is written until somebody actually acts on a starter.
 *
 * Safe to call repeatedly for the same starter: ids are derived, and an
 * existing document is left completely alone.
 *
 * Server-side only: Firestore rules deny client `create` on `templates`
 * (AGL-473), and `source` is server-managed by design.
 */
export async function materializeStarterTemplate(
  firestore: SeedFirestore,
  hostId: string,
  starterId: string,
  options: {
    /** Value stamped as createdAt/updatedAt. */
    now?: unknown
    /** Injectable for tests; defaults to the shipped starters. */
    docs?: StarterTemplateDoc[]
  } = {},
): Promise<MaterializeStarterResult> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const all = options.docs ?? buildAllStarterTemplateDocs()
  // Every page of exactly this starter. A starter is materialized whole:
  // its pages are authored as a set, and half a shop is not a usable
  // starting point.
  const docs = all.filter((entry) => entry.starterId === starterId)
  if (!docs.length) return { created: 0, skipped: 0 }
  const now = options.now ?? new Date()

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
      // somebody deliberately deleted is not materializing, it is undoing
      // them.
      skipped += 1
      return
    }
    // `set`, not `create`: a double-click would abort a `create` batch and
    // leave genuinely missing pages unwritten, whereas both writers here
    // produce byte-identical platform content.
    batch.set(templates.doc(entry.id), {
      ...entry.data,
      hostId,
      createdAt: now,
      updatedAt: now,
    })
    created += 1
  })
  if (!created) return { created: 0, skipped }
  await batch.commit()

  return { created, skipped }
}

export default materializeStarterTemplate
