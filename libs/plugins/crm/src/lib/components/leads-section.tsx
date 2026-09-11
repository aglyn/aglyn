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

import * as Aglyn from '@aglyn/aglyn'
import type { ConsolePluginPageProps, CrmLeadFields, CrmLeadStatus } from '@aglyn/aglyn'
import {
  mdiAccountArrowRight,
  mdiAccountCancelOutline,
  mdiAccountConvertOutline,
  mdiAccountTieOutline,
} from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  type OrgMemberOptions,
  useOrgMemberOptions,
} from '../hooks/use-org-member-options'
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'
import { useCrmSavedView } from '../hooks/use-crm-saved-view'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useCrmViewGrid } from '../hooks/use-crm-view-grid'
import { CRM_LIST_SLOTS, CrmColumnOrderProvider } from './crm-column-menu'
import { useOrgLeads } from '../hooks/use-org-leads'
import { CrmSuiteNotice, crmSuiteIncluded } from './crm-suite-lock'
import CrmViewsControl from './crm-views-control'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  deleteField,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { downloadTextFile } from '../model/contacts-csv'
import { crmRoutes } from '../model/crm-routes'
import {
  LEAD_FILTER_LABELS,
  LEAD_FILTERS,
  type LeadFilter,
  leadMatchesFilter,
} from '../model/lead-filters'
import { type LeadCsvOptions, leadsCsv } from '../model/leads-csv'
import { LeadConvertDialog } from './lead-convert-dialog'
import { leadSourceLabel, leadSources, leadTimeLabel } from './lead-history-card'
import { LeadImportButton } from './lead-import-drawer'
import { LeadOwnerSelect } from './lead-owner-select'
import { CONVERT_PENDING_ERASURE_REASON } from './lead-properties-card'
import { LeadStatusChip } from './lead-status-chip'
import LeadSurfacesNote from './lead-surfaces-note'
import { LeadUnqualifyDialog } from './lead-unqualify-dialog'
import LeadsBulkBar from './leads-bulk-bar'
import OrgLeadSurfacesNote from './org-lead-surfaces-note'

/**
 * How many leads the section reads: the newest by last seen, plus one probe
 * row so "there are more" is a fact rather than a guess at the boundary.
 *
 * A CEILING and a client-side filter rather than a paged status query, and
 * the reason is the lead documents themselves. Every lead the capture door
 * writes carries NO `status` — the field exists only once somebody in the
 * CRM has touched the lead — and Firestore cannot select documents by a
 * field's absence: `where('status','in',[…])`, `!=` and `not-in` all skip a
 * document without the field. A server-side "open leads" query would
 * therefore hide every lead nobody has worked yet, which is the entire
 * population the section exists to show on the day it ships. So the query
 * is the one order every lead can satisfy (`lastSeenAtMs`, stamped on every
 * capture), and the status filter narrows the loaded window — said out loud
 * beneath the table whenever the window is not the whole collection.
 *
 * The window is then PAGED in memory under the shared footer, the way the
 * workspace pickers page a slice of a window they cannot re-key: the rows
 * are already in the snapshot, so turning a page costs nothing, and the
 * footer's count is exact because it counts the filtered window rather than
 * a collection nobody has measured.
 */
const LEADS_WINDOW = 200

/**
 * What the section says on a plan without the CRM suite (AGL-2790), before
 * the notice's plan sentence and its way to the plans.
 */
export const LEADS_READ_ONLY_NOTICE =
  'Leads are read-only on your plan. Setting a status or an owner, keeping notes, ' +
  'converting and importing leads are part of the CRM suite.'

/**
 * One row of the list. `$id` keys the grid — the document id under a site,
 * `{hostId}/{leadId}` at the organization level, where a lead's id is a
 * person key the same on every site that met the person — and `leadId`
 * and `hostId` say which document, under which site, a write or a link
 * names.
 */
type LeadRow = Record<string, unknown> &
  CrmLeadFields & { $id: string; leadId: string; hostId: string }

/**
 * `/crm/leads` — the people a site has met but not yet qualified (AGL-2608).
 *
 * A section of its own, the way Salesforce keeps Leads apart from Contacts:
 * a lead is a capture — a form, a booking, a sign-up — that somebody has
 * still to work, and it converts into a contact, a company and a deal when
 * it is real. Reads `hosts/{hostId}/leads`, host-scoped by path, so there is
 * no `visibleTo` filter; the Firestore rules admit any member of the site to
 * read it and, on a plan with the CRM suite, an admin, editor or author to
 * update it, which is what makes the inline status and owner changes
 * client-direct writes.
 *
 * At the ORGANIZATION level (AGL-2630) there is no one site to read: the
 * section opens the same query under every site the org has (`useOrgLeads`)
 * and lists the merged window with a Site column, every row naming the site
 * its writes and its link go to. The per-site notes — which of a site's
 * forms file a lead — belong to a site's own hub and are not drawn here.
 *
 * ## Without the CRM suite, read-only
 *
 * Leads is the one section of the CRM a plan without the suite opens
 * (AGL-2790), and it is for reading: the list, a lead's page and the exports
 * stay; there is no status select, no row act but Open lead, no import, and
 * nothing on the bulk bar but the exports, beneath the suite's notice. The
 * rules refuse the same writes on such a plan (AGL-2801), so nothing drawn
 * here is the gate.
 */
export function CrmLeadsSection(props: ConsolePluginPageProps) {
  const { hostId, org, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId } = useCrmScope({ hostId, org })
  const mount = useCrmOrgMount()
  const roster = useOrgMemberOptions(orgId)
  const routes = crmRoutes(basePath ?? '')
  const suiteIncluded = crmSuiteIncluded(org)

  // Under a site: the site's own window, rows keyed by document id.
  const site = useFirestoreCollection<Record<string, unknown> & CrmLeadFields & { $id: string }>(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'leads'),
            orderBy('lastSeenAtMs', 'desc'),
            limit(LEADS_WINDOW + 1),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  // At the organization level: every site's window, merged.
  const orgHostIds = useMemo(
    () => (hostId ? [] : (mount?.hosts ?? []).map((host) => host.id)),
    [hostId, mount?.hosts],
  )
  const orgLeads = useOrgLeads({ hostIds: orgHostIds, windowSize: LEADS_WINDOW })
  const leadDocs = useMemo<LeadRow[]>(
    () =>
      hostId
        ? site.data.map((row) => ({ ...row, leadId: row.$id, hostId }))
        : orgLeads.data,
    [hostId, site.data, orgLeads.data],
  )
  const status = hostId
    ? site.status
    : mount?.hostsReady && !orgHostIds.length
      ? 'success'
      : orgLeads.status
  const truncated = hostId ? leadDocs.length > LEADS_WINDOW : orgLeads.truncated
  const window = useMemo(() => leadDocs.slice(0, LEADS_WINDOW), [leadDocs])

  /*
   * The `Show` filter is the saved VIEW'S (AGL-2617): a saved view of leads
   * holds the status beside the columns and the sort, and the select below
   * writes into it. Unset reads as `open`, which is what the section opened
   * on before views existed and the one reading a query cannot express.
   */
  const views = useCrmSavedView({
    section: 'leads',
    hostId,
    org: props.org,
    basePath: basePath ?? '',
  })
  const filter: LeadFilter = useMemo(() => {
    const value = views.state.filters.find((clause) => clause.field === 'status')?.value
    return (LEAD_FILTERS as readonly string[]).includes(value ?? '')
      ? (value as LeadFilter)
      : 'open'
  }, [views.state.filters])
  const setFilter = useCallback(
    (next: LeadFilter) =>
      views.setFilters(
        next === 'open' ? [] : [{ field: 'status', op: 'equals', value: next }],
      ),
    [views.setFilters],
  )
  // The label's id, so the filter's combobox is named "Show" rather than
  // after the option it shows — see `LeadOwnerSelect`.
  const filterLabelId = useId()
  const rows = useMemo(
    () => window.filter((lead) => leadMatchesFilter(lead, filter)),
    [window, filter],
  )
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // A new filter starts on page one: page three of the open leads is not a
  // page of the unqualified ones, and an out-of-range page renders empty.
  useEffect(() => {
    setPage(0)
  }, [filter])
  const pageRows = useMemo(
    () => rows.slice(page * pageSize, (page + 1) * pageSize),
    [rows, page, pageSize],
  )

  /*
   * The ticked rows, for the bulk bar (AGL-2662). Cleared when the filter
   * changes: a selection made on the open leads is not a selection of the
   * unqualified ones, and the bar's count would be over rows no longer
   * listed.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  useEffect(() => setSelectedIds([]), [filter])
  // How the file names the owner and, at the org level, the site.
  const csvOptions: LeadCsvOptions = useMemo(
    () => ({
      ownerEmail: roster.emailFor,
      ...(hostId ? {} : { siteName: (id: string) => mount?.siteName(id) }),
    }),
    [roster.emailFor, hostId, mount],
  )
  // The listed window — every row the filter admits, not just the page.
  const handleExport = useCallback(() => {
    downloadTextFile('leads.csv', 'text/csv', leadsCsv(rows, csvOptions))
  }, [rows, csvOptions])

  const [assigning, setAssigning] = useState<LeadRow | null>(null)
  const [unqualifying, setUnqualifying] = useState<LeadRow | null>(null)
  // The row whose conversion dialog is open (AGL-2641) — the same dialog
  // the lead's page opens, fed the row so the list is one click shorter.
  const [converting, setConverting] = useState<LeadRow | null>(null)

  const writeLead = useCallback(
    async (lead: LeadRow, fields: Record<string, unknown>, done: string) => {
      try {
        await updateDoc(doc(firestore, 'hosts', lead.hostId, 'leads', lead.leadId), {
          ...fields,
          updatedAt: serverTimestamp(),
        })
        enqueueSnackbar(done, { variant: 'success', persist: false })
      } catch (error) {
        enqueueSnackbar(
          error instanceof Error ? error.message : 'The lead could not be updated.',
          { variant: 'error' },
        )
      }
    },
    [firestore, enqueueSnackbar],
  )

  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'name',
        headerName: 'Lead',
        flex: 1.4,
        minWidth: 160,
        valueGetter: (_value, row: LeadRow) => String(row['name'] || row['email'] || ''),
        renderCell: ({ row }: { row: LeadRow }) => (
          <Stack spacing={0} sx={{ minWidth: 0, justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" noWrap>
              {String(row['name'] || row['email'] || row.$id)}
            </Typography>
            {row['name'] ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {String(row['email'] ?? '')}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.9,
        minWidth: 150,
        valueGetter: (_value, row: LeadRow) => Aglyn.crmLeadStatus(row),
        // Without the suite the status is shown, not changed (AGL-2790).
        renderCell: ({ row }: { row: LeadRow }) =>
          suiteIncluded ? (
            <InlineStatus
              lead={row}
              onChange={(next) => {
                if (next === 'unqualified') {
                  setUnqualifying(row)
                  return
                }
                void writeLead(
                  row,
                  {
                    status: next,
                    ...(Aglyn.crmLeadStatus(row) === 'unqualified'
                      ? { unqualifiedReason: deleteField() }
                      : {}),
                  },
                  'Status updated',
                )
              }}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <LeadStatusChip lead={row} />
            </Box>
          ),
      },
      {
        field: 'ownerUid',
        headerName: 'Owner',
        flex: 1,
        minWidth: 140,
        valueGetter: (_value, row: LeadRow) =>
          row.ownerUid ? roster.labelFor(row.ownerUid) : 'Unassigned',
      },
      // Only at the organization level, where a row can be any site's.
      ...(hostId
        ? []
        : [
            {
              field: 'hostId',
              headerName: 'Site',
              flex: 0.9,
              minWidth: 140,
              valueGetter: (_value: unknown, row: LeadRow) =>
                mount?.siteName(row.hostId) ?? row.hostId,
            } satisfies GridColDef,
          ]),
      {
        field: 'sources',
        headerName: 'Source',
        flex: 1,
        minWidth: 140,
        valueGetter: (_value, row: LeadRow) =>
          leadSources(row).map(leadSourceLabel).join(', '),
      },
      {
        field: 'lastSeenAtMs',
        headerName: 'Last seen',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: LeadRow) =>
          leadTimeLabel(row['lastSeenAtMs'] ?? row['createdAt']),
      },
      {
        field: 'actions',
        headerName: '',
        width: 56,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: ({ row }: { row: LeadRow }) => {
          /*
           * Why Convert is refused, in the order the lead's page refuses it:
           * a converted lead has its contact already, a closed one was
           * judged not real, and a person with an erasure pending must not
           * be captured again — a conversion is a capture (AGL-2623).
           */
          const converted = Boolean(row.convertedContactId)
          const erasurePending = Aglyn.readErasureRequestedAtMs(row) !== null
          const convertRefusal = converted
            ? 'This lead was converted'
            : !Aglyn.isCrmLeadOpen(row)
              ? 'This lead was unqualified'
              : erasurePending
                ? CONVERT_PENDING_ERASURE_REASON
                : null
          const open: RowActionsMenuItem = {
            key: 'open',
            label: 'Open lead',
            icon: <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />,
            href: routes.lead(row.leadId, hostId ? null : row.hostId),
          }
          // Working the lead is the suite's; opening it is every plan's (AGL-2790).
          const work: RowActionsMenuItem[] = suiteIncluded
            ? [
                {
                  key: 'convert',
                  label: 'Convert…',
                  icon: <MdiIcon path={mdiAccountConvertOutline.path} size={0.8} />,
                  onClick: () => setConverting(row),
                  disabled: convertRefusal !== null,
                  disabledReason: convertRefusal ?? undefined,
                },
                {
                  key: 'assign',
                  label: 'Assign owner',
                  icon: <MdiIcon path={mdiAccountTieOutline.path} size={0.8} />,
                  onClick: () => setAssigning(row),
                },
                {
                  key: 'unqualify',
                  label: 'Unqualify',
                  icon: <MdiIcon path={mdiAccountCancelOutline.path} size={0.8} />,
                  onClick: () => setUnqualifying(row),
                  disabled: !Aglyn.isCrmLeadOpen(row) || Boolean(row.convertedContactId),
                  disabledReason: row.convertedContactId
                    ? 'This lead was converted'
                    : 'This lead is already closed',
                },
              ]
            : []
          return (
            <Box
              onClick={(event) => event.stopPropagation()}
              sx={{ display: 'flex', alignItems: 'center', height: '100%' }}
            >
              <RowActionsMenu label={String(row['email'] ?? row.$id)} items={[open, ...work]} />
            </Box>
          )
        },
      },
    ],
    [roster, routes, writeLead, hostId, mount, suiteIncluded],
  )
  /* The column and sort models are the view's (AGL-2617). */
  const grid = useCrmViewGrid(views, columns)

  return (
    <>
      <CardDisplay
        header={'Leads'}
        help={Aglyn.pluginDocsHelp('contacts', { anchor: '#whats-in-the-crm-area' })}
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {/* The saved view this list is showing, beside the status it narrows to (AGL-2617). */}
            <CrmViewsControl controller={views} allLabel="All leads" />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id={filterLabelId}>{'Show'}</InputLabel>
              <Select
                labelId={filterLabelId}
                label="Show"
                value={filter}
                onChange={(event) => setFilter(event.target.value as LeadFilter)}
              >
                {LEAD_FILTERS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {LEAD_FILTER_LABELS[option]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {suiteIncluded ? <LeadImportButton hostId={hostId} /> : null}
            <Button size="small" onClick={handleExport} disabled={!rows.length}>
              {'Export CSV'}
            </Button>
          </Stack>
        }
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {/* A plan without the suite reads its leads and works none of them (AGL-2790). */}
          {suiteIncluded ? null : <CrmSuiteNotice>{LEADS_READ_ONLY_NOTICE}</CrmSuiteNotice>}
          {/* Which surfaces file a lead, by name (AGL-2612) — under a site its own, at the org level every site's (AGL-2638). */}
          {hostId ? (
            <LeadSurfacesNote hostId={hostId} suiteIncluded={suiteIncluded} />
          ) : (
            <OrgLeadSurfacesNote suiteIncluded={suiteIncluded} />
          )}
          {status === 'success' && window.length === 0 ? (
            <EmptyStateComponent
              label={'No leads yet'}
              description={
                suiteIncluded
                  ? 'Sign-ups, bookings and form submissions on your site become leads on their own — or bring a list in with Import CSV.'
                  : 'Sign-ups, bookings and form submissions on your site become leads on their own.'
              }
            />
          ) : status === 'success' && rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {`No ${LEAD_FILTER_LABELS[filter].toLowerCase()} leads among the ` +
                `${window.length.toLocaleString()} most recently seen.`}
            </Typography>
          ) : (
            <>
              <LeadsBulkBar
                rows={rows}
                selected={selectedIds}
                onSelectedChange={setSelectedIds}
                roster={roster}
                csv={csvOptions}
                orgId={orgId}
                hostId={hostId}
                suiteIncluded={suiteIncluded}
              />
              <CrmColumnOrderProvider value={grid.columnOrder}>
                <ListTable
                  rows={pageRows}
                  columns={grid.columns}
                  slots={CRM_LIST_SLOTS}
                  selectable={{ selected: selectedIds, onChange: setSelectedIds }}
                  loading={status === 'loading'}
                  onOpen={(_id, row: LeadRow) =>
                    router.push(routes.lead(row.leadId, hostId ? null : row.hostId))
                  }
                  // Columns and sort are the view's, controlled (AGL-2617).
                  columnVisibilityModel={grid.columnVisibilityModel}
                  onColumnVisibilityModelChange={grid.onColumnVisibilityModelChange}
                  sortModel={grid.sortModel}
                  onSortModelChange={grid.onSortModelChange}
                  // Paged by the footer below, so the grid must not also slice.
                  hideFooter
                />
              </CrmColumnOrderProvider>
              <ListPagination
                page={page}
                pageSize={pageSize}
                rowCount={pageRows.length}
                count={rows.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
          {truncated ? (
            <Alert severity="info">
              {`Showing the ${LEADS_WINDOW.toLocaleString()} most recently seen ` +
                'leads. The status filter narrows these; older leads are still ' +
                'listed in the Inbox and reached by campaign audiences.'}
            </Alert>
          ) : null}
        </Stack>
      </CardDisplay>
      {suiteIncluded ? (
        <>
          <AssignOwnerDialog
            lead={assigning}
            roster={roster}
            onClose={() => setAssigning(null)}
            onAssign={(uid) => {
              if (!assigning) return
              void writeLead(
                assigning,
                { ownerUid: uid || deleteField() },
                uid ? 'Owner assigned' : 'Owner cleared',
              )
              setAssigning(null)
            }}
          />
          <LeadUnqualifyDialog
            open={Boolean(unqualifying)}
            onClose={() => setUnqualifying(null)}
            hostId={unqualifying?.hostId ?? hostId ?? ''}
            leadId={unqualifying?.leadId ?? ''}
            leadLabel={String(unqualifying?.['name'] || unqualifying?.['email'] || '')}
          />
          {/* The row's site, not the mounted one: at the organization level a
              lead is its own site's record, and the conversion is that site's
              capture (AGL-2641). Under a site the two are the same. */}
          <LeadConvertDialog
            open={Boolean(converting)}
            onClose={() => setConverting(null)}
            hostId={converting?.hostId ?? hostId ?? ''}
            orgId={orgId}
            org={org as Record<string, unknown> | undefined}
            leadId={converting?.leadId ?? ''}
            lead={converting ?? {}}
            basePath={basePath ?? ''}
            roster={roster}
          />
        </>
      ) : null}
    </>
  )
}
CrmLeadsSection.displayName = 'CrmLeadsSection'

/**
 * The status, editable in place for a lead that is still open.
 *
 * A converted lead shows the chip alone: its status IS the conversion, and
 * the route stamped it. The select stops its click from reaching the row, or
 * every status change would also open the record.
 */
function InlineStatus(props: {
  lead: LeadRow
  onChange: (next: CrmLeadStatus) => void
}) {
  const { lead, onChange } = props
  if (lead.convertedContactId) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <LeadStatusChip lead={lead} />
      </Box>
    )
  }
  const status = Aglyn.crmLeadStatus(lead)
  return (
    <Box
      onClick={(event) => event.stopPropagation()}
      sx={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%' }}
    >
      <Select
        size="small"
        variant="standard"
        disableUnderline
        value={status}
        onChange={(event) => onChange(event.target.value as CrmLeadStatus)}
        renderValue={() => <LeadStatusChip lead={lead} />}
        sx={{ width: '100%' }}
      >
        <MenuItem value="new">{Aglyn.CRM_LEAD_STATUS_LABELS.new}</MenuItem>
        <MenuItem value="working">{Aglyn.CRM_LEAD_STATUS_LABELS.working}</MenuItem>
        <MenuItem value="unqualified">{`${Aglyn.CRM_LEAD_STATUS_LABELS.unqualified}…`}</MenuItem>
      </Select>
    </Box>
  )
}
InlineStatus.displayName = 'InlineStatus'

/** Hand a lead to a team member. */
function AssignOwnerDialog(props: {
  lead: LeadRow | null
  roster: OrgMemberOptions
  onClose: () => void
  onAssign: (uid: string) => void
}) {
  const { lead, roster, onClose, onAssign } = props
  const [uid, setUid] = useState<string | null>(null)
  const current = uid ?? String(lead?.ownerUid ?? '')
  return (
    <Dialog
      open={Boolean(lead)}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{ transition: { onExited: () => setUid(null) } }}
    >
      <DialogTitle>{`Assign ${String(lead?.['name'] || lead?.['email'] || 'lead')}`}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <LeadOwnerSelect value={current} onChange={setUid} roster={roster} size="medium" />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button variant="contained" onClick={() => onAssign(current)}>
          {'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
AssignOwnerDialog.displayName = 'AssignOwnerDialog'

export default CrmLeadsSection
