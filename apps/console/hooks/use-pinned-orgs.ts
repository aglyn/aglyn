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

import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { arrayRemove, arrayUnion, doc, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  PINNED_ORGS_FIELD,
  readPinnedOrgs,
  togglePinnedOrg,
} from '../utils/workspace-list'
import useFirestoreDoc from './use-firestore-doc'

export interface PinnedOrgs {
  /** The ids the reader pinned (possibly including orgs they have left). */
  pinned: string[]
  /** The account document has answered, so `pinned` is the real set. */
  ready: boolean
  /** Pins a workspace, or unpins one that is pinned. */
  toggle: (orgId: string) => void
}

/**
 * The workspaces the reader pinned (AGL-3762), kept on `users/{uid}` beside
 * the other console preferences a person keeps for themselves — the
 * dashboard arrangement, the media library's view — so a pin follows them to
 * every device. The rules let the account's owner, and nobody else, write
 * that document.
 *
 * Optimistic: the pin answers the click and the write follows. Each write
 * adds or removes ONE id (`arrayUnion` / `arrayRemove`), so two tabs pinning
 * different workspaces never overwrite each other's list.
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
  const [local, setLocal] = useState<{ uid: string; pinned: string[] } | null>(
    null,
  )
  const stored = readPinnedOrgs(profile)
  const pinned = local && local.uid === uid ? local.pinned : stored
  const ready = status === 'success' || status === 'error' || Boolean(local)

  const toggle = useCallback(
    (orgId: string) => {
      if (!uid || !orgId) return
      const pinning = !pinned.includes(orgId)
      setLocal({ uid, pinned: togglePinnedOrg(pinned, orgId) })
      void setDoc(
        doc(firestore, 'users', uid),
        {
          [PINNED_ORGS_FIELD]: pinning
            ? arrayUnion(orgId)
            : arrayRemove(orgId),
        },
        { merge: true },
      ).catch(console.error)
    },
    [firestore, uid, pinned],
  )

  return { pinned, ready, toggle }
}

export default usePinnedOrgs
