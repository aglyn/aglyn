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

import { collection } from 'firebase/firestore'
import { useMemo } from 'react'
import { collectionCeiling } from './host-collection-queries'
import { useFirestore } from './firebase/firebase-services'
import { useFirestoreCollection } from './use-firestore-collection'

/**
 * How many campaigns a picker offers.
 *
 * The same fifty the campaigns table draws, so a campaign a merchant can see
 * in the list is a campaign they can file a record under. A picker with a
 * larger window would offer campaigns the list they came from does not show;
 * a smaller one would hide campaigns that are plainly there.
 */
export const HOST_CAMPAIGN_CEILING = 50

/** One campaign, as much of it as a picker needs. */
export interface HostCampaignOption {
  value: string
  label: string
  /** The campaign window, for a caller that wants to say when it ran. */
  startAtMs?: number | null
  endAtMs?: number | null
}

export interface HostCampaigns {
  options: HostCampaignOption[]
  /** The site holds more campaigns than the ceiling offers. */
  truncated: boolean
  /** The read has answered — false while it is still settling or disabled. */
  ready: boolean
}

/**
 * THE SITE'S CAMPAIGNS, for a picker on some other record's page.
 *
 * Lives here rather than in the marketing plugin because the console app may
 * not import a feature plugin — a screen's detail page is an app route — and
 * the form and contact surfaces that need the same list are two other
 * libraries again. One read, one shape, three callers.
 *
 * ## It is OFF unless a caller asks
 *
 * `enabled` defaults to false. The picker this feeds sits on a record's own
 * page beside fields a reader came for; charging every open of a form, a
 * screen or a contact for a hundred campaign documents they may not touch is
 * the read-on-mount this console refuses. The callers turn it on when their
 * editing surface opens.
 *
 * ## Ordered on the document name
 *
 * `collectionCeiling`, for the reason it exists: `startAtMs` and `endAtMs`
 * are both optional on a campaign — an open-ended one carries neither — so
 * ordering on a date would not mis-sort the picker, it would DROP the
 * campaigns that have no dates. The labels are sorted by name here, over the
 * whole ceiling rather than a slice of it, which is the one case sorting a
 * window is honest.
 */
export function useHostCampaigns(
  hostId: string | undefined,
  options?: { enabled?: boolean },
): HostCampaigns {
  const enabled = options?.enabled ?? false
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      enabled && hostId
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'emailCampaigns'),
            HOST_CAMPAIGN_CEILING,
          )
        : null,
    [firestore, hostId, enabled],
    { idField: '$id' },
  )

  return useMemo(() => {
    const rows = data ?? []
    const truncated = rows.length > HOST_CAMPAIGN_CEILING
    const live = rows
      .slice(0, HOST_CAMPAIGN_CEILING)
      // A campaign the console soft-deleted is not a campaign a record may be
      // filed under. The campaigns table filters the same field for the same
      // reason.
      .filter((row) => !row['deletedAt'])
    return {
      options: live
        .map((row) => ({
          value: String(row['$id']),
          label: String(row['name'] ?? row['$id']),
          startAtMs: (row['startAtMs'] as number | null | undefined) ?? null,
          endAtMs: (row['endAtMs'] as number | null | undefined) ?? null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      truncated,
      ready: enabled && status !== 'loading',
    }
  }, [data, enabled, status])
}

export default useHostCampaigns
