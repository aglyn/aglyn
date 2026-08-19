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
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'

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
    const idToken = await (
      user as { getIdToken?: () => Promise<string> }
    )?.getIdToken?.()
    const search = new URLSearchParams(params).toString()
    const response = await fetch(`/api/admin/audit-archive/browse?${search}`, {
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
    })
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
 * Staff audit log viewer (AGL-203): every admin mutation writes an
 * append-only `adminAudit` entry (AGL-42) — this page finally makes them
 * readable: newest first, client-side filtering over actor/action/target,
 * expandable before/after diffs. Read access is staff-only in rules; the
 * page also hides itself without the claim, matching the orgs page.
 */
const AdminAudit: NextPageWithLayout<Record<string, never>> = () => {
  const firestore = useFirestore()

  /*==========================================
   * THE WINDOW, AND WHY IT MOVES (AGL-2324).
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
   * TWO CONTROLS, both chosen because they run on the SINGLE-FIELD index
   * that already exists:
   *
   *  - `pageSize` grows the window in steps. A growing limit re-reads what
   *    is already on screen, which is the cost of not holding a
   *    `DocumentSnapshot` cursor across a declarative hook; at these sizes
   *    it buys pagination for no schema change at all.
   *  - `from`/`to` are a RANGE on `at`, the same field the query orders by,
   *    so Firestore serves it from the single-field index too.
   *
   * ⚠️ What is deliberately NOT here: a server-side `where('scope','==',x)`.
   * That needs a composite `adminAudit (scope ASC, at DESC)` index, which is
   * absent from `cloud/firebase-firestore.indexes.json` and from production,
   * and shipping the query before the index throws at runtime for every
   * staff member. The scope facet therefore stays client-side over the
   * window, exactly as AGL-2287 left it. See the issue for the follow-up.
   *=========================================*/
  const PAGE_STEP = 200
  const [pageSize, setPageSize] = useState(PAGE_STEP)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data: entryDocs } = useFirestoreCollection<any>(
    () => {
      const constraints: any[] = [orderBy('at', 'desc')]
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
      constraints.push(limit(pageSize))
      return query(collection(firestore, 'adminAudit'), ...constraints)
    },
    [firestore, from, to, pageSize],
    { idField: '$id' },
  )

  /**
   * True when the read came back FULL — which means there are almost
   * certainly more rows behind it.
   *
   * Surfaced rather than inferred. A page that shows its last row with no
   * indication that the window ended there looks exactly like a page showing
   * the whole log, and that indistinguishability is the defect: the log had
   * been evicting its most important rows for as long as nobody counted.
   */
  const windowFull = (entryDocs?.length ?? 0) >= pageSize

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

  // Compliance export (AGL-206): CSV of the current filter.
  const handleExport = () => {
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
      ...entries.map((entry: any) => [
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
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="Filter (actor, email, action, target)"
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
                <Button
                  size="small"
                  onClick={handleExport}
                  disabled={!entries.length}
                >
                  {'Export CSV'}
                </Button>
              </Stack>
              {/*
                The end of the window, said out loud. `windowFull` means the
                read came back at its ceiling, so there is more behind it —
                the state in which this page used to show its last row and
                look complete.
              */}
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Typography variant="caption" color="text.secondary">
                  {windowFull
                    ? `Showing the newest ${pageSize.toLocaleString()} entries — there are older ones.`
                    : `Showing all ${(entryDocs?.length ?? 0).toLocaleString()} entries in range.`}
                </Typography>
                {windowFull ? (
                  <Button
                    size="small"
                    onClick={() => setPageSize((size) => size + PAGE_STEP)}
                  >
                    {'Load older'}
                  </Button>
                ) : null}
              </Stack>
              {entries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'No audit entries match.'}
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
