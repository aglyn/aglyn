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
import type {
  ConsolePluginPageProps,
  CrmLeadFields,
  CrmViewFilterClause,
  CrmLeadStatus,
} from '@aglyn/aglyn'
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
import { useCrmCampaigns } from '../hooks/use-crm-campaigns'
import { scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { useContactFieldDefinitions } from '../hooks/use-contact-field-definitions'
import { customFieldColumns } from './contact-custom-columns'
import { useCrmViewGrid } from '../hooks/use-crm-view-grid'
import { CRM_LIST_SLOTS, CrmColumnOrderProvider } from './crm-column-menu'
import { useOrgLeads } from '../hooks/use-org-leads'
import CrmViewsControl from './crm-views-control'
import { CrmListActions, CrmListToolbar } from './crm-list-toolbar'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
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
  where,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { downloadTextFile } from '../model/contacts-csv'
import { crmRoutes } from '../model/crm-routes'
import {
  LEAD_EMAIL_FILTER_OPTIONS,
  LEAD_FILTER_CODECS,
  LEAD_LIST_FILTER_FIELDS,
  LEAD_LIST_FILTER_HEADERS,
  LEAD_SOURCE_FILTER_NONE,
  LEAD_STATUS_FILTER_OPTIONS,
  leadClausesForGrid,
  leadClausesToStore,
  leadMatchesClauses,
  leadMatchesSearch,
} from '../model/lead-filters'
import {
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { useLeadSourcePicklist } from '../hooks/use-lead-source-picklist'
import { type LeadCsvOptions, leadsCsv } from '../model/leads-csv'
import { LeadConvertDialog } from './lead-convert-dialog'
import {
  leadSourceLabel,
  leadSources,
  leadTimeLabel,
} from './lead-history-card'
import { LeadImportButton } from './lead-import-drawer'
import NewLeadDrawer, { type NewLeadValues } from './new-lead-drawer'
import { useCrmApi } from './use-crm-api'
import { LeadOwnerSelect } from './lead-owner-select'
import { CONVERT_PENDING_ERASURE_REASON } from './lead-properties-card'
import { CrmEmailStateChip } from './crm-email-state-chip'
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
 * One row of the list. `$id` keys the grid and `leadId` names the document,
 * and they are the same value at both levels (AGL-3275).
 *
 * `$id` used to be `{hostId}/{leadId}` at the organization level, because a
 * lead's id is a person key and the same person met by two sites was two
 * documents carrying it — so the id alone could not key a list that spanned
 * sites. One org collection ends that, and the row no longer carries a site
 * at all: which sites hold this person is `capturedByHostIds`, a fact about
 * the person rather than part of their address.
 */
type LeadRow = Record<string, unknown> &
  CrmLeadFields & { $id: string; leadId: string }

/**
 * `/crm/leads` — the people a site has met but not yet qualified (AGL-2608).
 *
 * A section of its own, the way Salesforce keeps Leads apart from Contacts:
 * a lead is a capture — a form, a booking, a sign-up — that somebody has
 * still to work, and it converts into a contact, a company and a deal when
 * it is real. Reads `orgs/{orgId}/leads` narrowed by `visibleTo` to the sites
 * this viewer may see (AGL-3275) — the same collection and the same clause at
 * both levels, which is what lets ONE listener serve a section that used to
 * open one per site.
 *
 * Under a site the clause names that site; at the ORGANIZATION level an
 * org-wide member reads without one, since the rules short-circuit on
 * `isOrgWideMember()` and a clause would only narrow what they may already
 * read. The per-site notes — which of a site's forms file a lead — belong to
 * a site's own hub and are not drawn here.
 */
export function CrmLeadsSection(props: ConsolePluginPageProps) {
  const { hostId, org, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId, createHostId } = useCrmScope({ hostId, org })
  const mount = useCrmOrgMount()
  const roster = useOrgMemberOptions(orgId)
  // The org's lead fields, for the optional columns below (AGL-3272).
  const leadFields = useContactFieldDefinitions(orgId, 'lead')
  // The org's lead source values (AGL-3298): the filter's menu and the
  // column's sort order.
  const leadSourceList = useLeadSourcePicklist(orgId)
  const routes = crmRoutes(basePath ?? '')

  /*
   * Under a site: the ORG collection, narrowed to what this site may see
   * (AGL-3275). It read `hosts/{hostId}/leads` until the silo moved, and
   * leaving it there would have shown a site its pre-migration rows and
   * nothing captured since — then nothing at all, once AGL-3276 emptied the
   * path it was reading.
   */
  const site = useFirestoreCollection<
    Record<string, unknown> & CrmLeadFields & { $id: string }
  >(
    () =>
      hostId && orgId
        ? query(
            collection(firestore, 'orgs', orgId, 'leads'),
            where('visibleTo', 'array-contains-any', scopeTokensForHost(hostId)),
            orderBy('lastSeenAtMs', 'desc'),
            limit(LEADS_WINDOW + 1),
          )
        : null,
    [firestore, hostId, orgId],
    { idField: '$id' },
  )
  // At the organization level: every site's window, merged.
  const orgHostIds = useMemo(
    () => (hostId ? [] : (mount?.hosts ?? []).map((host) => host.id)),
    [hostId, mount?.hosts],
  )
  /*
   * ONE LISTENER (AGL-3275), where this used to fan out across the org's
   * sites and merge. At the organization level an org-wide member reads with
   * no scope clause, which is what `visibleTo: null` asks for.
   */
  const orgLeads = useOrgLeads({
    orgId,
    visibleTo: null,
    windowSize: LEADS_WINDOW,
  })
  const leadDocs = useMemo<LeadRow[]>(
    () =>
      hostId
        ? site.data.map((row) => ({ ...row, leadId: row.$id }))
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
   * What the list is narrowed by is the saved VIEW'S (AGL-2617), and the
   * grid's own Filters panel and quick search edit it (AGL-3313): Status,
   * Email, Owner, Lead source and Campaign are select columns of the grid.
   * The clauses keep the shape the old dropdowns stored — see
   * `leadClausesForGrid` — so no saved view of leads loses its filter.
   */
  const views = useCrmSavedView({
    section: 'leads',
    hostId,
    org: props.org,
    basePath: basePath ?? '',
  })
  const clauses = useMemo(
    () => leadClausesForGrid(views.state.filters),
    [views.state.filters],
  )
  const setClauses = useCallback(
    (next: CrmViewFilterClause[]) => views.setFilters(leadClausesToStore(next)),
    [views.setFilters],
  )
  const gridFilter = useListGridFilter({
    clauses,
    onChange: setClauses,
    selectFields: ['status', 'emailState', 'ownerUid'],
    codecs: LEAD_FILTER_CODECS,
  })
  const campaigns = useCrmCampaigns({ hostId, orgId }, { enabled: true })
  const campaignName = useCallback(
    (id: string) =>
      campaigns.options.find((option) => option.value === id)?.label ?? id,
    [campaigns.options],
  )
  /*
   * The choices each select column offers. A stored clause naming a value
   * no longer listed — a retired campaign, a lead source since removed —
   * stays a choice, so the panel can show it and clear it.
   */
  const filterOptions = useMemo<Record<string, ListFilterOption[]>>(() => {
    const stale = (field: string, known: readonly { value: string }[]) =>
      clauses
        .filter((clause) => clause.field === field && clause.op !== 'isEmpty')
        .flatMap((clause) => clause.value.split(','))
        .map((value) => value.trim())
        .filter((value) => value && !known.some((option) => option.value === value))
        .map((value) => ({ value, label: value }))
    const campaignOptions = campaigns.options.map((option) => ({
      value: option.value,
      label: option.label,
    }))
    // Salesforce's Lead Source (AGL-3298): every value the org keeps, inactive ones marked.
    const sourceOptions = [
      ...leadSourceList.picklist.values.map((value) => ({
        value: value.label,
        label: value.active ? value.label : `${value.label} (inactive)`,
      })),
      { value: LEAD_SOURCE_FILTER_NONE, label: 'No lead source' },
    ]
    return {
      status: LEAD_STATUS_FILTER_OPTIONS,
      emailState: LEAD_EMAIL_FILTER_OPTIONS,
      ownerUid: roster.options.map((option) => ({
        value: option.uid,
        label: Aglyn.crmMemberPickerLabel(option),
      })),
      campaignIds: [...campaignOptions, ...stale('campaignIds', campaignOptions)],
      leadSource: [...sourceOptions, ...stale('leadSource', sourceOptions)],
    }
  }, [clauses, campaigns.options, leadSourceList.picklist, roster.options])
  /*
   * Every clause and the search narrow the whole loaded WINDOW here, before
   * the footer's count and the page slice (AGL-3246). The grid holds one
   * page of it, so a filter or a quick search the grid ran itself would
   * answer "no match" for a lead on page three.
   */
  const searchKey = gridFilter.searchWords.join(' ')
  const rows = useMemo(
    () =>
      window.filter(
        (lead) =>
          leadMatchesClauses(lead, clauses) &&
          leadMatchesSearch(lead, searchKey),
      ),
    [window, clauses, searchKey],
  )
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // A new filter or search term starts on page one: page three of the open
  // leads is not a page of the unqualified ones, and an out-of-range page
  // renders empty.
  useEffect(() => {
    setPage(0)
  }, [views.state.filters, searchKey])
  const pageRows = useMemo(
    () => rows.slice(page * pageSize, (page + 1) * pageSize),
    [rows, page, pageSize],
  )

  /*
   * The ticked rows, for the bulk bar (AGL-2662). Cleared when the filter or
   * the search term changes: a selection made on the open leads is not a
   * selection of the unqualified ones, and the bar's count would be over
   * rows no longer listed.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  useEffect(
    () => setSelectedIds([]),
    [views.state.filters, searchKey],
  )
  // How the file names the owner and, at the org level, the site.
  const csvOptions: LeadCsvOptions = useMemo(
    () => ({
      ownerEmail: roster.emailFor,
      ...(hostId ? {} : { siteName: (id: string) => mount?.siteName(id) }),
    }),
    [roster.emailFor, hostId, mount],
  )
  // The listed window — every row the filter and the search admit, not just
  // the page.
  const handleExport = useCallback(() => {
    downloadTextFile('leads.csv', 'text/csv', leadsCsv(rows, csvOptions))
  }, [rows, csvOptions])

  const [assigning, setAssigning] = useState<LeadRow | null>(null)
  const [unqualifying, setUnqualifying] = useState<LeadRow | null>(null)
  // The row whose conversion dialog is open (AGL-2641) — the same dialog
  // the lead's page opens, fed the row so the list is one click shorter.
  const [converting, setConverting] = useState<LeadRow | null>(null)

  /*==========================================
   * NEW LEAD (AGL-3231) — Salesforce's New Lead, in a drawer over the
   * list. The route files the lead through the one lead door under the
   * mounted site, or at the organization level under the site the drawer's
   * picker named; the drawer holds its submit until one is known. It makes
   * a lead and nothing else — the conversion is what makes the contact.
   *=========================================*/
  const crmApi = useCrmApi(createHostId)
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const handleCreate = useCallback(
    async (values: NewLeadValues) => {
      setCreateBusy(true)
      setCreateError(null)
      try {
        const { response, payload } = await crmApi('leads-create', {
          email: values.email,
          ...(values.name ? { name: values.name } : {}),
          ...(values.company ? { company: values.company } : {}),
          ...(values.jobTitle ? { jobTitle: values.jobTitle } : {}),
          ...(values.phone ? { phone: values.phone } : {}),
          ...(values.website ? { website: values.website } : {}),
          ...(values.leadSource ? { leadSource: values.leadSource } : {}),
          ...(values.address ? { address: values.address } : {}),
          ...(values.tags.length ? { tags: values.tags } : {}),
          ...(values.campaignIds.length
            ? { campaignIds: values.campaignIds }
            : {}),
          ...(values.ownerUid ? { ownerUid: values.ownerUid } : {}),
          ...(values.notes ? { notes: values.notes } : {}),
          // The org's own lead fields (AGL-3272), sent only when one was
          // filled — the route reads the definitions to judge the map, and
          // a body without it pays for no read.
          ...(values.custom ? { custom: values.custom } : {}),
          status: values.status,
        })
        if (!response.ok) {
          // The route's own sentence, shown above the form unchanged.
          setCreateError(
            String(payload['error'] ?? 'The lead could not be added.'),
          )
          return
        }
        // The activity entry is the route's: it verified the caller and
        // performed the write.
        enqueueSnackbar(
          payload['created']
            ? 'Lead added'
            : 'This site already held a lead for that address — it was updated',
          { variant: 'success', persist: false },
        )
        setCreateOpen(false)
      } catch (error) {
        console.error(error)
        setCreateError('The lead could not be added.')
      } finally {
        setCreateBusy(false)
      }
    },
    [crmApi, enqueueSnackbar],
  )

  const writeLead = useCallback(
    async (lead: LeadRow, fields: Record<string, unknown>, done: string) => {
      if (!orgId) {
        enqueueSnackbar('Still loading this workspace — try again in a moment.', {
          variant: 'warning',
          persist: false,
        })
        return
      }
      try {
        await updateDoc(
          doc(firestore, 'orgs', orgId, 'leads', lead.leadId),
          {
            ...fields,
            updatedAt: serverTimestamp(),
          },
        )
        enqueueSnackbar(done, { variant: 'success', persist: false })
      } catch (error) {
        enqueueSnackbar(
          error instanceof Error
            ? error.message
            : 'The lead could not be updated.',
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
        valueGetter: (_value, row: LeadRow) =>
          String(row['name'] || row['email'] || ''),
        renderCell: ({ row }: { row: LeadRow }) => (
          <Stack
            spacing={0}
            sx={{ minWidth: 0, justifyContent: 'center', height: '100%' }}
          >
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
      // The lead's own profile (AGL-3231): the two facts a work queue is
      // scanned by, beside the person.
      {
        field: 'company',
        headerName: 'Company',
        flex: 1,
        minWidth: 140,
        valueGetter: (_value, row: LeadRow) => String(row.company ?? ''),
      },
      {
        field: 'jobTitle',
        headerName: 'Title',
        flex: 0.9,
        minWidth: 130,
        valueGetter: (_value, row: LeadRow) => String(row.jobTitle ?? ''),
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.9,
        minWidth: 150,
        valueGetter: (_value, row: LeadRow) => Aglyn.crmLeadStatus(row),
        renderCell: ({ row }: { row: LeadRow }) => (
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
        ),
      },
      {
        /*
         * The verdict on the address (AGL-3245): the chip the lead's page
         * carries, so a bounced lead is told apart in the queue it is worked
         * from; its label for the sort and the export.
         */
        field: 'emailState',
        headerName: 'Email',
        flex: 0.9,
        minWidth: 150,
        valueGetter: (_value, row: LeadRow) => {
          const state = Aglyn.readEmailState(row)
          return state ? Aglyn.EMAIL_STATE_LABELS[state.status] : ''
        },
        renderCell: ({ row }: { row: LeadRow }) => {
          const state = Aglyn.readEmailState(row)
          return state ? (
            <CrmEmailStateChip state={state} />
          ) : (
            <Typography variant="caption" color="text.secondary">
              {'—'}
            </Typography>
          )
        },
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
              /*
               * KNOWN BY, not "the site" (AGL-3275). A lead is one org row
               * and several sites in a consent group can hold the same
               * person, so this names every site that captured them — the
               * answer the Contacts list has always given in its own column.
               */
              valueGetter: (_value: unknown, row: LeadRow) => {
                const held = Array.isArray(row['capturedByHostIds'])
                  ? (row['capturedByHostIds'] as string[])
                  : []
                return held.map((id) => mount?.siteName(id) ?? id).join(', ')
              },
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
      /*
       * Salesforce's Lead Source (AGL-3298), beside the surfaces that
       * captured the person. Sorted in the order the org keeps its values,
       * as a picklist sorts, with a value the list does not hold after
       * every listed one and a lead with none last.
       */
      {
        field: 'leadSource',
        headerName: 'Lead source',
        flex: 1,
        minWidth: 150,
        valueGetter: (_value, row: LeadRow) => String(row.leadSource ?? ''),
        sortComparator: (a: unknown, b: unknown) =>
          Aglyn.crmPicklistRank(leadSourceList.picklist, a) -
            Aglyn.crmPicklistRank(leadSourceList.picklist, b) ||
          String(a ?? '').localeCompare(String(b ?? '')),
      } satisfies GridColDef,
      {
        field: 'tags',
        headerName: 'Tags',
        flex: 0.9,
        minWidth: 140,
        valueGetter: (_value, row: LeadRow) => (row.tags ?? []).join(', '),
      },
      // The campaigns the lead is filed under (AGL-3254), by name — the
      // ids are the storage.
      {
        field: 'campaignIds',
        headerName: 'Campaign',
        flex: 1,
        minWidth: 150,
        valueGetter: (_value: unknown, row: LeadRow) =>
          Aglyn.readCampaignIds(row).map(campaignName).join(', '),
      } satisfies GridColDef,
      {
        field: 'lastSeenAtMs',
        headerName: 'Last seen',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: LeadRow) =>
          leadTimeLabel(row['lastSeenAtMs'] ?? row['createdAt']),
      },
      // The org's lead fields as optional columns (AGL-3272), read off the
      // row's own `custom` map the way the contacts list reads its own.
      // Ahead of the row menu, so the overflow stays at the right edge
      // however many fields the org has defined.
      ...customFieldColumns(leadFields.active),
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
          return (
            <Box
              onClick={(event) => event.stopPropagation()}
              sx={{ display: 'flex', alignItems: 'center', height: '100%' }}
            >
              <RowActionsMenu
                label={String(row['email'] ?? row.$id)}
                items={[
                  {
                    key: 'open',
                    label: 'Open lead',
                    icon: (
                      <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />
                    ),
                    href: routes.lead(row.leadId),
                  },
                  {
                    key: 'convert',
                    label: 'Convert…',
                    icon: (
                      <MdiIcon
                        path={mdiAccountConvertOutline.path}
                        size={0.8}
                      />
                    ),
                    onClick: () => setConverting(row),
                    disabled: convertRefusal !== null,
                    disabledReason: convertRefusal ?? undefined,
                  },
                  {
                    key: 'assign',
                    label: 'Assign owner',
                    icon: (
                      <MdiIcon path={mdiAccountTieOutline.path} size={0.8} />
                    ),
                    onClick: () => setAssigning(row),
                  },
                  {
                    key: 'unqualify',
                    label: 'Unqualify',
                    icon: (
                      <MdiIcon path={mdiAccountCancelOutline.path} size={0.8} />
                    ),
                    onClick: () => setUnqualifying(row),
                    disabled:
                      !Aglyn.isCrmLeadOpen(row) ||
                      Boolean(row.convertedContactId),
                    disabledReason: row.convertedContactId
                      ? 'This lead was converted'
                      : 'This lead is already closed',
                  },
                ]}
              />
            </Box>
          )
        },
      },
    ],
    [
      roster,
      routes,
      writeLead,
      hostId,
      mount,
      campaignName,
      leadFields.active,
      leadSourceList.picklist,
    ],
  )
  /*
   * The column and sort models are the view's (AGL-2617); the filterable
   * columns are the declared fields, as selects over their choices (AGL-3313).
   */
  const filterColumns = useMemo(
    () =>
      listFilterGridColumns(columns, LEAD_LIST_FILTER_FIELDS, filterOptions, LEAD_LIST_FILTER_HEADERS),
    [columns, filterOptions],
  )
  const grid = useCrmViewGrid(views, filterColumns)

  return (
    <>
      <CardDisplay
        header={'Leads'}
        help={Aglyn.pluginDocsHelp('crmLeads', {
          anchor: '#filter-the-leads',
        })}
        contentGutterX
        contentGutterY
        HeaderProps={{
          // The record actions, top right and never clipped (AGL-3311).
          action: (
            <CrmListActions>
              <LeadImportButton hostId={hostId} orgId={orgId} />
              <Button size="small" onClick={handleExport} disabled={!rows.length}>
                {'Export CSV'}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => setCreateOpen(true)}
              >
                {'New lead'}
              </Button>
            </CrmListActions>
          ),
        }}
      >
        <Stack spacing={2}>
          {/* Which surfaces file a lead, by name (AGL-2612) — under a site its own, at the org level every site's (AGL-2638). */}
          {hostId ? (
            <LeadSurfacesNote hostId={hostId} />
          ) : (
            <OrgLeadSurfacesNote />
          )}
          {/*
            The saved view, and every clause it is narrowed by as a chip
            (AGL-3313). The clauses are set in the grid's own Filters panel;
            the chips show the whole set, which that panel shows one of.
          */}
          <CrmListToolbar label="Lead filters">
            <CrmViewsControl controller={views} allLabel="All leads" />
            <ListFilterChips
              fields={LEAD_LIST_FILTER_FIELDS}
              headers={LEAD_LIST_FILTER_HEADERS}
              clauses={clauses}
              onChange={setClauses}
              options={filterOptions}
              marksServed={false}
            />
          </CrmListToolbar>
          {status === 'success' && window.length === 0 ? (
            <EmptyStateComponent
              label={'No leads yet'}
              description={
                'Bookings and lead-routed forms on your site become leads on their own — or add one with New lead, or bring a list in with Import CSV.'
              }
            />
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
                org={org as Record<string, unknown> | undefined}
              />
              <CrmColumnOrderProvider value={grid.columnOrder}>
                <ListTable
                  rows={pageRows}
                  columns={grid.columns}
                  slots={CRM_LIST_SLOTS}
                  selectable={{
                    selected: selectedIds,
                    onChange: setSelectedIds,
                  }}
                  loading={status === 'loading'}
                  onOpen={(_id, row: LeadRow) =>
                    router.push(
                      routes.lead(row.leadId),
                    )
                  }
                  // Columns and sort are the view's, controlled (AGL-2617).
                  columnVisibilityModel={grid.columnVisibilityModel}
                  onColumnVisibilityModelChange={
                    grid.onColumnVisibilityModelChange
                  }
                  sortModel={grid.sortModel}
                  onSortModelChange={grid.onSortModelChange}
                  // The panel and the search are the grid's; the section
                  // answers both over the whole window (AGL-3313).
                  filterMode="server"
                  filterModel={gridFilter.filterModel}
                  onFilterModelChange={gridFilter.onFilterModelChange}
                  quickFilter
                  noRowsLabel={`No leads match among the ${window.length.toLocaleString()} most recently seen`}
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
                'leads. The filters and the search narrow these ' +
                `${LEADS_WINDOW.toLocaleString()} only; older leads are still ` +
                'listed in the Inbox and reached by campaign audiences.'}
            </Alert>
          ) : null}
        </Stack>
      </CardDisplay>
      <NewLeadDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        hostId={hostId ?? null}
        org={org as Record<string, unknown> | undefined}
        busy={createBusy}
        error={createError}
        roster={roster}
        orgId={orgId}
        onSubmit={(values) => void handleCreate(values)}
      />
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
        hostId={hostId ?? null}
        leadId={unqualifying?.leadId ?? ''}
        leadLabel={String(
          unqualifying?.['name'] || unqualifying?.['email'] || '',
        )}
      />
      {/* The site the conversion is filed as (AGL-2641), which since
          AGL-3275 is the first site that captured this person rather than
          "the site the row lives under" — a lead shared by a consent group
          lives under none of them in particular. Under a site the mounted
          one is used, and the two agree for every single-brand org. */}
      <LeadConvertDialog
        open={Boolean(converting)}
        onClose={() => setConverting(null)}
        hostId={
          hostId ??
          (Aglyn.leadPrimaryGroup(converting, org as Record<string, unknown>).hostId || null)
        }
        orgId={orgId}
        org={org as Record<string, unknown> | undefined}
        leadId={converting?.leadId ?? ''}
        lead={converting ?? {}}
        basePath={basePath ?? ''}
        roster={roster}
      />
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
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        width: '100%',
      }}
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
        <MenuItem value="working">
          {Aglyn.CRM_LEAD_STATUS_LABELS.working}
        </MenuItem>
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
          <LeadOwnerSelect
            value={current}
            onChange={setUid}
            roster={roster}
            size="medium"
          />
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
