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
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  Timestamp,
  where,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  useFirestore,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

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
 * narrows the dates — a capped export that announced nothing would be the
 * same silence the paging fix exists to end.
 */
const EXPORT_CEILING = 5000

/**
 * Staff audit log viewer (AGL-203): every admin mutation writes an
 * append-only `adminAudit` entry (AGL-42) — this page finally makes them
 * readable: newest first, client-side filtering over actor/action/target,
 * expandable before/after diffs. Read access is staff-only in rules; the
 * page also hides itself without the claim, matching the orgs page.
 */
const AdminAudit: NextPageWithLayout<Record<string, never>> = () => {
  const firestore = useFirestore()

  /*==========================================
   * THE WINDOW, AND WHY IT MOVES (AGL-2324, AGL-2501).
   *
   * This read was `orderBy('at','desc').limit(200)` with no cursor, no date
   * range and no way to ask for row 201. Roughly seventy distinct action
   * strings write to `adminAudit`, and several are system-actored and
   * high-frequency — `billing.disputeOpened`, `plugins.artifacts.reap`,
   * `erasure.runBatch`, `plugins.remoteServer.load`. Those can fill a
   * 200-row window within hours and push every staff action out of the only
   * surface that shows them. The row most likely to be evicted is
   * `org.override`: the lowest-frequency, highest-consequence entry in the
   * log, and the one this page has bespoke handling for.
   *
   * It then grew a page at a time behind a "Load older" button — a control
   * that only ever goes forward, offers no way to change the page size, and
   * is a fourth pagination grammar in a console that already had too many.
   * This is the shared one: `usePagedCollection` for the window,
   * `ListPagination` for the footer, so an auditor learns the control once
   * and reads the same count line here as on every other list.
   *
   * TWO CONTROLS, both chosen because they run on the SINGLE-FIELD index
   * that already exists:
   *
   *  - The page window is `orderBy('at','desc')` plus a limit the hook
   *    sizes. Ordering is what makes the limit mean "the newest N": an
   *    unordered `limit()` is answered in document-id order, and every row
   *    here is keyed by a generated id, so the window would be an arbitrary
   *    sample of the log arranged to look like its newest page.
   *  - `from`/`to` are a RANGE on `at`, the same field the query orders by,
   *    so Firestore serves it from the single-field index too.
   *
   * ⚠️ `orderBy('at')` matches only documents that HAVE `at`, so ordering
   * on a field a writer omits hides rows instead of arranging them. Every
   * writer of this collection sets it: the ~60 `adminAudit` call sites all
   * write `at` on the same `add`/`set` that creates the document, most as
   * `FieldValue.serverTimestamp()`, and there is no client write path —
   * the rules make `adminAudit` server-only.
   *
   * ⚠️ What is deliberately NOT here: a server-side `where('scope','==',x)`.
   * That needs a composite `adminAudit (scope ASC, at DESC)` index, which is
   * absent from `cloud/firebase-firestore.indexes.json` and from production,
   * and shipping the query before the index throws at runtime for every
   * staff member. The scope facet therefore stays client-side over the page,
   * as does the free-text filter — see the filter block below.
   *=========================================*/
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  /**
   * The ordering and the date range, in ONE place.
   *
   * Shared by the paged window and by the CSV export so the two cannot
   * disagree about which rows the range covers. An export built from its own
   * copy of these constraints is an export that quietly drifts from the
   * screen it was taken off.
   */
  const rangeConstraints = useMemo((): QueryConstraint[] => {
    const constraints: QueryConstraint[] = [orderBy('at', 'desc')]
    // A range on `at` and an order by `at`. Same field, so no composite
    // index — and `to` is EXCLUSIVE of the following day rather than
    // inclusive of midnight, or "to 2026-03-31" would silently drop every
    // row written on the 31st.
    const fromDate = from ? new Date(`${from}T00:00:00`) : null
    const toDate = to ? new Date(`${to}T00:00:00`) : null
    if (fromDate && !Number.isNaN(fromDate.getTime())) {
      constraints.push(where('at', '>=', Timestamp.fromDate(fromDate)))
    }
    if (toDate && !Number.isNaN(toDate.getTime())) {
      toDate.setDate(toDate.getDate() + 1)
      constraints.push(where('at', '<', Timestamp.fromDate(toDate)))
    }
    return constraints
  }, [from, to])

  const {
    rows: entryDocs,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<any>(
    (pageLimit) =>
      query(
        collection(firestore, 'adminAudit'),
        ...rangeConstraints,
        limit(pageLimit),
      ),
    [firestore, from, to],
    { idField: '$id' },
  )

  const [filter, setFilter] = useState('')
  /*==========================================
   * THE SCOPE FACET (AGL-2287).
   *
   * `scope` has been written top-level by five call sites — the five lockdown
   * branches, media quarantine, abuse reports and DMCA counter-notices — since
   * it was added, and `admin/lockdown/route.ts` says why in as many words:
   *
   *   "Stored top-level so the audit log filters by scope on an equality
   *    match. It is derivable from `target`, but only by prefix-matching a
   *    path — and `lockdowns/` alone covers three different scopes."
   *
   * The audit log had no scope filter, did not display the field, and left it
   * out of the compliance export. Five writers, zero readers: the one field
   * put there expressly to be filtered on was the one field nothing could
   * reach.
   *
   * DERIVED FROM THE ROWS IN VIEW rather than a hardcoded list. A fixed
   * vocabulary here would drift the first time a route audits a new scope, and
   * would offer facets that match nothing — the phantom-filter half of the
   * same defect. What is offered is exactly what is present.
   *
   * "In view" now means THE PAGE, not a 200-row window, and the labels say
   * so. Both facets are client-side because neither has an index behind it,
   * and a client-side filter can only narrow rows the client already holds —
   * so a page-scoped filter is the only honest one until `scope` gets its
   * composite index. The DATE RANGE is the control that narrows the read.
   *=========================================*/
  const scopes = useMemo(
    () =>
      [
        ...new Set(
          (entryDocs ?? [])
            .map((entry: any) => entry.scope)
            .filter((scope: unknown): scope is string => typeof scope === 'string' && !!scope),
        ),
      ].sort(),
    [entryDocs],
  )
  const [scope, setScope] = useState('')
  /** The page, narrowed by the two page-scoped facets. */
  const entries = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const all = (entryDocs ?? []).filter(
      (entry: any) => !scope || entry.scope === scope,
    )
    if (!term) return all
    // The reason and its note are searchable too (AGL-1652) — "why did we
    // give them the enterprise rate" is a question asked by the reason, not
    // by an actor or a target anyone remembers.
    //
    // `actorEmail` joined the haystack with AGL-2287. Nine routes wrote it and
    // nothing read it: a staff reviewer searching for a colleague by the only
    // identifier they know — an email address — got no rows, off a log that
    // had been storing exactly that string all along.
    return all.filter((entry: any) =>
      [
        entry.actorUid,
        entry.actorEmail,
        entry.action,
        entry.scope,
        entry.target,
        entry.reason,
        entry.note,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [entryDocs, filter, scope])

  const [expanded, setExpanded] = useState<string | null>(null)

  /*==========================================
   * COMPLIANCE EXPORT (AGL-206), AND WHY IT READS FOR ITSELF.
   *
   * The export used to serialize whatever was on screen, which was fine
   * while the screen held 200 rows and stopped being fine the moment the
   * list started at ten. A compliance export cut to a page size chosen for
   * READING is not a smaller export, it is a different document — and one
   * that looks complete, because a CSV carries no footer saying which page
   * it came off.
   *
   * So it runs its own one-shot `getDocs` over the SAME ordering and date
   * range the screen is showing, independent of the page and of the two
   * page-scoped facets. That is an expensive read, and it happens on a
   * CLICK: nothing here reads the range on mount.
   *
   * Bounded, and the bound is reported. Fetching the ceiling PLUS ONE is
   * what makes truncation a fact rather than a guess — the alternative is a
   * short CSV that reads as the whole range, which is the 200-row window's
   * defect one layer down.
   *=========================================*/
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  const handleExport = async () => {
    setExporting(true)
    setExportNote(null)
    let exported: any[]
    try {
      const snapshot = await getDocs(
        query(
          collection(firestore, 'adminAudit'),
          ...rangeConstraints,
          limit(EXPORT_CEILING + 1),
        ),
      )
      const capped = snapshot.size > EXPORT_CEILING
      exported = snapshot.docs
        .slice(0, EXPORT_CEILING)
        .map((entry) => ({ $id: entry.id, ...entry.data() }))
      setExportNote(
        capped
          ? `Exported the newest ${EXPORT_CEILING.toLocaleString()} entries in this range — there are more. Narrow the dates to export the rest.`
          : `Exported ${exported.length.toLocaleString()} entries.`,
      )
    } catch {
      // A refused or failed read must not hand the auditor a short CSV. No
      // file is a state they can act on; a truncated one is not.
      setExportNote('Could not read the range to export. Nothing was written.')
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
    // `reason`/`note` are columns of their own (AGL-1652) rather than being
    // left inside a JSON blob: the compliance export is read in a
    // spreadsheet, and a why nobody can filter on is a why nobody reads.
    // `scope` and `actorEmail` are columns too (AGL-2287), for the same reason
    // `reason`/`note` were given columns in AGL-1652: the compliance export is
    // read in a spreadsheet, and a field nobody can filter or sort on is a
    // field nobody reads. `actorEmail` in particular is the only column an
    // auditor outside engineering can act on — a bare uid names nobody.
    const rows = [
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
      ...exported.map((entry: any) => [
        entry.at?.seconds
          ? new Date(entry.at.seconds * 1000).toISOString()
          : '',
        entry.actorUid,
        entry.actorEmail ?? '',
        entry.action,
        entry.scope ?? '',
        entry.target,
        // WHICH identity pool the claim landed in (AGL-2324). `users/manage`
        // has written this since AGL-1993 and its own comment calls it
        // "exactly the row a staff-access review needs to see"; no reader
        // projected it. Empty means the project pool; a tenant id means a
        // staff grant was made on an identity inside a CUSTOMER's tenant,
        // which is the case the review exists to find.
        entry.targetTenantId ?? '',
        entry.reason ?? '',
        entry.note ?? '',
        entry.before,
        entry.after,
      ]),
    ]
    const csv = rows.map((row) => row.map(escape).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'admin-audit.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

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
              anchor: '#whats-there',
              excerpt:
                'Append-only record of every staff mutation with before/after diffs. Filter by actor, action, or target and export the slice as CSV.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2}>
              {/*
                * SAID ONCE, ABOUT EVERY ROW.
                *
                * `actorEmail` is a snapshot taken when the entry was written,
                * and an account's address can change afterwards. The stored
                * value is evidence and is never rewritten to match a current
                * address — an audit trail that mutates is worth less than one
                * that is stale — but a reader who assumes the address is
                * current will contact the wrong mailbox. One statement here
                * covers the whole list; a per-row suffix would repeat it on
                * every line of a page that is historical by definition.
                */}
              <Typography variant="caption" color="text.secondary">
                {'Each entry shows the actor’s address as it was when the ' +
                  'action was recorded. It is not updated if that account’s ' +
                  'address changes later — the uid beside it is the ' +
                  'identifier that does not go out of date.'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="Filter this page (actor, email, action, target)"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  sx={{ width: 360 }}
                />
                {/*
                  Rendered only when the window actually contains scoped rows.
                  An always-present select whose only option is "All scopes"
                  advertises a facet that answers nothing.
                */}
                {scopes.length > 0 ? (
                  <TextField
                    select
                    size="small"
                    label="Scope"
                    value={scope}
                    onChange={(event) => setScope(event.target.value)}
                    sx={{ width: 200 }}
                  >
                    <MenuItem value="">{'All scopes'}</MenuItem>
                    {scopes.map((option: string) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                {/*
                  A DATE RANGE, not just a text box (AGL-2324). "What did we
                  do on the 4th" was previously answerable only if the 4th
                  happened to still be inside the newest 200 rows. Both bounds
                  are a range on `at`, the field the query already orders by,
                  so this needs no index that does not already exist.
                */}
                <TextField
                  size="small"
                  type="date"
                  label="From"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: 170 }}
                />
                <TextField
                  size="small"
                  type="date"
                  label="To"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: 170 }}
                />
                {/*
                  Enabled off the DATE RANGE, never off the page. The export
                  reads for itself, so a page filtered down to nothing still
                  has a range to export — disabling on `entries` would refuse
                  the whole log because the current ten rows did not match a
                  search term.
                */}
                <Button size="small" onClick={handleExport} disabled={exporting}>
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </Button>
              </Stack>
              {exportNote ? (
                <Typography variant="caption" color="text.secondary">
                  {exportNote}
                </Typography>
              ) : null}
              {entries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {(entryDocs ?? []).length
                    ? 'Nothing on this page matches the filter.'
                    : 'No audit entries in this range.'}
                </Typography>
              ) : (
                entries.map((entry: any) => {
                  /**
                   * WHY the action was taken (AGL-1652), when the row
                   * carries one. `org.override` rows get the reason
                   * vocabulary's label; any other row that grows a
                   * top-level reason renders its raw code rather than
                   * being silently dropped for not being an override.
                   */
                  const why =
                    orgOverrideReasonSummary(entry.reason, entry.note) ??
                    (entry.reason
                      ? [entry.reason, entry.note].filter(Boolean).join(' — ')
                      : null)
                  return (
                  <Stack
                    key={entry.$id}
                    spacing={0.5}
                    sx={{
                      cursor: 'pointer',
                      borderBottom: 1,
                      borderColor: 'divider',
                      pb: 1,
                    }}
                    onClick={() =>
                      setExpanded((previous) =>
                        previous === entry.$id ? null : entry.$id,
                      )
                    }
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Chip label={entry.action} size="small" />
                      {/*
                        AGL-2287. `lockdowns/` alone covers platform, feature,
                        user, org and host locks, so the target path cannot be
                        read as a scope — which is why the writers store it
                        separately, and why leaving it off the row made five
                        different kinds of lock look like one kind.
                      */}
                      {/*
                        A staff grant made inside a CUSTOMER's identity pool
                        (AGL-2324). Rendered in `warning` because that is what
                        distinguishes it from the ordinary project-pool grant
                        beside it — a chip in the same colour as every other
                        chip is a field nobody reads twice.
                      */}
                      {entry.targetTenantId ? (
                        <Chip
                          label={`tenant pool: ${entry.targetTenantId}`}
                          size="small"
                          color="warning"
                          variant="outlined"
                        />
                      ) : null}
                      {entry.scope ? (
                        <Chip
                          label={entry.scope}
                          size="small"
                          variant="outlined"
                        />
                      ) : null}
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {entry.target}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 'auto' }}
                      >
                        {/*
                          * The address AS IT WAS when the entry was written,
                          * and never re-resolved from the account: the row is
                          * evidence, and rewriting stored history to match a
                          * current address would make the trail worth less
                          * than leaving it stale.
                          *
                          * Not suffixed per row — the page says it once, above
                          * the list, and every row here is historical by
                          * definition. The uid beside it is the identifier
                          * that does not go out of date, which is why it is
                          * always rendered.
                          */}
                        {`${
                          entry.actorEmail
                            ? `${entry.actorEmail} (${entry.actorUid})`
                            : entry.actorUid
                        } · ${
                          entry.at?.seconds
                            ? new Date(
                                entry.at.seconds * 1000,
                              ).toLocaleString()
                            : '—'
                        }`}
                      </Typography>
                    </Stack>
                    {/*
                      Shown COLLAPSED, not only in the expanded diff: a
                      reason nobody sees without clicking is the same
                      failure as no reason at all. `org.override` rows
                      written before AGL-1652 have none, and say so rather
                      than rendering a blank that would pass for one.
                    */}
                    {why ? (
                      <Typography variant="caption" color="text.secondary">
                        {`Why: ${why}`}
                      </Typography>
                    ) : entry.action === 'org.override' ? (
                      <Typography variant="caption" color="warning.main">
                        {'Why: not recorded — this override predates the ' +
                          'required reason.'}
                      </Typography>
                    ) : null}
                    {expanded === entry.$id ? (
                      <Typography
                        component="pre"
                        variant="caption"
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
                            reason: entry.reason ?? null,
                            note: entry.note ?? null,
                            before: entry.before,
                            after: entry.after,
                          },
                          null,
                          2,
                        )}
                      </Typography>
                    ) : null}
                  </Stack>
                  )
                })
              )}
              {/*
                The shared footer (AGL-2501). `hasMore` is a FACT here, not a
                guess off `length >= pageSize`: the hook over-fetches by one
                and never renders the probe row, so the last page cannot
                offer a Next that leads nowhere — nor hide one that leads
                somewhere, which is what a full final page used to do.

                `rowCount` is the FILTERED count, so the count line describes
                what the reader is looking at rather than what was fetched.
              */}
              <ListPagination
                page={page}
                pageSize={pageSize}
                rowCount={entries.length}
                hasMore={hasMore}
                onPageChange={setPage}
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
