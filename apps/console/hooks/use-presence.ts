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
  createResourceUid,
  resolveIdpDisplayName,
  resolveIdpPhotoUrl,
} from '@aglyn/aglyn'
import {
  FIREBASE_AUTH_EMULATOR_ENABLED,
  FIREBASE_DATABASE_EMULATOR_ENABLED,
  FIREBASE_FIRESTORE_EMULATOR_ENABLED,
} from '@aglyn/shared-data-enums'
import { FIREBASE_CLIENT_APP_NAME } from '@aglyn/tenant-feature-instance'
import { RECAPTCHA_API_KEY } from '@aglyn/tenant-feature-instance'
import { useUser } from '@aglyn/tenant-feature-instance'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
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
  update,
} from 'firebase/database'
import { useEffect, useMemo, useRef, useState } from 'react'

/** One entry per editor currently in a document. */
export interface PresenceEntry {
  uid: string
  displayName: string
  photoURL?: string
  colour?: string
  selectedNodeId?: string
  lastSeenAt?: number
  /**
   * How many places this person has the document open. Usually 1; more than
   * that means they are in two tabs or two browsers, which is worth knowing
   * because nothing merges between them either.
   */
  sessions?: number
}

export interface PresenceState {
  /** Everyone except you, one entry per person however many tabs they have. */
  entries: PresenceEntry[]
  /**
   * How many OTHER places *you* have this document open — your other tabs,
   * or the same account signed in elsewhere (AGL-675).
   *
   * Worth surfacing rather than hiding: two tabs on one document are two
   * independent `CanvasManager`s, so the second save silently replaces the
   * first (the AGL-674 guard does not fire — the stamp moved because of
   * *you*), and they share one local draft key on last-writer-wins
   * (AGL-1256). The avatar stack alone would never show this, because your
   * own uid is filtered out of the room.
   */
  ownOtherSessions: number
}

/**
 * Identifies THIS tab, for the life of the page.
 *
 * Presence used to be keyed on uid alone, which made two tabs one entry:
 * whichever tab closed first removed it, so the tab still open vanished from
 * everyone else's room, and each tab overwrote the other's `selectedNodeId`.
 * The session id is nested *under* the uid so the `auth.uid === $uid` write
 * rule keeps its exact shape.
 *
 * Module scope, not a ref: navigating between documents in one tab should
 * stay one session, and a remount should not mint a second.
 */
const TAB_SESSION_ID =
  typeof window === 'undefined' ? 'ssr' : createResourceUid()

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

/** `initializeAppCheck` throws if it runs twice for one app. */
let presenceAppCheckStarted = false

/**
 * An SSO identity carries NO profile on the Firebase user object (AGL-675).
 *
 * A SAML user has `displayName: undefined`, `photoURL: undefined` and an
 * empty `providerData` — GCIP puts the assertion's mapped attributes under
 * `firebase.sign_in_attributes` and never promotes them to top-level claims.
 * So presence listed an SSO colleague by their email address while listing
 * everyone else by name, which is how Zach spotted it.
 *
 * The claims are already in hand: effect 1 fetches an ID token to call the
 * broker. Decoding it locally costs nothing and needs no round trip. Only
 * the payload is read — never verified here, and never trusted for
 * authorization; the broker still verifies the same token server-side before
 * it mints anything.
 */
export function readIdpProfile(idToken: string): {
  displayName: string
  photoURL: string
} {
  try {
    const [, payload] = idToken.split('.')
    if (!payload) return { displayName: '', photoURL: '' }
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json)
    return {
      displayName: resolveIdpDisplayName(claims),
      photoURL: resolveIdpPhotoUrl(claims),
    }
  } catch {
    return { displayName: '', photoURL: '' }
  }
}

/**
 * App Check is per Firebase APP, not per project.
 *
 * `initializeAppCheck` only ever ran on the primary app, so the presence app
 * — created here from the primary's options — sent no App Check token, and
 * enforcement rejected its very first call: `signInWithCustomToken` failed
 * with `auth/firebase-app-check-token-is-invalid` and presence never started.
 * The hook's own catch made that a single console warning, so the symptom
 * was just an empty avatar stack.
 *
 * The emulator e2e could never have caught it: App Check is skipped under
 * the emulators (there is no App Check emulator), which is exactly the
 * configuration the two-session harness runs in.
 */
function startPresenceAppCheck(app: FirebaseApp): void {
  if (presenceAppCheckStarted) return
  // Same skip as the primary app: with no App Check emulator, ReCaptcha
  // would hit the real backend and its 403s break emulator auth (AGL-216).
  if (FIREBASE_AUTH_EMULATOR_ENABLED || FIREBASE_FIRESTORE_EMULATOR_ENABLED) {
    presenceAppCheckStarted = true
    return
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_API_KEY),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (error) {
    console.warn('[presence] app check did not start', error)
  }
  presenceAppCheckStarted = true
}

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
}): PresenceState {
  const { hostId, docType, docId, selectedNodeId } = options
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | undefined)?.uid
  // `user` is a NEW OBJECT on every render, so depending on it re-runs
  // these effects forever: effect 1 re-minted a token each pass, and
  // effect 2's cleanup removed the presence entry immediately after
  // writing it — presence wrote and un-wrote itself in a loop, which is
  // why the room looked empty with no error anywhere. Depend on
  // primitives only.
  const [idp, setIdp] = useState<{ displayName: string; photoURL: string }>({
    displayName: '',
    photoURL: '',
  })
  // An SSO user has none of these on the user object, so the IdP claims are
  // the fallback rather than the email address — see `readIdpProfile`.
  const displayName = String(
    (user as { displayName?: string } | undefined)?.displayName ||
      idp.displayName ||
      (user as { email?: string } | undefined)?.email ||
      'Someone',
  ).slice(0, 80)
  const photoURL =
    (user as { photoURL?: string } | undefined)?.photoURL || idp.photoURL
  // The token getter is called inside an effect that must NOT depend on
  // the user object; a ref keeps the latest without re-triggering.
  const getIdTokenRef = useRef<(() => Promise<string>) | undefined>(undefined)
  getIdTokenRef.current = (
    user as { getIdToken?: () => Promise<string> } | undefined
  )?.getIdToken?.bind(user)
  const [entries, setEntries] = useState<PresenceEntry[]>([])
  const [ownOtherSessions, setOwnOtherSessions] = useState(0)
  const [session, setSession] = useState<{ orgId: string } | null>(null)
  /** Latest selection, read by the announce effect without depending on it. */
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId
  /** This tab's node while it is announced; null between rooms. */
  const meRefHolder = useRef<ReturnType<typeof ref> | null>(null)

  // 1. Exchange the console session for a presence-scoped one.
  useEffect(() => {
    if (!hostId || !uid) return
    let active = true
    void (async () => {
      try {
        const idToken = await getIdTokenRef.current?.()
        if (!idToken) return
        const profile = readIdpProfile(idToken)
        if (active && (profile.displayName || profile.photoURL)) {
          setIdp(profile)
        }
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

        // The shared constant, not a literal: the primary app is
        // registered under a non-default name and a stale copy of it here
        // would fail silently.
        const primary = getApp(FIREBASE_CLIENT_APP_NAME)
        const presenceApp = getApps().some(
          (app) => app.name === PRESENCE_APP_NAME,
        )
          ? getApp(PRESENCE_APP_NAME)
          : initializeApp(primary.options, PRESENCE_APP_NAME)
        // BEFORE the first authenticated call on this app, not after — the
        // sign-in below is itself App Check enforced.
        startPresenceAppCheck(presenceApp)
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
      } catch (error) {
        // Quiet for the USER — an editor that will not open because nobody
        // could be listed is far worse than an empty avatar stack. Not
        // quiet for developers: swallowing this entirely made a broken
        // presence session indistinguishable from an empty room, which
        // cost real time to diagnose.
        console.warn('[presence] could not start a session', error)
      }
    })()
    return () => {
      active = false
    }
  }, [hostId, uid])

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
    } catch (error) {
      console.warn('[presence] no database handle', error)
      return
    }

    const roomPath = `presence/${session.orgId}/${docType}/${docId}`
    // One node per TAB, nested under the uid so the write rule is unchanged.
    const meRef = ref(database, `${roomPath}/${uid}/${TAB_SESSION_ID}`)

    void set(meRef, {
      displayName,
      lastSeenAt: Date.now(),
      colour: colourFor(uid),
      ...(photoURL ? { photoURL: String(photoURL).slice(0, 512) } : {}),
      ...(selectedNodeIdRef.current
        ? { selectedNodeId: selectedNodeIdRef.current }
        : {}),
    }).catch((error) => console.warn('[presence] could not announce', error))
    // Server-side cleanup: a closed tab or a slept laptop leaves no ghost.
    // Scoped to this tab's node, so one tab closing no longer evicts the
    // other tabs of the same person.
    void onDisconnect(meRef).remove().catch(() => undefined)

    const unsubscribe = onValue(
      ref(database, roomPath),
      (snapshot) => {
        const room = (snapshot.val() ?? {}) as Record<
          string,
          Record<string, PresenceEntry>
        >
        const others: PresenceEntry[] = []
        let mine = 0
        for (const [entryUid, sessions] of Object.entries(room)) {
          // Tolerate the pre-session shape: an entry written by an older
          // client sits directly under the uid rather than under a session.
          const list = isSessionMap(sessions)
            ? Object.entries(sessions)
            : ([['legacy', sessions as unknown as PresenceEntry]] as const)
          if (entryUid === uid) {
            mine += list.filter(([id]) => id !== TAB_SESSION_ID).length
            continue
          }
          // One avatar per PERSON however many tabs they have; the freshest
          // session speaks for them, since that is where they are looking.
          const freshest = list.reduce((best, [, entry]) =>
            (entry?.lastSeenAt ?? 0) > (best?.lastSeenAt ?? 0) ? entry : best,
          list[0]?.[1] as PresenceEntry)
          if (freshest) {
            others.push({ ...freshest, uid: entryUid, sessions: list.length })
          }
        }
        setEntries(others)
        setOwnOtherSessions(mine)
      },
      (error) => {
        console.warn('[presence] lost the room', error)
        setEntries([])
        setOwnOtherSessions(0)
      },
    )

    meRefHolder.current = meRef
    return () => {
      meRefHolder.current = null
      unsubscribe()
      void remove(meRef).catch(() => undefined)
    }
    // `selectedNodeId` is deliberately NOT a dependency: it changes on every
    // click, and tearing the room down to re-announce would unsubscribe,
    // delete and rewrite this tab's entry each time. The effect below pushes
    // it as a field update instead.
  }, [session, uid, docType, docId, displayName, photoURL])

  // 3. Broadcast where we are looking, without disturbing the subscription.
  useEffect(() => {
    const meRef = meRefHolder.current
    if (!meRef) return
    void update(meRef, {
      lastSeenAt: Date.now(),
      // RTDB has no "delete this field" in an update object; null is it.
      selectedNodeId: selectedNodeId ?? null,
    }).catch(() => undefined)
  }, [selectedNodeId])

  return useMemo(
    () => ({ entries, ownOtherSessions }),
    [entries, ownOtherSessions],
  )
}

/**
 * Distinguishes `{sessionId: entry}` from a bare pre-session `entry`.
 *
 * A presence entry always carries `displayName`; a map of sessions never
 * does at its own level.
 */
function isSessionMap(
  value: Record<string, PresenceEntry> | PresenceEntry,
): value is Record<string, PresenceEntry> {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PresenceEntry).displayName !== 'string'
  )
}

export default usePresence
