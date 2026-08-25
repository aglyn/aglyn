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

import { analyticsPathKey } from '@aglyn/aglyn'
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
import { hasEntitlement } from '../../constants/entitlements'
import { buildRoute, Route } from '../../constants/route-links'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useCurrentOrg from '../../hooks/use-current-org'
import { readAnalyticsDays, recentDayIds } from '../../utils/analytics-day-cache'

const DAYS = 14

interface DayStat {
  day: string
  /** Every path counted that day; this card reads ONE key out of it. */
  paths: Record<string, number>
}

/**
 * One content entry's traffic (AGL-2498) — the counterpart of
 * `ScreenAnalyticsCard` on the entry detail page.
 *
 * ## Why it reads `analytics/{day}.paths` and not `screenAnalytics`
 *
 * This looks like the same job as the screen card and is not, and getting it
 * wrong would produce a number that is confidently, silently wrong.
 *
 * The beacon's per-screen doc is keyed `{screenId}:{day}`, and an entry is not
 * a screen. Every entry in a collection renders through the SAME entry-template
 * screen — that is what a template is — so `screenAnalytics` for that screen is
 * the sum of the whole collection. Pointing this card at it would show a blog
 * post's own page reporting every post's views, and an entry rendered by the
 * built-in themed article has no screen id at all, so half the collections
 * would report zero instead.
 *
 * The host day-doc's `paths` map is per URL, which is exactly the granularity
 * an entry has: `/{collectionSlug}/{entrySlug}`. So that is the source, and
 * {@link analyticsPathKey} — the writer's own key rule, shared rather than
 * copied — is how the key is built.
 *
 * ## What it therefore cannot show, and says so
 *
 * Devices and referrers in that document are counted for the SITE, not per
 * path. The screen card shows both; this one shows neither rather than
 * attributing the site's split to one post. A caption says where the fuller
 * breakdown lives instead of leaving a reader to assume it was omitted.
 *
 * ## Cache
 *
 * Its own `field` key, NOT the traffic card's, and that is not a missed
 * saving. `readAnalyticsDays` caches the value its `read` returned, and a hit
 * skips `read` entirely — so two panels sharing a key must return the SAME
 * SHAPE or whichever one loads second gets the other's object. This card
 * keeps `{ day, paths }`; the traffic card also carries `total`, `visitors`,
 * `referrers`, `devices` and `utm`, and reading this object back through its
 * `sum + day.total` would produce `NaN` for the whole dashboard. One extra
 * `getDoc` per day is the price of the two staying independent.
 *
 * Paid (`screenAnalytics`, Pro+), the same entitlement per-screen traffic
 * sells: an entry page is a page. Collection never stops, so the locked state
 * can honestly promise history from day one after upgrading.
 */
export function EntryAnalyticsCard(props: {
  hostId: string
  /**
   * The entry's public path, e.g. `/blog/hello-world`. `null` while the entry
   * has no slug yet (an unsaved draft) — the card renders its "nothing to
   * measure" state rather than looking up the key for `/`, which is the HOME
   * PAGE and would report the site's busiest number against a blank draft.
   */
  path: string | null
}) {
  const { hostId, path } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { org, ready: orgReady } = useCurrentOrg()
  const entitled = hasEntitlement('screenAnalytics', org)
  const [days, setDays] = useState<DayStat[] | null>(null)

  useEffect(() => {
    if (!orgReady || !entitled || !path) return
    let active = true
    // Oldest first — the chart reads left to right. `recentDayIds` counts
    // back in whole UTC days from now, which is the day the counters are
    // written under; walking a local calendar is how a window skips a day
    // across a DST boundary.
    const newestFirst = recentDayIds(Date.now(), DAYS)
    const ids = [...newestFirst].reverse()
    void readAnalyticsDays<DayStat>({
      scopeKey: `hosts/${hostId}`,
      field: 'traffic-paths',
      dayIds: ids,
      liveDay: newestFirst[0],
      now: Date.now(),
      fallback: { day: '', paths: {} },
      read: async (id) => {
        const snapshot = await getDoc(
          doc(firestore, 'hosts', hostId, 'analytics', id),
        )
        return {
          day: id,
          paths: (snapshot.get('paths') ?? {}) as Record<string, number>,
        }
      },
    }).then((stats) => {
      // A failed day carries no id, so restore the one it stands for rather
      // than letting an empty label reach the chart.
      if (active) {
        setDays(stats.map((stat, index) => ({ ...stat, day: ids[index] })))
      }
    })
    return () => {
      active = false
    }
  }, [orgReady, entitled, firestore, hostId, path])

  if (!orgReady) {
    // `hasEntitlement(undefined)` answers "no" (AGL-1380), and this card's
    // "no" is an upsell with an Upgrade button — shown to a Pro org for the
    // analytics it already pays for. The effect above holds for the same
    // reason: gating the fetch on a guessed "no" suppresses the load for the
    // whole pending window.
    return (
      <CardDisplay
        header={'Entry traffic'}
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
        header={'Entry traffic'}
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
          {'Per-page traffic — how many people read this entry, day by day — ' +
            'is a Pro feature. Data is already being collected, so history ' +
            'is waiting the moment you upgrade.'}
        </Alert>
      </CardDisplay>
    )
  }

  const key = path ? analyticsPathKey(path) : null
  const counts = (days ?? []).map((day) => ({
    day: day.day,
    total: key ? Number(day.paths[key] ?? 0) : 0,
  }))
  const total = counts.reduce((sum, day) => sum + day.total, 0)
  const max = Math.max(1, ...counts.map((day) => day.total))
  const best = counts.reduce<{ day: string; total: number } | null>(
    (top, day) => (top && top.total >= day.total ? top : day),
    null,
  )

  return (
    <CardDisplay
      header={'Entry traffic (14 days)'}
      help={docsHelp('analytics', {
        anchor: '#traffic-card',
        excerpt:
          "This entry's page views over the last 14 days, counted against " +
          'its public path. The device and referrer breakdown is measured ' +
          'for the whole site rather than per page — it lives on Analytics.',
      })}
      contentGutterX
      contentGutterY
    >
      {!path ? (
        <Typography variant="body2" color="text.secondary">
          {'This entry has no public address yet — save it to give it one, ' +
            'and views will be counted from the moment it is published.'}
        </Typography>
      ) : days === null ? (
        <LinearProgress />
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
            <Stack>
              <Typography variant="h5">{total.toLocaleString()}</Typography>
              <Typography variant="caption" color="text.secondary">
                {'Page views'}
              </Typography>
            </Stack>
            <Stack>
              <Typography variant="h5">
                {best && best.total > 0 ? best.total.toLocaleString() : '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {best && best.total > 0 ? `Best day · ${best.day}` : 'Best day'}
              </Typography>
            </Stack>
            <Stack sx={{ minWidth: 0 }}>
              <Typography
                variant="h5"
                sx={{ overflowWrap: 'anywhere', fontSize: '1.05rem', pt: 0.5 }}
              >
                {path}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {'Counted against this path'}
              </Typography>
            </Stack>
          </Stack>
          {total === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No page views recorded for this entry yet. Only the ' +
                'published address is counted — a draft is not reachable, ' +
                'so it cannot be read.'}
            </Typography>
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 0.5,
                height: 96,
              }}
            >
              {counts.map((day) => (
                <Tooltip
                  key={day.day}
                  title={`${day.day} · ${day.total} view${
                    day.total === 1 ? '' : 's'
                  }`}
                >
                  <Box
                    sx={{
                      flexGrow: 1,
                      // A zero day still draws a 2px floor, so the chart
                      // reads as fourteen days with a gap rather than as a
                      // chart that failed to render some of them.
                      height: `${Math.max(2, (day.total / max) * 96)}px`,
                      bgcolor: day.total > 0 ? 'primary.main' : 'divider',
                      borderRadius: 0.5,
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary">
            {'Devices and referrers are counted for the site as a whole, not ' +
              'per page — see Analytics for that breakdown.'}
          </Typography>
        </Stack>
      )}
    </CardDisplay>
  )
}
EntryAnalyticsCard.displayName = 'EntryAnalyticsCard'

export default EntryAnalyticsCard
