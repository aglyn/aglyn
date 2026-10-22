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

import { useFirestore, useUser } from '@aglyn/tenant-feature-instance/hooks/firebase/firebase-services'
import { arrayRemove, arrayUnion, doc, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  effectivePinnedOrgs,
  keepPinnedOrgs,
  PINNED_ORGS_FIELD,
  PINNED_ORGS_MAX,
  pinnedOrgsOverCap,
  pinOrg,
  readPinnedOrgs,
  replacePinnedOrg,
} from '@aglyn/aglyn/app-utils/console/workspace-list'
import useFirestoreDoc from '@aglyn/tenant-feature-instance/hooks/use-firestore-doc'

/** What a pin click did. `full` asks "Pinned is full. Replace one?". */
export type PinToggleOutcome = 'pinned' | 'unpinned' | 'full' | 'none'

export interface PinnedOrgs {
  /** The pins in force, at most five: the first five stored until the reader picks. */
  pinned: string[]
  /** Every id stored, possibly more than five for an account that pinned before the cap. */
  stored: string[]
  /** The reader pinned more than five before the cap and has not said which to keep. */
  overCap: boolean
  /** Five are pinned, so a sixth asks which to replace. */
  full: boolean
  /** The account document has answered, so `pinned` is the real set. */
  ready: boolean
  /** Pins a workspace, or unpins one that is pinned; a sixth answers `full` and writes nothing. */
  toggle: (orgId: string) => PinToggleOutcome
  /** Puts `orgId` where `replacing` was: the answer to "Replace one?". */
  replace: (replacing: string, orgId: string) => void
  /** Keeps only these (at most five): the answer to "Keep which 5?". */
  keep: (orgIds: readonly string[]) => void
}

/**
 * The workspaces the reader pinned (AGL-3762), kept on `users/{uid}` beside
 * the other console preferences a person keeps for themselves — the
 * dashboard arrangement, the media library's view — so a pin follows them to
 * every device, and to the native apps' workspace rail. Capped at five,
 * everywhere (Zach, 2026-10-18, AGL-3943): the rules refuse a write that
 * grows the list past five, and a list already longer may only shrink.
 *
 * Optimistic: the pin answers the click and the write follows. A pin or an
 * unpin adds or removes ONE id (`arrayUnion` / `arrayRemove`), so two tabs
 * pinning different workspaces never overwrite each other's list; a write
 * the rules refuse (the other tab took the fifth place) puts the stored list
 * back rather than showing a pin that never landed.
 *
 * `enabled` gates the read, so a surface that only sometimes shows the list
 * (the app bar's switcher) reads nothing until it opens.
 */
export function usePinnedOrgs(enabled = true): PinnedOrgs {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid
  const { data: profile, status } = useFirestoreDoc<Record<string, unknown>>(
    () => (uid && enabled ? doc(firestore, 'users', uid) : null),
    [firestore, uid, enabled],
  )
  // The reader's own clicks this session, ahead of the document's echo.
  const [local, setLocal] = useState<{ uid: string; stored: string[] } | null>(
    null,
  )
  const fromDoc = readPinnedOrgs(profile)
  const stored = local && local.uid === uid ? local.stored : fromDoc
  const pinned = effectivePinnedOrgs(stored)
  const ready = status === 'success' || status === 'error' || Boolean(local)

  const write = useCallback(
    (next: string[], value: unknown) => {
      if (!uid) return
      setLocal({ uid, stored: next })
      void setDoc(doc(firestore, 'users', uid), { [PINNED_ORGS_FIELD]: value }, {
        merge: true,
      }).catch((error) => {
        console.error(error)
        setLocal(null)
      })
    },
    [firestore, uid],
  )

  const toggle = useCallback(
    (orgId: string): PinToggleOutcome => {
      if (!uid || !orgId) return 'none'
      if (pinned.includes(orgId)) {
        write(
          stored.filter((id) => id !== orgId),
          arrayRemove(orgId),
        )
        return 'unpinned'
      }
      const result = pinOrg(pinned, orgId)
      if (result.outcome !== 'pinned') return result.outcome === 'full' ? 'full' : 'none'
      write([...stored, orgId], arrayUnion(orgId))
      return 'pinned'
    },
    [uid, pinned, stored, write],
  )

  const replace = useCallback(
    (replacing: string, orgId: string) => {
      const next = replacePinnedOrg(pinned, replacing, orgId)
      if (next.join() === pinned.join()) return
      write(next, next)
    },
    [pinned, write],
  )

  const keep = useCallback(
    (orgIds: readonly string[]) => {
      const next = keepPinnedOrgs(stored, orgIds)
      write(next, next)
    },
    [stored, write],
  )

  return {
    pinned,
    stored,
    overCap: pinnedOrgsOverCap(stored),
    full: pinned.length >= PINNED_ORGS_MAX,
    ready,
    toggle,
    replace,
    keep,
  }
}

export default usePinnedOrgs
