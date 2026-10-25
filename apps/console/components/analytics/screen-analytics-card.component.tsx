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
  Alert,
  Box,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import {
  readAnalyticsDays,
  recentDayIds,
} from '../../utils/analytics-day-cache'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'
import { formatDwell } from '@aglyn/aglyn/app-utils/analytics-summary'
import {
  referrerLabel,
  summarizeScreenTraffic,
} from '@aglyn/aglyn/app-utils/screen-analytics-aggregate'
import { hasEntitlement } from '../../constants/entitlements'
import { buildRoute, Route } from '../../constants/route-links'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useCurrentOrg from '../../hooks/use-current-org'

/**
 * One help for the card in every state it draws (AGL-3707). `#dwell-time`,
 * because the Pages table on Analytics takes `#per-screen-traffic`; the title
 * keeps the card's own name until the analytics docs give it a section.
 */
const PAGE_TRAFFIC_HELP = docsHelp('analytics', {
  anchor: '#dwell-time',
  title: 'Page traffic',
  excerpt:
    "This page's views over the last 14 days, its device split and top " +
    'referrers, and the average time a visitor stayed — measured over the ' +
    'visits that reported one, capped at 30 minutes.',
})

const DAYS = 14

interface DayStat {
  day: string
  total: number
  referrers: Record<string, number>
  devices: Record<string, number>
  /** Summed dwell across the day's samples (AGL-2182). */
  dwellMs: number
  /** How many visits reported a dwell — the divisor. */
  dwellSamples: number
}

/**
 * Per-screen traffic panel (AGL-152): 14 days of this screen's pageviews
 * from the AGL-151 attribution docs, with device split and top referrers.
 * Paid (`screenAnalytics`, Pro+): data is always collected, so the locked
 * state can honestly promise history from day one after upgrading.
 */
export function ScreenAnalyticsCard(props: {
  hostId: string
  screenId: string
}) {
  const { hostId, screenId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { org, ready: orgReady } = useCurrentOrg()
  const entitled = hasEntitlement('screenAnalytics', org)
  const [days, setDays] = useState<DayStat[] | null>(null)

  useEffect(() => {
    if (!orgReady || !entitled) return
    let active = true
    /*
      Through the day cache, like every other analytics panel (AGL-1440 /
      AGL-703). This card walked the window with 14 raw `getDoc`s on EVERY
      mount, so clicking through twenty screens cost 280 reads for data that
      cannot change: thirteen of those fourteen days are closed, and a closed
      counter is written by the day it names and never again.

      It is the one analytics surface the AGL-1440 sweep missed — the media
      drawer, the host traffic panel and the entry panel all read through
      here already, and the fix is the same shape the requirement was for on "Used by":
      stop paying for the same documents over and over.

      `field` NAMES THE SCREEN, and that is load-bearing. These day-docs are
      per-screen (`screenAnalytics/{screenId}:{day}`), unlike the host-level
      `analytics/{day}` documents the other panels read — a key that ignored
      the screen would hand one screen's traffic to the next screen opened.

      `recentDayIds` rather than a local-calendar walk: it counts back in
      whole UTC days from now, which is the day the counters are written
      under. Walking `setDate` on a local clock is how a window silently
      skips a day across a DST boundary.
    */
    const newestFirst = recentDayIds(Date.now(), DAYS)
    const ids = [...newestFirst].reverse()
    void readAnalyticsDays<DayStat>({
      scopeKey: `hosts/${hostId}`,
      field: `screen:${screenId}`,
      dayIds: ids,
      liveDay: newestFirst[0],
      now: Date.now(),
      fallback: {
        day: '',
        total: 0,
        referrers: {},
        devices: {},
        dwellMs: 0,
        dwellSamples: 0,
      },
      read: async (id) => {
        const snapshot = await getDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'screenAnalytics',
            `${screenId}:${id}`,
          ),
        )
        return {
          day: id,
          total: Number(snapshot.get('total') ?? 0),
          referrers: (snapshot.get('referrers') ?? {}) as Record<
            string,
            number
          >,
          devices: (snapshot.get('devices') ?? {}) as Record<string, number>,
          dwellMs: Number(snapshot.get('dwellMs') ?? 0),
          dwellSamples: Number(snapshot.get('dwellSamples') ?? 0),
        }
      },
      // A read that throws resolves to `fallback` and is NOT cached — a
      // denial or a blip must not pin an empty day for the life of the tab.
    }).then((stats) => {
      if (active) setDays(stats)
    })
    return () => {
      active = false
    }
  }, [orgReady, entitled, firestore, hostId, screenId])

  if (!orgReady) {
    // `hasEntitlement(undefined)` answers "no" (AGL-1380), and this card's
    // "no" is an upsell with an Upgrade button — shown to a Pro org for the
    // analytics it already pays for. The effect above holds too: gating the
    // fetch on a guessed "no" meant the pending window suppressed the load.
    return (
      <CardDisplay
        header={'Page traffic'}
        help={PAGE_TRAFFIC_HELP}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      </CardDisplay>
    )
  }

  if (!entitled) {
    return (
      <CardDisplay
        header={'Page traffic'}
        help={PAGE_TRAFFIC_HELP}
        contentGutterX
        contentGutterY
      >
        <Alert
          severity="info"
          action={
            <AppLink
              componentVariant="button"
              color="inherit"
              size="small"
              href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}
            >
              {'Upgrade'}
            </AppLink>
          }
        >
          {'Per-page traffic — the views, devices and referrers of each page — is a ' +
            'Pro feature. Data is already being collected, so history is ' +
            'waiting the moment you upgrade.'}
        </Alert>
      </CardDisplay>
    )
  }

  // The card's figures (AGL-4011): one function, shared with the native page detail, so both read the same numbers.
  // The dwell is averaged over the visits that reported one (AGL-2182), never over views.
  const summary = summarizeScreenTraffic(days ?? [])
  const total = summary.total
  const avgDwell = summary.avgDwellMs
  const max = Math.max(1, ...(days ?? []).map((day) => day.total))
  const topReferrers = summary.topReferrers

  return (
    <CardDisplay
      header={'Page traffic (14 days)'}
      help={PAGE_TRAFFIC_HELP}
      contentGutterX
      contentGutterY
    >
      {days === null ? (
        <LinearProgress />
      ) : total === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No pageviews recorded for this page yet.'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Stack useFlexGap direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
            <Stack>
              <Typography variant="h4">{total.toLocaleString()}</Typography>
              <Typography variant="caption" color="text.secondary">
                {'Page views'}
              </Typography>
            </Stack>
            {/*
              `Avg. time 2m 04s / on this screen` (AGL-2182). Rendered
              only when visits actually reported a dwell: the beacon is
              fire-and-forget on `pagehide`, so the honest failure is a
              missing tile, never a zero that reads as "nobody stayed".
             */}
            {avgDwell === null ? null : (
              <Stack>
                <Typography variant="h4">
                  {formatDwell(avgDwell)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {'Avg. time on this page'}
                </Typography>
              </Stack>
            )}
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
                    bgcolor: day.total ? 'primary.main' : 'action.hover',
                    borderRadius: 0.5,
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
          {summary.deviceLine ? (
            <Typography variant="caption" color="text.secondary">
              {summary.deviceLine}
            </Typography>
          ) : null}
          {topReferrers.length ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{'Top referrers'}</Typography>
              {topReferrers.map(({ referrer: host, count }) => (
                <Stack
                  key={host}
                  direction="row"
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Typography variant="body2" noWrap sx={{ maxWidth: '80%' }}>
                    {referrerLabel(host)}
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
ScreenAnalyticsCard.displayName = 'ScreenAnalyticsCard'

export default ScreenAnalyticsCard
