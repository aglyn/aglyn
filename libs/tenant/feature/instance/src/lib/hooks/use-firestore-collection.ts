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
  getDocsFromServer,
  onSnapshot,
  type DocumentData,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useEffect, useRef, useState, type DependencyList } from 'react'
import {
  DENIAL_STREAK_TO_REPORT,
  denialLabelForQuery,
  refusedRetryDelayMs,
  reportFirestoreDenial,
  reportFirestoreServerRead,
  subscribeFirestoreSessionHeal,
} from './firestore-denial-reporter'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

/*
 * The cadence once a refusal streak has outlived the retry budget lives in
 * `firestore-denial-reporter.ts` (`refusedRetryDelayMs`), shared by all
 * three listener hooks: 2s while the fault could be the whole session — that
 * is what recovers the page after a heal nobody announced, and the ceiling
 * on it is the 38 AGL-1358 write guards — and 60s once another listener's
 * server answer proves the session reads and this refusal is about the ref
 * (AGL-1440). A heal broadcast reopens instantly regardless (see
 * `subscribeFirestoreSessionHeal`).
 */

export type FirestoreCollectionStatus = 'loading' | 'success' | 'error'

export interface UseFirestoreCollectionOptions {
  idField?: string
  /**
   * Confirm against the server when a document disappears from a NON-EMPTY
   * result, instead of trusting the live snapshot (AGL-1196).
   *
   * OPT-IN, and only worth setting for a query whose `where` reads a MUTABLE
   * field. Such a document can stop matching mid-session — a scope edit, an
   * un/republish — leave the query target, and get cached as a `noDocument`
   * tombstone at its own path, which is then served to every other reader of
   * that path including single-document reads (AGL-827/929).
   *
   * A query with no predicate, or one keyed on `documentId()`, cannot produce
   * this and must not pay for the extra read. Where the predicate can be
   * dropped entirely, drop it — that removes the mechanism rather than
   * repairing it after the fact (AGL-1190).
   */
  confirmDisappearances?: boolean
}

export interface UseFirestoreCollectionResult<T> {
  data: T[]
  status: FirestoreCollectionStatus
  error: FirestoreError | undefined
  /**
   * `data` came from the local cache and the server has not confirmed it
   * (AGL-1066). See `ObservableStatus.fromCache` for why this matters and
   * why it is the signal to reach for rather than `staleSession`.
   */
  fromCache: boolean
  /**
   * The server has REFUSED this listen for longer than the retry budget, and
   * no server snapshot has arrived since (AGL-1066).
   *
   * Kept after the flip rather than folded into `status`, because it says
   * something `status` does not: WHY the listen is failing. `status:
   * 'error'` covers every terminal error; this one counts `permission-denied`
   * alone, so it cannot fire offline, and a single server snapshot clears it.
   * A consumer asking "is what I am rendering cache-only because the session
   * is refused" wants this; one asking "did the read fail at all" wants
   * `status`.
   */
  serverDenied: boolean
}

/**
 * Collection-query counterpart to reactfire's `useFirestoreCollectionData`,
 * but backed by a raw `onSnapshot` listener with its own retry/backoff
 * instead of reactfire's cached Observable. That cache terminates forever on
 * its first error — a transient `permission-denied` right after sign-in
 * (before Firestore's own credential provider has attached the user's ID
 * token) permanently breaks the query for the rest of the session, even
 * across remounts. A fresh `onSnapshot` call each retry reopens a genuinely
 * new listener, so it recovers once the token has propagated (AGL-216/217).
 *
 * `buildQuery` is re-invoked from `deps` the same way a `useEffect`/`useMemo`
 * callback would be — pass the same primitive values (ids, uid, firestore)
 * you'd put in a `useMemo` dependency array, not the `Query` object itself.
 */
export function useFirestoreCollection<T = DocumentData>(
  buildQuery: () => Query<DocumentData> | null | undefined,
  deps: DependencyList,
  options: UseFirestoreCollectionOptions = {},
): UseFirestoreCollectionResult<T> {
  const [data, setData] = useState<T[]>([])
  const [status, setStatus] = useState<FirestoreCollectionStatus>('loading')
  const [error, setError] = useState<FirestoreError | undefined>(undefined)
  // Un-confirmed until a snapshot says otherwise: a hook that has not heard
  // from the server yet must not read as server-confirmed.
  const [fromCache, setFromCache] = useState(true)
  const [serverDenied, setServerDenied] = useState(false)
  const buildQueryRef = useRef(buildQuery)
  buildQueryRef.current = buildQuery
  const idField = options.idField
  const confirmDisappearances = options.confirmDisappearances

  useEffect(() => {
    setStatus('loading')
    setError(undefined)
    // Clear on EVERY dep change, not only when the query goes null: when
    // the scope moves between two live queries (org A → org B, host A →
    // host B) the old rows would otherwise stay rendered until the new
    // snapshot arrives — the org-switch "remnants" bug (AGL-591). Same
    // hold-nothing-rather-than-show-the-wrong-org rule as useOrgHosts.
    setData([])
    setFromCache(true)
    setServerDenied(false)

    const q = buildQueryRef.current()
    if (!q) {
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    /**
     * Refusals since the last SERVER snapshot (AGL-1066).
     *
     * Deliberately not `attempt`: that one is reset by any snapshot,
     * including a cached one, so under `persistentLocalCache` it never
     * reaches its budget and can never report anything.
     */
    let deniedStreak = 0
    /** Epoch ms of the current streak's first refusal (AGL-1440). */
    let deniedStreakStartedAt = 0
    let denialReported = false
    /**
     * The retry budget is spent and the last thing the server did was refuse
     * (AGL-1066).
     *
     * This is what makes `status: 'error'` STICK. Every reopened listen emits
     * from the cache before it learns it is still refused, and an
     * unconditional `setStatus('success')` in the success handler would hand
     * the page back to `success` on that emission — so the surface would
     * oscillate error → success → error at the retry cadence, which is worse
     * to look at than either state. Only a snapshot the SERVER answered
     * clears this, for the same reason it is the only thing that clears
     * `deniedStreak`: a cached emission is not evidence about the server.
     */
    let terminal = false
    const denialLabel = denialLabelForQuery(q)
    // Disappearance tracking (AGL-1196); inert unless opted in.
    const seen = new Set<string>()
    const confirmedGone = new Set<string>()

    const emit = (
      docs: QueryDocumentSnapshot<DocumentData>[],
      cached: boolean,
    ) => {
      // A server-answered emission is the one thing that ends the refusal,
      // including the `getDocsFromServer` confirmation path below.
      if (!cached) terminal = false
      if (!terminal) {
        setStatus('success')
        setError(undefined)
      }
      setFromCache(cached)
      setData(
        docs.map((docSnap) => {
          const value = { ...docSnap.data() } as Record<string, unknown>
          if (idField) value[idField] = docSnap.id
          return value as T
        }),
      )
    }

    const subscribe = () => {
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (cancelled) return
          /**
           * Only a SERVER-answered snapshot refunds the retry budget — the
           * AGL-1066 flip, and the reason it took four commits to become
           * safe.
           *
           * Under `persistentLocalCache` a reopened listen emits from the
           * cache BEFORE it learns the server refused it. Refunding on that
           * emission handed the budget back every cycle, so `attempt` never
           * reached `MAX_RETRIES`, `status` could never become `'error'`, and
           * a dead session looked exactly like a healthy one on every
           * listener-backed page for as long as it stayed dead.
           *
           * Landing this alone would have been a regression, and the three
           * things that made it one are now in place:
           *
           *  - the budget is 5 x 400ms, and the error branch used to stop
           *    retrying for good, while the heal is an AGL-664 in-place
           *    re-auth that takes as long as a human takes to type a
           *    password. A resolved re-auth now broadcasts and this listener
           *    reopens on it (`subscribeFirestoreSessionHeal` below), and a
           *    refusal streak keeps a slow road back for a recovery nobody
           *    announced (see the error branch);
           *  - `status: 'error'` had to become STICKY, or the cached emission
           *    that precedes each refusal would flip it straight back — see
           *    `terminal` above;
           *  - the surfaces that BLANK on `error` had to learn the
           *    difference between "never had data" and "have data, the server
           *    refused". They read `hasEmitted` now, so the besigner canvas
           *    and the host setup Theme tab keep rendering across a refusal
           *    instead of collapsing to "Not found".
           *
           * The withholding is keyed on a REFUSAL having happened, not on the
           * emission being cached, and that is load-bearing: offline stays
           * exactly as inert as it was. A lost network yields `unavailable`
           * (when it yields an error callback at all), which never enters
           * `deniedStreak`, so a cached emission still refunds the budget and
           * an offline listener still never goes terminal. The cache exists
           * for offline; this must not change what happens there.
           */
          // Only the SERVER answering is evidence the session can read.
          if (!snapshot.metadata.fromCache) {
            attempt = 0
            deniedStreak = 0
            denialReported = false
            setServerDenied(false)
            // Proof the session can read — stronger than any accumulated
            // denial, and what stops a scoped collaborator's by-design
            // denials from ever adding up to a re-auth prompt.
            reportFirestoreServerRead()
          } else if (deniedStreak === 0) {
            // Cached, but nothing has been refused since the server last
            // answered — so this is not the AGL-1066 fault and the budget is
            // refunded exactly as it always was.
            attempt = 0
          }

          if (confirmDisappearances) {
            const present = new Set(snapshot.docs.map((d) => d.id))
            const vanished = [...seen].filter(
              (id) => !present.has(id) && !confirmedGone.has(id),
            )
            if (vanished.length) {
              // A fresh (non-resumed) read ignores the resume token, returns
              // the true set and rewrites the cache, dropping any tombstone.
              getDocsFromServer(q)
                .then((fresh) => {
                  if (cancelled) return
                  const freshIds = new Set(fresh.docs.map((d) => d.id))
                  // Only an absence the SERVER agrees with is real. One that
                  // came back was a tombstone and must stay eligible to heal
                  // if it vanishes again.
                  vanished.forEach((id) => {
                    if (!freshIds.has(id)) confirmedGone.add(id)
                  })
                  freshIds.forEach((id) => seen.add(id))
                  // `getDocsFromServer` is server-confirmed by definition.
                  emit(fresh.docs, false)
                })
                .catch(() => {
                  // Couldn't confirm: show the live result rather than an
                  // error. A possibly-short list beats an empty one.
                  if (!cancelled) emit(snapshot.docs, snapshot.metadata.fromCache)
                })
              return
            }
            snapshot.docs.forEach((d) => seen.add(d.id))
          }

          emit(snapshot.docs, snapshot.metadata.fromCache)
        },
        (err) => {
          if (cancelled) return
          unsubscribe?.()
          // Say so once per outage, and only for a refusal — a lost network
          // produces no error callback at all, so this cannot fire offline.
          if (err?.code === 'permission-denied') {
            deniedStreak += 1
            // When the streak began — the reference point that lets
            // `refusedRetryDelayMs` ask whether the session has read from
            // the server SINCE this listen started being refused (AGL-1440).
            if (deniedStreak === 1) deniedStreakStartedAt = Date.now()
            if (deniedStreak >= DENIAL_STREAK_TO_REPORT) {
              setServerDenied(true)
              if (!denialReported) {
                denialReported = true
                reportFirestoreDenial(denialLabel)
              }
            }
          }
          if (attempt < MAX_RETRIES) {
            attempt += 1
            timer = setTimeout(
              subscribe,
              deniedStreak > MAX_RETRIES
                ? refusedRetryDelayMs(deniedStreakStartedAt)
                : RETRY_DELAY_MS,
            )
          } else {
            terminal = true
            setStatus('error')
            setError(err)
            /**
             * A refusal streak keeps a slow road back (AGL-1066).
             *
             * Before the flip this listener reopened forever, which is also
             * what HEALED it — a token that attached late, an App Check
             * hiccup, one of the AGL-1143 transient token-layer denials.
             * None of those broadcast a heal, because none of them involved
             * a re-auth the console asked for, so stopping here would leave
             * every listen in the console terminal until the user reloaded.
             * The status is corrected; the recovery is not taken away.
             *
             * Any OTHER terminal error still stops exactly as before — this
             * is deliberately keyed on the refusal streak, not on `attempt`.
             * How slow the road is depends on whether the refusal looks like
             * the session or the ref — see `refusedRetryDelayMs` (AGL-1440).
             */
            if (deniedStreak > MAX_RETRIES) {
              timer = setTimeout(
                subscribe,
                refusedRetryDelayMs(deniedStreakStartedAt),
              )
            }
          }
        },
      )
    }
    subscribe()

    /**
     * The session came back — reopen NOW rather than on the next tick of a
     * cadence tuned for a session that has not (AGL-1066).
     *
     * Gated on this listener actually being refused. A healthy listener has
     * an open subscription and nothing to recover, so it must ignore the
     * broadcast entirely: without this gate a heal would tear down and
     * reopen every listen in the console at once, which is a listener storm
     * dressed up as a fix.
     *
     * What is refunded is `attempt` — the retry BUDGET, which was spent on a
     * fault that is now over. `deniedStreak` is deliberately left alone: it
     * is evidence about the server, and only the server answering may clear
     * it. So `serverDenied` stays true across the heal and goes false on the
     * snapshot that actually proves the read works, and a heal that turns
     * out to be wishful thinking falls straight back to the slow cadence
     * instead of resuming a 400ms storm.
     *
     * `denialReported` IS reset: the outage ended here. If reads are still
     * refused afterwards that is a new one, and it has to be able to raise
     * the AGL-1063 banner again.
     */
    const unsubscribeHeal = subscribeFirestoreSessionHeal(() => {
      if (cancelled || deniedStreak === 0) return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      unsubscribe?.()
      attempt = 0
      denialReported = false
      subscribe()
    })

    return () => {
      cancelled = true
      unsubscribeHeal()
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, status, error, fromCache, serverDenied }
}

export default useFirestoreCollection
