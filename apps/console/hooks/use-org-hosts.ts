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
  doc,
  getDocsFromServer,
  onSnapshot,
  query,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

/**
 * Every host role, as a value (AGL-1145).
 *
 * This used to be a MANDATORY query constraint: `/hosts/{hostId}` is gated per
 * document on `memberRoles.{uid}`, Firestore refuses to run a LIST that could
 * return a denied document, and a missing role here meant a member silently
 * could not see a site they held.
 *
 * It is now an in-memory filter over the membership mirror (AGL-1190), so it
 * no longer decides whether the read is allowed at all — the per-host read
 * does. It stays because it still expresses which roles count as access, and
 * the `Record` keeps it honest: adding a role to `HostAccessRole` fails to
 * compile here.
 *
 * Declared rather than imported as a value: the `@aglyn/aglyn` barrel pulls
 * the whole library in, which these hooks do not otherwise need.
 */
const HOST_ACCESS_ROLE_KEYS: Record<HostAccessRole, true> = {
  admin: true,
  editor: true,
  viewer: true,
}
const HOST_ACCESS_ROLES = new Set<string>(Object.keys(HOST_ACCESS_ROLE_KEYS))

const RETRY_DELAY_MS = 400
// Cold loads (a refresh or a pasted deep link) restore the auth session and
// only then attach the ID token to Firestore, so the first listen can sit in
// transient `permission-denied` longer than the post-sign-in click this was
// first tuned for (AGL-216). 8 × 400ms ≈ 3.2s of headroom before we give up —
// enough that a valid host rarely falls through to the error path below
// (AGL-813).
const MAX_RETRIES = 8

export interface OrgHost extends DocumentData {
  $id: string
}

/**
 * The user's sites, as full host documents.
 *
 * ## Why this reads the mirror and not `hosts` (AGL-1190)
 *
 * It used to run a live query over the shared `hosts` collection, constrained
 * on `memberRoles.{uid}` and `orgId`. Both are MUTABLE, and that is the whole
 * problem: when a create, rename or org-assign writes those fields in steps, a
 * host transiently stops matching, leaves the query target, and the client can
 * cache a `noDocument` tombstone at `hosts/{hostId}`. The document cache is
 * keyed by PATH, not by target, so that tombstone is then served to every
 * other reader of that host — and because a resumed listen pulls only deltas,
 * an unchanged host is never re-sent and it outlives reloads (AGL-827/929).
 *
 * So: take the candidate ids from `users/{uid}/hostMemberships` with NO `where`
 * clause at all — its rule is `request.auth.uid == userId`, with no
 * `resource.data` term, so an unconstrained list is permitted — and filter by
 * org in memory. With no predicate, no document can stop matching, nothing
 * enters limbo resolution, and nothing gets tombstoned. Then read each host by
 * id: single-document targets do not go through limbo either, so `hosts/{id}`
 * is no longer reachable by any client query.
 *
 * That is also why the per-document heal AGL-929 added is gone. It existed to
 * repair spurious disappearances from a predicated query; an unconstrained
 * query cannot produce one, because "filtered out" is not a state a document
 * can be in. The empty-result confirm below stays — it guards a different
 * thing (trusting an empty answer at all), not tombstones.
 *
 * ## The mirror is a hint, not the gate
 *
 * `hostMemberships` is a server-written convenience index. It supplies
 * CANDIDATES; authorization still happens on the per-host read, where the
 * `memberRoles` rule applies exactly as before. A stale or wrong row yields a
 * denied host read and the host is dropped — it can cost a visible site, never
 * leak one.
 *
 * ## Retry
 *
 * Not via `useFirestoreCollectionData` (reactfire), whose cached Observable is
 * a *terminated* RxJS stream once it errors: resubscribing (even from a freshly
 * remounted component) replays the same cached error forever rather than
 * opening a new Firestore listen. Right after sign-in, `useUser()` can report a
 * signed-in user a beat before Firestore's credential provider has attached
 * that user's ID token, so the first listen can hit one transient
 * `permission-denied`. A genuinely fresh `onSnapshot` on a short backoff
 * resolves it once the token has propagated (AGL-216).
 */
export function useOrgHosts(
  firestore: Firestore,
  uid: string | undefined,
  /**
   * Org scope (AGL-236): the current org's id keeps every host list inside the
   * selected workspace — without it a member of several orgs sees all their
   * sites mixed together. Pass `undefined` while the workspace is still
   * resolving (the hook holds off rather than flash another org's sites) and
   * `null` for accounts with no org yet, which lists every site they hold.
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
    let membershipUnsub: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    // One-shot guard for the empty-result confirm; re-armed by any real result
    // so a session that empties, recovers and empties again confirms twice.
    let emptyConfirmed = false

    /** Live host documents, keyed by id. `null` = resolved as unreadable. */
    const hostDocs = new Map<string, OrgHost | null>()
    const hostUnsubs = new Map<string, () => void>()
    let wantedIds: string[] = []

    const membershipQuery = query(
      collection(firestore, 'users', uid, 'hostMemberships'),
    )

    /** Ids this user holds in scope, in mirror order. */
    const idsFrom = (docs: Array<{ id: string; data: () => DocumentData }>) =>
      docs
        .filter((row) => {
          const value = row.data()
          if (orgId && value.orgId !== orgId) return false
          // A row whose role is not an access role is not a site they hold.
          // The per-host read would deny it anyway; skipping it here saves a
          // listener and a guaranteed denial.
          return value.role === undefined || HOST_ACCESS_ROLES.has(value.role)
        })
        .map((row) => row.id)

    /**
     * Settle only once EVERY wanted host has resolved. Publishing a partial
     * list would let a consumer that gates a 404 on emptiness fire against a
     * list that is merely still loading (AGL-813).
     */
    const publish = () => {
      if (cancelled) return
      if (wantedIds.some((id) => !hostDocs.has(id))) return
      setHosts(
        wantedIds
          .map((id) => hostDocs.get(id))
          .filter((host): host is OrgHost => host != null),
      )
      setError(false)
      setReady(true)
    }

    const watchHost = (id: string) => {
      if (hostUnsubs.has(id)) return
      hostUnsubs.set(
        id,
        onSnapshot(
          doc(firestore, 'hosts', id),
          (snap) => {
            if (cancelled) return
            hostDocs.set(
              id,
              snap.exists() ? { $id: snap.id, ...snap.data() } : null,
            )
            publish()
          },
          () => {
            if (cancelled) return
            // Denied or unavailable: the mirror row is stale, or access was
            // removed. Drop this host rather than failing the whole list —
            // the mirror is a hint and this read is the gate.
            hostDocs.set(id, null)
            publish()
          },
        ),
      )
    }

    const applyIds = (ids: string[]) => {
      if (cancelled) return
      wantedIds = ids
      const wanted = new Set(ids)
      for (const [id, unsubscribe] of [...hostUnsubs]) {
        if (!wanted.has(id)) {
          unsubscribe()
          hostUnsubs.delete(id)
          hostDocs.delete(id)
        }
      }
      ids.forEach(watchHost)
      // Covers the confirmed-empty case, which has nothing to wait for.
      publish()
    }

    const subscribe = () => {
      membershipUnsub = onSnapshot(
        membershipQuery,
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          const ids = idsFrom(snapshot.docs)

          // An EMPTY live result is not yet trustworthy — it can also be a
          // read that never truly succeeded. Confirm it once against the
          // backend with a fresh (non-resumed) query, and do NOT settle in the
          // meantime: a consumer that 404s on ready+empty would beat the async
          // confirm and 404 a workspace that has sites (AGL-813/827).
          if (ids.length === 0 && !emptyConfirmed) {
            emptyConfirmed = true
            getDocsFromServer(membershipQuery)
              .then((fresh) => {
                if (cancelled) return
                applyIds(idsFrom(fresh.docs))
              })
              .catch(() => {
                if (cancelled) return
                // Couldn't confirm (offline/transient): surface a retry, never
                // a false 404. The live listener stays the source of truth.
                setError(true)
                setReady(true)
              })
            return
          }

          if (ids.length > 0) emptyConfirmed = false
          applyIds(ids)
        },
        () => {
          if (cancelled) return
          membershipUnsub?.()
          membershipUnsub = null
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
      membershipUnsub?.()
      hostUnsubs.forEach((unsubscribe) => unsubscribe())
      hostUnsubs.clear()
    }
  }, [firestore, uid, orgId])

  return { hosts, ready, error }
}

export default useOrgHosts
