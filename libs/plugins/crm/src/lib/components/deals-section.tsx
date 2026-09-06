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
  dealStageById,
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
import { useCrmSavedView } from '../hooks/use-crm-saved-view'
import { useCrmViewGrid } from '../hooks/use-crm-view-grid'
import CrmViewsControl from './crm-views-control'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useDealStageApi } from '../hooks/use-deal-stage-api'
import {
  BOARD_CLOSED_LIMIT,
  BOARD_OPEN_LIMIT,
  useDealsByStatus,
  usePagedDeals,
} from '../hooks/use-deals'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import { usePipeline } from '../hooks/use-pipeline'
import { crmRoutes } from '../model/crm-routes'
import {
  boardSummary,
  DEAL_STATUS_LABELS,
  type DealDoc,
  formatAmountByCurrency,
  formatMoney,
} from '../model/deal-board-model'
import { DealBoard } from './deal-board'
import { DealEditDrawer } from './deal-edit-drawer'
import { LostReasonDialog } from './lost-reason-dialog'
import { OwnerAvatar } from './owner-avatar'
import { PipelineStagesDialog } from './pipeline-stages-dialog'

type View = 'board' | 'table'
type StatusFilter = CrmDealStatus | 'all'

/**
 * `/crm/deals` — the pipeline (AGL-2598).
 *
 * ## Two views of one collection
 *
 * The BOARD is the default pipeline's open deals, one column per open stage,
 * read in one bounded listener over `(visibleTo, pipelineId, status,
 * updatedAt)` and sorted into columns here — a listener per column would be
 * five subscriptions for one board. The TABLE is every deal the viewer may
 * see, paged by the query, with a status toggle; it is where the closed
 * history and the deals of a second pipeline are found. The three figures
 * above both come from the board's read, so they describe what is in play
 * whichever view is showing.
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
  const { pipeline, pipelines } = pipelineState
  const roster = useOrgMemberDirectory(scope.orgId)
  const api = useDealStageApi(hostId)
  const nowMs = useMemo(() => Date.now(), [])

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
  const setStatusFilter = useCallback(
    (next: StatusFilter) =>
      views.setFilters(next === 'all' ? [] : [{ field: 'status', op: 'equals', value: next }]),
    [views.setFilters],
  )
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
  const paged = usePagedDeals(
    view === 'table' ? scope.orgId : null,
    scope.visibleTo,
    statusFilter,
  )

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
        () => api.moveToStage(deal.$id, stageId),
        `Moved to ${stage?.name ?? 'stage'}`,
      )
    },
    [api, pipeline, track],
  )
  const handleWon = useCallback(
    (deal: DealDoc) => void track(deal, () => api.markWon(deal.$id), 'Deal won'),
    [api, track],
  )
  const [losing, setLosing] = useState<DealDoc | null>(null)
  const handleLost = useCallback((deal: DealDoc) => setLosing(deal), [])
  const confirmLost = useCallback(
    (reason: string) => {
      const deal = losing
      if (!deal) return
      setLosing(null)
      void track(deal, () => api.markLost(deal.$id, reason), 'Deal marked lost')
    },
    [api, losing, track],
  )

  const openDeal = useCallback(
    (deal: DealDoc) => router.push(routes.deal(deal.$id)),
    [router, routes],
  )

  const [creating, setCreating] = useState(false)
  const [editingStages, setEditingStages] = useState(false)

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
    ],
    [pipelineState, roster],
  )
  /* The table's column and sort models are the view's (AGL-2617). */
  const grid = useCrmViewGrid(views, columns)

  const noOrg = scope.ready && !scope.orgId
  const pipelineLoading =
    !noOrg && (pipelineState.status === 'loading' || pipelineState.seeding || (!pipeline && pipelineState.status !== 'error'))

  return (
    <>
      <CardDisplay
        header={'Deals'}
        help={pluginDocsHelp('deals', { anchor: '#the-board-and-the-table' })}
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<MdiIcon path={mdiCogOutline.path} size={0.8} />}
              disabled={!pipeline}
              onClick={() => setEditingStages(true)}
            >
              {'Stages'}
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
          </Stack>
        }
        contentGutterX
        contentGutterY
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
              {/* The view this table is showing, beside the status it narrows by (AGL-2617). */}
              <Stack
                direction="row"
                spacing={2}
                sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
              >
                <CrmViewsControl controller={views} allLabel="All deals" />
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={statusFilter}
                  onChange={(_event, next) => {
                    if (next) setStatusFilter(next as StatusFilter)
                  }}
                  aria-label="Status"
                >
                  <ToggleButton value="all">{'All'}</ToggleButton>
                  <ToggleButton value="open">{'Open'}</ToggleButton>
                  <ToggleButton value="won">{'Won'}</ToggleButton>
                  <ToggleButton value="lost">{'Lost'}</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              {paged.status === 'success' && paged.rows.length === 0 && paged.page === 0 ? (
                <EmptyStateComponent
                  label={statusFilter === 'all' ? 'No deals yet' : `No ${statusFilter} deals`}
                  description={
                    statusFilter === 'all'
                      ? 'A deal is a sale in progress, moved across the pipeline as it advances.'
                      : undefined
                  }
                  action={
                    statusFilter === 'all' ? (
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
                />
              ) : (
                <>
                  <ListTable
                    rows={paged.rows}
                    columns={columns}
                    onOpen={(_id, row) => openDeal(row as DealDoc)}
                    // Columns and sort are the view's, controlled (AGL-2617).
                    columnVisibilityModel={grid.columnVisibilityModel}
                    onColumnVisibilityModelChange={grid.onColumnVisibilityModelChange}
                    sortModel={grid.sortModel}
                    onSortModelChange={grid.onSortModelChange}
                    hideFooter
                  />
                  <ListPagination
                    page={paged.page}
                    pageSize={paged.pageSize}
                    rowCount={paged.rows.length}
                    hasMore={paged.hasMore}
                    onPageChange={paged.setPage}
                    onPageSizeChange={paged.setPageSize}
                  />
                </>
              )}
            </Stack>
          )}
        </Stack>
      </CardDisplay>
      <DealEditDrawer
        open={creating}
        onClose={() => setCreating(false)}
        hostId={hostId}
        org={org}
        pipelines={pipelines}
        defaultPipeline={pipeline}
      />
      <PipelineStagesDialog
        open={editingStages}
        onClose={() => setEditingStages(false)}
        orgId={scope.orgId ?? ''}
        pipeline={pipeline}
        fromCache={pipelineState.fromCache}
        unreadable={pipelineState.status === 'error'}
        visibleToTokens={scope.visibleTo}
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
