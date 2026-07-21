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
  FIREBASE_AUTH_EMULATOR_ENABLED,
  FIREBASE_DATABASE_EMULATOR_ENABLED,
} from '@aglyn/shared-data-enums'
import { useUser } from '@aglyn/tenant-feature-instance'
import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  getAuth,
  signInWithCustomToken,
  connectAuthEmulator,
} from 'firebase/auth'
import {
  connectDatabaseEmulator,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  remove,
  set,
} from 'firebase/database'
import { useEffect, useMemo, useState } from 'react'

/** One entry per editor currently in a document. */
export interface PresenceEntry {
  uid: string
  displayName: string
  photoURL?: string
  colour?: string
  selectedNodeId?: string
  lastSeenAt?: number
}

/**
 * Stable per-user colour. Deterministic so the same person is the same
 * colour for everyone in the room, without coordinating.
 */
const COLOURS = [
  '#e8710a',
  '#1a73e8',
  '#12b5cb',
  '#9334e6',
  '#d93025',
  '#188038',
]
function colourFor(uid: string): string {
  let hash = 0
  for (let index = 0; index < uid.length; index += 1) {
    hash = (hash * 31 + uid.charCodeAt(index)) >>> 0
  }
  return COLOURS[hash % COLOURS.length]
}

/** Secondary Firebase app holding the presence-scoped session. */
const PRESENCE_APP_NAME = 'AGLYN_PRESENCE'

/**
 * Who else is in this document (AGL-675).
 *
 * Presence rides a SEPARATE Firebase app instance. The scoped token from
 * `/api/presence/token` has to be exchanged with `signInWithCustomToken`,
 * which replaces whatever session its auth instance holds — doing that on
 * the main app would sign the user out of the console and into a token
 * that can do nothing but presence. A second named app keeps the two
 * sessions apart, the same way the app already registers its primary as
 * `DEFAULT_AGLYN` rather than `[DEFAULT]`.
 *
 * `onDisconnect` removes the entry server-side when the tab closes or the
 * laptop sleeps — the reason presence lives in RTDB rather than Firestore,
 * which has no equivalent and would need a heartbeat plus a reaper.
 *
 * Fails quiet: presence is a nicety, and an editor that will not open
 * because nobody could be listed is a far worse outcome than an empty
 * avatar stack.
 */
export function usePresence(options: {
  hostId: string | undefined
  docType: 'screen' | 'layout' | 'component' | 'template'
  docId: string | undefined
  /** Currently selected node, broadcast so others can see where you are. */
  selectedNodeId?: string
}): PresenceEntry[] {
  const { hostId, docType, docId, selectedNodeId } = options
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | undefined)?.uid
  const [entries, setEntries] = useState<PresenceEntry[]>([])
  const [session, setSession] = useState<{ orgId: string } | null>(null)

  // 1. Exchange the console session for a presence-scoped one.
  useEffect(() => {
    if (!hostId || !uid) return
    let active = true
    void (async () => {
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> } | undefined
        )?.getIdToken?.()
        if (!idToken) return
        const response = await fetch('/api/presence/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ hostId }),
        })
        if (!response.ok) return
        const { token, orgId } = await response.json()
        if (!active || !token) return

        const primary = getApp('DEFAULT_AGLYN')
        const presenceApp = getApps().some(
          (app) => app.name === PRESENCE_APP_NAME,
        )
          ? getApp(PRESENCE_APP_NAME)
          : initializeApp(primary.options, PRESENCE_APP_NAME)
        const auth = getAuth(presenceApp)
        if (FIREBASE_AUTH_EMULATOR_ENABLED) {
          try {
            connectAuthEmulator(auth, 'http://localhost:9099', {
              disableWarnings: true,
            })
          } catch {
            // Already connected on a previous mount.
          }
        }
        await signInWithCustomToken(auth, token)
        if (active) setSession({ orgId })
      } catch {
        // No presence rather than no editor.
      }
    })()
    return () => {
      active = false
    }
  }, [hostId, uid, user])

  // 2. Announce ourselves and watch the room.
  useEffect(() => {
    if (!session || !uid || !docId) return
    let database
    try {
      const presenceApp = getApp(PRESENCE_APP_NAME)
      database = getDatabase(presenceApp)
      if (FIREBASE_DATABASE_EMULATOR_ENABLED) {
        try {
          connectDatabaseEmulator(database, 'localhost', 9000)
        } catch {
          // Already connected.
        }
      }
    } catch {
      return
    }

    const roomPath = `presence/${session.orgId}/${docType}/${docId}`
    const meRef = ref(database, `${roomPath}/${uid}`)
    const displayName =
      (user as { displayName?: string; email?: string } | undefined)
        ?.displayName ??
      (user as { email?: string } | undefined)?.email ??
      'Someone'
    const photoURL = (user as { photoURL?: string } | undefined)?.photoURL

    void set(meRef, {
      displayName: String(displayName).slice(0, 80),
      lastSeenAt: Date.now(),
      colour: colourFor(uid),
      ...(photoURL ? { photoURL: String(photoURL).slice(0, 512) } : {}),
      ...(selectedNodeId ? { selectedNodeId } : {}),
    }).catch(() => undefined)
    // Server-side cleanup: a closed tab or a slept laptop leaves no ghost.
    void onDisconnect(meRef).remove().catch(() => undefined)

    const unsubscribe = onValue(
      ref(database, roomPath),
      (snapshot) => {
        const value = (snapshot.val() ?? {}) as Record<string, PresenceEntry>
        setEntries(
          Object.entries(value)
            .filter(([entryUid]) => entryUid !== uid)
            .map(([entryUid, entry]) => ({ ...entry, uid: entryUid })),
        )
      },
      () => setEntries([]),
    )

    return () => {
      unsubscribe()
      void remove(meRef).catch(() => undefined)
    }
  }, [session, uid, docType, docId, selectedNodeId, user])

  return useMemo(() => entries, [entries])
}

export default usePresence
