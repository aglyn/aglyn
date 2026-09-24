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

import { orgOverrideReasonSummary } from '@aglyn/aglyn'
import {
  listPluginActivityFilters,
  pluginStaffAuditActionGroup as staffAuditActionGroup,
  pluginStaffAuditActionGroupLabel as staffAuditActionGroupLabel,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  filterListRows,
  type ListFilterClause,
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryDocumentSnapshot,
  startAfter,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { listFilterConstraints } from '@aglyn/tenant-feature-instance/hooks/list-filter-constraints'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import {
  CONTENT_MAX_WIDTH,
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_ROW_HEIGHT,
} from '../../../../constants/shared'
import {
  ADMIN_AUDIT_FILTER_FIELDS,
  ADMIN_AUDIT_FILTER_HEADERS,
  ADMIN_AUDIT_SCAN,
  ADMIN_AUDIT_SEARCH_PATHS,
  ADMIN_AUDIT_SELECT_FIELDS,
  adminAuditClauseStandsAlongside,
  adminAuditPlan,
} from '../../../../utils/audit-log-filters'
import { scanCursorPage } from '../../../../utils/scan-cursor-page'

/**
 * THE ARCHIVE, GIVEN A DOOR (AGL-2324).
 *
 * `audit-archive/route.ts` moves rows older than 90 days into
 * `adminAudit-archive/{yyyy-MM}/*.jsonl` and deletes them from Firestore.
 * `docs/DATA_RETENTION.md` promises "90 days hot, then 365 days archived".
 * The archived 365 days had no product reader at all — they were reachable
 * only by a human with GCS console access, which is not a product path and
 * not something an auditor can be handed.
 *
 * Deliberately a SEPARATE card rather than rows spliced into the hot list.
 * An archived row and a live row are not the same evidence: one is a
 * Firestore document that could still be written to, the other is an
 * immutable line in a compliance object, and blending them into one scroll
 * would quietly claim the hot log goes back a year.
 */
function ArchiveCard() {
  const { data: user } = useUser()
  const [month, setMonth] = useState('')
  const [files, setFiles] = useState<
    { name: string; bytes: number; archivedAt: string | null }[] | null
  >(null)
  const [rows, setRows] = useState<Record<string, any>[] | null>(null)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const call = async (params: Record<string, string>) => {
    const search = new URLSearchParams(params).toString()
    const response = await authorizedFetch(
      user,
      `/api/admin/audit-archive/browse?${search}`,
    )
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? 'Archive lookup failed')
    return body
  }

  const listMonth = async () => {
    setBusy(true)
    setError(null)
    setRows(null)
    setOpenFile(null)
    try {
      setFiles((await call({ month })).files ?? [])
    } catch (caught) {
      setFiles(null)
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openArchive = async (file: string) => {
    setBusy(true)
    setError(null)
    try {
      const body = await call({ month, file })
      setRows(body.rows ?? [])
      setOpenFile(file)
      // A file that would not fully parse says so. Dropping the bad lines
      // and showing a shorter list is the same defect as the 200-row window,
      // one storage layer down.
      if (body.unreadable) {
        setError(
          `${body.unreadable} line(s) in this object could not be parsed and are not shown.`,
        )
      }
    } catch (caught) {
      setRows(null)
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header={'Archive (90–365 days)'}
      help={docsHelp('staffConsole', {
        anchor: '#audit-archival',
        excerpt:
          'A nightly cron moves audit entries past the 90-day retention window into a Storage compliance trail (JSON lines, month-partitioned), kept a further 365 days.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Entries older than 90 days leave Firestore for the compliance trail
          in storage and are kept a further 365 days. Pick the month they were
          written to read them back.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            type="month"
            label="Month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 200 }}
          />
          <Button size="small" onClick={listMonth} disabled={!month || busy}>
            {'List archive'}
          </Button>
        </Stack>
        {error ? (
          <Typography variant="body2" color="error.main">
            {error}
          </Typography>
        ) : null}
        {files && files.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing archived for that month.'}
          </Typography>
        ) : null}
        {files?.map((entry) => (
          <Stack
            key={entry.name}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {entry.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {`${entry.bytes.toLocaleString()} bytes`}
            </Typography>
            <Button
              size="small"
              onClick={() => openArchive(entry.name)}
              disabled={busy}
            >
              {openFile === entry.name ? 'Reloaded' : 'Open'}
            </Button>
          </Stack>
        ))}
        {rows?.map((row, index) => (
          <Stack
            key={`${row['$id'] ?? index}`}
            spacing={0.5}
            sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Chip label={String(row['action'] ?? '')} size="small" />
              {row['scope'] ? (
                <Chip
                  label={String(row['scope'])}
                  size="small"
                  variant="outlined"
                />
              ) : null}
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {String(row['target'] ?? '')}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 'auto' }}
              >
                {/*
                  The archived `at` is an ISO STRING, not a Firestore
                  `Timestamp` — the writer serialized it with `toISOString()`.
                  Reading it as `.seconds` would render an em dash for every
                  archived row and make a full archive look empty.
                */}
                {`${row['actorEmail'] ?? row['actorUid'] ?? '—'} · ${
                  row['at'] ? new Date(String(row['at'])).toLocaleString() : '—'
                }`}
              </Typography>
            </Stack>
            {row['reason'] ? (
              <Typography variant="caption" color="text.secondary">
                {`Why: ${[row['reason'], row['note']].filter(Boolean).join(' — ')}`}
              </Typography>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </CardDisplay>
  )
}

/**
 * How many rows one compliance export may carry.
 *
 * High enough that a normal range comes back whole, bounded because an
 * unbounded fleet-wide read from a browser is how a staff page becomes an
 * outage. When the range holds more, the page says so and the auditor
 * narrows the filters — a capped export that announced nothing would be the
 * same silence the paging fix exists to end.
 */
const EXPORT_CEILING = 5000

/** A stored entry as the list holds it, with the group its action files under. */
const auditRow = (doc: QueryDocumentSnapshot): Record<string, any> => {
  const data = doc.data() as Record<string, any>
  return { ...data, $id: doc.id, actionGroup: staffAuditActionGroup(data['action']) }
}

/**
 * WHY the action was taken (AGL-1652), when the row carries one.
 * `org.override` rows get the reason vocabulary's label; any other row that
 * grows a top-level reason renders its raw code rather than being silently
 * dropped for not being an override.
 */
const auditWhy = (entry: Record<string, any>): string | null =>
  orgOverrideReasonSummary(entry['reason'], entry['note']) ??
  (entry['reason'] ? [entry['reason'], entry['note']].filter(Boolean).join(' — ') : null)

/**
 * Staff audit log viewer (AGL-203): every admin mutation writes an
 * append-only `adminAudit` entry (AGL-42), and this page reads them newest
 * first, filterable through the grid's toolbar, with each entry's
 * before/after one click away. Read access is staff-only in rules; the page
 * also hides itself without the claim, matching the orgs page.
 */
const AdminAudit: NextPageWithLayout<Record<string, never>> = () => {
  const firestore = useFirestore()

  /*==========================================
   * ONE QUERY, FILTERED WHERE IT CAN BE (AGL-3321).
   *
   * `orderBy('at','desc')` and a cursor, so a page is the newest N entries
   * after the last one read — an unordered `limit()` is answered in
   * document-id order, and every row here is keyed by a generated id, so a
   * window without the order is an arbitrary sample of the log (AGL-2324).
   * `orderBy('at')` matches only documents that HAVE `at`; every writer sets
   * it on the same write that creates the entry, and `adminAudit` has no
   * client write path.
   *
   * The toolbar's clauses split two ways (`adminAuditPlan`):
   *
   *  - SERVED: one of Action, Who (uid) or Target as an equality, each on its
   *    own composite, and When as a range over the sort field. They narrow
   *    the query, so they reach every entry in the log.
   *  - MATCHED: Action group, Scope and the search. A group is a namespace
   *    prefix or a plugin's list of codes and `scope` has no composite, so no
   *    query under the date sort can ask for them; the page reads the log in
   *    batches and keeps what matches, up to `ADMIN_AUDIT_SCAN` entries a
   *    page, and Next resumes after the last entry READ. Nothing is skipped —
   *    a page can only come back short.
   *
   * The scope facet exists because `scope` is stored top-level for exactly
   * this (AGL-2287): `lockdowns/` alone covers several different scopes, so
   * the target path cannot answer it. `actorEmail` is searchable because it
   * is the only identifier a reviewer outside engineering has.
   *=========================================*/
  const [clauses, setClauses] = useState<ListFilterClause[]>([])
  const [searchWords, setSearchWords] = useState<string[]>([])
  const gridFilter = useListGridFilter({
    selectFields: ADMIN_AUDIT_SELECT_FIELDS,
    // One served equality at a time; the date and the matched fields stand
    // beside it.
    single: true,
    keepAlongside: adminAuditClauseStandsAlongside,
    clauses,
    onChange: setClauses,
    search: { words: searchWords, onChange: setSearchWords },
  })
  const plan = useMemo(() => adminAuditPlan(clauses), [clauses])
  const servedConstraints = useMemo(
    () =>
      plan.served.flatMap(
        (clause) =>
          listFilterConstraints(ADMIN_AUDIT_FILTER_FIELDS, clause, { fixedOrderBy: 'at' }) ?? [],
      ),
    [plan],
  )
  const matching = plan.matched.length > 0 || searchWords.length > 0
  const matches = useCallback(
    (row: Record<string, any>) =>
      filterListRows([row], ADMIN_AUDIT_FILTER_FIELDS, plan.matched, {
        paths: ADMIN_AUDIT_SEARCH_PATHS,
        words: searchWords,
      }).length > 0,
    [plan, searchWords],
  )

  const [rows, setRows] = useState<Record<string, any>[]>([])
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  /** `cursors[i]` is the last entry page `i` READ, which page `i + 1` resumes after. */
  const [cursors, setCursors] = useState<QueryDocumentSnapshot[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  /*
   * The scopes and action groups of every entry read so far — what the
   * pickers offer. A fixed vocabulary would drift the first time a route
   * audits a new scope and offer choices that match nothing; the registered
   * plugin groups are offered from the start because the catalog names them.
   */
  const [seen, setSeen] = useState<{ scopes: string[]; groups: string[] }>({
    scopes: [],
    groups: [],
  })

  const loadPage = useCallback(
    async (targetPage: number, after: QueryDocumentSnapshot | null) => {
      setLoading(true)
      const scopes = new Set<string>()
      const groups = new Set<string>()
      try {
        const base = collection(firestore, 'adminAudit')
        const result = await scanCursorPage<QueryDocumentSnapshot, Record<string, any>>({
          pageSize,
          scanCap: matching ? ADMIN_AUDIT_SCAN : pageSize,
          // One extra row says whether a next page exists; a matched page
          // reads in larger batches so it is not one round trip per row.
          batchSize: matching ? Math.max(pageSize + 1, 100) : pageSize + 1,
          after,
          read: async (from, count) =>
            (
              await getDocs(
                query(
                  base,
                  ...servedConstraints,
                  orderBy('at', 'desc'),
                  ...(from ? [startAfter(from)] : []),
                  limit(count),
                ),
              )
            ).docs,
          accept: (doc) => {
            const row = auditRow(doc)
            if (typeof row['scope'] === 'string' && row['scope']) scopes.add(row['scope'])
            if (row['actionGroup']) groups.add(row['actionGroup'])
            return matches(row) ? row : null
          },
        })
        setUnreadable(false)
        setRows(result.rows)
        setHasMore(!result.exhausted)
        setPage(targetPage)
        setCursors((previous) => {
          const next = previous.slice(0, targetPage)
          if (result.last) next[targetPage] = result.last
          return next
        })
        setSeen((previous) => {
          const merged = {
            scopes: [...new Set([...previous.scopes, ...scopes])].sort(),
            groups: [...new Set([...previous.groups, ...groups])].sort(),
          }
          return merged.scopes.length === previous.scopes.length &&
            merged.groups.length === previous.groups.length
            ? previous
            : merged
        })
      } catch (error) {
        console.error(error)
        setUnreadable(true)
        setRows([])
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    },
    [firestore, pageSize, servedConstraints, matching, matches],
  )

  // A new filter, search or page size is a different query: page one.
  useEffect(() => {
    void loadPage(0, null)
  }, [loadPage])

  const options = useMemo(
    (): Record<string, readonly ListFilterOption[]> => ({
      actionGroup: [
        ...new Set([
          ...listPluginActivityFilters().map(({ group }) => group.id),
          ...seen.groups,
        ]),
      ]
        .sort()
        .map((group) => ({ value: group, label: staffAuditActionGroupLabel(group) })),
      scope: seen.scopes.map((scope) => ({ value: scope, label: scope })),
    }),
    [seen],
  )

  const [expanded, setExpanded] = useState<string | null>(null)
  const expandedRow = rows.find((row) => row['$id'] === expanded) ?? null

  const columns = useMemo((): GridColDef[] => {
    const shown: GridColDef[] = [
      {
        field: 'action',
        headerName: 'Action',
        flex: 1.1,
        minWidth: 190,
        renderCell: ({ row }: any) => <Chip label={row.action} size="small" />,
      },
      {
        field: 'scope',
        headerName: 'Scope',
        flex: 0.7,
        minWidth: 110,
        /*
          AGL-2287. `lockdowns/` alone covers platform, feature, user, org and
          host locks, so the target path cannot be read as a scope — which is
          why the writers store it separately.
        */
        renderCell: ({ row }: any) =>
          row.scope ? <Chip label={row.scope} size="small" variant="outlined" /> : null,
      },
      {
        field: 'target',
        headerName: 'Target',
        flex: 1.3,
        minWidth: 220,
        renderCell: ({ row }: any) => (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }} noWrap>
              {row.target}
            </Typography>
            {/*
              A staff grant made inside a CUSTOMER's identity pool (AGL-2324),
              in `warning` because that is what distinguishes it from the
              ordinary project-pool grant beside it.
            */}
            {row.targetTenantId ? (
              <Chip
                label={`tenant pool: ${row.targetTenantId}`}
                size="small"
                color="warning"
                variant="outlined"
              />
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'actorUid',
        /*
         * The address AS IT WAS when the entry was written, never re-resolved
         * from the account: the row is evidence. The uid beside it is the
         * identifier that does not go out of date, which is why it is always
         * shown — and what the Who filter matches.
         */
        headerName: 'Who (then)',
        flex: 1.2,
        minWidth: 220,
        valueGetter: (_value, row: any) =>
          row.actorEmail ? `${row.actorEmail} (${row.actorUid})` : row.actorUid,
      },
      {
        field: 'at',
        headerName: 'When',
        flex: 0.9,
        minWidth: 170,
        type: 'date',
        valueGetter: (_value, row: any) =>
          row.at?.seconds ? new Date(row.at.seconds * 1000) : null,
        renderCell: ({ row }: any) =>
          row.at?.seconds ? new Date(row.at.seconds * 1000).toLocaleString() : '—',
      },
      {
        field: 'why',
        headerName: 'Why',
        flex: 1,
        minWidth: 180,
        sortable: false,
        valueGetter: (_value, row: any) => auditWhy(row) ?? '',
        /*
          Shown in the row, not only in the expanded entry: a reason nobody
          sees without clicking is the same failure as no reason at all.
          `org.override` rows written before AGL-1652 have none, and say so
          rather than rendering a blank that would pass for one.
        */
        renderCell: ({ row }: any) => {
          const why = auditWhy(row)
          if (why) return why
          return row.action === 'org.override' ? (
            <Typography variant="caption" color="warning.main">
              {'Not recorded — this override predates the required reason.'}
            </Typography>
          ) : null
        },
      },
    ]
    return listFilterGridColumns(shown, ADMIN_AUDIT_FILTER_FIELDS, options, ADMIN_AUDIT_FILTER_HEADERS)
  }, [options])

  /*==========================================
   * COMPLIANCE EXPORT (AGL-206), AND WHY IT READS FOR ITSELF.
   *
   * A CSV of the page on screen would be a document cut to a size chosen for
   * READING, and one that looks complete, because a CSV carries no footer
   * saying which page it came off. So the export runs its own one-shot read
   * over the same served filters the list is showing, matches the same
   * clauses and search over it, and happens on a CLICK.
   *
   * Bounded, and the bound is reported. Reading the ceiling PLUS ONE is what
   * makes truncation a fact rather than a guess.
   *=========================================*/
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  const handleExport = async () => {
    setExporting(true)
    setExportNote(null)
    let exported: Record<string, any>[]
    try {
      const snapshot = await getDocs(
        query(
          collection(firestore, 'adminAudit'),
          ...servedConstraints,
          orderBy('at', 'desc'),
          limit(EXPORT_CEILING + 1),
        ),
      )
      const capped = snapshot.size > EXPORT_CEILING
      exported = snapshot.docs.slice(0, EXPORT_CEILING).map(auditRow).filter(matches)
      setExportNote(
        capped
          ? `Exported from the newest ${EXPORT_CEILING.toLocaleString()} entries these filters reach — there are more. Narrow the dates to export the rest.`
          : `Exported ${exported.length.toLocaleString()} entries.`,
      )
    } catch {
      // A refused or failed read must not hand the auditor a short CSV. No
      // file is a state they can act on; a truncated one is not.
      setExportNote('Could not read the entries to export. Nothing was written.')
      return
    } finally {
      setExporting(false)
    }
    const escape = (value: unknown) => {
      const text =
        typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value ?? '')
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    // `reason`/`note` (AGL-1652), `scope` and `actorEmail` (AGL-2287) and
    // `targetTenantId` (AGL-2324) are columns of their own: the export is
    // read in a spreadsheet, and a field nobody can filter or sort on is a
    // field nobody reads. An empty `targetTenantId` is the project pool; a
    // tenant id is a staff grant inside a CUSTOMER's identity pool.
    const table = [
      [
        'at',
        'actorUid',
        'actorEmail',
        'action',
        'scope',
        'target',
        'targetTenantId',
        'reason',
        'note',
        'before',
        'after',
      ],
      ...exported.map((entry) => [
        entry['at']?.seconds ? new Date(entry['at'].seconds * 1000).toISOString() : '',
        entry['actorUid'],
        entry['actorEmail'] ?? '',
        entry['action'],
        entry['scope'] ?? '',
        entry['target'],
        entry['targetTenantId'] ?? '',
        entry['reason'] ?? '',
        entry['note'] ?? '',
        entry['before'],
        entry['after'],
      ]),
    ]
    const csv = table.map((row) => row.map(escape).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'admin-audit.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const filtering = clauses.length > 0 || searchWords.length > 0

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Audit log', href: buildRoute(Route.ADMIN_AUDIT) },
      ]}
      help={{ topic: 'staffConsole', anchor: '#audit-log' }}
      header={{
        children: 'Audit Log',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
          <CardDisplay
            header={'Admin actions'}
            help={docsHelp('staffConsole', {
              anchor: '#audit-log',
              excerpt:
                'Append-only record of every staff mutation with before/after diffs. Filter by action, who, target, scope or date, search it, and export the slice as CSV.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={1.5}>
              {/*
                * SAID ONCE, ABOUT EVERY ROW. `actorEmail` is a snapshot taken
                * when the entry was written and is never rewritten to match a
                * current address — an audit trail that mutates is worth less
                * than one that is stale.
                */}
              <Typography variant="caption" color="text.secondary">
                {'Each entry shows the actor’s address as it was when the ' +
                  'action was recorded. It is not updated if that account’s ' +
                  'address changes later — the uid beside it is the ' +
                  'identifier that does not go out of date.'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {/*
                  Enabled whatever the page holds: the export reads for
                  itself, so a page filtered down to nothing still has
                  entries to export.
                */}
                <Button size="small" onClick={handleExport} disabled={exporting}>
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </Button>
                {exportNote ? (
                  <Typography variant="caption" color="text.secondary">
                    {exportNote}
                  </Typography>
                ) : null}
              </Stack>
              <ListFilterChips
                fields={ADMIN_AUDIT_FILTER_FIELDS}
                headers={ADMIN_AUDIT_FILTER_HEADERS}
                options={options}
                clauses={clauses}
                onChange={setClauses}
              />
              {matching ? (
                <Typography variant="caption" color="text.secondary">
                  {'Action group, Scope and the search are matched as the log ' +
                    `is read: each page looks through up to ${ADMIN_AUDIT_SCAN} ` +
                    'entries, so a page can come back short — Next carries on ' +
                    'from where it stopped.'}
                </Typography>
              ) : null}
              {unreadable && !loading ? (
                <Alert severity="warning">
                  {'Could not read the audit log. This is not the same as there ' +
                    'being no entries.'}
                </Alert>
              ) : rows.length === 0 && !loading && !filtering ? (
                <Typography variant="body2" color="text.secondary">
                  {'No audit entries yet.'}
                </Typography>
              ) : (
                <ListTable
                  aria-label="Admin actions"
                  rows={rows}
                  columns={columns}
                  /*
                   * A row opens its entry — the reason, the note and the
                   * before/after — below the list.
                   */
                  onOpen={(id) => setExpanded((previous) => (previous === id ? null : id))}
                  hideFooter
                  rowHeight={TABLE_ROW_HEIGHT}
                  /*
                   * The grid holds one page of a cursor feed, so it never
                   * filters that page itself: the clauses and the search go
                   * to the read above.
                   */
                  filterMode="server"
                  filterModel={gridFilter.filterModel}
                  onFilterModelChange={gridFilter.onFilterModelChange}
                  quickFilter
                  loading={loading}
                  noRowsLabel="No audit entries match these filters"
                />
              )}
              {expandedRow ? (
                <Typography
                  component="pre"
                  variant="caption"
                  aria-label="Entry details"
                  sx={{
                    m: 0,
                    p: 1,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(
                    {
                      action: expandedRow['action'],
                      target: expandedRow['target'],
                      reason: expandedRow['reason'] ?? null,
                      note: expandedRow['note'] ?? null,
                      before: expandedRow['before'],
                      after: expandedRow['after'],
                    },
                    null,
                    2,
                  )}
                </Typography>
              ) : null}
              {/*
                The shared footer (AGL-2501). `hasMore` is a FACT: the read
                over-fetches by one, or the matched walk stopped before the
                log ran out.
              */}
              <ListPagination
                page={page}
                pageSize={pageSize}
                rowCount={rows.length}
                hasMore={hasMore}
                disabled={loading}
                onPageChange={(next) => {
                  if (next === page) return
                  void loadPage(next, next > 0 ? (cursors[next - 1] ?? null) : null)
                }}
                onPageSizeChange={setPageSize}
              />
            </Stack>
          </CardDisplay>

          <ArchiveCard />
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminAudit.displayName = 'Page:AdminAudit'

export default AdminAudit
