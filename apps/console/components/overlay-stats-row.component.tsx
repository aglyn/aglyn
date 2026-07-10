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

import { Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'

const DAYS = 14

/**
 * 14-day overlay metrics line (AGL-200): sums the `overlays` map from the
 * AGL-82 analytics day docs. `impressionKey`/`actionKey` pick which
 * counters a given card cares about (popup vs announcement bar).
 */
export function OverlayStatsRow(props: {
  hostId: string
  impressionKey?: string
  actionKey: string
  actionLabel: string
}) {
  const { hostId, impressionKey, actionKey, actionLabel } = props
  const firestore = useFirestore()
  const [stats, setStats] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    let active = true
    const ids = Array.from({ length: DAYS }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (DAYS - 1 - index))
      return date.toISOString().slice(0, 10)
    })
    void Promise.all(
      ids.map((id) =>
        getDoc(doc(firestore, 'hosts', hostId, 'analytics', id))
          .then(
            (snapshot) =>
              (snapshot.get('overlays') ?? {}) as Record<string, number>,
          )
          .catch(() => ({}) as Record<string, number>),
      ),
    ).then((days) => {
      if (!active) return
      const totals: Record<string, number> = {}
      for (const day of days) {
        for (const [key, value] of Object.entries(day)) {
          totals[key] = (totals[key] ?? 0) + Number(value ?? 0)
        }
      }
      setStats(totals)
    })
    return () => {
      active = false
    }
  }, [firestore, hostId])

  if (!stats) return null
  const impressions = impressionKey ? (stats[impressionKey] ?? 0) : null
  const actions = stats[actionKey] ?? 0
  if (!impressions && !actions) return null
  return (
    <Typography variant="caption" color="text.secondary">
      {[
        impressions !== null
          ? `${impressions.toLocaleString()} impressions`
          : null,
        `${actions.toLocaleString()} ${actionLabel}`,
      ]
        .filter(Boolean)
        .join(' · ') + ' (14 days)'}
    </Typography>
  )
}
OverlayStatsRow.displayName = 'OverlayStatsRow'

export default OverlayStatsRow
