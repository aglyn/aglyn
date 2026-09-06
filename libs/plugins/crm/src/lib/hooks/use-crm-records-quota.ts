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
  type AglynOrgBilling,
  checkCrmRecordsQuota,
  CRM_RECORD_COLLECTIONS,
  type CrmRecordsQuotaResult,
} from '@aglyn/aglyn'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, getCountFromServer } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

export interface CrmRecordsQuotaState {
  /** The contacts aggregate, or `null` while pending or denied. */
  contactsCount: number | null
  companiesCount: number | null
  dealsCount: number | null
  /**
   * The three summed, with an unanswered one counted as its fallback — a
   * LOWER bound until `ready`, never an overstatement, so no alert this
   * number gates can fire on a count larger than the truth.
   */
  crmRecordsCount: number
  /** The band's verdict on `crmRecordsCount`. */
  quota: CrmRecordsQuotaResult
  /** All three aggregates have answered. */
  ready: boolean
}

/**
 * The CRM records band as the browser can measure it (AGL-2611): one
 * server-side aggregate per counted collection, read once per mount, summed,
 * and handed to `checkCrmRecordsQuota` — the client twin of the server's
 * `countCrmRecords`, for the surfaces that write client-direct.
 *
 * The contacts list has always read its head-count this way (AGL-1706): the
 * listener is `limit(1000)` and must never answer "how many". What the band
 * widening adds is the two collections beside it, so the list's alert and
 * the company and deal drawers refuse on the same number the rollup bills.
 *
 * `scope` may be `null` to read nothing — a drawer that is closed, or a
 * drawer editing an existing record, has no create to gate and pays for no
 * aggregate. A denied read stays `null` and falls back: the band alert on a
 * Free org must not be cleared by a count that could not be taken, and a
 * defaulted 0 would do exactly that.
 */
export function useCrmRecordsQuota(
  scope: readonly ['orgs', string] | null | undefined,
  org: Partial<AglynOrgBilling> | null | undefined,
  options: { contactsFallback?: number | null } = {},
): CrmRecordsQuotaState {
  const firestore = useFirestore()
  const { contactsFallback = null } = options
  const [counts, setCounts] = useState<Record<string, number | null>>({})

  /*
   * Every state write below is IDENTITY-PRESERVING when nothing changed —
   * the same answer to the same read hands back the same object — so the
   * effect reaches a steady state even under a caller whose `scope` tuple
   * is not referentially stable. A reset that minted a fresh `{}` per run
   * would re-render, re-fire on the fresh tuple, reset again, and never
   * settle: a read per render at best, a hung surface at worst.
   */
  useEffect(() => {
    if (!scope) return
    let active = true
    const record = (name: string, value: number | null) =>
      setCounts((current) =>
        name in current && current[name] === value
          ? current
          : { ...current, [name]: value },
      )
    for (const name of CRM_RECORD_COLLECTIONS) {
      void getCountFromServer(collection(firestore, scope[0], scope[1], name))
        .then((snapshot) => {
          if (active) record(name, snapshot.data().count)
        })
        .catch(() => {
          // Denied or unavailable: `null`, and the fallback stands in.
          if (active) record(name, null)
        })
    }
    return () => {
      active = false
    }
  }, [firestore, scope])

  return useMemo(() => {
    const contactsCount = counts['contacts'] ?? null
    const companiesCount = counts['companies'] ?? null
    const dealsCount = counts['deals'] ?? null
    const crmRecordsCount =
      (contactsCount ?? contactsFallback ?? 0) +
      (companiesCount ?? 0) +
      (dealsCount ?? 0)
    return {
      contactsCount,
      companiesCount,
      dealsCount,
      crmRecordsCount,
      quota: checkCrmRecordsQuota(org, crmRecordsCount),
      ready: CRM_RECORD_COLLECTIONS.every((name) => name in counts),
    }
  }, [counts, contactsFallback, org])
}

export default useCrmRecordsQuota
