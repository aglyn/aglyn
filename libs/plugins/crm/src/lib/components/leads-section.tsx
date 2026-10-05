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
import { useCrmFoldsScope, useCrmListQuery } from '../hooks/use-crm-list-query'
import CrmViewsControl from './crm-views-control'
import { CrmListActions, CrmListToolbar } from './crm-list-toolbar'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import ListQueryNotices from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  deleteField,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { leadPrimaryGroup } from '../model/contact-holder'
import { crmRoutes } from '../model/crm-routes'
import {
  LEAD_EMAIL_FILTER_OPTIONS,
  LEAD_FILTER_CODECS,
  LEAD_LIST_DECLARATION,
  LEAD_LIST_FILTER_FIELDS,
  LEAD_LIST_FILTER_HEADERS,
  LEAD_PICKLIST_FILTERS,
  LEAD_SOURCE_DIRECTION_FILTER_OPTIONS,
  LEAD_SOURCE_FILTER_NONE,
  leadClausesForGrid,
  leadStatusFilterOptions,
  LEAD_PREFIX_SEARCH,
  leadClauseImpliesScope,
  leadClausesToStore,
  leadQueryClause,
} from '../model/lead-filters'
import { crmAskClauses, crmQueryRefusals } from '../model/crm-list-query'
import {
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { useLeadSourcePicklist } from '../hooks/use-lead-source-picklist'
import { useLeadStatusPicklist } from '../hooks/use-lead-status-picklist'
import { useLeadPicklists } from '../hooks/use-lead-picklists'
import { LeadConvertDialog } from './lead-convert-dialog'
import {
  leadSourceLabel,
  leadSources,
  leadTimeLabel,
} from './lead-history-card'
import { CrmExportButton, CrmImportButton } from './crm-transfer-buttons'
import { CRM_LEADS_RESOURCE } from '../transfer/fields'
import NewLeadDrawer, { type NewLeadValues } from './new-lead-drawer'
import { useCrmApi } from './use-crm-api'
import { LeadOwnerSelect } from './lead-owner-select'
import { CONVERT_PENDING_ERASURE_REASON } from './lead-properties-card'
import { CrmEmailStateChip } from './crm-email-state-chip'
import { LeadStatusChip } from './lead-status-chip'
import { type LeadStatusChoice, leadStatusChoices, leadStatusMenuItems } from './lead-status-options'
import { CrmShareChipView } from './record-sharing-card'
import { crmShareChipFor } from '../model/crm-sharing'
import { useCrmSharingFollowUp } from '../hooks/use-crm-sharing'
import LeadSurfacesNote from './lead-surfaces-note'
import { LeadUnqualifyDialog } from './lead-unqualify-dialog'
import LeadsBulkBar from './leads-bulk-bar'
import OrgLeadSurfacesNote from './org-lead-surfaces-note'

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

/** Salesforce's Industry and Rating columns (AGL-3513), off until a reader turns one on. */
const LEAD_HIDDEN_COLUMNS: Readonly<Record<string, boolean>> = {
  industry: false,
  rating: false,
}

/**
 * `/crm/leads` — the people a site has met but not yet qualified (AGL-2608).
 *
 * A section of its own, the way Salesforce keeps Leads apart from Contacts:
 * a lead is a capture — a form, a booking, a sign-up — that somebody has
 * still to work, and it converts into a contact, a company and a deal when
 * it is real. Reads `orgs/{orgId}/leads` narrowed by `visibleTo` to the sites
 * this viewer may see (AGL-3275) — the same collection and the same clause at
 * both levels, which is what lets ONE listener serve a section that used to
 * open one per site — and pages it by a query that carries every filter and
 * the search word (AGL-3321; see `leadQueryClause`).
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
  const { orgId, createHostId, consentGroup } = useCrmScope({ hostId, org })
  // The viewing site's group: a row it sees only through a share is chipped
  // with who shared it (AGL-3336). None at the organization level.
  const viewingHostIds = consentGroup?.hostIds
  const mount = useCrmOrgMount()
  const roster = useOrgMemberOptions(orgId)
  // The org's lead fields, for the optional columns below (AGL-3272).
  const leadFields = useContactFieldDefinitions(orgId, 'lead')
  // The org's lead source values (AGL-3298): the filter's menu and the
  // column's sort order.
  const leadSourceList = useLeadSourcePicklist(orgId)
  // The org's lead status values (AGL-3512): the chips' words, the inline
  // select's choices and the Status filter's names.
  const leadStatusList = useLeadStatusPicklist(orgId)
  // The org's Industry and Rating lists (AGL-3513): their filters' choices.
  const leadPicklists = useLeadPicklists(orgId)
  const routes = crmRoutes(basePath ?? '')

  /*
   * Under a site: the ORG collection, narrowed to what this site may see
   * (AGL-3275) by `visibleTo array-contains-any` over the site's own tokens.
   * At the ORGANIZATION level an org-wide member reads with no scope clause,
   * which is what `null` asks for.
   */
  const scopeTokens = useMemo(
    () => (hostId ? scopeTokensForHost(hostId) : null),
    [hostId],
  )
  const dataRoot = useMemo(
    () => (orgId ? (['orgs', orgId] as const) : null),
    [orgId],
  )
  const foldsScope = useCrmFoldsScope(orgId, scopeTokens)

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
    selectFields: [
      'status',
      'emailState',
      'ownerUid',
      'leadSourceDirection',
      ...LEAD_PICKLIST_FILTERS.map((entry) => entry.column),
    ],
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
    /*
     * Industry and Rating (AGL-3513): every value the org keeps, valued by
     * the key the query compares and captioned by the label, inactive ones
     * marked — the Companies list's choices.
     */
    const picklistOptions = Object.fromEntries(
      LEAD_PICKLIST_FILTERS.map((entry) => {
        const known = (leadPicklists.lists[entry.picklistId]?.values ?? []).flatMap((value) => {
          const key = Aglyn.crmPicklistKey(value.label)
          return key
            ? [{ value: key, label: value.active ? value.label : `${value.label} (inactive)` }]
            : []
        })
        return [entry.column, [...known, ...stale(entry.column, known)]]
      }),
    )
    return {
      ...picklistOptions,
      status: leadStatusFilterOptions(leadStatusList.picklist),
      emailState: LEAD_EMAIL_FILTER_OPTIONS,
      ownerUid: roster.options.map((option) => ({
        value: option.uid,
        label: Aglyn.crmMemberPickerLabel(option),
      })),
      campaignIds: [...campaignOptions, ...stale('campaignIds', campaignOptions)],
      leadSource: [...sourceOptions, ...stale('leadSource', sourceOptions)],
      // The picklist's groups (AGL-3511): Inbound and Outbound.
      leadSourceDirection: LEAD_SOURCE_DIRECTION_FILTER_OPTIONS,
    }
  }, [
    clauses,
    campaigns.options,
    leadSourceList.picklist,
    leadStatusList.picklist,
    leadPicklists.lists,
    roster.options,
  ])
  /*
   * Every clause and the search word on ONE query (AGL-3321): each stored
   * clause asked through the field its writer keeps (`leadQueryClause`),
   * paged by that query, and what one query cannot hold refused by name
   * above the list — never matched over the rows a page happened to load.
   */
  const asked = useMemo(
    () =>
      crmAskClauses(clauses, (clause) =>
        leadQueryClause(clause, {
          scopeTokens,
          foldsScope,
          // A direction is expanded through the org's own groups (AGL-3511).
          leadSources: leadSourceList.picklist,
        }),
      ),
    [clauses, scopeTokens, foldsScope, leadSourceList.picklist],
  )
  const searchKey = gridFilter.searchWords.join(' ')
  const paged = useCrmListQuery<Record<string, unknown> & CrmLeadFields & { $id: string }>({
    scope: dataRoot,
    collection: 'leads',
    visibleTo: scopeTokens,
    foldsScope,
    declaration: LEAD_LIST_DECLARATION,
    clauses: asked.clauses,
    search: gridFilter.searchWords,
    impliesScope: leadClauseImpliesScope,
    prefixSearch: LEAD_PREFIX_SEARCH,
  })
  const status = paged.status
  const rows = useMemo<LeadRow[]>(
    () => paged.rows.map((row) => ({ ...row, leadId: row.$id })),
    [paged.rows],
  )
  const refused = useMemo(
    () =>
      crmQueryRefusals(paged.plan, asked, {
        fields: LEAD_LIST_FILTER_FIELDS,
        headers: LEAD_LIST_FILTER_HEADERS,
        options: filterOptions,
      }),
    [paged.plan, asked, filterOptions],
  )
  /** The list as it opens — Open leads, nothing typed — whose emptiness is news. */
  const opening =
    !searchKey.trim() &&
    clauses.length === 1 &&
    clauses[0].field === 'status' &&
    clauses[0].value === 'open'

  /*
   * The ticked rows, for the bulk bar (AGL-2662). Cleared when the filter or
   * the search term changes: a selection made on the open leads is not a
   * selection of the unqualified ones, and the bar's count would be over
   * rows no longer listed.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  useEffect(
    () => setSelectedIds([]),
    [views.state.filters, searchKey, paged.page],
  )

  // The list's filter, when one narrows it, for the export to read the same
  // records the list does (AGL-3528).
  const exportFilter = useMemo(
    () => (paged.plan.served.length || paged.plan.searched ? { label: 'what the list shows', plan: paged.plan } : null),
    [paged.plan],
  )

  const [assigning, setAssigning] = useState<LeadRow | null>(null)
  const [unqualifying, setUnqualifying] = useState<LeadRow | null>(null)
  // The Unqualified value the row's select picked (AGL-3512).
  const [unqualifyAs, setUnqualifyAs] = useState<string | null>(null)
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
          // Salesforce's standard lead fields (AGL-3513), the filled ones.
          ...values.standard,
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

  // A client-direct write owes the org's sharing rules a re-evaluation (AGL-3336).
  const followUpSharing = useCrmSharingFollowUp(hostId, orgId)
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
        followUpSharing('leads', [lead.leadId])
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
    [firestore, enqueueSnackbar, followUpSharing],
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
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {String(row['name'] || row['email'] || row.$id)}
              </Typography>
              <CrmShareChipView chip={crmShareChipFor(row, viewingHostIds ?? [])} org={org} />
            </Stack>
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
        // The meaning, which the Status filter asks; the cell shows the org's label.
        valueGetter: (_value, row: LeadRow) => Aglyn.crmLeadStatus(row),
        renderCell: ({ row }: { row: LeadRow }) => (
          <InlineStatus
            lead={row}
            statuses={leadStatusList.picklist}
            onChange={(next) => {
              if (next.status === 'unqualified') {
                setUnqualifying(row)
                setUnqualifyAs(next.label)
                return
              }
              void writeLead(
                row,
                {
                  status: next.status,
                  statusLabel: next.label,
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
      /*
       * Salesforce's Industry and Rating (AGL-3513), optional: valued by
       * the key their filters compare, drawn as the label the lead holds.
       */
      ...LEAD_PICKLIST_FILTERS.map(
        (entry): GridColDef => ({
          field: entry.column,
          headerName: entry.header,
          flex: 0.8,
          minWidth: 130,
          sortable: false,
          valueGetter: (_value, row: LeadRow) => Aglyn.crmPicklistKey(row[entry.column]) ?? '',
          renderCell: ({ row }: { row: LeadRow }) => String(row[entry.column] ?? '') || '—',
        }),
      ),
      // The campaigns the lead is filed under (AGL-3254), by name — the
      // ids are the storage.
      {
        field: 'campaignIds',
        headerName: 'Campaign',
        flex: 1,
        minWidth: 150,
        valueGetter: (_value: unknown, row: LeadRow) =>
          Aglyn.readContainerIds(row, 'campaign').map(campaignName).join(', '),
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
                    onClick: () => {
                      setUnqualifyAs(null)
                      setUnqualifying(row)
                    },
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
      viewingHostIds,
      org,
      mount,
      campaignName,
      leadFields.active,
      leadSourceList.picklist,
      leadStatusList.picklist,
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
  const grid = useCrmViewGrid(views, filterColumns, LEAD_HIDDEN_COLUMNS)

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
              <CrmImportButton resource={CRM_LEADS_RESOURCE} noun="leads" hostId={hostId} mappingZone="leads" />
              <CrmExportButton resource={CRM_LEADS_RESOURCE} hostId={hostId} filter={exportFilter} />
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
          <ListQueryNotices refused={refused} notices={paged.plan.notices} />
          <LeadsBulkBar
            rows={rows}
            selected={selectedIds}
            onSelectedChange={setSelectedIds}
            roster={roster}
            orgId={orgId}
            hostId={hostId}
            org={org as Record<string, unknown> | undefined}
          />
          <CrmColumnOrderProvider value={grid.columnOrder}>
            <ListTable
              rows={rows}
              columns={grid.columns}
              slots={CRM_LIST_SLOTS}
              selectable={{
                selected: selectedIds,
                onChange: setSelectedIds,
              }}
              loading={status === 'loading'}
              onOpen={(_id, row: LeadRow) => router.push(routes.lead(row.leadId))}
              // Columns are the view's, controlled (AGL-2617). The query
              // orders the list — newest seen first — so the grid sorts
              // nothing itself: a sort over one page would reorder that page.
              columnVisibilityModel={grid.columnVisibilityModel}
              onColumnVisibilityModelChange={grid.onColumnVisibilityModelChange}
              sortingMode="server"
              disableColumnSorting
              // The panel and the search are the grid's; the query answers
              // both (AGL-3321).
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              quickFilter
              noRowsLabel={opening ? 'No open leads' : 'No leads match these filters'}
              noRowsDescription={
                opening
                  ? 'Bookings and lead-routed forms on your site become leads on their own — or add one with New lead, or bring a list in with Import CSV.'
                  : undefined
              }
              // Paged by the footer below, so the grid must not also slice.
              hideFooter
            />
          </CrmColumnOrderProvider>
          <ListPagination
            page={paged.page}
            pageSize={paged.pageSize}
            rowCount={rows.length}
            hasMore={paged.hasMore}
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
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
        statusLabel={unqualifyAs}
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
          (leadPrimaryGroup(converting, org as Record<string, unknown>).hostId || null)
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
  statuses: Aglyn.CrmPicklist
  onChange: (next: LeadStatusChoice) => void
}) {
  const { lead, statuses, onChange } = props
  if (lead.convertedContactId) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <LeadStatusChip lead={lead} statuses={statuses} />
      </Box>
    )
  }
  const choices = leadStatusChoices(statuses, lead)
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
        value={Aglyn.crmLeadStatusLabel(lead, statuses)}
        onChange={(event) => {
          const choice = choices.find((entry) => entry.label === event.target.value)
          if (choice) onChange(choice)
        }}
        renderValue={() => <LeadStatusChip lead={lead} statuses={statuses} />}
        sx={{ width: '100%' }}
      >
        {leadStatusMenuItems(choices)}
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
