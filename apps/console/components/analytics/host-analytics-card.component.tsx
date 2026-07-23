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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'

interface DayStat {
  day: string
  total: number
  paths: Record<string, number>
  referrers: Record<string, number>
  devices: Record<string, number>
}

/**
 * Glanceable traffic panel (AGL-82, insights AGL-138): pageviews over a
 * selectable window from the per-day counter docs the tenant beacon
 * writes, plus top pages, top referrers, and a device split. Explicitly
 * not a GA replacement — Setup accepts a GA measurement id for that.
 */
export function HostAnalyticsCard(props: {
  hostId: string
  /** "View details" link, shown on the dashboard glance (AGL-352). */
  viewAllHref?: string
}) {
  const { hostId, viewAllHref } = props
  const firestore = useFirestore()
  const [days, setDays] = useState<DayStat[] | null>(null)
  const [range, setRange] = useState(14)

  useEffect(() => {
    let active = true
    const ids = Array.from({ length: range }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (range - 1 - index))
      return date.toISOString().slice(0, 10)
    })
    void Promise.all(
      ids.map((id) =>
        getDoc(doc(firestore, 'hosts', hostId, 'analytics', id))
          .then((snapshot) => ({
            day: id,
            total: Number(snapshot.get('total') ?? 0),
            paths: (snapshot.get('paths') ?? {}) as Record<string, number>,
            referrers: (snapshot.get('referrers') ?? {}) as Record<
              string,
              number
            >,
            devices: (snapshot.get('devices') ?? {}) as Record<
              string,
              number
            >,
          }))
          .catch(() => ({
            day: id,
            total: 0,
            paths: {},
            referrers: {},
            devices: {},
          })),
      ),
    ).then((stats) => {
      if (active) setDays(stats)
    })
    return () => {
      active = false
    }
  }, [firestore, hostId, range])

  const total = (days ?? []).reduce((sum, day) => sum + day.total, 0)
  const max = Math.max(1, ...(days ?? []).map((day) => day.total))
  const topPaths = Object.entries(
    (days ?? []).reduce<Record<string, number>>((acc, day) => {
      for (const [path, count] of Object.entries(day.paths)) {
        acc[path] = (acc[path] ?? 0) + count
      }
      return acc
    }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
  const topReferrers = Object.entries(
    (days ?? []).reduce<Record<string, number>>((acc, day) => {
      for (const [host, count] of Object.entries(day.referrers)) {
        acc[host] = (acc[host] ?? 0) + count
      }
      return acc
    }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
  const deviceTotals = (days ?? []).reduce<Record<string, number>>(
    (acc, day) => {
      for (const [device, count] of Object.entries(day.devices)) {
        acc[device] = (acc[device] ?? 0) + count
      }
      return acc
    },
    {},
  )
  const deviceSum = Object.values(deviceTotals).reduce(
    (sum, count) => sum + count,
    0,
  )
  // Top insights (AGL-386): per-day average, week-over-week trend, and
  // the leading device — computed from the same day-counter docs.
  const dayCount = (days ?? []).length || 1
  const avgPerDay = Math.round(total / dayCount)
  const last7 = (days ?? []).slice(-7).reduce((sum, d) => sum + d.total, 0)
  const prev7 = (days ?? []).slice(-14, -7).reduce((sum, d) => sum + d.total, 0)
  const wowPct = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : null
  const topDevice = Object.entries(deviceTotals).sort(
    ([, a], [, b]) => b - a,
  )[0]?.[0]

  return (
    <CardDisplay
      header={'Traffic'}
      help={docsHelp('analytics', {
        excerpt:
          'Pageviews from the built-in beacon — daily totals, top ' +
          'pages, top referrers, and the device split.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {viewAllHref ? (
            <Button
              component={AppLink as any}
              {...({ componentVariant: 'naked', nativeButton: false } as any)}
              href={viewAllHref}
              size="small"
              color="secondary"
            >
              {'View details'}
            </Button>
          ) : null}
          <TextField
            select
            size="small"
            value={range}
            onChange={(event) => {
              setDays(null)
              setRange(Number(event.target.value))
            }}
          >
            <MenuItem value={7}>{'7 days'}</MenuItem>
            <MenuItem value={14}>{'14 days'}</MenuItem>
            <MenuItem value={30}>{'30 days'}</MenuItem>
            <MenuItem value={90}>{'90 days'}</MenuItem>
          </TextField>
          </Stack>
        ),
      }}
    >
      {days === null ? (
        <LinearProgress />
      ) : total === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No pageviews recorded yet — stats appear as visitors browse ' +
            'your published site.'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
            <Stack>
              <Typography variant="h4">{total.toLocaleString()}</Typography>
              <Typography variant="caption" color="text.secondary">
                {'Pageviews'}
              </Typography>
            </Stack>
            <Stack>
              <Typography variant="h4">
                {avgPerDay.toLocaleString()}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {'Avg / day'}
              </Typography>
            </Stack>
            {wowPct !== null ? (
              <Stack>
                <Typography
                  variant="h4"
                  color={
                    wowPct > 0
                      ? 'success.main'
                      : wowPct < 0
                        ? 'error.main'
                        : 'text.primary'
                  }
                >
                  {`${wowPct > 0 ? '+' : ''}${wowPct}%`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {'Week over week'}
                </Typography>
              </Stack>
            ) : null}
            {topDevice ? (
              <Stack>
                <Typography variant="h4" sx={{ textTransform: 'capitalize' }}>
                  {topDevice}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {'Top device'}
                </Typography>
              </Stack>
            ) : null}
          </Stack>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'flex-end', height: 64 }}
          >
            {days.map((day) => (
              <Tooltip key={day.day} title={`${day.day}: ${day.total}`}>
                <Box
                  sx={{
                    flex: 1,
                    height: `${Math.max(4, (day.total / max) * 100)}%`,
                    bgcolor: day.total ? 'secondary.main' : 'action.hover',
                    borderRadius: 0.5,
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
          {deviceSum ? (
            <Typography variant="caption" color="text.secondary">
              {['desktop', 'mobile', 'tablet']
                .filter((device) => deviceTotals[device])
                .map(
                  (device) =>
                    `${device} ${Math.round(
                      ((deviceTotals[device] ?? 0) / deviceSum) * 100,
                    )}%`,
                )
                .join(' · ')}
            </Typography>
          ) : null}
          {topReferrers.length ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{'Top referrers'}</Typography>
              {topReferrers.map(([host, count]) => (
                <Stack
                  key={host}
                  direction="row"
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Typography variant="body2" noWrap sx={{ maxWidth: '80%' }}>
                    {host}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {count.toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : null}
          {/* Per-screen teaser (AGL-153). */}
          <Typography variant="caption" color="text.secondary">
            {'Per-screen breakdowns live on each screen\u2019s view page ' +
              '(Pro plans).'}
          </Typography>
          {topPaths.length ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{'Top pages'}</Typography>
              {topPaths.map(([path, count]) => (
                <Stack
                  key={path}
                  direction="row"
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Typography variant="body2" noWrap sx={{ maxWidth: '80%' }}>
                    {path}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {count.toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : null}
        </Stack>
      )}
    </CardDisplay>
  )
}
HostAnalyticsCard.displayName = 'HostAnalyticsCard'

export default HostAnalyticsCard
