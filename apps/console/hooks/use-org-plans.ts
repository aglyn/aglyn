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

import { isEnterpriseOrg } from '@aglyn/aglyn'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useRef, useState } from 'react'

/**
 * The billing plan/tier for each of the user's orgs, read on demand (AGL-631).
 * The org doc is the plan source of truth (webhook-mirrored); the membership
 * mirror the org switcher lists carries only role/name/slug, so the switcher
 * reads each org's plan directly. Per-doc `getDoc` keeps it rules-safe — a
 * member can read their own org doc, whereas an `in` query over `orgs` cannot
 * be proven allowed and is denied. `enabled` gates the reads to when the menu
 * opens, so nothing is fetched until the user actually looks.
 *
 * AGL-2336 — this fan-out is what capped memberships at 50, not the size of
 * the membership docs. Two rules now bound it:
 *
 *  - **Ask only for what is not already answered.** Resolved tiers accumulate
 *    for the life of the hook, so re-opening the switcher costs ZERO reads.
 *    Previously every open re-read every id, so a 50-workspace agency paid 50
 *    reads per glance at the menu and a 500-workspace one would pay 500.
 *  - **The caller passes the rows it is actually showing**, not the whole
 *    membership list — see `org-switcher-nav`'s reveal window. Cost is then
 *    proportional to what a human looked at and is independent of how many
 *    workspaces they belong to, which is the precondition for raising the cap.
 *
 * A tier resolved once is not re-read while the hook is mounted, so a plan
 * change elsewhere shows on the next load. That is fine for a row badge: the
 * workspace you are actually IN takes its badge from `useCurrentOrg`, which
 * is a live subscription.
 *
 * A FAILED read is deliberately not memoised — it is not an answer, and the
 * next open should ask again.
 */
export function useOrgPlans(
  orgIds: string[],
  enabled = true,
): Record<string, string> {
  const firestore = useFirestore()
  const [plans, setPlans] = useState<Record<string, string>>({})
  // What has been asked for already — answered or in flight. A ref, not
  // derived from `plans`, so an id whose read is still in flight is not
  // re-requested by the next render.
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)
  const key = orgIds.join(',')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A different Firestore instance is a different world; drop the memo with
  // it rather than serve another instance's answers. Declared BEFORE the
  // fetch effect so it runs first on the render that swaps the instance, and
  // skipped on the first run so mounting does not cost a wasted re-render.
  const instance = useRef(firestore)
  useEffect(() => {
    if (instance.current === firestore) return
    instance.current = firestore
    requested.current = new Set<string>()
    setPlans({})
  }, [firestore])

  useEffect(() => {
    if (!enabled) return undefined
    const wanted = orgIds.filter((id) => id && !requested.current.has(id))
    if (wanted.length === 0) return undefined
    wanted.forEach((id) => requested.current.add(id))
    void Promise.all(
      wanted.map(async (id) => {
        try {
          const snap = await getDoc(doc(firestore, 'orgs', id))
          // A custom-priced enterprise deal reads as "enterprise" regardless of
          // its base plan (AGL-1110).
          if (isEnterpriseOrg(snap.data() as never)) {
            return [id, 'enterprise'] as const
          }
          // An org on the free tier has no `plan` field at all — the webhook
          // only writes one for a paid subscription. A successful read with
          // no plan therefore MEANS free, and must be reported as such;
          // leaving it absent made "free" look identical to "not loaded"
          // (AGL-646). Only a failed read stays unknown.
          return [
            id,
            (snap.get('plan') as string | undefined) ?? 'free',
          ] as const
        } catch {
          // Not an answer — let the next open ask again.
          requested.current.delete(id)
          return [id, undefined] as const
        }
      }),
    ).then((entries) => {
      // Deliberately NOT gated on an effect-scoped `cancelled` flag: closing
      // the switcher flips `enabled` and tears this effect down, and dropping
      // an in-flight answer there would leave the id marked requested and
      // permanently unanswerable. Only an unmounted hook stops caring.
      if (!mounted.current) return
      const resolved = entries.filter((entry): entry is [string, string] =>
        Boolean(entry[1]),
      )
      if (resolved.length === 0) return
      // MERGE, never replace: the map spans every row revealed so far, and
      // replacing it would blank the badges on rows already on screen.
      setPlans((current) => ({ ...current, ...Object.fromEntries(resolved) }))
    })
    return undefined
    // `key` captures the org-id list; enabled toggles the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, key, enabled])

  return plans
}

export default useOrgPlans
