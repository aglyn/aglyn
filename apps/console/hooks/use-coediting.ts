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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import {
  get,
  onChildAdded,
  onChildChanged,
  onValue,
  ref,
  update,
} from 'firebase/database'
import { autorun, runInAction } from 'mobx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TAB_SESSION_ID, type PresenceSession } from './use-presence'

/**
 * Live co-editing (AGL-677).
 *
 * ## Why this shape
 *
 * AGL-677 lists three constraints. This is the design that satisfies all
 * three without a storage migration, and the reasoning matters because the
 * obvious alternatives each fail one of them:
 *
 * **Firestore stays the durable store; RTDB carries only the live delta.**
 * The node map is one msgpack blob, so Firestore cannot merge two writers —
 * but it does not have to. Saving is unchanged (whole map, guarded by
 * AGL-674). RTDB holds a *mirror of unsaved changes only*, per node, and a
 * save clears it. Nothing about the at-rest shape changes, so there is no
 * migration and no compatibility path to maintain.
 *
 * **The unit is a node, not a document and not an operation.** Measured on
 * the real corpus (AGL-677 comment): a whole document is ~46 KB for a real
 * page against ~238 bytes for one node, so broadcasting the document per
 * edit is ~200× the traffic and obviously wrong. Per-node also means two
 * people editing *different* nodes both keep their work — only same-node
 * edits are last-writer-wins.
 *
 * **Diffing, not instrumenting `CanvasManager`.** An op log would be
 * smaller still, but half the editor mutates nodes by direct assignment
 * (`node.props.children = …`) rather than through a `CanvasManager` action,
 * so an action-level emitter would silently miss the properties panel — the
 * single most common edit. A mobx `autorun` over the serialized map sees
 * every change however it was made.
 *
 * **Remote changes never touch local undo.** `HistoryManager` snapshots the
 * whole document, so pushing a remote edit onto `past` would let a local
 * undo erase a colleague's work (constraint 3). Applying goes through
 * `setNodes(partial, merge)`, which does not call `saveHistory`. Undo
 * therefore stays local-only and honest: it rewinds *your* edits and leaves
 * theirs alone. Operation-based collaborative undo is still future work,
 * but nothing here makes it worse.
 */

/** How long to coalesce local edits before publishing them. */
export const COEDIT_PUBLISH_MS = 120

/** One node's entry in the live mirror. */
export interface MirrorEntry {
  by?: string
  at?: number
  json?: string
  deleted?: boolean
}

export interface CoEditingState {
  /** True once the live channel is subscribed. */
  live: boolean
  /** How many remote node changes have been applied this session. */
  appliedCount: number
  /**
   * Drop the mirror of unsaved work. Called after a successful save, which
   * makes Firestore authoritative again — leaving it would replay
   * already-saved edits to whoever joins next.
   */
  clearMirror: () => void
}

function serializeNodes(): Record<string, unknown> {
  return Aglyn.canvas.toJSON().nodes as Record<string, unknown>
}

/**
 * What a node looked like when the current batch of remote entries started
 * to land. Recorded before each apply so the reconcile can tell what THIS
 * batch broke from what was already broken (AGL-1363).
 */
interface PriorNodeState {
  /** It was in the node map. */
  existed: boolean
  /** Its `parentId` then. */
  parentId?: string
  /** Its position in that parent's child list, or -1 when unlisted. */
  index: number
  /** That parent was itself in the map. */
  parentExisted: boolean
  /** Its own child list then — the ids a list replacement can strand. */
  children: string[]
}

/** The open batch: node id → its state before the batch touched it. */
const batch = new Map<string, PriorNodeState>()
let flushScheduled = false

function recordPrior(nodeId: string): void {
  // First touch wins: that is the state the whole batch is judged against.
  if (batch.has(nodeId)) return
  const node = Aglyn.canvas.nodes.get(nodeId)
  const parent = node?.parentId
    ? Aglyn.canvas.nodes.get(node.parentId)
    : undefined
  batch.set(nodeId, {
    existed: Boolean(node),
    parentId: node?.parentId,
    index: parent?.nodes?.indexOf(nodeId) ?? -1,
    parentExisted: Boolean(parent),
    children: [...(node?.nodes ?? [])],
  })
}

/**
 * Reconciles the batch of remote entries applied since the last flush, so a
 * peer's update cannot leave a node in the map that the tree does not reach
 * (AGL-1363).
 *
 * ## Why a batch, and not each node as it lands
 *
 * A peer publishes one multi-path `update()` — the node AND its parent's new
 * child list AND every tombstone — and RTDB raises those as separate child
 * events off the one server message. Judging any of them alone fights a
 * change that is about to arrive: a per-node reconcile would re-link every
 * child of a section being deleted, in the gap before that child's own
 * tombstone applied. Reconciling once, after the burst, sees the peer's
 * intent whole. Callers get this for free — `applyRemoteNode` schedules the
 * flush on a microtask, which lands after the synchronous run of events.
 *
 * ## What it repairs, and what it deliberately does not
 *
 * Only what THIS batch broke, judged against the state recorded before each
 * apply. A node that was already unreachable stays exactly where it is: the
 * `/product` screen carries 61 such nodes, and re-homing those onto the root
 * the moment two people co-edit would rewrite a live page nobody touched.
 *
 * Nothing here deletes content. A subtree stranded by a delete whose
 * per-child tombstones did not all arrive is re-homed onto the nearest
 * surviving ancestor, at the position the deleted parent held — visible,
 * and an author's call. That is the same reasoning that rules out a prune in
 * `serializeNodes`: those 26 orphaned Hero nodes on `/product` held the only
 * copy of their text, and anything silently destructive would have taken it.
 *
 * The repair is a plain child-list edit rather than `canvas.reparentNode`,
 * because that one calls `saveHistory` — a remote change must never enter
 * the local undo stack (AGL-677 rule 1).
 *
 * @returns the ids it had to repair; empty when the batch was consistent.
 */
export function flushRemoteReconcile(): string[] {
  flushScheduled = false
  if (!batch.size) return []
  const prior = new Map(batch)
  batch.clear()

  const canvas = Aglyn.canvas
  // Children of a node whose list this batch replaced are candidates too —
  // they are how "the parent's update landed, the child's did not" strands a
  // node. Untouched by the batch themselves, so their state now is their
  // state then; anything the batch DID touch keeps its own record.
  for (const [id, was] of [...prior]) {
    was.children.forEach((childId, at) => {
      if (prior.has(childId)) return
      prior.set(childId, {
        existed: canvas.nodes.has(childId),
        parentId: id,
        index: at,
        parentExisted: true,
        children: [],
      })
    })
  }

  /** The closest ancestor of a deleted parent that is still in the map. */
  const survivingAncestor = (startId?: string) => {
    const seen = new Set<string>()
    let cursor = startId
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const live = canvas.nodes.get(cursor)
      if (live) return live
      cursor = prior.get(cursor)?.parentId
    }
    return canvas.nodes.get(Aglyn.NODE_ROOT_ID)
  }

  const repaired: string[] = []
  /** Where the next orphan of a given vanished parent goes, so siblings keep order. */
  const rehomeCursor = new Map<string, number>()

  runInAction(() => {
    for (const [id, was] of prior) {
      if (id === Aglyn.NODE_ROOT_ID) continue
      const node = canvas.nodes.get(id)

      // Deleted by this batch: drop the reference its parent still holds, or
      // the saved document ships a child id that resolves to nothing.
      if (!node) {
        if (!was.existed || !was.parentId) continue
        const parent = canvas.nodes.get(was.parentId)
        const at = parent?.nodes?.indexOf(id) ?? -1
        if (at < 0) continue
        parent.nodes.splice(at, 1)
        repaired.push(id)
        continue
      }

      const parent = node.parentId
        ? canvas.nodes.get(node.parentId)
        : undefined

      // Reachable through its parent: nothing to do.
      if (parent?.nodes?.includes(id)) continue

      if (parent) {
        // Its parent is here and does not list it. Leave it alone if it was
        // already like that before the batch — not ours to move.
        if (
          was.existed &&
          was.parentExisted &&
          was.parentId === node.parentId &&
          was.index < 0
        ) {
          continue
        }
        if (!parent.nodes) parent.nodes = []
        const at =
          was.parentId === node.parentId && was.index > -1
            ? Math.min(was.index, parent.nodes.length)
            : parent.nodes.length
        parent.nodes.splice(at, 0, id)
        repaired.push(id)
        continue
      }

      // Its parent is not in the map. Only act when THIS batch removed it —
      // a parentId that never resolved locally is either a pre-existing
      // orphan or a node whose parent is still in flight, and re-homing
      // either would list the node twice once the parent shows up.
      const goneId = node.parentId
      const vanished = goneId ? prior.get(goneId) : undefined
      if (!vanished?.existed) continue
      const host = survivingAncestor(goneId)
      if (!host || host.$id === id) continue
      if (!host.nodes) host.nodes = []
      // Siblings of one vanished parent land consecutively, in their old
      // order, where that parent used to sit.
      const base =
        rehomeCursor.get(goneId) ??
        (vanished.parentId === host.$id && vanished.index > -1
          ? vanished.index
          : host.nodes.length)
      const at = Math.min(base, host.nodes.length)
      node.parentId = host.$id
      host.nodes.splice(at, 0, id)
      rehomeCursor.set(goneId, at + 1)
      repaired.push(id)
    }
  })

  return repaired
}

/**
 * Applies one remote node into the canvas without disturbing local history.
 *
 * `setNodes(map, merge = true)` merges rather than replaces and is a mobx
 * action, so the canvas re-renders once; crucially it does NOT call
 * `saveHistory`, which is what keeps a remote edit out of the local undo
 * stack.
 *
 * It also does not touch the parent's child list, and the raw delete below
 * does not touch the children — so each apply is scheduled for the batch
 * reconcile in {@link flushRemoteReconcile}, which is what stops a lost
 * companion entry from stranding a node in the map forever (AGL-1363).
 *
 * Exported for its spec: the AGL-677 rules it encodes (no history entry, no
 * `deleteNode` recursion) are asserted against the REAL canvas there.
 */
export function applyRemoteNode(nodeId: string, entry: MirrorEntry): boolean {
  if (entry.deleted) {
    // A raw map delete, NOT `canvas.deleteNode` — that one recurses into the
    // whole subtree and saves history. The peer already told us about every
    // node it removed, individually.
    return runInAction(() => {
      if (!Aglyn.canvas.nodes.has(nodeId)) return false
      recordPrior(nodeId)
      Aglyn.canvas.nodes.delete(nodeId)
      scheduleRemoteReconcile()
      return true
    })
  }
  if (!entry.json) return false
  try {
    const node = JSON.parse(entry.json)
    recordPrior(nodeId)
    Aglyn.canvas.setNodes({ [nodeId]: node } as never, true)
    scheduleRemoteReconcile()
    return true
  } catch {
    return false
  }
}

function scheduleRemoteReconcile(): void {
  if (flushScheduled) return
  flushScheduled = true
  // A microtask, so it runs after the synchronous burst of child events one
  // peer `update()` raises — see {@link flushRemoteReconcile}.
  queueMicrotask(() => flushRemoteReconcile())
}

export function useCoEditing(options: {
  session: PresenceSession | null
  docType: 'screen' | 'layout' | 'component' | 'template' | 'email'
  docId: string | undefined
  versionId: string | undefined
  /**
   * The stored document's stamp. Mirror entries older than the last save are
   * ignored on join: the save already folded them into Firestore, and the
   * canvas has just loaded that. Only genuinely-unsaved work is replayed.
   */
  storedStamp?: unknown
  /** Canvas has the stored document in it; nothing publishes before this. */
  loaded: boolean
  enabled?: boolean
}): CoEditingState {
  const {
    session,
    docType,
    docId,
    versionId,
    storedStamp,
    loaded,
    enabled = true,
  } = options

  const [live, setLive] = useState(false)
  const [appliedCount, setAppliedCount] = useState(0)

  /**
   * Last published serialization per node. The diff is against this rather
   * than against the canvas's `_initial`, because `_initial` only moves on
   * save — we need "what have my peers already been told".
   */
  const shadowRef = useRef<Map<string, string>>(new Map())
  /** Set while applying a remote change, so it is not published straight back. */
  const applyingRef = useRef(false)
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const roomPath =
    session && docId
      ? `coedit/${session.orgId}/${session.hostId}/${docType}/${docId}/` +
        `${versionId ?? 'current'}/nodes`
      : null

  const canWrite = Boolean(session?.canEdit) && enabled

  const publish = useCallback(() => {
    if (!roomPath || !session || !canWrite) return
    if (applyingRef.current) return
    const current = serializeNodes()
    const shadow = shadowRef.current
    const payload: Record<string, MirrorEntry> = {}
    const now = Date.now()

    for (const [nodeId, node] of Object.entries(current)) {
      const json = JSON.stringify(node)
      if (shadow.get(nodeId) === json) continue
      shadow.set(nodeId, json)
      payload[nodeId] = { by: TAB_SESSION_ID, at: now, json }
    }
    for (const nodeId of [...shadow.keys()]) {
      if (nodeId in current) continue
      shadow.delete(nodeId)
      payload[nodeId] = { by: TAB_SESSION_ID, at: now, deleted: true }
    }
    if (!Object.keys(payload).length) return

    void update(ref(session.database, roomPath), payload).catch((error) =>
      console.warn('[coedit] could not publish', error),
    )
  }, [roomPath, session, canWrite])

  const schedulePublish = useCallback(() => {
    if (publishTimerRef.current) clearTimeout(publishTimerRef.current)
    publishTimerRef.current = setTimeout(() => {
      publishTimerRef.current = null
      publish()
    }, COEDIT_PUBLISH_MS)
  }, [publish])

  // Seed the shadow from the loaded document, so joining does not republish
  // the whole thing as if it were all new work.
  useEffect(() => {
    if (!loaded || !roomPath) return
    const shadow = new Map<string, string>()
    for (const [nodeId, node] of Object.entries(serializeNodes())) {
      shadow.set(nodeId, JSON.stringify(node))
    }
    shadowRef.current = shadow
  }, [loaded, roomPath])

  // Subscribe. `onChildAdded` + `onChildChanged` deliver one node at a time;
  // `onValue` on the room would resend every node on every keystroke by
  // anyone, which is the whole-document cost this design exists to avoid.
  useEffect(() => {
    if (!roomPath || !session || !loaded || !enabled) return undefined
    const roomRef = ref(session.database, roomPath)
    const floor = Aglyn.versionStamp(storedStamp)
    const floorMillis = floor?.startsWith('ms:')
      ? Number(floor.slice(3))
      : 0

    const handle = (nodeId: string | null, value: MirrorEntry | null) => {
      if (!nodeId || !value) return
      // Our own echo.
      if (value.by === TAB_SESSION_ID) return
      // Already folded into the document we loaded.
      if ((value.at ?? 0) < floorMillis) return
      applyingRef.current = true
      try {
        if (applyRemoteNode(nodeId, value)) {
          // Keep the shadow in step, or the next local diff would publish
          // their change back to them as if it were ours.
          const node = Aglyn.canvas.nodes.get(nodeId)
          if (value.deleted) shadowRef.current.delete(nodeId)
          else if (node) {
            shadowRef.current.set(nodeId, JSON.stringify(node.toJSON()))
          }
          setAppliedCount((count) => count + 1)
        }
      } finally {
        applyingRef.current = false
      }
    }

    const offAdded = onChildAdded(roomRef, (snapshot) =>
      handle(snapshot.key, snapshot.val()),
    )
    const offChanged = onChildChanged(roomRef, (snapshot) =>
      handle(snapshot.key, snapshot.val()),
    )
    const offValue = onValue(
      roomRef,
      () => setLive(true),
      (error) => {
        console.warn('[coedit] lost the channel', error)
        setLive(false)
      },
    )
    return () => {
      offAdded()
      offChanged()
      offValue()
      // Settle the open batch against the canvas it came from — the room is
      // keyed by document, so leaving it pending would let the repair run
      // against whatever is loaded next (AGL-1363).
      flushRemoteReconcile()
      setLive(false)
    }
  }, [roomPath, session, loaded, enabled, storedStamp])

  // Publish local edits. Same `autorun`-over-`toJSON` tracking as the draft
  // snapshotter: it sees direct property assignment, which an action-level
  // hook would not.
  useEffect(() => {
    if (!roomPath || !loaded || !canWrite) return undefined
    return autorun(() => {
      Aglyn.canvas.toJSON()
      if (applyingRef.current) return
      schedulePublish()
    })
  }, [roomPath, loaded, canWrite, schedulePublish])

  // A save makes Firestore authoritative again, so the mirror of unsaved
  // work is not just stale — leaving it would replay already-saved edits to
  // the next person who joins.
  const clearMirror = useCallback(() => {
    if (!roomPath || !session || !canWrite) return
    // Per NODE, not the room. The database rules grant `.write` at
    // `…/nodes/$nodeId` and nothing above it, so `remove()` on the room was
    // refused every time — measured on production 2026-08-05, every room on
    // the marketing host still held entries from saves hours earlier
    // (AGL-1262). A multi-path update of nulls deletes the same children
    // through the path the rules actually allow.
    const roomRef = ref(session.database, roomPath)
    void get(roomRef)
      .then((snapshot) => {
        const value = snapshot.val() as Record<string, unknown> | null
        const ids = value ? Object.keys(value) : []
        if (!ids.length) return undefined
        return update(
          roomRef,
          Object.fromEntries(ids.map((id) => [id, null])),
        )
      })
      .catch((error) => console.warn('[coedit] could not clear', error))
  }, [roomPath, session, canWrite])

  useEffect(() => {
    return () => {
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current)
    }
  }, [])

  return useMemo(
    () => ({ live, appliedCount, clearMirror }),
    [live, appliedCount, clearMirror],
  )
}

export default useCoEditing
