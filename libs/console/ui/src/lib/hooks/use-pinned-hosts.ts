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

import {
  PINNED_HOSTS_FIELD,
  PINNED_HOSTS_PER_WORKSPACE,
  pinHost,
  readPinnedHosts,
  replacePinnedHost,
  unpinHost,
  workspacePinnedHosts,
  type PinnedHost,
} from '@aglyn/aglyn/app-utils/account-preferences'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance/hooks/firebase/firebase-services'
import { arrayRemove, arrayUnion, doc, setDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import useFirestoreDoc from '@aglyn/tenant-feature-instance/hooks/use-firestore-doc'
import type { PinToggleOutcome } from './use-pinned-orgs'

export interface PinnedHosts {
  /** The workspace's pinned site ids, in the order pinned, at most five. */
  pinned: string[]
  /** Five are pinned in this workspace, so a sixth asks which to replace. */
  full: boolean
  /** The account document has answered, so `pinned` is the real set. */
  ready: boolean
  /** Pins a site, or unpins one that is pinned; a sixth answers `full` and writes nothing. */
  toggle: (hostId: string) => PinToggleOutcome
  /** Puts `hostId` where `replacing` was: the answer to "Replace one?". */
  replace: (replacing: string, hostId: string) => void
}

/**
 * The sites the reader pinned in one workspace (AGL-4005), kept on `users/{uid}` as
 * `pinnedHosts` beside the workspaces they pinned (`usePinnedOrgs`), so a
 * pin follows them to every device. Five a workspace, like workspace pins;
 * the rules bound the whole list (see `PINNED_HOSTS_MAX`).
 *
 * Optimistic, the way workspace pins are: the pin answers the click and the
 * write follows. A pin or an unpin adds or removes ONE entry (`arrayUnion` /
 * `arrayRemove`), so two tabs pinning different sites never overwrite each
 * other's list; a write the rules refuse puts the stored list back.
 *
 * `enabled` gates the read, so a surface that only sometimes shows the list
 * (the app bar's site switcher) reads nothing until it opens.
 */
export function usePinnedHosts(
  orgId: string | null | undefined,
  enabled = true,
): PinnedHosts {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid
  const { data: profile, status } = useFirestoreDoc<Record<string, unknown>>(
    () => (uid && enabled ? doc(firestore, 'users', uid) : null),
    [firestore, uid, enabled],
  )
  // The reader's own clicks this session, ahead of the document's echo.
  const [local, setLocal] = useState<{ uid: string; stored: PinnedHost[] } | null>(
    null,
  )
  const stored = useMemo(
    () => (local && local.uid === uid ? local.stored : readPinnedHosts(profile)),
    [local, uid, profile],
  )
  const pinned = useMemo(
    () => (orgId ? workspacePinnedHosts(stored, orgId) : []),
    [stored, orgId],
  )
  const ready = status === 'success' || status === 'error' || Boolean(local)

  const write = useCallback(
    (next: PinnedHost[], value: unknown) => {
      if (!uid) return
      setLocal({ uid, stored: next })
      void setDoc(doc(firestore, 'users', uid), { [PINNED_HOSTS_FIELD]: value }, {
        merge: true,
      }).catch((error) => {
        console.error(error)
        setLocal(null)
      })
    },
    [firestore, uid],
  )

  const toggle = useCallback(
    (hostId: string): PinToggleOutcome => {
      if (!uid || !orgId || !hostId) return 'none'
      if (pinned.includes(hostId)) {
        write(
          unpinHost(stored, hostId),
          arrayRemove(...stored.filter((entry) => entry.hostId === hostId)),
        )
        return 'unpinned'
      }
      const result = pinHost(stored, { orgId, hostId })
      if (result.outcome !== 'pinned') return result.outcome === 'full' ? 'full' : 'none'
      // One entry added is one `arrayUnion`; anything else (a site that moved
      // workspace, the account-wide bound making room) writes the list.
      const appended = result.pinnedHosts.length === stored.length + 1
      write(
        result.pinnedHosts,
        appended ? arrayUnion({ orgId, hostId }) : result.pinnedHosts,
      )
      return 'pinned'
    },
    [uid, orgId, pinned, stored, write],
  )

  const replace = useCallback(
    (replacing: string, hostId: string) => {
      if (!orgId) return
      const next = replacePinnedHost(stored, replacing, { orgId, hostId })
      if (JSON.stringify(next) === JSON.stringify(stored)) return
      write(next, next)
    },
    [orgId, stored, write],
  )

  return {
    pinned,
    full: pinned.length >= PINNED_HOSTS_PER_WORKSPACE,
    ready,
    toggle,
    replace,
  }
}

export default usePinnedHosts
