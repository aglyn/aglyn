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
import {
  readAnalyticsDays,
  recentDayIds,
} from '../../utils/analytics-day-cache'
import {
  deviceSplit,
  deviceSplitLabel,
  deviceSplitValue,
  rollUp,
  splitTrafficWindows,
  trafficDeltaPct,
} from '../../utils/analytics-summary'
import { docsHelp } from '../../constants/docs-links'

interface DayStat {
  day: string
  total: number
  /** Approximate uniques (AGL-1844): one per browser tab per UTC day. */
  visitors: number
  paths: Record<string, number>
  referrers: Record<string, number>
  devices: Record<string, number>
  /** Campaign labels (AGL-1844): `source`/`medium`/`campaign` → value → n. */
  utm: Record<string, Record<string, number>>
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
    // Oldest first — the chart reads left to right. `recentDayIds` counts back
    // from today, so reverse it; index 0 of that list is the live UTC day.
    // TWICE the selected range (AGL-2160). The advertised tile reads
    // `+12% vs prior`, which needs the window BEFORE the one on screen —
    // and the card previously had only `range` days loaded, which is why
    // its delta was pinned to a 7-vs-7 comparison that ignored the
    // selector entirely. The extra days are closed counters, so the cache
    // pays for each of them exactly once per tab.
    const newestFirst = recentDayIds(Date.now(), range * 2)
    const ids = [...newestFirst].reverse()
    // Every day but today is a closed counter, so this panel pays for a day
    // once rather than on every dashboard visit and every range switch
    // (AGL-1440) — widening 14 → 30 now reads the 16 days it does not have,
    // not all 30. See `analytics-day-cache` for the invalidation argument.
    void readAnalyticsDays<DayStat>({
      scopeKey: `hosts/${hostId}`,
      field: 'traffic',
      dayIds: ids,
      liveDay: newestFirst[0],
      now: Date.now(),
      fallback: {
        day: '',
        total: 0,
        visitors: 0,
        paths: {},
        referrers: {},
        devices: {},
        utm: {},
      },
      read: async (id) => {
        const snapshot = await getDoc(
          doc(firestore, 'hosts', hostId, 'analytics', id),
        )
        return {
          day: id,
          total: Number(snapshot.get('total') ?? 0),
          visitors: Number(snapshot.get('visitors') ?? 0),
          paths: (snapshot.get('paths') ?? {}) as Record<string, number>,
          referrers: (snapshot.get('referrers') ?? {}) as Record<string, number>,
          devices: (snapshot.get('devices') ?? {}) as Record<string, number>,
          utm: (snapshot.get('utm') ?? {}) as Record<
            string,
            Record<string, number>
          >,
        }
      },
    }).then((stats) => {
      // A failed day carries no id, so restore the one it stands for rather
      // than letting an empty label reach the chart.
      if (active) setDays(stats.map((stat, index) => ({ ...stat, day: ids[index] })))
    })
    return () => {
      active = false
    }
  }, [firestore, hostId, range])

  // `days` now holds two windows back to back, oldest first. Everything
  // displayed reads `windowDays`; only the comparison reads `priorDays`.
  const { current: windowDays, prior: priorDays } = splitTrafficWindows(
    days ?? [],
    range,
  )
  const total = windowDays.reduce((sum, day) => sum + day.total, 0)
  const priorTotal = priorDays.reduce((sum, day) => sum + day.total, 0)
  const deltaPct = trafficDeltaPct(total, priorTotal)
  // Approximate uniques (AGL-1844): summing per-day counts is honest here
  // because the flag that feeds them cannot span a day — but it means a
  // multi-day visitor counts once per day, which the label says out loud.
  const visitors = windowDays.reduce((sum, day) => sum + day.visitors, 0)
  const max = Math.max(1, ...windowDays.map((day) => day.total))
  const allPaths = rollUp(windowDays, 'paths')
  const allReferrers = rollUp(windowDays, 'referrers')
  const topPaths = allPaths.slice(0, 5)
  const topReferrers = allReferrers.slice(0, 5)
  const deviceTotals = windowDays.reduce<Record<string, number>>(
    (acc, day) => {
      for (const [device, count] of Object.entries(day.devices)) {
        acc[device] = (acc[device] ?? 0) + count
      }
      return acc
    },
    {},
  )
  const devices = deviceSplit(deviceTotals)
  // The single top row of each list, promoted to its own tile — the two
  // the mockup shows beside Page views (AGL-2160).
  const topPage = allPaths[0]
  const topReferrer = allReferrers[0]
  // Campaign attribution (AGL-1844): the two UTM dimensions worth a list —
  // source says who sent the traffic, campaign says which push; medium is
  // recorded in the day docs but rarely earns list space (it repeats
  // 'email'/'cpc'), so it stays available without a section here.
  const topUtm = (param: 'source' | 'campaign') =>
    Object.entries(
      windowDays.reduce<Record<string, number>>((acc, day) => {
        for (const [value, count] of Object.entries(day.utm[param] ?? {})) {
          acc[value] = (acc[value] ?? 0) + count
        }
        return acc
      }, {}),
    )
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
  const topUtmSources = topUtm('source')
  const topUtmCampaigns = topUtm('campaign')
  const deviceSum = Object.values(deviceTotals).reduce(
    (sum, count) => sum + count,
    0,
  )
  // Top insights (AGL-386): per-day average, week-over-week trend, and
  // the leading device — computed from the same day-counter docs.
  const dayCount = windowDays.length || 1
  const avgPerDay = Math.round(total / dayCount)

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
              color="primary"
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
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
                <Typography variant="h4">{total.toLocaleString()}</Typography>
                {/*
                  The delta belongs ON the figure it describes and follows
                  the RANGE SELECTOR (AGL-2160). It used to be a separate
                  `Week over week` tile pinned to 7-vs-7, so choosing 90
                  days still showed last week's movement — a number that
                  was true of a window nobody had asked to see. Silent when
                  the prior window recorded nothing: a site's first week has
                  no growth rate.
                 */}
                {deltaPct === null ? null : (
                  <Tooltip title={`vs the previous ${range} days`}>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 600,
                        color:
                          deltaPct > 0
                            ? 'success.main'
                            : deltaPct < 0
                              ? 'error.main'
                              : 'text.secondary',
                      }}
                    >
                      {`${deltaPct > 0 ? '+' : ''}${deltaPct}% vs prior`}
                    </Typography>
                  </Tooltip>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {'Page views'}
              </Typography>
            </Stack>
            {visitors > 0 ? (
              // Cookieless approximation (AGL-1844): one count per browser
              // tab per day, so it under- and over-counts in known ways.
              // The tooltip is the honesty contract — do not shorten it.
              <Tooltip
                title={
                  'Approximate: counts each browser tab once per day, ' +
                  'without cookies or visitor IDs. A visitor using two ' +
                  'tabs, or returning on another day, counts again.'
                }
              >
                <Stack>
                  <Typography variant="h4">
                    {visitors.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {'Visitors (approx.)'}
                  </Typography>
                </Stack>
              </Tooltip>
            ) : null}
            <Stack>
              <Typography variant="h4">
                {avgPerDay.toLocaleString()}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {'Avg / day'}
              </Typography>
            </Stack>
            {devices.length ? (
              // `Mobile / Desktop` over `61% / 39%`, as the mockup shows
              // it. The one-word `Top device` tile it replaces answered a
              // question nobody asks — a split is the whole point.
              <Stack>
                <Typography variant="h4">
                  {deviceSplitValue(devices)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {deviceSplitLabel(devices)}
                </Typography>
              </Stack>
            ) : null}
            {topPage ? (
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="h4" noWrap sx={{ maxWidth: 220 }}>
                  {topPage[0]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {`Top page · ${topPage[1].toLocaleString()} views`}
                </Typography>
              </Stack>
            ) : null}
            {topReferrer ? (
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="h4" noWrap sx={{ maxWidth: 220 }}>
                  {topReferrer[0]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {`Top referrer · ${topReferrer[1].toLocaleString()} views`}
                </Typography>
              </Stack>
            ) : null}
          </Stack>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'flex-end', height: 64 }}
          >
            {windowDays.map((day) => (
              <Tooltip key={day.day} title={`${day.day}: ${day.total}`}>
                <Box
                  sx={{
                    flex: 1,
                    height: `${Math.max(4, (day.total / max) * 100)}%`,
                    bgcolor: day.total ? 'primary.main' : 'action.hover',
                    borderRadius: 0.5,
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
          {/*
            The lowercase `desktop 62% · mobile 31%` caption that used to
            sit here is now the device tile above, which is where the
            mockup puts it. Kept as one statement rather than two so the
            same numbers cannot be rendered twice in two formats.
           */}
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
          {topUtmSources.length ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">
                {'Top campaign sources (UTM)'}
              </Typography>
              {topUtmSources.map(([value, count]) => (
                <Stack
                  key={value}
                  direction="row"
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Typography variant="body2" noWrap sx={{ maxWidth: '80%' }}>
                    {value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {count.toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : null}
          {topUtmCampaigns.length ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{'Top campaigns (UTM)'}</Typography>
              {topUtmCampaigns.map(([value, count]) => (
                <Stack
                  key={value}
                  direction="row"
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Typography variant="body2" noWrap sx={{ maxWidth: '80%' }}>
                    {value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {count.toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : null}
          {/* Per-screen teaser (AGL-153, table AGL-1844). */}
          <Typography variant="caption" color="text.secondary">
            {'Per-screen breakdowns live in the Screens table on the ' +
              'analytics page and on each screen\u2019s view page (Pro ' +
              'plans).'}
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
