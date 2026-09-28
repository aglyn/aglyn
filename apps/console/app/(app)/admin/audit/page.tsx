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
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  type ListFilterClause,
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { planListQuery } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  getDocs,
  limit,
  query,
  type QueryDocumentSnapshot,
  startAfter,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { getDocsBounded } from '@aglyn/tenant-feature-instance/hooks/firebase/firestore-bounded-read'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
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
  ADMIN_AUDIT_KNOWN_SCOPES,
  ADMIN_AUDIT_KNOWN_TARGET_KINDS,
  ADMIN_AUDIT_LIST_FIELDS,
  ADMIN_AUDIT_LIST_HEADERS,
  ADMIN_AUDIT_LIST_QUERY,
  ADMIN_AUDIT_LIST_SELECT_FIELDS,
} from '../../../../utils/admin-audit-list-query'

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

/**
 * A stored entry as the list holds it. The group is the one the writer
 * stamped, which is what the Action group filter queries; a row the backfill
 * has not reached yet shows the group the registry gives it today.
 */
const auditRow = (doc: QueryDocumentSnapshot): Record<string, any> => {
  const data = doc.data() as Record<string, any>
  return {
    ...data,
    $id: doc.id,
    actionGroup: data['actionGroup'] ?? staffAuditActionGroup(data['action']),
  }
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
   * EVERY CLAUSE ON THE QUERY (AGL-3321).
   *
   * `orderBy('at','desc')` and a cursor, so a page is the newest N entries
   * after the last one read — an unordered `limit()` is answered in
   * document-id order, and every row here is keyed by a generated id, so a
   * window without the order is an arbitrary sample of the log (AGL-2324).
   * `orderBy('at')` matches only documents that HAVE `at`; every writer sets
   * it on the same write that creates the entry.
   *
   * Every clause in the toolbar and the search word go onto that one query
   * (`planListQuery` over `ADMIN_AUDIT_LIST_QUERY`): Action, Action group,
   * Who, Target, Target type, Site and Scope as equalities on the fields each
   * row carries — the group, the target type, the site and the search tokens
   * stamped by the writer (`withAdminAuditIndex`) — and When as a range over
   * the sort field. So each reaches every entry in the log, and nothing is
   * matched over the rows a read happened to fetch. A combination one query
   * cannot hold (two "any of" filters past thirty values, say) is refused by
   * name above the list and not applied at all.
   *
   * The scope facet exists because `scope` is stored top-level for exactly
   * this (AGL-2287): `lockdowns/` alone covers several different scopes, so
   * the target path cannot answer it. `actorEmail` is searchable because it
   * is the only identifier a reviewer outside engineering has.
   *=========================================*/
  const [clauses, setClauses] = useState<ListFilterClause[]>([])
  const [searchWords, setSearchWords] = useState<string[]>([])
  const gridFilter = useListGridFilter({
    selectFields: ADMIN_AUDIT_LIST_SELECT_FIELDS,
    clauses,
    onChange: setClauses,
    search: { words: searchWords, onChange: setSearchWords },
  })
  const plan = useMemo(
    () =>
      planListQuery(
        ADMIN_AUDIT_LIST_QUERY,
        { clauses, search: searchWords },
        nameSearchNormalizers,
      ),
    [clauses, searchWords],
  )
  const constraints = useMemo(() => listQueryConstraints(plan), [plan])

  const [rows, setRows] = useState<Record<string, any>[]>([])
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  /** `cursors[i]` is the last entry page `i` read, which page `i + 1` starts after. */
  const [cursors, setCursors] = useState<QueryDocumentSnapshot[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  /*
   * The scopes and target types of every entry read so far, offered beside
   * the ones the writers are known to store. Only what the pickers OFFER —
   * the pick itself is a query over the whole log.
   */
  const [seen, setSeen] = useState<{ scopes: string[]; targetKinds: string[] }>({
    scopes: [],
    targetKinds: [],
  })

  const loadPage = useCallback(
    async (targetPage: number, after: QueryDocumentSnapshot | null) => {
      setLoading(true)
      try {
        // One extra row says whether a next page exists.
        // Bounded (AGL-3373): a stalled client answers from the cache after
        // a few seconds and is asked to recover, instead of holding `loading`
        // forever.
        const { snapshot } = await getDocsBounded(
          query(
            collection(firestore, 'adminAudit'),
            ...constraints,
            ...(after ? [startAfter(after)] : []),
            limit(pageSize + 1),
          ),
        )
        const docs = snapshot.docs.slice(0, pageSize)
        const read = docs.map(auditRow)
        setUnreadable(false)
        setRows(read)
        setHasMore(snapshot.docs.length > pageSize)
        setPage(targetPage)
        setCursors((previous) => {
          const next = previous.slice(0, targetPage)
          const last = docs[docs.length - 1]
          if (last) next[targetPage] = last
          return next
        })
        setSeen((previous) => {
          const scopes = new Set(previous.scopes)
          const targetKinds = new Set(previous.targetKinds)
          for (const row of read) {
            if (typeof row['scope'] === 'string' && row['scope']) scopes.add(row['scope'])
            if (typeof row['targetKind'] === 'string' && row['targetKind']) {
              targetKinds.add(row['targetKind'])
            }
          }
          return scopes.size === previous.scopes.length &&
            targetKinds.size === previous.targetKinds.length
            ? previous
            : { scopes: [...scopes].sort(), targetKinds: [...targetKinds].sort() }
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
    [firestore, pageSize, constraints],
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
          ...rows.map((row) => String(row['actionGroup'] ?? '')).filter(Boolean),
          ...clauses.filter((clause) => clause.field === 'actionGroup').map((clause) => clause.value),
        ]),
      ]
        .sort()
        .map((group) => ({ value: group, label: staffAuditActionGroupLabel(group) })),
      scope: [...new Set([...ADMIN_AUDIT_KNOWN_SCOPES, ...seen.scopes])]
        .sort()
        .map((scope) => ({ value: scope, label: scope })),
      targetKind: [...new Set([...ADMIN_AUDIT_KNOWN_TARGET_KINDS, ...seen.targetKinds])]
        .sort()
        .map((type) => ({ value: type, label: type })),
    }),
    [seen, rows, clauses],
  )
  const refused = useMemo(
    () =>
      listQueryRefusals(plan.refused, {
        fields: ADMIN_AUDIT_LIST_FIELDS,
        headers: ADMIN_AUDIT_LIST_HEADERS,
        options,
      }),
    [plan, options],
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
    return listFilterGridColumns(shown, ADMIN_AUDIT_LIST_FIELDS, options, ADMIN_AUDIT_LIST_HEADERS)
  }, [options])

  /*==========================================
   * COMPLIANCE EXPORT (AGL-206), AND WHY IT READS FOR ITSELF.
   *
   * A CSV of the page on screen would be a document cut to a size chosen for
   * READING, and one that looks complete, because a CSV carries no footer
   * saying which page it came off. So the export runs its own one-shot read
   * of the same query the list is showing — every clause and the search on
   * it — and happens on a CLICK.
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
        query(collection(firestore, 'adminAudit'), ...constraints, limit(EXPORT_CEILING + 1)),
      )
      const capped = snapshot.size > EXPORT_CEILING
      exported = snapshot.docs.slice(0, EXPORT_CEILING).map(auditRow)
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
                'Append-only record of every staff mutation with before/after diffs. Filter by action, action group, who, target, target type, site, scope or date, search it, and export the slice as CSV.',
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
                fields={ADMIN_AUDIT_LIST_FIELDS}
                headers={ADMIN_AUDIT_LIST_HEADERS}
                options={options}
                clauses={clauses}
                onChange={setClauses}
              />
              <ListQueryNotices refused={refused} notices={plan.notices} />
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
                   * to the read above. Nor does it sort that page: the rows
                   * keep the feed's newest-first order.
                   */
                  disableColumnSorting
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
                over-fetches by one.
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
