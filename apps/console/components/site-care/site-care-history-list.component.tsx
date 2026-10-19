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

import { formatSiteCareDate } from '@aglyn/aglyn/app-utils/site-care'
import { Stack, Typography } from '@mui/material'

/** One history row as the routes return it. */
export interface SiteCareHistoryEntry {
  $id?: string
  atMs: number
  byEmail?: string | null
  kind?: string
  summary: string
  reason?: string | null
  stripe?: { object: string; id: string } | null
}

export interface SiteCareHistoryListProps {
  rows: readonly SiteCareHistoryEntry[]
  /** Staff see who did it, the row's kind and the Stripe object; owners do not. */
  staff?: boolean
  empty?: string
}

/**
 * An append-only history, oldest first: one dated line per thing that
 * happened, with the reason under a correction (AGL-3959). The staff
 * request panel, the staff month card and the owner's Billing card share it,
 * so the record reads the same wherever it is shown.
 */
export function SiteCareHistoryList({ rows, staff, empty }: SiteCareHistoryListProps) {
  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty ?? 'Nothing recorded yet.'}
      </Typography>
    )
  }
  return (
    <Stack spacing={1} component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {rows.map((row, index) => (
        <Stack key={row.$id ?? `${row.atMs}-${index}`} component="li" spacing={0.25}>
          <Typography variant="caption" color="text.secondary">
            {[
              formatSiteCareDate(row.atMs),
              staff ? (row.byEmail ?? 'System') : null,
              staff ? row.kind : null,
              staff && row.stripe ? `${row.stripe.object} ${row.stripe.id}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <Typography variant="body2">{row.summary}</Typography>
          {row.reason ? (
            <Typography variant="body2" color="text.secondary">
              {`Why: ${row.reason}`}
            </Typography>
          ) : null}
        </Stack>
      ))}
    </Stack>
  )
}

SiteCareHistoryList.displayName = 'SiteCareHistoryList'

export default SiteCareHistoryList
