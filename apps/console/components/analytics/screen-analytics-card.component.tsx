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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../../constants/entitlements'
import { buildRoute, Route } from '../../constants/route-links'
import useCurrentTenant from '../../hooks/use-current-tenant'

const DAYS = 14

interface DayStat {
  day: string
  total: number
  referrers: Record<string, number>
  devices: Record<string, number>
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
  const { tenant } = useCurrentTenant()
  const entitled = hasEntitlement('screen-analytics', tenant)
  const [days, setDays] = useState<DayStat[] | null>(null)

  useEffect(() => {
    if (!entitled) return
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
          }))
          .catch(() => ({ day: id, total: 0, referrers: {}, devices: {} })),
      ),
    ).then((stats) => {
      if (active) setDays(stats)
    })
    return () => {
      active = false
    }
  }, [entitled, firestore, hostId, screenId])

  if (!entitled) {
    return (
      <CardDisplay header={'Screen traffic'} contentGutterX contentGutterY>
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              href={buildRoute(Route.MANAGE_BILLING)}
            >
              {'Upgrade'}
            </Button>
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
          <Typography variant="h4">{total.toLocaleString()}</Typography>
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
        </Stack>
      )}
    </CardDisplay>
  )
}
ScreenAnalyticsCard.displayName = 'ScreenAnalyticsCard'

export default ScreenAnalyticsCard
