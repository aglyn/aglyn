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
  onChildAdded,
  onChildChanged,
  onValue,
  ref,
  remove,
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
interface MirrorEntry {
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
 * Applies one remote node into the canvas without disturbing local history.
 *
 * `setNodes(map, merge = true)` merges rather than replaces and is a mobx
 * action, so the canvas re-renders once; crucially it does NOT call
 * `saveHistory`, which is what keeps a remote edit out of the local undo
 * stack.
 */
function applyRemoteNode(nodeId: string, entry: MirrorEntry): boolean {
  if (entry.deleted) {
    // A raw map delete, NOT `canvas.deleteNode` — that one recurses into the
    // whole subtree and saves history. The peer already told us about every
    // node it removed, individually.
    return runInAction(() => {
      if (!Aglyn.canvas.nodes.has(nodeId)) return false
      Aglyn.canvas.nodes.delete(nodeId)
      return true
    })
  }
  if (!entry.json) return false
  try {
    const node = JSON.parse(entry.json)
    Aglyn.canvas.setNodes({ [nodeId]: node } as never, true)
    return true
  } catch {
    return false
  }
}

export function useCoEditing(options: {
  session: PresenceSession | null
  docType: 'screen' | 'layout' | 'component' | 'template'
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
    void remove(ref(session.database, roomPath)).catch(() => undefined)
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
