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
  type Firestore,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'

import { type ProcessableNodes } from '@aglyn/aglyn'
import type { BesignerDraftIds } from './besigner-draft-store'

/**
 * THE WORKING DRAFT — server-side, shared, one per version (AGL-1152).
 *
 * ## Why this exists alongside the local store
 *
 * `besigner-draft-store` is a crash net: it holds keystrokes that were never
 * saved, in this browser, and dies the moment a save succeeds. That is still
 * exactly what it should be, and nothing here changes it.
 *
 * This is the other thing asked for, and it is genuinely different: the
 * draft was originally only to save lost work, but now it is becoming a
 * working document and we want to save the working document as we make changes
 * and then publish after we are all done. So a draft here is written
 * DELIBERATELY, survives the browser, and lives until it is published.
 *
 * ## Why it is not a free version history
 *
 * The same line AGL-1256 drew still holds, and this stays on the safe side of
 * it for a structural reason rather than a promise: the document id is the
 * constant {@link DRAFT_DOC_ID}. There is no second name to write, so there is
 * no list to browse, nothing to name and nothing to choose between — you
 * cannot have more than one. Versions remain the paid feature: many of them,
 * restore points, scheduled release, variants, review cycles.
 *
 * ## Why a subcollection and not a field on the version
 *
 * The tenant reads version documents to render. A draft held as a field on one
 * would be shipped to every render of that page and billed on every read of
 * that document, to serve a value the tenant must never show. As its own
 * document it is read only by an editor that opens it, and it gets its own 1MB
 * budget rather than halving the target's.
 *
 * ## Co-editing
 *
 * There is ONE draft per target, not one per person, which is what makes it
 * work with the live mirror rather than against it: the mirror carries
 * in-flight keystrokes between people in the room, and a draft save promotes
 * that shared state to something durable that everyone in the room — and
 * anyone who joins later, from any browser — loads next. That is why saving a
 * draft clears the mirror exactly as saving the document does: Firestore has
 * become authoritative again, and replaying the mirror over it would re-apply
 * edits the draft already contains.
 */

/** The only id a draft may have. One per version, by construction. */
export const DRAFT_DOC_ID = 'current'

export interface BesignerServerDraft {
  nodes: ProcessableNodes
  /**
   * The stored document's version stamp when this draft was taken. What lets
   * the editor say "someone published since you started" honestly rather than
   * silently overwriting them (AGL-674).
   */
  baseStamp: string | null
  /** Who last wrote it — a shared draft needs to say whose work it holds. */
  updatedByUid: string | null
  updatedByEmail: string | null
}

/**
 * `screen` → `screens`. The kinds that have no versioned subcollection get no
 * draft: a template IS its document, so there is nothing for a draft to sit
 * beside, and returning null here is what keeps callers from inventing a path.
 */
const COLLECTION_OF: Partial<Record<BesignerDraftIds['kind'], string>> = {
  screen: 'screens',
  layout: 'layouts',
  component: 'components',
  form: 'forms',
}

/**
 * The draft's document, or null when this target cannot hold one — no host
 * scope, no version, or a kind with no versions. Null is a supported answer
 * and every caller treats it as "no draft here", never as an error.
 */
export function serverDraftRef(firestore: Firestore, ids: BesignerDraftIds) {
  const collection = COLLECTION_OF[ids.kind]
  if (!collection || !ids.scope || ids.scope === 'platform') return null
  if (!ids.docId || !ids.versionId) return null
  return doc(
    firestore,
    'hosts',
    ids.scope,
    collection,
    ids.docId,
    'versions',
    ids.versionId,
    'draft',
    DRAFT_DOC_ID,
  )
}

/**
 * Writes the working draft. Resolves false rather than throwing when the
 * target cannot hold one, so a caller does not have to re-derive that.
 */
/**
 * What a draft save did.
 *
 * `unchanged` is a SUCCESS, not a failure: the draft already holds this tree.
 * Distinguished from `written` because the two deserve different words on
 * screen — "Draft saved" said four times over an untouched document is how a
 * reader stops believing the message (AGL-1483).
 */
export type ServerDraftWrite = 'written' | 'unchanged' | 'failed'

/**
 * The tree last written to each draft, by path.
 *
 * Module scope, so all three editors get the check without repeating it, and
 * so it survives a re-render rather than a mount.
 *
 * A LOCAL baseline, deliberately, where `handleSave` insists on comparing
 * against the stored document. The two are guarding opposite mistakes.
 * `handleSave` must never skip a write that is needed, so a baseline that
 * lies would lose work and it re-reads to be sure. Here a stale baseline
 * only ever causes an extra identical write, which costs one document and
 * changes nothing — while reading the draft back on every click would cost a
 * Firestore read per click for a check nothing depends on.
 */
const lastWritten = new Map<string, string>()

export async function writeServerDraft(
  firestore: Firestore,
  ids: BesignerDraftIds,
  draft: BesignerServerDraft,
): Promise<ServerDraftWrite> {
  const ref = serverDraftRef(firestore, ids)
  if (!ref) return 'failed'
  // Keyed on the whole payload, not just the nodes: a draft carries the base
  // stamp it was taken against, and one taken against a newer document is a
  // different draft even when the tree is identical.
  const fingerprint = JSON.stringify([
    draft.nodes,
    draft.baseStamp ?? null,
    draft.updatedByUid ?? null,
  ])
  if (lastWritten.get(ref.path) === fingerprint) return 'unchanged'
  // Not `merge`: a draft is the whole working tree, and merging a smaller
  // tree into a larger one would leave nodes from a previous save behind —
  // the shape of AGL-1445, where a partial write resurrects deleted content.
  await setDoc(ref, { ...draft, updatedAt: serverTimestamp() })
  lastWritten.set(ref.path, fingerprint)
  return 'written'
}

export async function readServerDraft(
  firestore: Firestore,
  ids: BesignerDraftIds,
): Promise<BesignerServerDraft | null> {
  const ref = serverDraftRef(firestore, ids)
  if (!ref) return null
  const snapshot = await getDoc(ref)
  if (!snapshot.exists()) return null
  const data = snapshot.data() as Partial<BesignerServerDraft>
  // A draft with no tree is not a draft. Guarding here rather than at the call
  // site because a half-written document should read as absent, not as an
  // empty canvas someone is about to publish over their page.
  if (!data?.nodes) return null
  return {
    nodes: data.nodes,
    baseStamp: data.baseStamp ?? null,
    updatedByUid: data.updatedByUid ?? null,
    updatedByEmail: data.updatedByEmail ?? null,
  }
}

/**
 * Clears the working draft. Called when it has been PUBLISHED — the work is in
 * the document now, so a draft that outlived it would offer to restore the
 * state the author just moved past.
 */
export async function clearServerDraft(
  firestore: Firestore,
  ids: BesignerDraftIds,
): Promise<void> {
  const ref = serverDraftRef(firestore, ids)
  if (!ref) return
  // Forget the fingerprint with the draft. Otherwise the next save of the
  // same tree — a publish, then an undo back to it — would report itself
  // unchanged against a draft that no longer exists.
  lastWritten.delete(ref.path)
  // Best effort: a publish that succeeded must not report failure because the
  // tidy-up afterwards did. A stale draft is offered, not applied.
  await deleteDoc(ref).catch(() => undefined)
}
