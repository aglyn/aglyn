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

import type { HostAccessRole } from '@aglyn/aglyn'
import {
  collection,
  getDocsFromServer,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

/**
 * Every host role, as a value (AGL-1145).
 *
 * `/hosts/{hostId}` is gated per document on `memberRoles.{uid}` and Firestore
 * refuses to run a LIST that could return a denied document, so this filter is
 * mandatory — and it must name ALL the roles, or a member silently cannot see
 * a site they hold.
 *
 * Declared here rather than imported as a value: the `@aglyn/aglyn` barrel
 * pulls the whole library in, which these hooks do not otherwise need. The
 * `Record` keeps it honest anyway — adding a role to `HostAccessRole` fails to
 * compile here, exactly as it does at the shared `HOST_ACCESS_ROLES`.
 */
const HOST_ACCESS_ROLE_KEYS: Record<HostAccessRole, true> = {
  admin: true,
  editor: true,
  viewer: true,
}
const HOST_ACCESS_ROLES = Object.keys(HOST_ACCESS_ROLE_KEYS) as HostAccessRole[]

const RETRY_DELAY_MS = 400
// Cold loads (a refresh or a pasted deep link) restore the auth session and
// only then attach the ID token to Firestore, so the first host listen can sit
// in transient `permission-denied` longer than the post-sign-in click this was
// first tuned for (AGL-216). 8 × 400ms ≈ 3.2s of headroom before we give up —
// enough that a valid host rarely falls through to the error path below
// (AGL-813).
const MAX_RETRIES = 8

export interface OrgHost extends DocumentData {
  $id: string
}

/**
 * Subscribes to the hosts where the user holds any `memberRoles` tier
 * (admin/editor/viewer), with its own retry —
 * NOT via `useFirestoreCollectionData` (reactfire), whose cached Observable
 * is a *terminated* RxJS stream once it errors: resubscribing (even from a
 * freshly remounted component) replays the same cached error forever rather
 * than opening a new Firestore listen. Right after sign-in, `useUser()` can
 * report a signed-in user a beat before Firestore's own credential provider
 * has attached that user's ID token, so this first listen can hit one
 * transient `permission-denied`. Registering a genuinely fresh `onSnapshot`
 * listener on a short backoff resolves it once the token has propagated
 * (AGL-216).
 */
export function useOrgHosts(
  firestore: Firestore,
  uid: string | undefined,
  /**
   * Org scope (AGL-236): the current org's id keeps every host list
   * inside the selected workspace — without it a member of several orgs
   * sees all their sites mixed together. Pass `undefined` while the
   * workspace is still resolving (the hook holds off rather than flash
   * another org's sites) and `null` for accounts with no org yet.
   */
  orgId?: string | null,
): { hosts: OrgHost[]; ready: boolean; error: boolean } {
  const [hosts, setHosts] = useState<OrgHost[]>([])
  const [ready, setReady] = useState(false)
  // `true` only when resolution SETTLED by exhausting retries (never from a
  // clean empty result). It lets the HostGuard tell "couldn't load your sites"
  // apart from "this site isn't one you can open" — the former must offer a
  // retry, not a false 404 for a host that actually exists (AGL-813).
  const [error, setError] = useState(false)

  useEffect(() => {
    setReady(false)
    setHosts([])
    setError(false)
    if (!uid || orgId === undefined) return

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    // Guards for the two server-confirm fallbacks below (AGL-827, AGL-929).
    //
    // `serverConfirmed` covers an EMPTY live result. It resets once a real
    // result arrives, so a second transient later in the same session can heal
    // too — it used to be a one-shot for the life of the subscription.
    //
    // `seen` and `confirmedGone` cover the PARTIAL case: a host this
    // subscription already saw that has since vanished. A host is only added
    // to `confirmedGone` when the SERVER agrees it is gone, so one that came
    // back from a tombstone stays eligible to heal if it disappears again.
    let serverConfirmed = false
    const seen = new Set<string>()
    const confirmedGone = new Set<string>()

    const subscribe = () => {
      // The org membership projection (AGL-233) is the only host
      // authority (AGL-238); scoping by orgId keeps the query inside the
      // rules' membership constraint.
      const q = query(
        collection(firestore, 'hosts'),
        where(`memberRoles.${uid}`, 'in', HOST_ACCESS_ROLES),
        ...(orgId ? [where('orgId', '==', orgId)] : []),
      )
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          // Stale-negative-cache heal (AGL-827): the console runs a persistent
          // multi-tab IndexedDB cache. If a host briefly stopped matching this
          // query (a create/rename/org-assign writes memberRoles + orgId in
          // steps), a tab can cache a `noDocument` tombstone for it — and
          // because the resumed listen only pulls DELTAS via its resume token,
          // an unchanged host is never re-sent, so the tombstone sticks across
          // reloads and the site vanishes from the list while existing fine on
          // the server. So an EMPTY live result is not yet trustworthy: confirm
          // it once against the backend with a fresh (non-resumed) query, which
          // ignores the resume token, returns the true result set, and writes
          // it back into the cache — dropping any stale tombstone.
          //
          // Crucially, do NOT settle (`ready`) on that empty result: the
          // HostGuard 404s the moment it sees ready+no-host, which would beat
          // the async confirm and 404 a site the server still has (AGL-813).
          // Hold the spinner and settle only once the confirm returns — as a
          // match if healed, a genuine 404 if truly empty, or a retry if the
          // confirm itself failed. A populated list settles immediately and
          // costs no extra read.
          const confirmAgainstServer = (candidates: string[]) => {
            getDocsFromServer(q)
              .then((fresh) => {
                if (cancelled) return
                const freshIds = new Set(fresh.docs.map((doc) => doc.id))
                // Only a host the SERVER also reports missing is genuinely
                // gone. One that reappears was a tombstone, and must stay
                // eligible to heal the next time it vanishes.
                candidates.forEach((id) => {
                  if (!freshIds.has(id)) confirmedGone.add(id)
                })
                freshIds.forEach((id) => seen.add(id))
                setHosts(
                  fresh.docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
                )
                setError(false)
                setReady(true)
              })
              .catch(() => {
                if (cancelled) return
                // Couldn't confirm (offline/transient): surface a retry, never
                // a false 404. The live listener stays the source of truth.
                setError(true)
                setReady(true)
              })
          }

          if (snapshot.empty && !serverConfirmed) {
            serverConfirmed = true
            confirmAgainstServer([...seen])
            return
          }

          // AGL-929: the empty check above only catches TOTAL loss. An org
          // with three sites that tombstones ONE produces a snapshot of two —
          // not empty — so the heal never ran and that site stayed missing
          // from the switcher until the resume token was discarded. For a
          // multi-site org that is the likelier failure, not the rarer one.
          //
          // A host this subscription has already seen, now absent, is the same
          // signature as the empty case and gets the same treatment. A genuine
          // removal confirms once and then sits in `confirmedGone`, so it does
          // not re-confirm on every later snapshot.
          const present = new Set(snapshot.docs.map((doc) => doc.id))
          const vanished = [...seen].filter(
            (id) => !present.has(id) && !confirmedGone.has(id),
          )
          if (vanished.length) {
            confirmAgainstServer(vanished)
            return
          }

          snapshot.docs.forEach((doc) => seen.add(doc.id))
          // A real result means the next empty one deserves its own confirm.
          serverConfirmed = false
          setError(false)
          setReady(true)
          setHosts(
            snapshot.docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
          )
        },
        () => {
          if (cancelled) return
          unsubscribe?.()
          if (attempt < MAX_RETRIES) {
            attempt += 1
            timer = setTimeout(subscribe, RETRY_DELAY_MS)
          } else {
            // Give up gracefully rather than crash the app, but FLAG it: an
            // empty list here means "the read never succeeded", not "no hosts".
            // Consumers that gate a 404 on emptiness must not fire on this
            // (AGL-813).
            setError(true)
            setReady(true)
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
  }, [firestore, uid, orgId])

  return { hosts, ready, error }
}

export default useOrgHosts
