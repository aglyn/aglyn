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

import { analyticsPathKey, checkEntitlement } from '@aglyn/aglyn'
import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useOrgPlan } from '@aglyn/tenant-feature-instance'

const DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** The last `days` UTC day ids, oldest first — the ids the beacon writes under. */
export function productTrafficDayIds(now: number, days = DAYS): string[] {
  const ids: string[] = []
  for (let back = days - 1; back >= 0; back -= 1) {
    ids.push(new Date(now - back * DAY_MS).toISOString().slice(0, 10))
  }
  return ids
}

interface DayCount {
  day: string
  views: number
  failed: boolean
}

/**
 * Module cache of closed days' counts for one path (the live day is re-read
 * after a minute): reopening a product's editor does not re-read fourteen
 * day documents.
 */
const dayCache = new Map<string, { views: number; storedAt: number }>()
const LIVE_TTL_MS = 60_000

/**
 * One product's page views, day by day (AGL-4253) — the product's own row of
 * the site's Pages table, where a merchant edits it.
 *
 * Read from `hosts/{hostId}/analytics/{day}.paths['/products/{slug}']`, never
 * from the product template screen's counts: every product renders through
 * that ONE screen, so its counts are the whole catalog's (the AGL-2498
 * lesson). Devices and referrers are counted for the site, not per page, so
 * this card does not show them.
 *
 * Paid like the Pages table (`screenAnalytics`, Pro+); a plan without it sees
 * nothing here — the Pages table is where the upgrade is offered.
 */
export function ProductTrafficCard(props: {
  hostId: string
  /** The product's STORED slug; a retyped, unsaved one names no page yet. */
  slug: string | null | undefined
}) {
  const { hostId, slug } = props
  const firestore = useFirestore()
  const { org, ready } = useOrgPlan(hostId)
  const entitled = ready && checkEntitlement(org as never, 'screenAnalytics')
  const [days, setDays] = useState<DayCount[] | null>(null)
  const path = slug ? `/products/${slug}` : null

  useEffect(() => {
    if (!entitled || !path) return
    let active = true
    const now = Date.now()
    const ids = productTrafficDayIds(now)
    const live = ids[ids.length - 1]
    const key = analyticsPathKey(path)
    void Promise.all(
      ids.map(async (day): Promise<DayCount> => {
        const cacheKey = `${hostId}|${key}|${day}`
        const hit = dayCache.get(cacheKey)
        if (hit && (day !== live || now - hit.storedAt < LIVE_TTL_MS)) {
          return { day, views: hit.views, failed: false }
        }
        try {
          const snapshot = await getDoc(doc(firestore, 'hosts', hostId, 'analytics', day))
          const paths = (snapshot.get('paths') ?? {}) as Record<string, number>
          const views = Number(paths[key] ?? 0)
          dayCache.set(cacheKey, { views, storedAt: now })
          return { day, views, failed: false }
        } catch {
          return { day, views: 0, failed: true }
        }
      }),
    ).then((counts) => {
      if (active) setDays(counts)
    })
    return () => {
      active = false
    }
  }, [entitled, firestore, hostId, path])

  if (!entitled || !path) return null

  const total = (days ?? []).reduce((sum, day) => sum + day.views, 0)
  const failed = (days ?? []).filter((day) => day.failed).length
  const max = Math.max(1, ...(days ?? []).map((day) => day.views))

  return (
    <Stack spacing={1} aria-label={'Product page views'}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
        <Typography variant="subtitle2">{'Page views (14 days)'}</Typography>
        {days !== null && (
          <Typography variant="subtitle2" color="text.secondary">
            {total.toLocaleString()}
          </Typography>
        )}
      </Stack>
      {days === null ? (
        <LinearProgress />
      ) : total === 0 && failed === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {`No views of ${path} in the last 14 days.`}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 48 }}>
          {days.map((day) => (
            <Tooltip
              key={day.day}
              title={
                day.failed
                  ? `${day.day} · could not be read`
                  : `${day.day} · ${day.views} view${day.views === 1 ? '' : 's'}`
              }
            >
              <Box
                sx={{
                  flexGrow: 1,
                  height: `${Math.max(2, (day.views / max) * 48)}px`,
                  bgcolor: day.failed ? 'warning.light' : day.views > 0 ? 'primary.main' : 'divider',
                  borderRadius: 0.5,
                }}
              />
            </Tooltip>
          ))}
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        {failed > 0
          ? `${failed} of the 14 days could not be read and are left out. `
          : ''}
        {'Counted at '}
        {path}
        {'. Every product side by side is in Analytics → Pages.'}
      </Typography>
    </Stack>
  )
}
ProductTrafficCard.displayName = 'ProductTrafficCard'

export default ProductTrafficCard
