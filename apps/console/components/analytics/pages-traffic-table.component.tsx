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

import { rollUpPathViews, displayCountedPath } from '@aglyn/aglyn/app-utils/page-traffic'
import {
  aggregateScreenDays,
  referrerLabel,
  topDevice,
  topReferrer,
  type ScreenTrafficRow,
} from '@aglyn/aglyn/app-utils/screen-analytics-aggregate'
import { mdiOpenInNew } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { MdiIcon } from '@aglyn/shared-ui-jsx/components/mdi-icon'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'
import { hasEntitlement } from '../../constants/entitlements'
import { buildRoute, Route } from '../../constants/route-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../../constants/shared'
import { useHostSubdomain } from '../host-id-provider'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useCurrentOrg from '../../hooks/use-current-org'
import { recentDayIds } from '../../utils/analytics-day-cache'
import { readHostPathDays } from '../../utils/host-path-days'
import {
  labelSitePaths,
  OTHER_GROUP,
  type SitePageGroup,
  type SitePageLabel,
} from '../../utils/site-page-labels'

/**
 * Bounded on purpose (AGL-1844): one doc per screen per day with traffic.
 * Newest first, so the ceiling costs the far end of the window (AGL-2501).
 * Only the per-page device and referrer columns read it now.
 */
export const SCREEN_QUERY_LIMIT = 1000

/** Whole-result cache for the screen range query, 60 s (AGL-1440). */
const screenCache = new Map<string, { value: ScreenTrafficRow[]; storedAt: number }>()
const SCREEN_TTL_MS = 60_000

/** Test seam: the cache is module scope by design. */
export function resetPagesTrafficCache(): void {
  screenCache.clear()
}

async function readScreenRows(
  firestore: Firestore,
  hostId: string,
  startDay: string,
  range: number,
): Promise<ScreenTrafficRow[]> {
  const key = `${hostId}|${range}`
  const hit = screenCache.get(key)
  if (hit && Date.now() - hit.storedAt < SCREEN_TTL_MS) return hit.value
  const snapshot = await getDocs(
    query(
      collection(firestore, 'hosts', hostId, 'screenAnalytics'),
      where('day', '>=', startDay),
      orderBy('day', 'desc'),
      limit(SCREEN_QUERY_LIMIT),
    ),
  )
  const value = aggregateScreenDays(snapshot.docs.map((one) => one.data() as never))
  screenCache.set(key, { value, storedAt: Date.now() })
  return value
}

export interface PageTrafficRow {
  path: string
  views: number
  label: SitePageLabel
  /** This page's own device and referrer counts; null when not measured per page. */
  screen: ScreenTrafficRow | null
}

interface Loaded {
  rows: PageTrafficRow[]
  total: number
  failedDays: number
  /** The names could not be read: rows show their paths, and the card says so. */
  labelsFailed: boolean
  /** The per-page device and referrer counts could not be read. */
  screensFailed: boolean
}

const ALL = 'all'

const SHARED_TEMPLATE_HINT =
  'Not split per page. This page is drawn from a template it shares with ' +
  'others like it, and device and referrer are counted per template. The ' +
  'site-wide split is in Traffic above.'

/** A label for a path when the names could not be read. */
function unlabeled(path: string): SitePageLabel {
  return {
    path: displayCountedPath(path),
    group: OTHER_GROUP,
    title: displayCountedPath(path),
    note: null,
    editHref: null,
    liveHref: null,
    screenId: null,
  }
}

/**
 * The Pages table (AGL-1844, per page AGL-4253): which pages of the site were
 * visited — each product, store collection, post and page by its own name.
 *
 * It used to group by SCREEN, and every product renders through one template
 * screen, so a store's catalog was one row named after the template. Views
 * now come from the host day-doc's per-path counts, the template is only how
 * a path is named, and the table groups by kind so "which products are being
 * looked at" is one click.
 *
 * Paid (`screenAnalytics`, Pro+), as it always was: data is always collected.
 */
export function PagesTrafficTable(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { org, ready: orgReady } = useCurrentOrg()
  const entitled = hasEntitlement('screenAnalytics', org)
  const [range, setRange] = useState(14)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [group, setGroup] = useState<string>(ALL)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)

  useEffect(() => {
    if (!orgReady || !entitled || !orgSlug || !host) return
    let active = true
    const newestFirst = recentDayIds(Date.now(), range)
    const startDay = newestFirst[newestFirst.length - 1]
    void (async () => {
      const [days, screens] = await Promise.all([
        readHostPathDays({
          firestore,
          hostId,
          dayIds: newestFirst,
          liveDay: newestFirst[0],
        }),
        readScreenRows(firestore, hostId, startDay, range).catch(() => null),
      ])
      const views = rollUpPathViews(days.filter((day) => !day.failed))
      let labels: Map<string, SitePageLabel> | null = null
      try {
        labels = await labelSitePaths({
          firestore,
          hostId,
          paths: views.map((one) => one.path),
          context: { orgSlug, host },
        })
      } catch {
        labels = null
      }
      const screenById = new Map<string, ScreenTrafficRow>(
        (screens ?? []).map((row) => [row.screenId, row]),
      )
      const rows = views.map(({ path, views: count }): PageTrafficRow => {
        const label = labels?.get(path) ?? unlabeled(path)
        return {
          path,
          views: count,
          label,
          screen: label.screenId ? (screenById.get(label.screenId) ?? null) : null,
        }
      })
      if (!active) return
      setLoaded({
        rows,
        total: rows.reduce((sum, row) => sum + row.views, 0),
        failedDays: days.filter((day) => day.failed).length,
        labelsFailed: labels === null && rows.length > 0,
        screensFailed: screens === null,
      })
    })()
    return () => {
      active = false
    }
  }, [orgReady, entitled, firestore, hostId, range, orgSlug, host])

  // A shorter range or another group holds fewer rows; page four of a
  // twelve-row table does not exist.
  useEffect(() => {
    setPage(0)
  }, [range, group])

  const groups = useMemo(() => {
    const byId = new Map<string, SitePageGroup & { views: number; count: number }>()
    for (const row of loaded?.rows ?? []) {
      const one = byId.get(row.label.group.id) ?? {
        ...row.label.group,
        views: 0,
        count: 0,
      }
      one.views += row.views
      one.count += 1
      byId.set(one.id, one)
    }
    // Most-visited kind first; "Other addresses" always last.
    return [...byId.values()].sort((a, b) =>
      a.id === OTHER_GROUP.id ? 1 : b.id === OTHER_GROUP.id ? -1 : b.views - a.views,
    )
  }, [loaded])

  const help = docsHelp('analytics', {
    anchor: '#per-screen-traffic',
    excerpt:
      'Every visited page by name: each product, collection, post and ' +
      'page, grouped by kind, with its views over the selected window.',
  })

  if (!orgReady) {
    return (
      <CardDisplay header={'Pages'} help={help} contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      </CardDisplay>
    )
  }

  if (!entitled) {
    return (
      <CardDisplay header={'Pages'} help={help} contentGutterX contentGutterY>
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
          {'Seeing which pages, products and posts get visited is a Pro ' +
            'feature. Data is already being collected, so history is ' +
            'waiting the moment you upgrade.'}
        </Alert>
      </CardDisplay>
    )
  }

  const allRows = loaded?.rows ?? []
  const rows = group === ALL ? allRows : allRows.filter((row) => row.label.group.id === group)
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize)
  const grandTotal = loaded?.total ?? 0

  return (
    <CardDisplay
      header={'Pages'}
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
            <MenuItem value={7}>{'Last 7 days'}</MenuItem>
            <MenuItem value={14}>{'Last 14 days'}</MenuItem>
            <MenuItem value={30}>{'Last 30 days'}</MenuItem>
          </TextField>
        ),
      }}
    >
      {loaded === null ? (
        <LinearProgress />
      ) : (
        <Stack spacing={2}>
          {loaded.failedDays > 0 && (
            <Alert severity="warning">
              {`${loaded.failedDays} of the ${range} days in this range could not be read, so their views are left out.`}
            </Alert>
          )}
          {loaded.labelsFailed && (
            <Alert severity="warning">
              {'The names of these pages could not be read, so they show by address.'}
            </Alert>
          )}
          {allRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No pageviews recorded in this range yet.'}
            </Typography>
          ) : (
            <>
              <Stack
                direction="row"
                useFlexGap
                spacing={1}
                sx={{ flexWrap: 'wrap' }}
                role="group"
                aria-label={'Show pages of one kind'}
              >
                <Chip
                  label={`All · ${allRows.length}`}
                  color={group === ALL ? 'primary' : 'default'}
                  variant={group === ALL ? 'filled' : 'outlined'}
                  onClick={() => setGroup(ALL)}
                  aria-pressed={group === ALL}
                />
                {groups.map((one) => (
                  <Chip
                    key={one.id}
                    label={`${one.label} · ${one.count} · ${one.views.toLocaleString()} views`}
                    color={group === one.id ? 'primary' : 'default'}
                    variant={group === one.id ? 'filled' : 'outlined'}
                    onClick={() => setGroup(one.id)}
                    aria-pressed={group === one.id}
                  />
                ))}
              </Stack>
              <ScrollTable size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Page'}</TableCell>
                    {group === ALL && <TableCell>{'Kind'}</TableCell>}
                    <TableCell align="right">{'Views'}</TableCell>
                    <TableCell align="right">{'Share'}</TableCell>
                    <TableCell>{'Top device'}</TableCell>
                    <TableCell>{'Top referrer'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((row) => (
                    <PageRow
                      key={row.path}
                      row={row}
                      grandTotal={grandTotal}
                      showKind={group === ALL}
                      screensFailed={loaded.screensFailed}
                    />
                  ))}
                </TableBody>
              </ScrollTable>
              <ListPagination
                page={page}
                pageSize={pageSize}
                rowCount={pageRows.length}
                count={rows.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
              <Typography variant="caption" color="text.secondary">
                {'Views are counted per address, so each product, post and ' +
                  'collection is its own row. Device and referrer are counted ' +
                  'per page design: rows drawn from a shared template show ' +
                  '“site-wide”, and the site’s split is in Traffic above.'}
              </Typography>
            </>
          )}
        </Stack>
      )}
    </CardDisplay>
  )
}
PagesTrafficTable.displayName = 'PagesTrafficTable'

function PageRow(props: {
  row: PageTrafficRow
  grandTotal: number
  showKind: boolean
  screensFailed: boolean
}) {
  const { row, grandTotal, showKind, screensFailed } = props
  const { label, screen } = row
  const measured = Boolean(label.screenId)
  const perPage = (value: string) => {
    if (!measured) {
      return (
        <Tooltip title={SHARED_TEMPLATE_HINT}>
          <Typography variant="body2" color="text.secondary" component="span">
            {'Site-wide'}
          </Typography>
        </Tooltip>
      )
    }
    if (screensFailed) {
      return (
        <Typography variant="body2" color="text.secondary" component="span">
          {'Could not read'}
        </Typography>
      )
    }
    return value || '--'
  }
  return (
    <TableRow>
      <TableCell sx={{ maxWidth: 360 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Stack sx={{ minWidth: 0 }}>
            {label.editHref ? (
              <AppLink href={label.editHref} variant="body2" noWrap>
                {label.title}
              </AppLink>
            ) : (
              <Typography variant="body2" noWrap>
                {label.title}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" noWrap>
              {label.note ? `${label.path} · ${label.note}` : label.path}
            </Typography>
          </Stack>
          {label.liveHref && (
            <Tooltip title={'Open the live page'}>
              <IconButton
                size="small"
                href={label.liveHref}
                target="_blank"
                rel="noopener"
                aria-label={`Open ${label.title} on the live site`}
              >
                <MdiIcon path={mdiOpenInNew.path} fontSize="inherit" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </TableCell>
      {showKind && <TableCell>{label.group.label}</TableCell>}
      <TableCell align="right">{row.views.toLocaleString()}</TableCell>
      <TableCell align="right">
        {grandTotal ? `${Math.round((row.views / grandTotal) * 100)}%` : '--'}
      </TableCell>
      <TableCell sx={{ textTransform: measured && screen ? 'capitalize' : undefined }}>
        {perPage(screen ? topDevice(screen) : '')}
      </TableCell>
      {/* Not capitalized: a referrer is a HOSTNAME (AGL-2341). */}
      <TableCell sx={{ maxWidth: 200 }}>
        {perPage(screen ? referrerLabel(topReferrer(screen)) : '')}
      </TableCell>
    </TableRow>
  )
}

export default PagesTrafficTable
