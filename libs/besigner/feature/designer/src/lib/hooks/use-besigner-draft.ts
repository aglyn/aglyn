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
import type { Firestore } from 'firebase/firestore'
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
import {
  clearServerDraft,
  readServerDraft,
} from '../drafts/besigner-server-draft'
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

/**
 * Why a recovered draft may not be put back on the canvas (AGL-2486). Null
 * when restoring is a private act and safe to offer.
 */
export type BesignerDraftRestoreBlock =
  /**
   * Someone else SAVED this document after the draft was taken, so the draft
   * predates work that is now in the stored document.
   *
   * The only remaining verdict, and it applies only when this editor is
   * ALONE in the room: every shared case now withholds the whole prompt
   * rather than a button (see `roomIsShared`). A `'live-session'` member
   * used to sit beside this one and became unreachable the moment the
   * signal that produced it also suppressed the offer — so it is gone
   * rather than left as a branch nothing can enter.
   */
  'saved-since'

/** Which store an offered draft came from. See `BesignerDraftState.origin`. */
export type BesignerDraftOrigin = 'browser' | 'shared'

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
   * else saved while it was stranded (AGL-674).
   */
  staleAgainstDocument: boolean
  /**
   * WHERE the offered draft came from, which is the difference between two
   * things the banner used to describe in one voice (AGL-2508).
   *
   * * `browser` — the local crash net. Work that was never saved, held in
   *   this browser only, offered back after a reload or a crash.
   * * `shared` — the WORKING DRAFT on the server. The author pressed Save
   *   draft, was told it saved, and it did: this is that document coming
   *   back, from any browser, for anyone with access.
   *
   * Telling an author their deliberately saved draft was "recovered from
   * this browser" reads as a save that failed and a browser that rescued
   * them. It is the opposite on both counts.
   */
  origin: BesignerDraftOrigin
  /**
   * Why {@link restore} is withheld, or null when it is safe to offer
   * (AGL-2486). A blocked restore is a no-op, not merely an unrendered
   * button: the offer and the action have to agree.
   */
  restoreBlockedBy: BesignerDraftRestoreBlock | null
  /** Puts the draft into the canvas as an undoable, unsaved change. */
  restore: () => void
  /** Drops the offer and the stored draft. */
  discard: () => void
}

const EMPTY_STATE: BesignerDraftState = {
  available: false,
  takenAt: null,
  staleAgainstDocument: false,
  origin: 'browser',
  restoreBlockedBy: null,
  restore: () => undefined,
  discard: () => undefined,
}

/**
 * How many OTHER editing sessions are in this room, from the point of view
 * of the recovery prompt — or null while that is not yet known (AGL-2486).
 *
 * Presence is the input, but its statuses do not map onto "am I alone" one
 * for one, and the difference decides whether a person who crashed gets
 * their work back:
 *
 * * `live` — the room is known. However many sessions it holds is the
 *   answer, zero included.
 * * `idle` / `connecting` — NOT known yet. Null, so the prompt waits rather
 *   than offering a Discard for the second before presence lands.
 * * `unauthorized` / `error` / `unconfigured` — presence cannot answer and
 *   never will on this load. Zero, deliberately: a deployment with no
 *   Realtime Database has no co-edit mirror either, so there is nothing to
 *   have already restored the work, and withholding recovery there would
 *   break the crash net for every self-host that never configured presence
 *   (`project_self_host_docker_byo_firebase`).
 */
export function recoverableRoomSessions(
  status: string,
  otherSessions: number,
): number | null {
  if (status === 'live') return otherSessions
  if (status === 'idle' || status === 'connecting') return null
  return 0
}

export interface UseBesignerDraftOptions {
  /** Omit to disable drafts for this document. */
  ids?: BesignerDraftIds
  /**
   * Omit to use the local crash net alone (AGL-1152).
   *
   * Given one, the SHARED working draft is consulted too and PREFERRED when
   * both exist. That ordering is the point rather than a tie-break: a local
   * draft is residue from a browser that stopped, while a server draft is work
   * somebody deliberately saved — possibly a colleague, possibly this person
   * on another machine. Offering the crash residue over it would hand back the
   * older of the two and look like data loss.
   */
  firestore?: Firestore
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
  /**
   * Other live editing sessions in this room, or null while unknown — see
   * {@link recoverableRoomSessions}, which is how a caller with a presence
   * state derives it (AGL-2486).
   *
   * Omitted means ZERO, not unknown: an editor with no presence at all (the
   * system-email besigner has no honest orgId for a room) is a single-player
   * session by construction, and must keep its crash net.
   */
  roomSessions?: number | null
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
 *
 * ## Where this sits next to live co-editing (AGL-2486)
 *
 * There are two "unsaved" states in a besigner editor and they have
 * different scopes, which is why the prompt says "from this browser" out
 * loud:
 *
 * * The **co-edit mirror** (AGL-677) is the SHARED one. It carries unsaved
 *   work per node between sessions and replays it to whoever joins, so
 *   opening a document someone else is editing already shows their
 *   in-progress state — and shows you your own again after a crash, before
 *   this prompt is read.
 * * This draft is the PRIVATE one: one snapshot, in one browser, for the
 *   case where nothing else survived.
 *
 * They are not merged and this one is not made shareable — the mirror
 * already is that, per node, without a merge of two whole maps.
 *
 * The private snapshot is not OFFERED at all while the room is shared
 * (AGL-2486). Withholding only Restore is not enough: that leaves a prompt
 * whose one remaining button is Discard, standing over work several people
 * are still doing. Recovery is a crash story, a crash means nothing else
 * survived, and a live room is proof that something did. See
 * `roomIsShared` in the body for the two signals that decide it, and
 * {@link BesignerDraftState.restoreBlockedBy} for the narrower verdicts that
 * still apply when this editor is alone.
 */
export function useBesignerDraft(
  options: UseBesignerDraftOptions,
): BesignerDraftState {
  const { ids, loaded, dirty, storedStamp, firestore } = options
  // `??` would fold null into 0 and lose the distinction the whole rule
  // rests on: null is "presence has not answered yet", 0 is "it answered,
  // and you are alone".
  const roomSessions =
    options.roomSessions === undefined ? 0 : options.roomSessions
  const key = ids ? besignerDraftKey(ids) : null

  /** The draft being offered, held in memory for the life of the offer. */
  const [offer, setOffer] = useState<BesignerDraft | null>(null)
  /**
   * Which store {@link offer} came from (AGL-2508). Tracked beside the offer
   * rather than folded into `BesignerDraft`, because the stored shape is what
   * both stores persist and neither one records where it ended up being read
   * from — that is a fact about this load, not about the document.
   */
  const [offerOrigin, setOfferOrigin] = useState<BesignerDraftOrigin>('browser')
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
    setOfferOrigin('browser')
    // The shared draft answers late, and wins when it answers. `readKeyRef`
    // has already latched, so a slow reply cannot re-offer a draft the author
    // has meanwhile restored or discarded — the guard covers both reads.
    if (!firestore) return undefined
    let live = true
    void readServerDraft(firestore, currentIds)
      .then((server) => {
        if (!live || !server) return
        setOfferOrigin('shared')
        setOffer({
          nodes: server.nodes,
          baseStamp: server.baseStamp,
          // The shared draft stamps with `serverTimestamp`; the offer only
          // needs an age for the local store's expiry rules, which do not
          // apply to it. "Now" keeps it out of the aged-out branch.
          updatedAt: Date.now(),
        })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [key, loaded, firestore])

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
    // Discarding has to reach the SHARED draft too, or the next open — or the
    // next colleague to join — is offered the very thing just declined.
    if (firestore) void clearServerDraft(firestore, currentIds)
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

  /**
   * A peer's live change is on this canvas. Read OUTSIDE the memo below so
   * the observer that renders the prompt re-runs it when the first remote
   * change lands — a mobx read inside a `useMemo` whose deps never mention
   * it would keep serving the verdict from mount.
   */
  const canvasHasRemoteEdits = Aglyn.canvas.hasRemoteEdits
  const staleAgainstDocument = Boolean(
    offer && Aglyn.hasConcurrentWrite(offer.baseStamp, storedStamp),
  )
  /**
   * Restoring is a WHOLE-MAP replace, and in a shared session that is not a
   * private act (AGL-2486). Measured on the running editor: a peer created a
   * node, the other session pressed Restore, and the node was deleted on the
   * peer's own screen; with a stale draft the same click reverted a
   * colleague's SAVED work and survived the reload the conflict banner asks
   * for, with Save re-enabled and no warning left on screen.
   *
   * So the offer is withheld rather than merely re-worded. What the author
   * loses by that is small and the mirror mostly covers it: unsaved work in a
   * co-edited room is republished to whoever rejoins, which is how their own
   * changes are already back on the canvas before this prompt is even read.
   * What they would lose by the other choice is someone else's work.
   */
  const restoreBlockedBy: BesignerDraftRestoreBlock | null =
    staleAgainstDocument ? 'saved-since' : null

  /**
   * Whether this room is somebody else's too, i.e. whether the mirror
   * already has the work this prompt is about (AGL-2486).
   *
   * The recovery prompt exists for a CRASH, and a crash is the case where
   * nothing else survived. When something else demonstrably did — a third tab
   * opening onto a document two other tabs are editing unsaved — there is no
   * recovery to offer, and both buttons can only do harm to work that is
   * still in progress.
   *
   * TWO signals, OR'd, because they cover different halves of "the mirror
   * already has this" and neither implies the other:
   *
   * * **Presence membership.** Another session is in the room right now. It
   *   may not have published anything since this tab joined — a colleague
   *   who is reading rather than typing publishes nothing — but the mirror
   *   is live and their unsaved work is in it, so a whole-map replace from
   *   an older private snapshot would still be a replace of shared state.
   * * **Mirror-entry presence** (`canvas.hasRemoteEdits`). The mirror has
   *   already replayed another session's unsaved work ONTO this canvas.
   *   This is the half that catches the room whose other sessions have since
   *   closed: their work came back on join, and it is on screen now.
   *
   * Presence alone misses the second; `hasRemoteEdits` alone misses the
   * first, which is any tab that joins a live room before anyone in it types
   * again. Unknown (null) counts as shared until presence says otherwise —
   * the cost of waiting a second is a delayed offer, the cost of guessing
   * wrong is a Discard button over other people's work.
   *
   * What is NOT withheld: a person alone in the room after a browser quit
   * gets the full offer, Restore included. That case is the entire reason
   * the feature exists, and nothing here narrows it.
   */
  const roomIsShared =
    roomSessions === null || roomSessions > 0 || canvasHasRemoteEdits

  const restore = useCallback(() => {
    const draft = offer
    if (!draft) return
    // The action agrees with the offer. A component that renders Restore
    // without consulting `restoreBlockedBy` still cannot roll a colleague
    // back through this path.
    if (restoreBlockedBy || roomIsShared) return
    // `applyNodes` snapshots history first, so restoring is undoable and
    // leaves the canvas dirty. Dirty matters beyond the save button: it is
    // what keeps "Save the canvas before creating a version" firing, so a
    // restored draft can never be swept into a version snapshot.
    Aglyn.canvas.applyNodes(draft.nodes)
    setOffer(null)
  }, [offer, restoreBlockedBy, roomIsShared])

  const discard = useCallback(() => {
    const currentIds = idsRef.current
    setOffer(null)
    if (!currentIds) return
    clearBesignerDraft(currentIds)
    // Whichever store the offer came from. The shared draft is PREFERRED over
    // the local one when both exist, so declining an offer that clearing only
    // localStorage cannot reach leaves the author declining the same thing on
    // every reload, with no way to stop being asked. It is the same rule the
    // clean-canvas cleanup already follows.
    if (firestore) void clearServerDraft(firestore, currentIds)
  }, [firestore])

  return useMemo(() => {
    if (!key || !offer) return EMPTY_STATE
    // No prompt at all in a shared room — not a re-worded one. The draft is
    // deliberately LEFT ON DISK: nothing about the room makes this browser's
    // snapshot wrong, only unofferable, and reaping it here would take away
    // the crash net of the very tab that is still holding the work.
    if (roomIsShared) return EMPTY_STATE
    return {
      available: true,
      takenAt: offer.updatedAt ?? null,
      staleAgainstDocument,
      origin: offerOrigin,
      restoreBlockedBy,
      restore,
      discard,
    }
  }, [
    key,
    offer,
    offerOrigin,
    roomIsShared,
    staleAgainstDocument,
    restoreBlockedBy,
    restore,
    discard,
  ])
}

export default useBesignerDraft
