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
  CrmLeadStatus,
} from '@aglyn/aglyn'
import {
  mdiAccountArrowRight,
  mdiAccountCancelOutline,
  mdiAccountConvertOutline,
  mdiAccountTieOutline,
  mdiMagnify,
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
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
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
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { downloadTextFile } from '../model/contacts-csv'
import { crmRoutes } from '../model/crm-routes'
import {
  LEAD_FILTER_LABELS,
  LEAD_EMAIL_FILTER_LABELS,
  LEAD_EMAIL_FILTERS,
  LEAD_FILTERS,
  type LeadEmailFilter,
  type LeadFilter,
  leadMatchesCampaignFilter,
  leadMatchesEmailFilter,
  leadMatchesFilter,
  leadMatchesLeadSourceFilter,
  leadMatchesSearch,
  LEAD_SOURCE_FILTER_NONE,
} from '../model/lead-filters'
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
    const value = views.state.filters.find(
      (clause) => clause.field === 'status',
    )?.value
    return (LEAD_FILTERS as readonly string[]).includes(value ?? '')
      ? (value as LeadFilter)
      : 'open'
  }, [views.state.filters])
  /*
   * The `Email` filter (AGL-3245) is the view's too, as an `emailState`
   * clause beside the status one. Each setter keeps the other's clause:
   * narrowing to bounced leads does not reopen the unqualified ones.
   */
  const emailFilter: LeadEmailFilter = useMemo(() => {
    const value = views.state.filters.find(
      (clause) => clause.field === 'emailState',
    )?.value
    return (LEAD_EMAIL_FILTERS as readonly string[]).includes(value ?? '')
      ? (value as LeadEmailFilter)
      : 'any'
  }, [views.state.filters])
  const setFilter = useCallback(
    (next: LeadFilter) =>
      views.setFilters([
        ...views.state.filters.filter((clause) => clause.field !== 'status'),
        ...(next === 'open'
          ? []
          : [{ field: 'status', op: 'equals', value: next }]),
      ]),
    [views.setFilters, views.state.filters],
  )
  const setEmailFilter = useCallback(
    (next: LeadEmailFilter) =>
      views.setFilters([
        ...views.state.filters.filter(
          (clause) => clause.field !== 'emailState',
        ),
        ...(next === 'any'
          ? []
          : [{ field: 'emailState', op: 'equals', value: next }]),
      ]),
    [views.setFilters, views.state.filters],
  )
  /*
   * The `Campaign` filter (AGL-3254) is the view's too, as a `campaignIds`
   * clause: the id of one of the org's campaign containers, resolved to its
   * name from the containers themselves — ids only in storage, so a renamed
   * campaign keeps its leads. Under a site the choice is the campaigns
   * placed on it; at the organization level, every campaign in the org.
   */
  const campaignFilter = useMemo(
    () =>
      views.state.filters.find((clause) => clause.field === 'campaignIds')
        ?.value ?? '',
    [views.state.filters],
  )
  const setCampaignFilter = useCallback(
    (next: string) =>
      views.setFilters([
        ...views.state.filters.filter(
          (clause) => clause.field !== 'campaignIds',
        ),
        ...(next
          ? [{ field: 'campaignIds', op: 'contains', value: next }]
          : []),
      ]),
    [views.setFilters, views.state.filters],
  )
  /*
   * The `Lead source` filter (AGL-3298) is the view's too: an `equals`
   * clause naming the label records store, or an `isEmpty` one for the
   * leads that hold none.
   */
  const leadSourceFilter = useMemo(() => {
    const clause = views.state.filters.find((entry) => entry.field === 'leadSource')
    if (!clause) return ''
    return clause.op === 'isEmpty' ? LEAD_SOURCE_FILTER_NONE : String(clause.value ?? '')
  }, [views.state.filters])
  const setLeadSourceFilter = useCallback(
    (next: string) =>
      views.setFilters([
        ...views.state.filters.filter((clause) => clause.field !== 'leadSource'),
        ...(next === LEAD_SOURCE_FILTER_NONE
          ? [{ field: 'leadSource', op: 'isEmpty', value: '' }]
          : next
            ? [{ field: 'leadSource', op: 'equals', value: next }]
            : []),
      ]),
    [views.setFilters, views.state.filters],
  )
  const campaigns = useCrmCampaigns({ hostId, orgId }, { enabled: true })
  const campaignName = useCallback(
    (id: string) =>
      campaigns.options.find((option) => option.value === id)?.label ?? id,
    [campaigns.options],
  )
  // The label's id, so the filter's combobox is named "Show" rather than
  // after the option it shows — see `LeadOwnerSelect`.
  const filterLabelId = useId()
  const emailFilterLabelId = useId()
  const campaignFilterLabelId = useId()
  const leadSourceFilterLabelId = useId()
  /*
   * The search box is the SECTION'S, not the grid's (AGL-3246). The grid's
   * quick filter runs over the rows the grid holds, and the grid holds one
   * PAGE of the window — so a lead on page three answered "no match" while
   * the footer below went on counting the unfiltered window. The term
   * narrows the whole loaded window here, beside the status filter and
   * before the footer's count and the page slice, over the fields a person
   * types to find a lead: name, email, company, title and tags.
   */
  const [search, setSearch] = useState('')
  const rows = useMemo(
    () =>
      window.filter(
        (lead) =>
          leadMatchesFilter(lead, filter) &&
          leadMatchesEmailFilter(lead, emailFilter) &&
          leadMatchesCampaignFilter(lead, campaignFilter) &&
          leadMatchesLeadSourceFilter(lead, leadSourceFilter) &&
          leadMatchesSearch(lead, search),
      ),
    [window, filter, emailFilter, campaignFilter, leadSourceFilter, search],
  )
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // A new filter or search term starts on page one: page three of the open
  // leads is not a page of the unqualified ones, and an out-of-range page
  // renders empty.
  useEffect(() => {
    setPage(0)
  }, [filter, emailFilter, campaignFilter, leadSourceFilter, search])
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
    [filter, emailFilter, campaignFilter, leadSourceFilter, search],
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
  /* The column and sort models are the view's (AGL-2617). */
  const grid = useCrmViewGrid(views, columns)

  return (
    <>
      <CardDisplay
        header={'Leads'}
        help={Aglyn.pluginDocsHelp('contacts', {
          anchor: '#whats-in-the-crm-area',
        })}
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
                onChange={(event) =>
                  setFilter(event.target.value as LeadFilter)
                }
              >
                {LEAD_FILTERS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {LEAD_FILTER_LABELS[option]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {/* The verdict on the address (AGL-3245): the bounced, the blocked, the ones who left. */}
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id={emailFilterLabelId}>{'Email'}</InputLabel>
              <Select
                labelId={emailFilterLabelId}
                label="Email"
                value={emailFilter}
                onChange={(event) =>
                  setEmailFilter(event.target.value as LeadEmailFilter)
                }
              >
                {LEAD_EMAIL_FILTERS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {LEAD_EMAIL_FILTER_LABELS[option]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {/* The campaign the lead is filed under (AGL-3254), by name. */}
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id={campaignFilterLabelId} shrink>
                {'Campaign'}
              </InputLabel>
              <Select
                labelId={campaignFilterLabelId}
                label="Campaign"
                notched
                value={campaignFilter}
                onChange={(event) =>
                  setCampaignFilter(String(event.target.value))
                }
                displayEmpty
              >
                <MenuItem value="">{'Any campaign'}</MenuItem>
                {campaigns.options.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
                {/* A stored filter naming a campaign no longer listed stays selectable, by id, so it can be cleared. */}
                {campaignFilter &&
                !campaigns.options.some(
                  (option) => option.value === campaignFilter,
                ) ? (
                  <MenuItem value={campaignFilter}>{campaignFilter}</MenuItem>
                ) : null}
              </Select>
            </FormControl>
            {/* Salesforce's Lead Source (AGL-3298): every value the org keeps, inactive ones marked. */}
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id={leadSourceFilterLabelId} shrink>
                {'Lead source'}
              </InputLabel>
              <Select
                labelId={leadSourceFilterLabelId}
                label="Lead source"
                notched
                value={leadSourceFilter}
                onChange={(event) => setLeadSourceFilter(String(event.target.value))}
                displayEmpty
              >
                <MenuItem value="">{'Any lead source'}</MenuItem>
                {leadSourceList.picklist.values.map((value) => (
                  <MenuItem key={value.id} value={value.label}>
                    {value.active ? value.label : `${value.label} (inactive)`}
                  </MenuItem>
                ))}
                <MenuItem value={LEAD_SOURCE_FILTER_NONE}>{'No lead source'}</MenuItem>
                {/* A stored filter naming a value no longer listed stays selectable, so it can be cleared. */}
                {leadSourceFilter &&
                leadSourceFilter !== LEAD_SOURCE_FILTER_NONE &&
                !Aglyn.crmPicklistValueByLabel(leadSourceList.picklist, leadSourceFilter) ? (
                  <MenuItem value={leadSourceFilter}>{leadSourceFilter}</MenuItem>
                ) : null}
              </Select>
            </FormControl>
            <TextField
              size="small"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search leads"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <MdiIcon path={mdiMagnify.path} size={0.8} />
                    </InputAdornment>
                  ),
                },
                htmlInput: { 'aria-label': 'Search leads', type: 'search' },
              }}
              sx={{ minWidth: 200 }}
            />
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
          </Stack>
        }
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {/* Which surfaces file a lead, by name (AGL-2612) — under a site its own, at the org level every site's (AGL-2638). */}
          {hostId ? (
            <LeadSurfacesNote hostId={hostId} />
          ) : (
            <OrgLeadSurfacesNote />
          )}
          {status === 'success' && window.length === 0 ? (
            <EmptyStateComponent
              label={'No leads yet'}
              description={
                'Bookings and lead-routed forms on your site become leads on their own — or add one with New lead, or bring a list in with Import CSV.'
              }
            />
          ) : status === 'success' && rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {`No ${LEAD_FILTER_LABELS[filter].toLowerCase()} leads` +
                (search.trim() ? ` match “${search.trim()}”` : '') +
                ` among the ${window.length.toLocaleString()} most recently seen.`}
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
                  // The search is the section's, above: the grid's own box
                  // would search this page alone.
                  quickFilter={false}
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
                'leads. The search box and the status filter narrow these ' +
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
