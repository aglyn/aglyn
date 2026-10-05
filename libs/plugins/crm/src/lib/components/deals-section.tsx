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

import {
  type ConsolePluginPageProps,
  type CrmDealStatus,
  type CrmPicklist,
  CRM_COLLECTIONS,
  crmPicklistRank,
  dealStageById,
  findOrgMember,
  ORG_SCOPE_TOKEN,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import {
  mdiCogOutline,
  mdiPlus,
  mdiTableLarge,
  mdiViewColumnOutline,
} from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import ListQueryNotices from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { useCrmSavedView } from '../hooks/use-crm-saved-view'
import { useCrmViewGrid } from '../hooks/use-crm-view-grid'
import { CrmListActions, CrmListToolbar } from './crm-list-toolbar'
import { CRM_LIST_SLOTS, CrmColumnOrderProvider } from './crm-column-menu'
import {
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
  CRM_NEXT_ACTIVITY_FILTER_HEADER,
  nextActivityColumn,
} from './crm-next-activity-column'
import {
  DEAL_FILTER_CODECS,
  DEAL_LIST_DECLARATION,
  DEAL_LIST_FILTER_FIELDS,
  DEAL_PICKLIST_FILTER_NONE,
  DEAL_PREFIX_SEARCH,
  dealPipelineBase,
  dealQueryClause,
} from '../constants/deal-filters'
import { useCrmFoldsScope, useCrmListQuery } from '../hooks/use-crm-list-query'
import { useCrmCampaigns } from '../hooks/use-crm-campaigns'
import { useCrmPicklist } from '../hooks/use-crm-picklist'
import { crmAskClauses, crmQueryRefusals } from '../model/crm-list-query'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import CrmViewsControl from './crm-views-control'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useContactFieldDefinitions } from '../hooks/use-contact-field-definitions'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useDealStageApi } from '../hooks/use-deal-stage-api'
import {
  BOARD_CLOSED_LIMIT,
  BOARD_OPEN_LIMIT,
  useDealsByStatus,
} from '../hooks/use-deals'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import { usePipeline } from '../hooks/use-pipeline'
import { downloadTextFile } from '../model/contacts-csv'
import { crmRoutes } from '../model/crm-routes'
import { type DealCsvOptions, dealsCsv } from '../model/deals-csv'
import {
  boardSummary,
  DEAL_STATUS_LABELS,
  type DealDoc,
  formatAmountByCurrency,
  formatMoney,
} from '../model/deal-board-model'
import { customFieldColumns } from './contact-custom-columns'
import { DealBoard } from './deal-board'
import { DealEditDrawer } from './deal-edit-drawer'
import { DealImportButton } from './deal-import-drawer'
import DealsBulkBar from './deals-bulk-bar'
import { LostReasonDialog } from './lost-reason-dialog'
import { OwnerAvatar } from './owner-avatar'
import { PipelinesDialog } from './pipelines-dialog'

type View = 'board' | 'table'
type StatusFilter = CrmDealStatus | 'all'

/** What the deals table's panel offers: the status, "No next activity", the Type and the Lead source. */
const DEAL_GRID_FILTER_FIELDS = DEAL_LIST_FILTER_FIELDS
const DEAL_GRID_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
  [CRM_NEXT_ACTIVITY_FILTER_FIELD.column]: CRM_NEXT_ACTIVITY_FILTER_HEADER,
  type: 'Type',
  leadSource: 'Lead source',
}
const DEAL_STATUS_FILTER_OPTIONS = (['open', 'won', 'lost'] as const).map((value) => ({
  value,
  label: DEAL_STATUS_LABELS[value],
}))

/** Salesforce's Type and Lead source columns are offered, not shown, until a view turns them on (AGL-3516). */
const DEAL_HIDDEN_COLUMNS: Readonly<Record<string, boolean>> = { type: false, leadSource: false }

/** A picklist's choices for its filter: every value the org keeps, inactive ones marked, then "none". */
function picklistFilterOptions(picklist: CrmPicklist, none: string): ListFilterOption[] {
  return [
    ...picklist.values.map((value) => ({
      value: value.label,
      label: value.active ? value.label : `${value.label} (inactive)`,
    })),
    { value: DEAL_PICKLIST_FILTER_NONE, label: none },
  ]
}


/** What a pipeline made at the organization level is stamped with — the org's own token. */
const ORG_PIPELINE_TOKENS: readonly string[] = [ORG_SCOPE_TOKEN]

/**
 * `/crm/deals` — the pipeline (AGL-2598).
 *
 * ## Two views of one pipeline
 *
 * The BOARD is one pipeline's open deals, one column per open stage, read
 * in one bounded listener over `(visibleTo, pipelineId, status, updatedAt)`
 * and sorted into columns here — a listener per column would be five
 * subscriptions for one board. The TABLE is the same pipeline's deals,
 * paged by a query that carries its status, "No next activity" and search
 * word (AGL-3321); it is where the closed history is found. The three figures above both come from the board's read, so
 * they describe what is in play whichever view is showing.
 *
 * ## Which pipeline
 *
 * The switcher in the header (AGL-2620) picks among the ACTIVE pipelines
 * and opens on the default; the board, the table, the figures and the New
 * deal drawer all follow it. It is section state rather than a route: a
 * pipeline is a lens on the section, and a saved view that names one
 * composes with it. **Pipelines** opens the dialog that creates, renames,
 * defaults, archives and — through it — edits the stages of each.
 *
 * ## Every move goes through the route
 *
 * A drag, a card's "Move to", "Mark won" and "Mark lost" all end in
 * `useDealStageApi`, never a Firestore write: the stage is the fact the
 * automations listen for, and only the server emits the event. The section
 * marks the card pending while the request runs and lets the listener land
 * it — see `DealBoard` for why a move is not applied optimistically.
 *
 * ## Creation is a button
 *
 * "New deal" opens a drawer; there is no form above the list. The drawer
 * writes client-direct against the rules, stamped with this console's scope.
 *
 * ## The table selects and exports (AGL-2621)
 *
 * The table's rows are selectable, and a selection raises `DealsBulkBar`
 * over it — whose stage moves go through the same `useDealStageApi` as a
 * drag. Export CSV beside the status toggle writes the page through
 * `dealsCsv()`, naming the pipeline, the stage and the owner; the bar
 * writes the same file over the selection.
 */
export function DealsSection(props: ConsolePluginPageProps) {
  const { hostId, org, basePath } = props
  const routes = crmRoutes(basePath ?? '')
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const scope = useCrmScope({ hostId, org })
  const pipelineState = usePipeline(scope.orgId, {
    hostId,
    org: (org ?? null) as Record<string, unknown> | null,
  })
  const { activePipelines } = pipelineState
  const [pipelineId, setPipelineId] = useState<string | null>(null)
  // The chosen pipeline while it is still active; else the default. A
  // pipeline archived from another tab falls back rather than leaving the
  // board on a pipeline the picker no longer lists.
  const pipeline =
    (pipelineId ? activePipelines.find((entry) => entry.$id === pipelineId) : null) ??
    pipelineState.pipeline
  const roster = useOrgMemberDirectory(scope.orgId)
  const api = useDealStageApi(hostId)
  const nowMs = useMemo(() => Date.now(), [])
  // The org's deal fields, for the table's optional columns (AGL-2661).
  const dealFields = useContactFieldDefinitions(scope.orgId, 'deal')
  // Salesforce's Type and Lead source lists, for their columns and filters,
  // and the campaigns a file names its deals' campaign by (AGL-3516).
  const typeList = useCrmPicklist('opportunityType', scope.orgId)
  const leadSourceList = useCrmPicklist('leadSource', scope.orgId)
  const campaigns = useCrmCampaigns({ hostId, orgId: scope.orgId }, { enabled: true })

  const [view, setView] = useState<View>('board')
  const [closedExpanded, setClosedExpanded] = useState(false)
  /*
   * The table's status filter is the saved VIEW'S (AGL-2617): a view of
   * deals is a view of the table, and it holds the status beside the
   * columns and the sort. Opening one shows the table, because the board
   * has no columns to arrange and answers to the pipeline's stages alone.
   */
  const views = useCrmSavedView({
    section: 'deals',
    hostId,
    org,
    basePath: basePath ?? '',
  })
  const statusFilter: StatusFilter = useMemo(() => {
    const value = views.state.filters.find((clause) => clause.field === 'status')?.value
    return value === 'open' || value === 'won' || value === 'lost' ? value : 'all'
  }, [views.state.filters])
  // Every clause is the query's, the status and "No next activity" alike.
  const viewFilters = views.state.filters
  useEffect(() => {
    if (views.currentId) setView('table')
  }, [views.currentId])

  // The board's read stays on in the table view too: it is what the summary
  // above both views is computed from, and it is already bounded.
  const open = useDealsByStatus(
    scope.orgId,
    scope.visibleTo,
    pipeline?.$id ?? null,
    'open',
    BOARD_OPEN_LIMIT,
  )
  const closedPipelineId =
    view === 'board' && closedExpanded ? (pipeline?.$id ?? null) : null
  const won = useDealsByStatus(scope.orgId, scope.visibleTo, closedPipelineId, 'won', BOARD_CLOSED_LIMIT)
  const lost = useDealsByStatus(scope.orgId, scope.visibleTo, closedPipelineId, 'lost', BOARD_CLOSED_LIMIT)
  /*
   * THE TABLE (AGL-3321): the pipeline's deals, every clause and the search
   * word on one query — the search reads the title's word prefixes every
   * deal writer stamps, so a deal on page four is found by any word of its
   * title — paged by that query, and read only while the table is showing.
   */
  const [searchWords, setSearchWords] = useState<string[]>([])
  const searching = searchWords.some((word) => word.trim())
  const searchKey = searchWords.join(' ')
  const foldsScope = useCrmFoldsScope(scope.orgId, scope.visibleTo)
  const pipelineBase = useMemo(() => dealPipelineBase(pipeline?.$id ?? null), [pipeline?.$id])
  // Each stored clause asked through the field its writer keeps — a Type
  // or a Lead source by its key (AGL-3516).
  const asked = useMemo(() => crmAskClauses(viewFilters, dealQueryClause), [viewFilters])
  const paged = useCrmListQuery<DealDoc>({
    scope: scope.scope,
    collection: CRM_COLLECTIONS.deals,
    visibleTo: scope.visibleTo,
    foldsScope,
    declaration: DEAL_LIST_DECLARATION,
    clauses: asked.clauses,
    search: searchWords,
    base: pipelineBase,
    prefixSearch: DEAL_PREFIX_SEARCH,
    enabled: view === 'table' && Boolean(pipeline),
  })

  const summary = useMemo(() => boardSummary(open.data, pipeline), [open.data, pipeline])

  /*
   * MOVES IN FLIGHT. A card in this set is dimmed and cannot be dragged
   * again until the route answers; the listener is what moves it.
   */
  const [moving, setMoving] = useState<ReadonlySet<string>>(() => new Set())
  const track = useCallback(
    async (deal: DealDoc, request: () => Promise<unknown>, done: string) => {
      setMoving((current) => new Set(current).add(deal.$id))
      try {
        await request()
        enqueueSnackbar(done, { variant: 'success', persist: false })
        return true
      } catch (error) {
        enqueueSnackbar(
          error instanceof Error ? error.message : 'The deal could not be moved.',
          { variant: 'warning', allowDuplicate: true },
        )
        return false
      } finally {
        setMoving((current) => {
          const next = new Set(current)
          next.delete(deal.$id)
          return next
        })
      }
    },
    [enqueueSnackbar],
  )
  const handleMove = useCallback(
    (deal: DealDoc, stageId: string) => {
      const stage = dealStageById(pipeline, stageId)
      void track(
        deal,
        () => api.moveToStage(deal, stageId),
        `Moved to ${stage?.name ?? 'stage'}`,
      )
    },
    [api, pipeline, track],
  )
  const handleWon = useCallback(
    (deal: DealDoc) => void track(deal, () => api.markWon(deal), 'Deal won'),
    [api, track],
  )
  const [losing, setLosing] = useState<DealDoc | null>(null)
  const handleLost = useCallback((deal: DealDoc) => setLosing(deal), [])
  const confirmLost = useCallback(
    (reason: string) => {
      const deal = losing
      if (!deal) return
      setLosing(null)
      void track(deal, () => api.markLost(deal, reason), 'Deal marked lost')
    },
    [api, losing, track],
  )

  const openDeal = useCallback(
    (deal: DealDoc) => router.push(routes.deal(deal.$id)),
    [router, routes],
  )

  const [creating, setCreating] = useState(false)
  const [managingPipelines, setManagingPipelines] = useState(false)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // A page or a status is a different set of rows; a selection made on
  // the last one would be a count over rows no longer on screen.
  useEffect(() => setSelectedIds([]), [paged.plan, paged.page])
  const csvOptions: DealCsvOptions = useMemo(
    () => ({
      pipelineName: (id) => pipelineState.pipelineById(id)?.name,
      stageName: (pipelineId, stageId) =>
        dealStageById(pipelineState.pipelineById(pipelineId), stageId)?.name,
      ownerEmail: (uid) => {
        const member = findOrgMember(roster.members, uid)
        return member?.email || member?.label || uid
      },
      campaignName: (id) => campaigns.options.find((option) => option.value === id)?.label,
    }),
    [pipelineState, roster.members, campaigns.options],
  )
  // The page on screen; Export all on the bulk bar takes the whole list.
  const handleExport = useCallback(() => {
    downloadTextFile('deals.csv', 'text/csv', dealsCsv(paged.rows, csvOptions))
  }, [paged.rows, csvOptions])

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'title',
        headerName: 'Deal',
        flex: 1.6,
        minWidth: 220,
        renderCell: ({ row }: { row: DealDoc }) => {
          const withWhom = [row.contactName, row.companyName].filter(Boolean).join(' · ')
          return (
            <Stack sx={{ justifyContent: 'center', lineHeight: 1.25 }}>
              <Typography variant="body2" sx={{ lineHeight: 1.25 }}>
                {row.title || 'Untitled deal'}
              </Typography>
              {withWhom ? (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.25 }}>
                  {withWhom}
                </Typography>
              ) : null}
            </Stack>
          )
        },
      },
      {
        field: 'stageId',
        headerName: 'Stage',
        flex: 0.9,
        minWidth: 140,
        valueGetter: (_value: unknown, row: DealDoc) =>
          dealStageById(pipelineState.pipelineById(row.pipelineId), row.stageId)?.name ??
          row.stageId,
      },
      {
        field: 'amountCents',
        headerName: 'Amount',
        flex: 0.8,
        minWidth: 120,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_value: unknown, row: DealDoc) => row.amountCents ?? null,
        renderCell: ({ row }: { row: DealDoc }) =>
          typeof row.amountCents === 'number' ? formatMoney(row.amountCents, row.currency) : '—',
      },
      {
        field: 'ownerUid',
        headerName: 'Owner',
        flex: 0.9,
        minWidth: 140,
        valueGetter: (_value: unknown, row: DealDoc) => roster.nameOf(row.ownerUid),
        renderCell: ({ row }: { row: DealDoc }) => {
          const label = roster.nameOf(row.ownerUid)
          return label ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <OwnerAvatar label={label} size={22} />
              <Typography variant="body2" noWrap>
                {label}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'—'}
            </Typography>
          )
        },
      },
      {
        field: 'expectedCloseAtMs',
        headerName: 'Expected close',
        flex: 0.8,
        minWidth: 130,
        type: 'date',
        valueGetter: (_value: unknown, row: DealDoc) =>
          typeof row.expectedCloseAtMs === 'number' ? new Date(row.expectedCloseAtMs) : null,
        renderCell: ({ row }: { row: DealDoc }) =>
          typeof row.expectedCloseAtMs === 'number'
            ? new Date(row.expectedCloseAtMs).toLocaleDateString()
            : '—',
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.6,
        minWidth: 100,
        renderCell: ({ row }: { row: DealDoc }) => (
          <Chip
            size="small"
            label={DEAL_STATUS_LABELS[row.status] ?? row.status}
            color={row.status === 'won' ? 'success' : row.status === 'lost' ? 'default' : 'primary'}
            variant={row.status === 'open' ? 'outlined' : 'filled'}
          />
        ),
      },
      // When the earliest open task against the deal is due (AGL-2661).
      nextActivityColumn(nowMs),
      // Salesforce's Type and Lead source, optional, in their lists' order (AGL-3516).
      picklistColumn('type', 'Type', typeList.picklist),
      picklistColumn('leadSource', 'Lead source', leadSourceList.picklist),
      // The org's deal fields as optional columns (AGL-2661).
      ...customFieldColumns(dealFields.active),
    ],
    [pipelineState, roster, dealFields.active, nowMs, typeList.picklist, leadSourceList.picklist],
  )
  /** The table's rows: the query's page. */
  const tableRows = paged.rows
  /*
   * The table's column and sort models are the view's (AGL-2617); its
   * filters are the grid's own panel over the view's clauses (AGL-3313),
   * every one of them asked of the query (AGL-3321).
   */
  /*
   * The choices each select column offers. A stored clause naming a value
   * no longer listed stays a choice, so the panel can show it and clear it.
   */
  const filterOptions = useMemo<Record<string, ListFilterOption[]>>(() => {
    const stale = (field: string, known: readonly { value: string }[]) =>
      viewFilters
        .filter((clause) => clause.field === field && clause.op !== 'isEmpty')
        .flatMap((clause) => clause.value.split(','))
        .map((value) => value.trim())
        .filter((value) => value && !known.some((option) => option.value === value))
        .map((value) => ({ value, label: value }))
    const types = picklistFilterOptions(typeList.picklist, 'No type')
    const sources = picklistFilterOptions(leadSourceList.picklist, 'No lead source')
    return {
      status: DEAL_STATUS_FILTER_OPTIONS,
      type: [...types, ...stale('type', types)],
      leadSource: [...sources, ...stale('leadSource', sources)],
    }
  }, [viewFilters, typeList.picklist, leadSourceList.picklist])
  const filterColumns = useMemo(
    () => listFilterGridColumns(columns, DEAL_GRID_FILTER_FIELDS, filterOptions, DEAL_GRID_FILTER_HEADERS),
    [columns, filterOptions],
  )
  const grid = useCrmViewGrid(views, filterColumns, DEAL_HIDDEN_COLUMNS)
  const gridFilter = useListGridFilter({
    clauses: viewFilters,
    onChange: views.setFilters,
    selectFields: ['status', 'type', 'leadSource'],
    codecs: DEAL_FILTER_CODECS,
    search: { words: searchWords, onChange: setSearchWords },
  })
  // What the query could not hold, named by the clause the reader set.
  const refused = useMemo(
    () =>
      crmQueryRefusals(paged.plan, asked, {
        fields: DEAL_GRID_FILTER_FIELDS,
        headers: DEAL_GRID_FILTER_HEADERS,
        options: filterOptions,
      }),
    [paged.plan, asked, filterOptions],
  )

  const noOrg = scope.ready && !scope.orgId
  const pipelineLoading =
    !noOrg && (pipelineState.status === 'loading' || pipelineState.seeding || (!pipeline && pipelineState.status !== 'error'))

  return (
    <>
      <CardDisplay
        header={'Deals'}
        help={pluginDocsHelp('deals', { anchor: '#the-board-and-the-table' })}
        contentGutterX
        contentGutterY
        HeaderProps={{
          // The record actions, top right and never clipped (AGL-3311).
          action: (
            <CrmListActions>
              <DealImportButton hostId={hostId} />
              {/* The file is the table's rows, so it is offered with the table. */}
              {view === 'table' ? (
                <Button
                  size="small"
                  onClick={handleExport}
                  disabled={!paged.rows.length}
                >
                  {'Export CSV'}
                </Button>
              ) : null}
              <Button
                size="small"
                startIcon={<MdiIcon path={mdiCogOutline.path} size={0.8} />}
                disabled={!scope.orgId || pipelineState.status === 'loading'}
                onClick={() => setManagingPipelines(true)}
              >
                {'Pipelines'}
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
                disabled={!pipeline || !scope.orgId}
                onClick={() => setCreating(true)}
              >
                {'New deal'}
              </Button>
            </CrmListActions>
          ),
        }}
      >
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={3}
            sx={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 1 }}
          >
            <Figure label="Open deals" value={summary.openCount.toLocaleString()} />
            <Figure label="Pipeline value" value={formatAmountByCurrency(summary.valueByCurrency)} />
            <Figure label="Weighted value" value={formatAmountByCurrency(summary.weightedByCurrency)} />
            <Stack sx={{ flex: 1 }} />
            {/* Which pipeline the board and table show, above them rather than under (AGL-3311). */}
            {activePipelines.length > 1 ? (
              <TextField
                select
                size="small"
                label="Pipeline"
                value={pipeline?.$id ?? ''}
                onChange={(event) => setPipelineId(event.target.value)}
                sx={{ minWidth: 160 }}
                slotProps={{ select: { 'aria-label': 'Pipeline' } }}
              >
                {activePipelines.map((entry) => (
                  <MenuItem key={entry.$id} value={entry.$id}>
                    {entry.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={view}
              onChange={(_event, next) => {
                if (next) setView(next as View)
              }}
              aria-label="View"
            >
              <ToggleButton value="board" aria-label="Board">
                <MdiIcon path={mdiViewColumnOutline.path} size={0.8} />
                <Typography variant="button" sx={{ ml: 0.5 }}>
                  {'Board'}
                </Typography>
              </ToggleButton>
              <ToggleButton value="table" aria-label="Table">
                <MdiIcon path={mdiTableLarge.path} size={0.8} />
                <Typography variant="button" sx={{ ml: 0.5 }}>
                  {'Table'}
                </Typography>
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {noOrg ? (
            <Alert severity="info">
              {'This site has no organization, so it has no pipeline.'}
            </Alert>
          ) : pipelineState.status === 'error' ? (
            <Alert severity="warning">
              {'The pipeline could not be read. Deals need the "Manage data" permission.'}
            </Alert>
          ) : pipelineLoading ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                {pipelineState.seeding ? 'Setting up your Sales pipeline…' : 'Loading the pipeline…'}
              </Typography>
            </Stack>
          ) : view === 'board' && pipeline ? (
            <>
              {open.status === 'success' && open.data.length === 0 ? (
                <EmptyStateComponent
                  compact
                  label={'No open deals yet'}
                  description={'A deal is a sale in progress, moved across the stages below as it advances.'}
                  action={
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
                      disabled={!pipeline || !scope.orgId}
                      onClick={() => setCreating(true)}
                    >
                      {'New deal'}
                    </Button>
                  }
                />
              ) : null}
              <DealBoard
                pipeline={pipeline}
                deals={open.data}
                won={closedExpanded && won.status !== 'loading' ? won.data : null}
                lost={closedExpanded && lost.status !== 'loading' ? lost.data : null}
                closedExpanded={closedExpanded}
                onToggleClosed={() => setClosedExpanded((current) => !current)}
                labelFor={roster.nameOf}
                moving={moving}
                onOpen={openDeal}
                onMove={handleMove}
                onWon={handleWon}
                onLost={handleLost}
                nowMs={nowMs}
              />
            </>
          ) : (
            <Stack spacing={1.5}>
              {/*
                The view this table is showing, and the clauses narrowing it
                as chips (AGL-2617, AGL-3313). Status and "No next activity"
                are set in the grid's own Filters panel.
              */}
              <CrmListToolbar label="Deal filters">
                <CrmViewsControl controller={views} allLabel="All deals" />
                <ListFilterChips
                  fields={DEAL_GRID_FILTER_FIELDS}
                  headers={DEAL_GRID_FILTER_HEADERS}
                  clauses={viewFilters}
                  onChange={views.setFilters}
                  options={filterOptions}
                  marksServed={false}
                />
              </CrmListToolbar>
              <ListQueryNotices refused={refused} notices={paged.plan.notices} />
                <>
                  <DealsBulkBar
                    hostId={hostId}
                    scope={scope.scope}
                    rows={tableRows}
                    selected={selectedIds}
                    onSelectedChange={setSelectedIds}
                    pipelineById={pipelineState.pipelineById}
                    roster={roster}
                    api={api}
                    csv={csvOptions}
                  />
                  <CrmColumnOrderProvider value={grid.columnOrder}>
                    <ListTable
                      rows={tableRows}
                      columns={grid.columns}
                      slots={CRM_LIST_SLOTS}
                      selectable={{ selected: selectedIds, onChange: setSelectedIds }}
                      onOpen={(_id, row) => openDeal(row as DealDoc)}
                      // The panel and the search are the query's (AGL-3321).
                      filterMode="server"
                      filterModel={gridFilter.filterModel}
                      onFilterModelChange={gridFilter.onFilterModelChange}
                      quickFilter
                      loading={paged.status === 'loading'}
                      // An empty table is said inside the grid, so its toolbar
                      // stays to change the status that emptied it.
                      noRowsLabel={
                        searching
                          ? `No deals match “${searchKey.trim()}”`
                          : statusFilter === 'all'
                            ? 'No deals yet'
                            : `No ${statusFilter} deals`
                      }
                      noRowsDescription={
                        statusFilter === 'all' && !searching
                          ? 'A deal is a sale in progress, moved across the pipeline as it advances.'
                          : undefined
                      }
                      noRowsAction={
                        statusFilter === 'all' && !searching ? (
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
                            disabled={!pipeline || !scope.orgId}
                            onClick={() => setCreating(true)}
                          >
                            {'New deal'}
                          </Button>
                        ) : undefined
                      }
                      // Columns and sort are the view's, controlled (AGL-2617).
                      columnVisibilityModel={grid.columnVisibilityModel}
                      onColumnVisibilityModelChange={grid.onColumnVisibilityModelChange}
                      sortModel={grid.sortModel}
                      onSortModelChange={grid.onSortModelChange}
                      hideFooter
                    />
                  </CrmColumnOrderProvider>
                  <ListPagination
                    page={paged.page}
                    pageSize={paged.pageSize}
                    rowCount={paged.rows.length}
                    hasMore={paged.hasMore}
                    onPageChange={paged.setPage}
                    onPageSizeChange={paged.setPageSize}
                  />
                </>
            </Stack>
          )}
        </Stack>
      </CardDisplay>
      <DealEditDrawer
        open={creating}
        onClose={() => setCreating(false)}
        hostId={hostId}
        org={org}
        pipelines={activePipelines}
        defaultPipeline={pipeline}
      />
      <PipelinesDialog
        open={managingPipelines}
        onClose={() => setManagingPipelines(false)}
        orgId={scope.orgId ?? ''}
        // A pipeline made here is stamped the way the seeded default is
        // (`usePipeline`): the site's own tokens under a site; at the
        // organization level the org token, with the picked site as its
        // provenance (AGL-2630).
        hostId={scope.createHostId}
        pipelines={pipelineState.pipelines}
        fromCache={pipelineState.fromCache}
        unreadable={pipelineState.status === 'error'}
        visibleToTokens={scope.visibleTo}
        createTokens={scope.level === 'site' ? scope.createTokens : ORG_PIPELINE_TOKENS}
      />
      <LostReasonDialog
        open={Boolean(losing)}
        dealTitle={losing?.title ?? ''}
        onClose={() => setLosing(null)}
        onConfirm={confirmLost}
      />
    </>
  )
}
DealsSection.displayName = 'DealsSection'

/** An optional column of a picklist field: its label, sorted in the list's order. */
function picklistColumn(field: 'type' | 'leadSource', headerName: string, picklist: CrmPicklist): GridColDef {
  return {
    field,
    headerName,
    flex: 0.8,
    minWidth: 130,
    valueGetter: (_value: unknown, row: DealDoc) => String(row[field] ?? ''),
    sortComparator: (a: string, b: string) =>
      crmPicklistRank(picklist, a) - crmPicklistRank(picklist, b) || a.localeCompare(b),
  }
}

function Figure(props: { label: string; value: string }) {
  return (
    <Stack sx={{ lineHeight: 1.2 }}>
      <Typography variant="caption" color="text.secondary">
        {props.label}
      </Typography>
      <Typography variant="h6" component="span">
        {props.value}
      </Typography>
    </Stack>
  )
}
Figure.displayName = 'Figure'

export default DealsSection
