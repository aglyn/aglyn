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
  reportFirestoreDenial,
  reportFirestoreServerRead,
} from './firestore-denial-reporter'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

/**
 * Cadence once a refusal streak has outlived the retry budget (AGL-1066).
 *
 * Until that point the fault is indistinguishable from the AGL-216/217
 * post-sign-in token race, which resolves in well under two seconds, so the
 * fast cadence is what recovers the page. Past it the session is refusing
 * this listen and reopening 2.5 listeners a second buys nothing — but the
 * loop must NOT stop, because the heal (an AGL-664 in-place re-auth) takes as
 * long as a human takes to type a password, and nothing else re-subscribes.
 *
 * The ceiling on this number is not the churn — it is the 38 AGL-1358 write
 * guards, which refuse a save while `fromCache` is true and can only learn
 * otherwise from a reopened listener that the server answers. Whatever this
 * is, it is also how long a save stays refused AFTER the session heals. Two
 * seconds still cuts the churn fivefold and is inside the latency of the
 * click that follows a re-auth.
 */
const REFUSED_RETRY_DELAY_MS = 2_000

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
   * This is what `status` would say if the budget were spendable — see the
   * note on the retry loop below for why it is not, and why correcting
   * `status` in place is a staged change rather than a one-liner. Until that
   * flip lands, this is the honest verdict: any `data` alongside it is
   * cache-only and will not refresh on its own.
   *
   * Only `permission-denied` counts, so it cannot fire offline, and a single
   * server snapshot clears it — the same two properties that make the
   * `session-health` reporting safe.
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
    let denialReported = false
    const denialLabel = denialLabelForQuery(q)
    // Disappearance tracking (AGL-1196); inert unless opted in.
    const seen = new Set<string>()
    const confirmedGone = new Set<string>()

    const emit = (
      docs: QueryDocumentSnapshot<DocumentData>[],
      cached: boolean,
    ) => {
      setStatus('success')
      setError(undefined)
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
           * Ungated ON PURPOSE, and this is the open half of AGL-1066.
           *
           * Under `persistentLocalCache` the cached emission that precedes a
           * refusal lands here and hands the budget back, so `attempt` never
           * reaches `MAX_RETRIES` and `status` can never become `'error'`.
           * Gating this on `!snapshot.metadata.fromCache` is the correction —
           * one line — but it is NOT safe to make in isolation:
           *
           *  - the budget is 5 x 400ms = two seconds, after which the error
           *    branch stops retrying for good. An AGL-664 in-place re-auth
           *    takes far longer than that and nothing re-subscribes, so every
           *    listener would already have given up by the time the session
           *    healed;
           *  - `error` blanks surfaces that today render cached data — the
           *    besigner editors swap the canvas for "Not found", and the host
           *    setup Theme tab renders nothing.
           *
           * `serverDenied` below carries the corrected verdict in the
           * meantime, so consumers can migrate before `status` moves.
           */
          attempt = 0
          // Only the SERVER answering is evidence the session can read.
          if (!snapshot.metadata.fromCache) {
            deniedStreak = 0
            denialReported = false
            setServerDenied(false)
            // Proof the session can read — stronger than any accumulated
            // denial, and what stops a scoped collaborator's by-design
            // denials from ever adding up to a re-auth prompt.
            reportFirestoreServerRead()
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
                ? REFUSED_RETRY_DELAY_MS
                : RETRY_DELAY_MS,
            )
          } else {
            setStatus('error')
            setError(err)
          }
        },
      )
    }
    subscribe()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, status, error, fromCache, serverDenied }
}

export default useFirestoreCollection
