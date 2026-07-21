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

import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'

/**
 * The billing plan/tier for each of the user's orgs, read on demand (AGL-631).
 * The org doc is the plan source of truth (webhook-mirrored); the membership
 * mirror the org switcher lists carries only role/name/slug, so the switcher
 * reads each org's plan directly. Per-doc `getDoc` keeps it rules-safe — a
 * member can read their own org doc, whereas an `in` query over `orgs` cannot
 * be proven allowed and is denied. `enabled` gates the reads to when the menu
 * opens, so nothing is fetched until the user actually looks.
 */
export function useOrgPlans(
  orgIds: string[],
  enabled = true,
): Record<string, string> {
  const firestore = useFirestore()
  const [plans, setPlans] = useState<Record<string, string>>({})
  const key = orgIds.join(',')

  useEffect(() => {
    if (!enabled || orgIds.length === 0) return undefined
    let cancelled = false
    void Promise.all(
      orgIds.map(async (id) => {
        try {
          const snap = await getDoc(doc(firestore, 'orgs', id))
          // An org on the free tier has no `plan` field at all — the webhook
          // only writes one for a paid subscription. A successful read with
          // no plan therefore MEANS free, and must be reported as such;
          // leaving it absent made "free" look identical to "not loaded"
          // (AGL-646). Only a failed read stays unknown.
          return [id, (snap.get('plan') as string | undefined) ?? 'free'] as const
        } catch {
          return [id, undefined] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      setPlans(
        Object.fromEntries(
          entries.filter((entry): entry is [string, string] =>
            Boolean(entry[1]),
          ),
        ),
      )
    })
    return () => {
      cancelled = true
    }
    // `key` captures the org-id list; enabled toggles the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, key, enabled])

  return plans
}

export default useOrgPlans
