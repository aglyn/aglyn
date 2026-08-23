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
import { type Auth, connectAuthEmulator } from 'firebase/auth'
import {
  AVATAR_COLOURS,
  avatarColourFor,
} from '../components/member-avatar.component'
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
  /**
   * This build has no presence backend at all — a self-host deployment that
   * did not configure the Realtime Database (`project_self_host_docker_byo_
   * firebase`). Deliberately NOT `error`: nothing is broken, the feature was
   * never switched on, and telling an operator to "try again" about a
   * deployment decision wastes their afternoon.
   */
  | 'unconfigured'

/**
 * What the reader should DO about it (AGL-2486).
 *
 * Zach, on the first version of this: "what does this mean? It gives the
 * users no course of action on how to fix it." The old tooltip ended at
 * `Failed at: broker (500)` — a stage name and a status code, in front of a
 * customer. `stage` and `code` are still carried, because whoever debugs this
 * next needs them; they are just no longer the message.
 *
 * The kind is what selects the words. Four, because there are exactly four
 * different things the reader can do: nothing (it was never set up), sign in
 * again, ask for access, or retry and report.
 */
export type PresenceFaultKind =
  /** Never configured on this deployment. Not a bug; no remedy needed. */
  | 'unconfigured'
  /** The session is stale, revoked or disabled. Remedy: sign in again. */
  | 'signed-out'
  /** Authenticated, but not admitted here. Remedy: ask a site admin. */
  | 'not-allowed'
  /** Something that should have worked did not. Remedy: retry, then report. */
  | 'broken'

export interface PresenceFault {
  /** The remedy class — what the reader can actually do. */
  kind: PresenceFaultKind
  /** Which leg failed, so the next person knows where to look. */
  stage: 'config' | 'broker' | 'sign-in' | 'announce' | 'room'
  /** HTTP status or Firebase error code, whichever applies. */
  code: string
  message: string
}

/** Plain-language failure copy: what happened, and what to do about it. */
export interface PresenceNotice {
  /** One sentence naming the situation in the reader's terms. */
  title: string
  /** What to do. Empty only when there is genuinely nothing to do. */
  remedy: string
  /**
   * The two things that must be said every time, and were the two things the
   * old copy got right: an empty stack is not proof you are alone, and none
   * of this touches your own work.
   */
  caution: string
  /** `stage (code) — message`, for the details affordance. Never the lead. */
  detail: string
}

/**
 * The words for a fault. Pure and exported so the copy can be asserted in a
 * spec rather than read off a screenshot.
 *
 * "Your work is safe" is not reassurance for its own sake — it is the single
 * most load-bearing fact on this tooltip. Presence failing looks, from the
 * canvas, exactly like the editor having lost its connection, and the
 * reasonable response to that belief is to stop working or to start copying
 * things out. Saving is a different subsystem entirely (Firestore, with the
 * AGL-674 concurrent-edit guard still running), and saying so is what keeps a
 * cosmetic outage cosmetic.
 */
export function presenceFaultNotice(fault: PresenceFault | null): PresenceNotice {
  const detail = fault
    ? `${fault.stage} (${fault.code}) — ${fault.message}`
    : ''
  // Said on every branch, in the same words, because it is true on every
  // branch. The first half is the warning Zach kept; the second is the one
  // that stops a cosmetic failure from reading as data loss.
  const caution =
    'An empty stack does NOT mean you are alone — someone else may be ' +
    'editing this screen without appearing here. Your own editing is ' +
    'unaffected and your work is saved normally.'
  switch (fault?.kind) {
    case 'unconfigured':
      return {
        title: 'Live collaboration is not set up on this deployment.',
        remedy:
          'Nothing is broken and there is nothing to retry. Whoever runs ' +
          'this deployment can turn it on by configuring a Realtime ' +
          'Database for it.',
        caution,
        detail,
      }
    case 'signed-out':
      return {
        title: 'Your sign-in is no longer valid, so live collaboration could not start.',
        remedy: 'Sign out and sign back in, then reopen this screen.',
        caution,
        detail,
      }
    case 'not-allowed':
      return {
        title:
          'You can edit this screen, but this account was not admitted to ' +
          'its live session.',
        remedy:
          'Ask an admin of this site to check your access, then reload. ' +
          'Your editing permissions are unchanged either way.',
        caution,
        detail,
      }
    default:
      return {
        title: 'Live collaboration is not running right now.',
        remedy:
          'Reload the page to try again. If it keeps happening, sign out ' +
          'and back in — and tell support, quoting the details below.',
        caution,
        detail,
      }
  }
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
  /**
   * The auth instance this session signed into, kept so a rules refusal can
   * report WHICH org the presence token was actually scoped to (AGL-2486).
   * Without it, `permission_denied` names the path it was refused and says
   * nothing about the claim that refused it, which is the only half that
   * identifies the cause.
   */
  auth: Auth
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
 * A colour per SESSION, not per person (AGL-2486).
 *
 * Zach: "We should also see the same avatar repeated for each of its active
 * sessions all with a different presence color not just consolidated into
 * one." Seeding on `uid:sessionId` is what makes that work: two windows of
 * one account draw the same face in two different colours, and — because the
 * colour is WRITTEN INTO the room entry by the session it belongs to —
 * everyone else sees that session in that same colour too, including the
 * cursor and the selection box the overlays draw from `entry.colour`.
 *
 * Seeding on the uid alone, which is what this did, made every one of a
 * person's sessions identical: indistinguishable avatars, and two cursors in
 * one colour fighting over the canvas.
 */
function colourFor(seed: string): string {
  return avatarColourFor(seed)
}

/** Which palette slot a key hashes to. One hash, shared by both callers. */
function colourIndexFor(key: string): number {
  return AVATAR_COLOURS.indexOf(avatarColourFor(key))
}

/** Secondary Firebase app holding the presence-scoped session. */
const PRESENCE_APP_NAME = 'AGLYN_PRESENCE'

/**
 * The Realtime Database this deployment presences into, or '' when it has
 * none (AGL-2486).
 *
 * Read off the ALREADY-INITIALISED primary app rather than from an env
 * constant, so it reflects what the running build was actually configured
 * with — a self-host deployment that brings its own Firebase
 * (`project_self_host_docker_byo_firebase`) is exactly the case where the two
 * can disagree, and the app's own options are the ones the SDK would use.
 *
 * Never throws. `getApp` throws when the named app is not registered yet, and
 * a config PROBE that can itself fail is not a probe.
 */
function presenceDatabaseUrl(): string {
  try {
    return String(getApp(FIREBASE_CLIENT_APP_NAME).options?.databaseURL ?? '')
  } catch {
    return ''
  }
}

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
 * A DISTINCT colour for every session in the room (AGL-2486).
 *
 * ## Why hashing was not enough
 *
 * Each session used to pick its own colour by hashing `uid:sessionId` into a
 * six-entry palette and writing the result into its own RTDB row. Independent
 * picks from a six-wide palette collide about one time in six, which is
 * exactly what Zach saw: "sometimes our same user gets the same color" — two
 * discs purple in one screenshot, purple and orange in the next. Nothing was
 * wrong with the input's uniqueness; the OUTPUT space was small and nobody
 * was reconciling it. Two sessions sharing a colour defeats the entire point
 * of drawing them separately, and it does it to the cursors and selection
 * boxes on the canvas too, which are drawn from the same value.
 *
 * ## What this does instead
 *
 * Assigns over the WHOLE room at once. Each key keeps its hashed colour when
 * that slot is free, and otherwise takes the next free slot — so a collision
 * is resolved instead of shipped, while a session that never collides keeps
 * the colour it would have had. Past the palette size the hash is used
 * unchanged: a seventh simultaneous session repeats a colour, which is
 * honest, and six is already well past the point where the avatars are doing
 * the identifying rather than the colour.
 *
 * ## Why every viewer computes the same answer
 *
 * The input is the sorted list of every session key in the room INCLUDING the
 * viewer's own, and the walk is deterministic. Two people looking at the same
 * room therefore assign identically, which is what lets them say "the purple
 * cursor" and mean the same person. Seeding from the key rather than from a
 * list position is what keeps a colour stable across re-renders and reloads.
 */
export function assignRoomColours(keys: string[]): Record<string, string> {
  const assigned: Record<string, string> = {}
  const taken = new Set<number>()
  // Sorted, not insertion-ordered: `Object.keys` order depends on how the
  // RTDB snapshot arrived, so two viewers could otherwise walk the same room
  // in different orders and resolve a collision to different colours.
  for (const key of [...keys].sort()) {
    const start = colourIndexFor(key)
    let index = start
    if (taken.size < AVATAR_COLOURS.length) {
      let step = 0
      while (taken.has(index) && step < AVATAR_COLOURS.length) {
        index = (index + 1) % AVATAR_COLOURS.length
        step += 1
      }
    }
    taken.add(index)
    assigned[key] = AVATAR_COLOURS[index]
  }
  return assigned
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
  // Every session key in the room INCLUDING this tab's own, sorted, so the
  // colour assignment below is computed from the same input by every viewer.
  const allKeys: string[] = []
  for (const [entryUid, sessions] of Object.entries(room ?? {})) {
    const keys = isSessionMap(sessions) ? Object.keys(sessions) : ['legacy']
    for (const sessionId of keys) allKeys.push(`${entryUid}:${sessionId}`)
  }
  const colours = assignRoomColours(allKeys)
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
      // A presence entry ALWAYS carries a string `displayName` — the RTDB
      // rules refuse a session node without one, and the client's own
      // fallback chain ends at 'Someone', so an entry lacking it is not an
      // entry. It is a stray field under a malformed uid node, or a fixture
      // somebody left behind (an agent wrote two `zzTESTCOLLAB` rows into
      // PRODUCTION on 2026-08-22, one of them into Zach's own org). Rendered,
      // those became the `?` discs Zach reported: `String(undefined ?? '')`
      // is empty, and empty initials draw a question mark.
      //
      // Skipped rather than defaulted, because a phantom collaborator is
      // worse than a missing one — it draws a cursor and a selection box over
      // an element nobody has selected.
      if (typeof (entry as PresenceEntry).displayName !== 'string') continue
      if (entryUid === uid && sessionId === TAB_SESSION_ID) continue
      // Reaped by AGE, on read, never written back. `onDisconnect` misses
      // often enough that a room accumulates ghosts of people who left —
      // measured at 73 minutes on production RTDB — and a ghost that draws a
      // cursor and a selection box is a phantom colleague fighting you over
      // an element nobody has selected, not a cosmetic wart.
      if ((entry.lastSeenAt ?? 0) < cutoff) continue
      const isSelf = entryUid === uid
      if (isSelf) ownOtherSessions += 1
      const key = `${entryUid}:${sessionId}`
      entries.push({
        ...entry,
        uid: entryUid,
        sessionId,
        key,
        // The ASSIGNED colour wins over whatever the session wrote, because
        // only the room as a whole can guarantee two sessions differ.
        colour: colours[key] ?? entry.colour,
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
 * The presence app's auth, created ONCE per page with in-memory persistence.
 *
 * Memoised because `initializeAuth` throws if it runs twice for one app, and
 * this hook re-runs its exchange on every remount and every document change.
 * `getAuth` is NOT the fallback for a failed init — that would silently hand
 * back the cross-tab-synced instance this exists to avoid, which is the bug
 * wearing the fix's clothes. There is no such failure path anyway: this is
 * the only caller, and it is memoised.
 */
let presenceAuthInstance: Auth | null = null
function presenceAuth(app: FirebaseApp): Auth {
  if (!presenceAuthInstance) {
    presenceAuthInstance = createAuthInstance(app, 'ephemeral')
  }
  return presenceAuthInstance
}

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
  // NOT used to build the presence auth instance any more — see
  // `presenceAuth`. Still read, and still a dependency below, because it is
  // the signal that the ORIGIN's persistence policy changed, and a presence
  // session minted under the old one should be re-established rather than
  // left running.
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
  // `.trim() || 'Someone'` closes the last hole in the chain (AGL-2486): a
  // provider that asserts a name of `" "` satisfies every `||` above and then
  // renders as a question mark on everyone else's screen, because empty
  // initials have nothing to draw. The chain must end at a real string, not
  // merely at a defined one — and it is worth ending it HERE, in the writer,
  // so no reader has to defend against it.
  const displayName =
    String(
      (user as { displayName?: string } | undefined)?.displayName ||
        idp.displayName ||
        (user as { email?: string } | undefined)?.email ||
        'Someone',
    )
      .slice(0, 80)
      .trim() || 'Someone'
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
        // IS THERE A PRESENCE BACKEND AT ALL? (AGL-2486)
        //
        // Asked FIRST, and asked of configuration rather than of a failed
        // call, because "this deployment never had live collaboration" and
        // "live collaboration is broken" need different words and only one of
        // them is a bug. A self-host install that brings its own Firebase may
        // simply not have a Realtime Database; without this check it would
        // mint a token, sign in, and then show an operator a red badge and a
        // network error about a service they deliberately did not configure.
        if (!presenceDatabaseUrl()) {
          if (active) {
            report(setStatus, setFault, 'unconfigured', {
              kind: 'unconfigured',
              stage: 'config',
              code: 'no-database-url',
              message:
                'This deployment has no Realtime Database configured, which ' +
                'is where presence lives.',
            })
          }
          return
        }
        const idToken = await getIdTokenRef.current?.()
        if (!idToken) {
          if (active) {
            report(setStatus, setFault, 'error', {
              kind: 'signed-out',
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
            // 401 is the broker saying the SESSION is the problem, and it is
            // the only one of these the reader can fix alone. 403 is a
            // membership answer — a different person has to act. Everything
            // else is ours to fix, including the 500 the SSO revocation bug
            // produced, which is why that one no longer arrives here at all.
            const status = response.status
            report(
              setStatus,
              setFault,
              status === 401 || status === 403 ? 'unauthorized' : 'error',
              {
                kind:
                  status === 401
                    ? 'signed-out'
                    : status === 403
                      ? 'not-allowed'
                      : 'broken',
                stage: 'broker',
                code: String(status),
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
            kind: 'broken',
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
        // ALWAYS EPHEMERAL, never the provider's class (AGL-2486).
        //
        // ## The bug
        //
        // This inherited `authPersistence`, which is `durable` on
        // `*.aglyn.com` — and `durable` means `getAuth(app)`, whose default is
        // IndexedDB persistence, which Firebase Auth SYNCHRONISES ACROSS TABS.
        // There is one `AGLYN_PRESENCE` app per browser profile, so there was
        // one presence session per browser profile, and every tab signed into
        // it with a token scoped to ITS OWN org. The newest sign-in silently
        // took over every other tab.
        //
        // Reproduced deterministically on 2026-08-22: with a test-org screen
        // open and an aglyn-org screen opened after it, the first tab's room
        // read was refused —
        //   `presence/hz_KgetqSq/screen/4L_o499p_p: permission_denied`
        //   `[presence token is scoped to org jWmGooWE3L ...]`
        // — the diagnostic below prints exactly that. This is what Zach saw
        // as presence "going away after a period of not editing" and the
        // error coming back: nothing to do with idling, everything to do with
        // whichever tab last re-minted. Two accounts in two windows made it
        // constant, and it also explains why a single tab, or two tabs on the
        // SAME org, looked perfectly healthy in testing.
        //
        // ## Why ephemeral is right, not just a workaround
        //
        // A presence session is per TAB by construction — `TAB_SESSION_ID`
        // keys the room entry — it is re-minted on every mount, and it can do
        // nothing except presence. Persisting it buys nothing and costs
        // correctness. It is also strictly MORE conservative than AGL-1379
        // asked for: in-memory writes no refresh token anywhere, so the
        // "origin the provider deliberately kept clean" stays cleaner than
        // inheriting `durable` ever left it.
        const auth = presenceAuth(presenceApp)
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
          setSession({ orgId, hostId, canEdit: Boolean(canEdit), database, auth })
        }
      } catch (error) {
        // Quiet for the USER — an editor that will not open because nobody
        // could be listed is far worse than an empty avatar stack. Not
        // quiet for developers, and no longer quiet for the OPERATOR either:
        // the fault travels out on `PresenceState` so the app bar can say
        // that presence is off rather than implying the room is empty.
        if (!active) return
        report(setStatus, setFault, 'error', {
          // A custom-token exchange that the pool refuses is an
          // authentication answer, not an outage, and the reader can act on
          // it. Everything else on this leg is ours.
          kind: String(
            (error as { code?: string } | undefined)?.code ?? '',
          ).startsWith('auth/')
            ? 'signed-out'
            : 'broken',
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
      colour: colourFor(`${uid}:${TAB_SESSION_ID}`),
      ...(photoURL ? { photoURL: String(photoURL).slice(0, 512) } : {}),
      ...(selectedNodeIdRef.current
        ? { selectedNodeId: selectedNodeIdRef.current }
        : {}),
    }).catch((error) =>
      report(setStatus, setFault, 'error', {
        kind: String((error as { code?: string })?.code ?? '')
          .toUpperCase()
          .includes('PERMISSION')
          ? 'not-allowed'
          : 'broken',
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
        // `toUpperCase`, because RTDB spells this `PERMISSION_DENIED` on the
        // message and `permission-denied`/`permission_denied` on the code
        // depending on the transport. A case-sensitive `includes('permission')`
        // silently classified a real rules refusal as a generic outage and
        // told the reader to reload, forever.
        const refused = `${(error as { code?: string })?.code ?? ''}`
          .toUpperCase()
          .includes('PERMISSION')
        report(setStatus, setFault, refused ? 'unauthorized' : 'error', {
          kind: refused ? 'not-allowed' : 'broken',
          stage: 'room',
          code: String((error as { code?: string })?.code ?? 'unknown'),
          message: `${roomPath}: ${String(
            (error as { message?: string })?.message ?? error,
          ).slice(0, 160)}`,
        })
        // WHICH CLAIM REFUSED IT (AGL-2486).
        //
        // `permission_denied` names the PATH it refused and nothing about the
        // token, so a room read failing because the presence session belongs
        // to a different org — or to a different PERSON — was indistinguishable
        // from a rules bug, from a broken mint, and from a genuine access
        // decision. That ambiguity is what made this take a day. The claim is
        // read after the fact and appended, so the refusal still surfaces
        // instantly and gets more precise a moment later.
        void (async () => {
          try {
            const claims = (
              await session.auth.currentUser?.getIdTokenResult()
            )?.claims
            if (!claims) return
            const tokenOrg = String(claims['presenceOrg'] ?? 'none')
            if (tokenOrg === session.orgId && claims['user_id'] === uid) return
            setFault((current) =>
              current && current.stage === 'room'
                ? {
                    ...current,
                    message:
                      `${current.message} [presence token is scoped to ` +
                      `org ${tokenOrg} as uid ${String(
                        claims['user_id'] ?? '?',
                      )}, but this room is org ${session.orgId} for uid ` +
                      `${uid} — the session was taken over by another tab]`,
                  }
                : current,
            )
          } catch {
            // A diagnostic that can fail must not become a second failure.
          }
        })()
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
