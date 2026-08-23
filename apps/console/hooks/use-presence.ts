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
import {
  APP_CHECK_KEY_MISSING_MESSAGE,
  appCheckSiteKey,
} from '@aglyn/tenant-feature-instance'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  createAuthInstance,
  useAuthPersistence,
} from '@aglyn/tenant-feature-instance'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { connectAuthEmulator } from 'firebase/auth'
import { signInWithPooledCustomToken } from '../utils/pooled-custom-token'
import {
  type Database,
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

/**
 * One entry per editing SESSION currently in a document.
 *
 * A session, not a person (AGL-2486). Zach's call: "we should see co-editing
 * regardless anyways if we are in the same account or not". A cursor and a
 * selection belong to a tab, so collapsing two tabs into one entry threw away
 * exactly the thing the overlays draw — and it made your own second window
 * invisible, which is the case that loses work most often.
 *
 * `people` on `PresenceState` is the collapsed view, for the avatar stack.
 */
export interface PresenceEntry {
  uid: string
  /** The peer's tab id — the `$sessionId` half of the presence key. */
  sessionId: string
  /** Stable across renders and unique in the room: `uid:sessionId`. */
  key: string
  /**
   * This is YOU, in another tab or another window of the same account.
   *
   * Kept as a flag rather than filtered out, so the UI can say "you,
   * elsewhere" instead of showing a stranger — a second person and your own
   * other tab must never be indistinguishable.
   */
  isSelf?: boolean
  displayName: string
  photoURL?: string
  colour?: string
  selectedNodeId?: string
  lastSeenAt?: number
  /** Pointer position, normalised 0..1 against the canvas root's box. */
  cursorX?: number
  cursorY?: number
  /**
   * How many places this person has the document open. Usually 1; more than
   * that means they are in two tabs or two browsers, which is worth knowing
   * because nothing merges between them either.
   */
  sessions?: number
}

/** One row per PERSON in the avatar stack, however many tabs they have. */
export interface PresencePerson {
  uid: string
  displayName: string
  photoURL?: string
  colour?: string
  /** How many sessions this person has here — their tabs, or yours. */
  sessions: number
  /** True when the person is you, signed in somewhere else. */
  isSelf?: boolean
}

/**
 * How presence is getting on, in terms an operator can act on (AGL-2486).
 *
 * Presence failed SILENTLY in three separate places — a non-ok broker
 * response returned with no log at all, the sign-in catch wrote one
 * `console.warn`, and a rules refusal on the room read wrote another — so
 * "nobody else is here" and "presence is broken" looked identical on screen
 * and very nearly identical in the console. This makes the difference
 * legible without reading source.
 */
export type PresenceStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'unauthorized'
  | 'error'

export interface PresenceFault {
  /** Which leg failed, so the next person knows where to look. */
  stage: 'broker' | 'sign-in' | 'announce' | 'room'
  /** HTTP status or Firebase error code, whichever applies. */
  code: string
  message: string
}

export interface PresenceState {
  /**
   * Every editing SESSION in the room except this tab — including your own
   * other tabs, flagged `isSelf`. One entry per session, because cursors and
   * selections are per session.
   */
  entries: PresenceEntry[]
  /** The same room collapsed to one row per person, for the avatar stack. */
  people: PresencePerson[]
  /** Where presence has got to, and why it stopped if it did. */
  status: PresenceStatus
  fault: PresenceFault | null
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
  /**
   * The brokered RTDB session, once it exists — the co-editing engine rides
   * the SAME authenticated app rather than brokering a second token
   * (AGL-677). Null until presence has signed in.
   */
  session: PresenceSession | null
}

export interface PresenceSession {
  orgId: string
  /** The one host the broker proved the caller against. */
  hostId: string
  /**
   * Whether the broker granted a `coeditHost` claim. False for viewers, and
   * the RTDB rules refuse their co-editing writes regardless — this is for
   * the UI, not the gate.
   */
  canEdit: boolean
  database: Database
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
export const TAB_SESSION_ID =
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

/**
 * Record a fault once, in both places that matter.
 *
 * The console line is for whoever has devtools open; the state is for the
 * app bar, which is the only one an operator without devtools will ever see.
 * A failure that only exists as a `console.warn` is a failure nobody reports.
 */
function report(
  setStatus: (value: PresenceStatus) => void,
  setFault: (value: PresenceFault | null) => void,
  status: PresenceStatus,
  fault: PresenceFault,
): void {
  console.warn(
    `[presence] ${fault.stage} failed (${fault.code}): ${fault.message}`,
  )
  setStatus(status)
  setFault(fault)
}

/**
 * Turn one RTDB room snapshot into what the UI draws.
 *
 * Pure, exported and taking `now` as an argument so the staleness rule can be
 * tested at a fixed clock rather than inferred from a rendered component —
 * the reaping cutoff is the part most likely to be got wrong, and the most
 * expensive to get wrong, since too tight a window evicts live colleagues.
 */
export function projectRoom(
  room: Record<string, Record<string, PresenceEntry> | PresenceEntry>,
  uid: string,
  now: number,
): {
  entries: PresenceEntry[]
  people: PresencePerson[]
  ownOtherSessions: number
} {
  const entries: PresenceEntry[] = []
  const cutoff = now - PRESENCE_STALE_MS
  let ownOtherSessions = 0
  for (const [entryUid, sessions] of Object.entries(room ?? {})) {
    // Tolerate the pre-session shape: an entry written by an older client
    // sits directly under the uid rather than under a session.
    const list = isSessionMap(sessions)
      ? Object.entries(sessions)
      : ([['legacy', sessions as unknown as PresenceEntry]] as [
          string,
          PresenceEntry,
        ][])
    for (const [sessionId, entry] of list) {
      if (!entry) continue
      if (entryUid === uid && sessionId === TAB_SESSION_ID) continue
      // Reaped by AGE, on read, never written back. `onDisconnect` misses
      // often enough that a room accumulates ghosts of people who left —
      // measured at 73 minutes on production RTDB — and a ghost that draws a
      // cursor and a selection box is a phantom colleague fighting you over
      // an element nobody has selected, not a cosmetic wart.
      if ((entry.lastSeenAt ?? 0) < cutoff) continue
      const isSelf = entryUid === uid
      if (isSelf) ownOtherSessions += 1
      entries.push({
        ...entry,
        uid: entryUid,
        sessionId,
        key: `${entryUid}:${sessionId}`,
        isSelf,
      })
    }
  }
  // The avatar stack stays one face per PERSON — a stack of faces you cannot
  // tell apart is worse than a stack of names — while the overlays keep the
  // per-session list, because a cursor and a selection belong to a tab.
  const people = new Map<string, PresencePerson>()
  const freshest = new Map<string, number>()
  for (const entry of entries) {
    const seenAt = entry.lastSeenAt ?? 0
    const existing = people.get(entry.uid)
    if (existing) {
      existing.sessions += 1
      // The freshest session speaks for them: that is where they are
      // looking, so that is whose name and picture are current.
      if (seenAt > (freshest.get(entry.uid) ?? 0)) {
        freshest.set(entry.uid, seenAt)
        existing.displayName = entry.displayName
        existing.photoURL = entry.photoURL
      }
      continue
    }
    freshest.set(entry.uid, seenAt)
    people.set(entry.uid, {
      uid: entry.uid,
      displayName: entry.displayName,
      photoURL: entry.photoURL,
      colour: entry.colour,
      sessions: 1,
      isSelf: entry.isSelf,
    })
  }
  return { entries, people: [...people.values()], ownOtherSessions }
}

/**
 * Pointer moves are cheap to generate and expensive to broadcast.
 *
 * 60 ms — a ceiling of ~16 writes per second per editor, coalesced onto an
 * animation frame so a burst of moves inside one frame becomes one write.
 * Chosen against the receiving end rather than the sending end: the overlay
 * re-measures every frame, so a position landing every 60 ms reads as
 * continuous motion, and the interval sits under the ~100 ms at which a
 * followed cursor starts to look like it is stepping.
 *
 * The interval alone was not the expensive part. Two cheaper guards do more:
 * a stationary or barely-moving pointer now writes NOTHING (see
 * `CURSOR_MIN_DELTA`), and a hidden tab stops broadcasting altogether. A
 * pointer resting on the canvas used to keep paying the full rate for a
 * position nobody's screen would move.
 *
 * Cost at the ceiling: one `update()` of three numeric fields on a leaf node,
 * ~60 bytes on the wire, so a four-person room peaks near 50 writes/second
 * and 3 KB/second — and only while four people are actually moving.
 */
export const CURSOR_THROTTLE_MS = 60

/**
 * How far the pointer must travel, in canvas-relative units, to be worth a
 * write. 0.002 of the canvas box — about 2 px on a 1000 px-wide canvas, below
 * which nobody can see the cursor move anyway.
 */
export const CURSOR_MIN_DELTA = 0.002

/**
 * How often a tab re-stamps `lastSeenAt` while it just sits there.
 *
 * Without this there is no liveness signal at all: `lastSeenAt` was only
 * written on announce, on a selection change and on a cursor move, so an
 * editor reading a page for five minutes looked identical to a dead entry,
 * and nothing could be reaped by age without evicting live people.
 */
export const PRESENCE_HEARTBEAT_MS = 20_000

/**
 * How stale an entry may be before the room stops drawing it.
 *
 * Three missed heartbeats. `onDisconnect().remove()` is the primary cleanup
 * and it is not reliable enough to be the only one — measured on production
 * RTDB on 2026-08-22, a presence entry whose tab was long gone was still
 * sitting in the room 73 minutes later, counted as a live session. That ghost
 * was merely a wrong badge before; now that a session draws an avatar, a
 * cursor and a selection box, it would be a phantom colleague fighting you
 * over an element nobody has selected.
 *
 * Reaped on READ, never written back. Cursors and selections are disposable
 * and must not acquire the durability the co-edit mirror has: nothing here
 * replays, nothing here is retained, and nothing here reaches the saved
 * document.
 */
export const PRESENCE_STALE_MS = 3 * PRESENCE_HEARTBEAT_MS

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
  // No site key means no provider (AGL-2049). `new ReCaptchaV3Provider(
  // undefined)` does not throw — it fails asynchronously inside the SDK, past
  // this catch — so registering one anyway would leave the presence app in the
  // state this whole function exists to avoid: holding a provider that can
  // never mint a token, which enforcement rejects exactly like having none,
  // but silently.
  const siteKey = appCheckSiteKey()
  if (!siteKey) {
    console.warn(APP_CHECK_KEY_MISSING_MESSAGE)
    presenceAppCheckStarted = true
    return
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
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
  docType: 'screen' | 'layout' | 'component' | 'template' | 'email'
  docId: string | undefined
  /** Currently selected node, broadcast so others can see where you are. */
  selectedNodeId?: string
  /**
   * Broadcast pointer position over the canvas (AGL-677). Off by default:
   * it is the highest-frequency thing in the room, and only the editing
   * surfaces want it.
   */
  broadcastCursor?: boolean
  /**
   * Resolves the canvas root element, which the pointer position is measured
   * against. Supplied by the caller because it comes from the besigner's
   * `RenderedCanvasElements` registry — the canvas renders into shadow roots
   * and emits no id attribute a document query could find.
   */
  getCanvasRoot?: () => Element | null | undefined
}): PresenceState {
  const {
    hostId,
    docType,
    docId,
    selectedNodeId,
    broadcastCursor,
    getCanvasRoot,
  } = options
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | undefined)?.uid
  // A primitive, so it is safe in effect 1's dependency list — see the note
  // below on why that list must stay primitives-only.
  const authPersistence = useAuthPersistence()
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
  const [people, setPeople] = useState<PresencePerson[]>([])
  const [ownOtherSessions, setOwnOtherSessions] = useState(0)
  const [session, setSession] = useState<PresenceSession | null>(null)
  const [status, setStatus] = useState<PresenceStatus>('idle')
  const [fault, setFault] = useState<PresenceFault | null>(null)
  /** Latest selection, read by the announce effect without depending on it. */
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId
  /** This tab's node while it is announced; null between rooms. */
  const meRefHolder = useRef<ReturnType<typeof ref> | null>(null)
  /** Latest root resolver, so the pointer listener is not re-bound per render. */
  const getCanvasRootRef = useRef(getCanvasRoot)
  getCanvasRootRef.current = getCanvasRoot

  // 1. Exchange the console session for a presence-scoped one.
  useEffect(() => {
    if (!hostId || !uid) return
    let active = true
    setStatus('connecting')
    setFault(null)
    void (async () => {
      try {
        const idToken = await getIdTokenRef.current?.()
        if (!idToken) {
          if (active) {
            report(setStatus, setFault, 'error', {
              stage: 'sign-in',
              code: 'no-id-token',
              message: 'The console session produced no ID token.',
            })
          }
          return
        }
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
        // A bare `if (!response.ok) return` sat here and logged NOTHING. It
        // is the most likely thing to fire in the field — a non-member, a
        // suspended org, an unverified address, an SSO account whose token
        // the broker would not take — and it produced an empty avatar stack
        // indistinguishable from an empty room. The broker's own reason is
        // right there in the body; read it and say it.
        if (!response.ok) {
          const detail = await response
            .text()
            .then((text) => {
              try {
                const parsed = JSON.parse(text)
                return String(parsed?.error ?? text).slice(0, 200)
              } catch {
                return text.slice(0, 200)
              }
            })
            .catch(() => '')
          if (active) {
            report(
              setStatus,
              setFault,
              response.status === 401 || response.status === 403
                ? 'unauthorized'
                : 'error',
              {
                stage: 'broker',
                code: String(response.status),
                message: detail || 'The presence broker refused this session.',
              },
            )
          }
          return
        }
        const { token, orgId, canEdit, tenantId } = await response.json()
        if (!active) return
        if (!token) {
          report(setStatus, setFault, 'error', {
            stage: 'broker',
            code: 'no-token',
            message: 'The presence broker returned 200 with no token.',
          })
          return
        }

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
        // Persistence class INHERITED from the provider's instance, never
        // re-decided here (AGL-1379). Presence is a second Firebase app on
        // the same origin, so a bare `getAuth(presenceApp)` — which is what
        // this was — takes the SDK default and writes a refresh token to
        // IndexedDB even on an origin the provider deliberately kept clean.
        // Configuring only the shared provider would have left exactly that.
        const auth = createAuthInstance(presenceApp, authPersistence)
        if (FIREBASE_AUTH_EMULATOR_ENABLED) {
          try {
            connectAuthEmulator(auth, 'http://localhost:9099', {
              disableWarnings: true,
            })
          } catch {
            // Already connected on a previous mount.
          }
        }
        // An SSO user's custom token is minted in their org's GCIP tenant
        // (AGL-1962), and a tenant token can only be exchanged by an auth
        // instance already placed in that tenant. Set it BEFORE the exchange.
        // Assigned unconditionally — null puts the instance back on the
        // project pool, so a presence app reused across a sign-out into a
        // non-SSO account cannot carry a stale tenant over. Shared with every
        // other exchange since AGL-1993; this call site is where the rule was
        // first got right.
        await signInWithPooledCustomToken(auth, token, tenantId)
        // The database handle is built HERE, once, and carried on the
        // session: co-editing must talk to the same authenticated app
        // instance the presence write used, and re-deriving it in each
        // consumer is how two channels end up on two connections.
        const database = getDatabase(presenceApp)
        if (FIREBASE_DATABASE_EMULATOR_ENABLED) {
          try {
            connectDatabaseEmulator(database, 'localhost', 9000)
          } catch {
            // Already connected on a previous mount.
          }
        }
        if (active) {
          setSession({ orgId, hostId, canEdit: Boolean(canEdit), database })
        }
      } catch (error) {
        // Quiet for the USER — an editor that will not open because nobody
        // could be listed is far worse than an empty avatar stack. Not
        // quiet for developers, and no longer quiet for the OPERATOR either:
        // the fault travels out on `PresenceState` so the app bar can say
        // that presence is off rather than implying the room is empty.
        if (!active) return
        report(setStatus, setFault, 'error', {
          stage: 'sign-in',
          code: String(
            (error as { code?: string } | undefined)?.code ?? 'unknown',
          ),
          message: String(
            (error as { message?: string } | undefined)?.message ?? error,
          ).slice(0, 200),
        })
      }
    })()
    return () => {
      active = false
    }
  }, [hostId, uid, authPersistence])

  // 2. Announce ourselves and watch the room.
  useEffect(() => {
    if (!session || !uid || !docId) return
    const database = session.database

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
    }).catch((error) =>
      report(setStatus, setFault, 'error', {
        stage: 'announce',
        code: String((error as { code?: string })?.code ?? 'unknown'),
        message: String((error as { message?: string })?.message ?? error).slice(
          0,
          200,
        ),
      }),
    )
    // Server-side cleanup: a closed tab or a slept laptop leaves no ghost.
    // Scoped to this tab's node, so one tab closing no longer evicts the
    // other tabs of the same person.
    void onDisconnect(meRef).remove().catch(() => undefined)

    // The last room snapshot, re-projected on a timer as well as on change.
    // Staleness is a function of the CLOCK, not of RTDB traffic: a ghost
    // sitting in a room nobody is writing to produces no snapshot, so a
    // purely event-driven projection would leave it on screen forever.
    let lastRoom: Record<string, Record<string, PresenceEntry>> = {}
    const project = () => {
      const projected = projectRoom(lastRoom, uid, Date.now())
      setEntries(projected.entries)
      setPeople(projected.people)
      setOwnOtherSessions(projected.ownOtherSessions)
    }

    const unsubscribe = onValue(
      ref(database, roomPath),
      (snapshot) => {
        lastRoom = (snapshot.val() ?? {}) as Record<
          string,
          Record<string, PresenceEntry>
        >
        project()
        setStatus('live')
        setFault(null)
      },
      (error) => {
        // A rules refusal arrives here, not at the write — the room read is
        // gated on `presenceOrg`, so this is what a bad or missing claim
        // looks like from the client. It used to be one `console.warn` that
        // said "lost the room" and named neither the path nor the code.
        report(
          setStatus,
          setFault,
          String((error as { code?: string })?.code ?? '').includes('permission')
            ? 'unauthorized'
            : 'error',
          {
            stage: 'room',
            code: String((error as { code?: string })?.code ?? 'unknown'),
            message: `${roomPath}: ${String(
              (error as { message?: string })?.message ?? error,
            ).slice(0, 160)}`,
          },
        )
        setEntries([])
        setPeople([])
        setOwnOtherSessions(0)
      },
    )

    // Liveness, so age-based reaping cannot evict someone who is simply
    // reading. Cheap: one numeric field every 20 s per open document, and
    // only while the tab is visible — a backgrounded tab is allowed to go
    // stale and drop out of the room, which is the honest answer.
    //
    // The same tick re-projects, so a peer who stops heartbeating fades from
    // the room within one interval of going stale.
    const heartbeat = setInterval(() => {
      project()
      if (typeof document !== 'undefined' && document.hidden) return
      void update(meRef, { lastSeenAt: Date.now() }).catch(() => undefined)
    }, PRESENCE_HEARTBEAT_MS)

    meRefHolder.current = meRef
    return () => {
      meRefHolder.current = null
      clearInterval(heartbeat)
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

  // 4. Where the pointer is, in canvas-relative terms.
  //
  // Normalised 0..1 against the canvas root's box rather than sent as client
  // pixels: two editors have different window sizes, scroll offsets and zoom
  // levels, and a raw clientX would put their cursor somewhere else entirely
  // on the document. Throttled hard — this is the highest-frequency write in
  // the room and nobody needs sub-frame fidelity to follow someone.
  useEffect(() => {
    if (!broadcastCursor || !session) return undefined
    let frame: number | null = null
    let last = 0
    let lastX = -1
    let lastY = -1
    const clearCursor = () => {
      const meRef = meRefHolder.current
      if (!meRef) return
      if (lastX < 0 && lastY < 0) return
      lastX = -1
      lastY = -1
      // RTDB has no "delete this field" in an update object; null is it. A
      // cursor left behind when the pointer leaves the canvas is a lie that
      // would sit on someone else's screen indefinitely.
      void update(meRef, { cursorX: null, cursorY: null }).catch(
        () => undefined,
      )
    }
    const onMove = (event: PointerEvent) => {
      const meRef = meRefHolder.current
      if (!meRef) return
      // A hidden tab has no pointer worth broadcasting, and a background tab
      // that keeps writing is pure cost.
      if (typeof document !== 'undefined' && document.hidden) return
      const now = Date.now()
      if (now - last < CURSOR_THROTTLE_MS) return
      const root = getCanvasRootRef.current?.()
      if (!root) return
      const box = root.getBoundingClientRect()
      if (!box.width || !box.height) return
      const x = (event.clientX - box.left) / box.width
      const y = (event.clientY - box.top) / box.height
      // Outside the document is not a position worth sending — and if we
      // were previously inside it, the stale one has to be withdrawn.
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        clearCursor()
        return
      }
      // A pointer that has not really moved costs a write for a position
      // nobody's screen would change by. This is the guard that matters
      // most: a hand resting on the mouse generates a steady trickle of
      // sub-pixel moves, and the throttle alone happily forwards all of it.
      if (
        Math.abs(x - lastX) < CURSOR_MIN_DELTA &&
        Math.abs(y - lastY) < CURSOR_MIN_DELTA
      ) {
        return
      }
      last = now
      lastX = x
      lastY = y
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        void update(meRef, {
          cursorX: Math.round(x * 10_000) / 10_000,
          cursorY: Math.round(y * 10_000) / 10_000,
          lastSeenAt: Date.now(),
        }).catch(() => undefined)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('blur', clearCursor)
    document.addEventListener('visibilitychange', clearCursor)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', clearCursor)
      document.removeEventListener('visibilitychange', clearCursor)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [broadcastCursor, session])

  return useMemo(
    () => ({ entries, people, status, fault, ownOtherSessions, session }),
    [entries, people, status, fault, ownOtherSessions, session],
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
