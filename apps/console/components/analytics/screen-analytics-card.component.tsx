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
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'
import { formatDwell } from '../../utils/analytics-summary'
import { hasEntitlement } from '../../constants/entitlements'
import { buildRoute, Route } from '../../constants/route-links'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useCurrentOrg from '../../hooks/use-current-org'

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
    const ids = Array.from({ length: DAYS }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (DAYS - 1 - index))
      return date.toISOString().slice(0, 10)
    })
    void Promise.all(
      ids.map((id) =>
        getDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'screenAnalytics',
            `${screenId}:${id}`,
          ),
        )
          .then((snapshot) => ({
            day: id,
            total: Number(snapshot.get('total') ?? 0),
            referrers: (snapshot.get('referrers') ?? {}) as Record<
              string,
              number
            >,
            devices: (snapshot.get('devices') ?? {}) as Record<string, number>,
            dwellMs: Number(snapshot.get('dwellMs') ?? 0),
            dwellSamples: Number(snapshot.get('dwellSamples') ?? 0),
          }))
          .catch(() => ({
            day: id,
            total: 0,
            referrers: {},
            devices: {},
            dwellMs: 0,
            dwellSamples: 0,
          })),
      ),
    ).then((stats) => {
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
        header={'Screen traffic'}
        help={docsHelp('analytics', { anchor: '#per-screen-traffic' })}
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
        header={'Screen traffic'}
        help={docsHelp('analytics', { anchor: '#per-screen-traffic' })}
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
          {'Per-screen traffic — views, devices, referrers per page — is a ' +
            'Pro feature. Data is already being collected, so history is ' +
            'waiting the moment you upgrade.'}
        </Alert>
      </CardDisplay>
    )
  }

  const total = (days ?? []).reduce((sum, day) => sum + day.total, 0)
  // Averaged over SAMPLES, not over views (AGL-2182). Not every visit
  // reports a dwell — a killed tab sends nothing — so dividing by views
  // would report a number lower than any visit actually spent.
  const dwellTotalMs = (days ?? []).reduce((sum, day) => sum + day.dwellMs, 0)
  const dwellSamples = (days ?? []).reduce(
    (sum, day) => sum + day.dwellSamples,
    0,
  )
  const avgDwell = dwellSamples > 0 ? dwellTotalMs / dwellSamples : null
  const max = Math.max(1, ...(days ?? []).map((day) => day.total))
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

  return (
    <CardDisplay
      header={'Screen traffic (14 days)'}
      help={docsHelp('analytics', {
        anchor: '#per-screen-traffic',
        excerpt:
          "This screen's pageviews over the last 14 days, with its " +
          'device split and top referrers.',
      })}
      contentGutterX
      contentGutterY
    >
      {days === null ? (
        <LinearProgress />
      ) : total === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No pageviews recorded for this screen yet.'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
            <Stack>
              <Typography variant="h4">{total.toLocaleString()}</Typography>
              <Typography variant="caption" color="text.secondary">
                {'Screen views'}
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
                  {'Avg. time on this screen'}
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
        </Stack>
      )}
    </CardDisplay>
  )
}
ScreenAnalyticsCard.displayName = 'ScreenAnalyticsCard'

export default ScreenAnalyticsCard
