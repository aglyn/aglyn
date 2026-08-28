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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  Alert,
  LinearProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../../constants/shared'
import { hasEntitlement } from '../../constants/entitlements'
import { buildRoute, Route } from '../../constants/route-links'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useCurrentOrg from '../../hooks/use-current-org'
import { recentDayIds } from '../../utils/analytics-day-cache'
import {
  aggregateScreenDays,
  topReferrer,
  topDevice,
  type ScreenTrafficRow,
} from '../../utils/screen-analytics-aggregate'

/**
 * Bounded on purpose (AGL-1844): the range query returns one doc per screen
 * per day with traffic, so this is the hard ceiling on what one open of the
 * analytics page can read. 1000 covers ~30 screens over 30 days; beyond it
 * the table under-reports rather than reading unboundedly.
 *
 * WHICH days it under-reports is the whole question, and it used to be the
 * wrong ones. A range filter carries an implicit ascending order on its own
 * field, so `where('day', '>=', start)` with a bare `limit()` answers with
 * the OLDEST thousand documents in the window: a site over the ceiling saw
 * the start of its range and none of this week. The explicit descending
 * `orderBy('day')` inverts that, so the ceiling costs the far end of the
 * window instead of the near one.
 */
const QUERY_LIMIT = 1000

interface LoadedState {
  rows: ScreenTrafficRow[]
  /** The host doc's `screens` routing map: screenId → serving path. */
  paths: Record<string, string>
}

/**
 * Whole-result cache, 60 s, module scope — the AGL-1440 discipline restated
 * for a range QUERY, which cannot be split into per-day entries the way
 * `readAnalyticsDays` splits gets: closed days never change, but they arrive
 * inside one snapshot with the live day. 60 s is the staleness this codebase
 * already accepts for the live day, so the whole blob gets that TTL; a range
 * flip back and forth inside a minute costs one query, not two per flip.
 */
const resultCache = new Map<string, { value: LoadedState; storedAt: number }>()
const RESULT_TTL_MS = 60_000

/**
 * Per-screen traffic comparison (AGL-1844): every screen's pageviews over a
 * selectable window, side by side, from the AGL-151 attribution docs — the
 * dashboard-level view the requirement was for beyond the single-screen panel on each
 * screen's view page (AGL-152). Same paid gate as that panel: data is always
 * collected, display is what `screenAnalytics` (Pro+) buys.
 */
export function ScreensAnalyticsTable(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { org, ready: orgReady } = useCurrentOrg()
  const entitled = hasEntitlement('screenAnalytics', org)
  const [range, setRange] = useState(14)
  const [loaded, setLoaded] = useState<LoadedState | null>(null)
  /*
   * The table PAGES (AGL-693). It rendered `rows.slice(0, MAX_ROWS)` — fifty
   * screens, no footer and nothing saying so, on a card whose whole purpose
   * is comparing screens against each other. A site with sixty screens was
   * shown the leading fifty as if that were the comparison.
   *
   * The rows are AGGREGATED in the browser, so unlike the console's Firestore
   * lists this one genuinely knows its total and hands it to the footer:
   * `count` renders a real "1–10 of 63" rather than "more than 10".
   */
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)

  useEffect(() => {
    if (!orgReady || !entitled) return
    let active = true
    const cacheKey = `${hostId}|${range}`
    const hit = resultCache.get(cacheKey)
    if (hit && Date.now() - hit.storedAt < RESULT_TTL_MS) {
      setLoaded(hit.value)
      return
    }
    // Oldest day in the window; day ids sort lexically, so one range filter
    // does it. Docs predating the `day` field cannot match — they are also
    // the docs old enough to be out of every selectable window.
    const dayIds = recentDayIds(Date.now(), range)
    const startDay = dayIds[dayIds.length - 1]
    void Promise.all([
      getDocs(
        query(
          collection(firestore, 'hosts', hostId, 'screenAnalytics'),
          where('day', '>=', startDay),
          /*
            NEWEST first, so `QUERY_LIMIT` bites the far end of the window.
            Ordering on `day` cannot drop a document the filter kept: an
            inequality already matches only documents that HAVE the field, so
            the order is over exactly the same set. No composite index is
            owed either — the filter and the order name one field, and
            Firestore indexes every field in both directions on its own.
          */
          orderBy('day', 'desc'),
          limit(QUERY_LIMIT),
        ),
      ),
      // One read for the labels: the routing map on the host doc names the
      // path each screen serves — no 200-doc screens read for a label
      // column.
      getDoc(doc(firestore, 'hosts', hostId)),
    ])
      .then(([snapshot, hostSnapshot]) => {
        if (!active) return
        const value: LoadedState = {
          rows: aggregateScreenDays(
            snapshot.docs.map((docSnapshot) => docSnapshot.data() as any),
          ),
          paths: (hostSnapshot.get('screens') ?? {}) as Record<string, string>,
        }
        resultCache.set(cacheKey, { value, storedAt: Date.now() })
        setLoaded(value)
      })
      .catch(() => {
        // A denial or a blip renders the empty state; never cached.
        if (active) setLoaded({ rows: [], paths: {} })
      })
    return () => {
      active = false
    }
  }, [orgReady, entitled, firestore, hostId, range])

  // A shorter range holds fewer screens, and page four of a 63-row table does
  // not exist in a 12-row one — MUI renders an out-of-range page as an empty
  // table with no explanation, which reads as the data having gone.
  useEffect(() => {
    setPage(0)
  }, [range])

  const help = docsHelp('analytics', {
    anchor: '#per-screen-traffic',
    excerpt:
      'Every screen’s pageviews over the selected window, compared ' +
      'side by side, with each screen’s leading device.',
  })

  if (!orgReady) {
    // `hasEntitlement(undefined)` answers "no" (AGL-1380), and this card's
    // "no" is an upsell — never show it while the plan is still loading.
    return (
      <CardDisplay header={'Screens'} help={help} contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      </CardDisplay>
    )
  }

  if (!entitled) {
    return (
      <CardDisplay header={'Screens'} help={help} contentGutterX contentGutterY>
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
          {'Comparing traffic across screens is a Pro feature. Data is ' +
            'already being collected, so history is waiting the moment ' +
            'you upgrade.'}
        </Alert>
      </CardDisplay>
    )
  }

  const rows = loaded?.rows ?? []
  // The SHARE column is a share of the whole window, not of the page — a
  // percentage that re-based itself per page would sum to 100% on every one
  // of them.
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0)
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize)

  return (
    <CardDisplay
      header={'Screens'}
      help={help}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <TextField
            select
            size="small"
            value={range}
            onChange={(event) => {
              setLoaded(null)
              setRange(Number(event.target.value))
            }}
          >
            <MenuItem value={7}>{'7 days'}</MenuItem>
            <MenuItem value={14}>{'14 days'}</MenuItem>
            <MenuItem value={30}>{'30 days'}</MenuItem>
          </TextField>
        ),
      }}
    >
      {loaded === null ? (
        <LinearProgress />
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No per-screen pageviews recorded in this range yet.'}
        </Typography>
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Screen'}</TableCell>
                <TableCell align="right">{'Views'}</TableCell>
                <TableCell align="right">{'Share'}</TableCell>
                <TableCell>{'Top device'}</TableCell>
                <TableCell>{'Top referrer'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((row) => {
                // The routing map only lists screens that still serve; a
                // screen deleted after collecting history keeps its row under
                // its id, which is honest — those views happened.
                const path = loaded.paths[row.screenId]
                return (
                  <TableRow key={row.screenId}>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" noWrap>
                        {path || row.screenId}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {row.total.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      {grandTotal
                        ? `${Math.round((row.total / grandTotal) * 100)}%`
                        : '--'}
                    </TableCell>
                    <TableCell sx={{ textTransform: 'capitalize' }}>
                      {topDevice(row) || '--'}
                    </TableCell>
                    {/*
                     * Not capitalized: a referrer is a HOSTNAME, and
                     * `News.ycombinator.com` is a different string from the
                     * one stored. AGL-2341.
                     */}
                    <TableCell sx={{ maxWidth: 200 }}>
                      <Typography variant="body2" noWrap>
                        {topReferrer(row) || '--'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={pageRows.length}
            // The total is KNOWN here — the rows are aggregated on the
            // client, so nothing has to be read to count them.
            count={rows.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </CardDisplay>
  )
}
ScreensAnalyticsTable.displayName = 'ScreensAnalyticsTable'

export default ScreensAnalyticsTable
