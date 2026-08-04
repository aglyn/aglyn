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

import * as Aglyn from '@aglyn/aglyn'
import { autorun } from 'mobx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type BesignerDraft,
  type BesignerDraftIds,
  besignerDraftKey,
  clearBesignerDraft,
  pruneBesignerDrafts,
  readBesignerDraft,
  writeBesignerDraft,
} from '../drafts/besigner-draft-store'
import { useDebouncedCommit } from './use-debounced-commit'

/**
 * Trailing debounce on the snapshot. Longer than the AGL-567 attribute
 * debounce because this is disk work, not model work, and nobody is waiting
 * on it: a snapshot one second behind the canvas is still a snapshot.
 */
export const DRAFT_WRITE_DEBOUNCE_MS = 1_000

/**
 * …and an upper bound, because a trailing debounce alone never fires during
 * sustained activity. Dragging a section around for two minutes without a
 * one-second pause must not mean two minutes of unprotected work.
 */
export const DRAFT_WRITE_MAX_WAIT_MS = 15_000

export interface BesignerDraftState {
  /**
   * Unsaved work from a previous session is on hand and the author has not
   * decided about it yet. Undefined ids (no draft support wired) or no draft
   * both read as false.
   */
  available: boolean
  /** When the offered draft was taken; null when there is none. */
  takenAt: number | null
  /**
   * The stored document has moved on since the draft was taken — someone
   * else saved while it was stranded (AGL-674). Restoring is still allowed
   * (into the canvas, unsaved), but the save that follows goes through the
   * existing conflict guard, and the prompt has to say so.
   */
  staleAgainstDocument: boolean
  /** Puts the draft into the canvas as an undoable, unsaved change. */
  restore: () => void
  /** Drops the offer and the stored draft. */
  discard: () => void
}

const EMPTY_STATE: BesignerDraftState = {
  available: false,
  takenAt: null,
  staleAgainstDocument: false,
  restore: () => undefined,
  discard: () => undefined,
}

export interface UseBesignerDraftOptions {
  /** Omit to disable drafts for this document. */
  ids?: BesignerDraftIds
  /**
   * True once the stored document has been pushed into the canvas. Nothing
   * is read or written before this: writing earlier would snapshot an empty
   * canvas over a real draft, and reading earlier could not tell "no draft"
   * from "not loaded yet".
   */
  loaded: boolean
  /** The canvas differs from the last agreed state. */
  dirty: boolean
  /** Current stored-document stamp, in `Aglyn.versionStamp` form. */
  storedStamp: string | null
}

/**
 * Keeps a single local snapshot of unsaved canvas work per document, and
 * offers it back after a crash (AGL-1256).
 *
 * See `besigner-draft-store` for why this is a crash net and not version
 * history — in particular why the draft is destroyed the instant a save
 * succeeds, which is the property that keeps it from being a free stand-in
 * for the paid versioning feature.
 *
 * **Two tabs on one document write one draft key, last writer wins.** That
 * is deliberate: both tabs are editing the same version and the newest
 * unsaved state is the one worth recovering. Nothing here tries to merge
 * them; merging whole node maps is AGL-677's problem, not a crash net's.
 */
export function useBesignerDraft(
  options: UseBesignerDraftOptions,
): BesignerDraftState {
  const { ids, loaded, dirty, storedStamp } = options
  const key = ids ? besignerDraftKey(ids) : null

  /** The draft being offered, held in memory for the life of the offer. */
  const [offer, setOffer] = useState<BesignerDraft | null>(null)
  /** Guards the read so it happens exactly once per document, before writes. */
  const readKeyRef = useRef<string | null>(null)
  const idsRef = useRef(ids)
  idsRef.current = ids
  const storedStampRef = useRef(storedStamp)
  storedStampRef.current = storedStamp
  /**
   * Whether this session has ever written the draft slot. Without it the
   * clean-canvas cleanup below would delete the draft it was just offered:
   * a freshly loaded document is clean by definition, so "clean" only means
   * "nothing left to protect" once we have actually put something there.
   */
  const wroteRef = useRef(false)

  const writeDraft = useCallback(() => {
    const currentIds = idsRef.current
    if (!currentIds) return
    wroteRef.current = true
    // Serialising here rather than in the autorun is the whole point of the
    // debounce: the tracking read is cheap to repeat, `JSON.stringify` of a
    // 200-node map plus a synchronous `setItem` is not (AGL-567).
    const nodes = Aglyn.canvas.toJSON().nodes as Aglyn.ProcessableNodes
    writeBesignerDraft(currentIds, {
      nodes,
      baseStamp: storedStampRef.current,
    })
  }, [])

  const { schedule, flush } = useDebouncedCommit(
    writeDraft,
    DRAFT_WRITE_DEBOUNCE_MS,
    { maxWait: DRAFT_WRITE_MAX_WAIT_MS },
  )

  // Read the existing draft once the document is in the canvas, and before
  // anything can overwrite it.
  // Keyed on the storage key rather than the ids object: callers build that
  // object inline, so a dependency on it would re-run this on every render.
  useEffect(() => {
    const currentIds = idsRef.current
    if (!key || !currentIds || !loaded) return
    if (readKeyRef.current === key) return
    readKeyRef.current = key
    pruneBesignerDrafts()
    setOffer(readBesignerDraft(currentIds))
  }, [key, loaded])

  // Snapshot on canvas change. `autorun` re-runs whenever anything the
  // tracked read touched changes, and `toJSON()` touches every node — which
  // is the same depth of read the existing `isInitialSame` computed already
  // performs on every change, so this adds a constant factor to a path that
  // is already O(nodes), not a new order of cost.
  useEffect(() => {
    if (!key || !loaded) return undefined
    return autorun(() => {
      Aglyn.canvas.toJSON()
      if (Aglyn.canvas.isInitialSame) return
      schedule()
    })
  }, [key, loaded, schedule])

  // Returning to the saved state (an undo back to it, or a save landing)
  // means there is no unsaved work left to protect. Dropping the draft here
  // is what stops it lingering as a restore point for a document that has
  // moved past it.
  useEffect(() => {
    const currentIds = idsRef.current
    if (!key || !currentIds || !loaded || dirty) return
    if (!wroteRef.current) return
    // Flush before clearing, not after: a timer left pending would land
    // *after* the delete and re-create a draft whose content is identical to
    // the saved document — offered on the next load as unsaved work that
    // never existed.
    flush()
    clearBesignerDraft(currentIds)
    wroteRef.current = false
  }, [key, loaded, dirty, flush])

  // A crash is not the only way a tab dies; closing it is the common one,
  // and `pagehide` is the last reliable moment to get the pending snapshot
  // onto disk. `visibilitychange` covers the mobile/background case where
  // `pagehide` may never fire.
  useEffect(() => {
    if (!key || !loaded) return undefined
    const flushNow = () => {
      if (!Aglyn.canvas.isInitialSame) flush()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow()
    }
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key, loaded, flush])

  const restore = useCallback(() => {
    const draft = offer
    if (!draft) return
    // `applyNodes` snapshots history first, so restoring is undoable and
    // leaves the canvas dirty. Dirty matters beyond the save button: it is
    // what keeps "Save the canvas before creating a version" firing, so a
    // restored draft can never be swept into a version snapshot.
    Aglyn.canvas.applyNodes(draft.nodes)
    setOffer(null)
  }, [offer])

  const discard = useCallback(() => {
    const currentIds = idsRef.current
    setOffer(null)
    if (currentIds) clearBesignerDraft(currentIds)
  }, [])

  return useMemo(() => {
    if (!key || !offer) return EMPTY_STATE
    return {
      available: true,
      takenAt: offer.updatedAt ?? null,
      staleAgainstDocument: Aglyn.hasConcurrentWrite(
        offer.baseStamp,
        storedStamp,
      ),
      restore,
      discard,
    }
  }, [key, offer, storedStamp, restore, discard])
}

export default useBesignerDraft
