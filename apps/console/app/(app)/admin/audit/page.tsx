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
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'

/**
 * Staff audit log viewer (AGL-203): every admin mutation writes an
 * append-only `adminAudit` entry (AGL-42) — this page finally makes them
 * readable: newest first, client-side filtering over actor/action/target,
 * expandable before/after diffs. Read access is staff-only in rules; the
 * page also hides itself without the claim, matching the orgs page.
 */
const AdminAudit: NextPageWithLayout<Record<string, never>> = () => {
  const firestore = useFirestore()

  const { data: entryDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'adminAudit'),
        orderBy('at', 'desc'),
        limit(200),
      ),
    [firestore],
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
                <Button
                  size="small"
                  onClick={handleExport}
                  disabled={!entries.length}
                >
                  {'Export CSV'}
                </Button>
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
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminAudit.displayName = 'Page:AdminAudit'

export default AdminAudit
