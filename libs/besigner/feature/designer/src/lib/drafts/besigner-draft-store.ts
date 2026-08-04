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
  type ProcessableNodes,
  pruneLocalStorageByAge,
  writeLocalStorageWithBudget,
} from '@aglyn/aglyn'

/**
 * Local crash net for unsaved besigner work (AGL-1256).
 *
 * ## What this is not
 *
 * It is deliberately **not** version history. Versioning is a paid feature
 * (`versioning`, Pro and above): named snapshots of the *saved* document that
 * you can list, reopen, publish and schedule. A store of dated snapshots in
 * the browser is one careless design decision away from being a free
 * imitation of exactly that, so three rules hold the line, and every one of
 * them is load-bearing rather than incidental:
 *
 * 1. **One draft per document, latest wins.** No list, no names, no history.
 *    There is nothing to browse and nothing to choose between.
 * 2. **A draft only ever holds work that was never saved.** It is cleared the
 *    moment a save succeeds, so it can never act as "restore the document to
 *    how it was before" — that is rollback, and rollback is what versions
 *    sell. The only thing a draft can give back is the thing that would
 *    otherwise be gone forever.
 * 3. **A draft expires.** {@link DRAFT_MAX_AGE_MS} keeps it a recovery window
 *    rather than an archive.
 *
 * Because of those, drafts are ungated: this is data-loss prevention, and
 * gating it would mean a free org's crash still costs them their afternoon.
 * A free org gets back exactly what they had in the canvas and not one
 * revision more.
 */

/** Every key this module owns; also the set it may evict from. */
export const BESIGNER_DRAFT_KEY_PREFIX = 'aglyn:draft:'

/**
 * A week. Long enough to cover "my laptop died on Friday", short enough that
 * the store never becomes an accumulating pile of restore points.
 */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Which besigner document a draft belongs to.
 *
 * Every field is part of the key on purpose. `useBesignerDocument`'s
 * `documentKey` looks like the natural choice and is not safe as one: both
 * email editors build it as `${templateKey}:${versionId}`, so a platform
 * email template and a host's override of the same key — and two different
 * hosts overriding it — all collide. This is the same trap AGL-1203 hit with
 * preview snapshots, where screen, layout, component and template ids come
 * from one generator and live in sibling collections.
 */
export interface BesignerDraftIds {
  /**
   * Owning host id, or `'platform'` for the staff-owned system documents
   * that have no host.
   */
  scope: string
  kind: 'screen' | 'layout' | 'component' | 'template' | 'email'
  docId: string
  /**
   * Which version of the document is open. Keeping this in the key is what
   * stops a draft taken against version A being offered on version B —
   * versions are meant to be independent, and a draft that leaked across
   * them would corrupt the paid feature rather than merely duplicate it.
   * Templates version but never publish, so they have none.
   */
  versionId?: string
}

export interface BesignerDraft {
  nodes: ProcessableNodes
  /**
   * The stored document's version stamp when this draft was taken, in
   * `Aglyn.versionStamp` form. Null when the document had not stamped yet.
   * This is what makes the restore prompt honest about a colleague having
   * saved in the meantime (AGL-674).
   */
  baseStamp: string | null
  /** When the draft was last written. */
  updatedAt: number
}

export function besignerDraftKey(ids: BesignerDraftIds): string {
  const version = ids.versionId ?? 'current'
  return (
    `${BESIGNER_DRAFT_KEY_PREFIX}${ids.kind}:` +
    `${ids.scope}:${ids.docId}:${version}`
  )
}

function storageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * Writes the draft, replacing any previous one for this document.
 *
 * Returns false when storage refused it — the caller carries on editing
 * either way. Preview snapshots are spent first when the origin is full
 * (they regenerate on the next Preview click); other documents' drafts only
 * after that, oldest first.
 */
export function writeBesignerDraft(
  ids: BesignerDraftIds,
  draft: Omit<BesignerDraft, 'updatedAt'>,
  now: number = Date.now(),
): boolean {
  const value: BesignerDraft = { ...draft, updatedAt: now }
  return writeLocalStorageWithBudget({
    key: besignerDraftKey(ids),
    value: JSON.stringify(value),
    evictPrefixes: ['aglyn:preview:', BESIGNER_DRAFT_KEY_PREFIX],
  }).ok
}

/**
 * Reads this document's draft, or null when there is none, it is unreadable,
 * or it has aged out. An expired draft is removed on the way past, so the
 * store self-prunes on the path everyone takes.
 */
export function readBesignerDraft(
  ids: BesignerDraftIds,
  now: number = Date.now(),
): BesignerDraft | null {
  const storage = storageOrNull()
  if (!storage) return null
  const key = besignerDraftKey(ids)
  const raw = storage.getItem(key)
  if (!raw) return null
  let draft: BesignerDraft | null = null
  try {
    const parsed = JSON.parse(raw) as BesignerDraft
    draft = parsed?.nodes ? parsed : null
  } catch {
    draft = null
  }
  if (!draft) {
    clearBesignerDraft(ids)
    return null
  }
  if (now - (draft.updatedAt ?? 0) > DRAFT_MAX_AGE_MS) {
    clearBesignerDraft(ids)
    return null
  }
  return draft
}

export function clearBesignerDraft(ids: BesignerDraftIds): void {
  try {
    storageOrNull()?.removeItem(besignerDraftKey(ids))
  } catch {
    // Nothing to do and nothing worth interrupting an edit for.
  }
}

/** Drops every expired draft, whichever document it belongs to. */
export function pruneBesignerDrafts(now: number = Date.now()): string[] {
  return pruneLocalStorageByAge({
    prefix: BESIGNER_DRAFT_KEY_PREFIX,
    maxAgeMs: DRAFT_MAX_AGE_MS,
    now,
  })
}
