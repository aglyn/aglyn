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
  actionRunResult,
  actionRunSummary,
  actionTriggerLabel,
  runTriggeredByLabel,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { HOST_EVENT_TYPES } from '@aglyn/aglyn/app-utils/host-events'
import { AUTOMATION_RUN_ZONE, type AutomationTarget } from './workflow-zones'
import { CardDisplay, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  RUN_HISTORY_HEADERS,
  RUN_HISTORY_QUERY,
  runHistoryBase,
} from '../model/run-history'

export interface HostRunHistoryCardProps {
  hostId: string
  /** The org the page names, for what other plugins add to a failed run. */
  orgId?: string
  /** Show only runs of this action/workflow. */
  targetId?: string
  /**
   * What `targetId` names, and its name. A run row records its automation's id
   * but not whether it is an action or a workflow, so the card that opened the
   * history says; without it, a failed run offers nothing beside its summary.
   */
  targetType?: AutomationTarget['type']
  targetName?: string
  header?: string
  /** Overrides the default help affordance on the card header. */
  help?: HelpTipContent
}

const RESULT_COLOR = {
  succeeded: 'success',
  failed: 'error',
  skipped: 'warning',
} as const

const RESULT_LABEL = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
} as const

type RunResult = keyof typeof RESULT_LABEL

/** One run as the grid holds it: the entry, and what it is shown by. */
interface RunRow {
  $id: string
  entry: any
  result: RunResult
  trigger: string
  triggerLabel: string
  /** Who set the run off (AGL-3376). */
  who: string
  summary: string
  createdAtMs: number | null
}

/** Trigger and Result are picked: the event list and the three verdicts. */
const RUN_FILTER_OPTIONS = {
  trigger: HOST_EVENT_TYPES.map((event) => ({
    value: event,
    label: actionTriggerLabel(event),
  })),
  result: (Object.keys(RESULT_LABEL) as RunResult[]).map((result) => ({
    value: result,
    label: RESULT_LABEL[result],
  })),
}
const RUN_SELECT_FIELDS = Object.keys(RUN_FILTER_OPTIONS)

/**
 * The run-history table `/product/workflows` advertises (AGL-2171):
 * `Time | Trigger | Result | What happened`.
 *
 * A separate component from `HostActivityCard` on purpose. That card is
 * the site's general feed — publishes, media saves, member changes — and
 * a run is a different record with different columns. Pointing the Runs
 * dialog at the general feed is what produced a list of
 * `Action ran on formSubmission — My automation` where the mockup shows
 * four columns.
 *
 * EVERY FILTER IS ON THE QUERY (AGL-3321). The history is one Firestore
 * query over `hosts/{hostId}/activity` — this automation's entries, runs
 * only, newest first — with each Filters-panel clause and the search word
 * as another predicate on it (`RUN_HISTORY_QUERY`), and it pages by that
 * query. A filtered page is a page of matches from the whole history, not
 * the matches among entries already read; what one query cannot hold is
 * said above the grid and not applied.
 */
export function HostRunHistoryCard(props: HostRunHistoryCardProps) {
  const {
    hostId,
    orgId,
    targetId,
    targetType,
    targetName = '',
    header = 'Run history',
    help = pluginDocsHelp('buildAWorkflow', {
      anchor: '#4-save-and-test',
      excerpt:
        'Every run of this automation, including the ones a trigger ' +
        'condition skipped — which is the answer to "why did it not fire?".',
    }),
  } = props
  const firestore = useFirestore()
  /**
   * The shell's zone renderer (AGL-2919), for what other plugins add to a
   * failed run; `null` outside the console shell.
   */
  const RunZone = useConsoleWidgetSlot()
  /** The automation a failed run belongs to, as the `automationRun` zone names it. */
  const zoneTarget = useMemo<AutomationTarget | null>(
    () =>
      targetId && targetType
        ? { type: targetType, id: targetId, name: targetName }
        : null,
    [targetId, targetType, targetName],
  )
  const gridFilter = useListGridFilter({ selectFields: RUN_SELECT_FIELDS })
  const activity = useMemo(
    () => (hostId ? collection(firestore, 'hosts', hostId, 'activity') : null),
    [firestore, hostId],
  )
  /*
   * `target.id` equality keeps the read proportional to the card — this
   * automation's rows, not the site's — and `result` keeps it to runs.
   * Both, and every clause, are served by the `activity` composites the
   * index file carries for `RUN_HISTORY_QUERY` beneath `createdAt` DESC.
   * A different workflow is a different history, and a new plan a new
   * query: the pager starts over on either.
   */
  const {
    rows: entries,
    status,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
  } = useListQuery<any>({
    collection: activity,
    declaration: RUN_HISTORY_QUERY,
    request: {
      clauses: gridFilter.clauses,
      search: gridFilter.searchWords,
      base: runHistoryBase(targetId, gridFilter.clauses),
    },
    deps: [firestore, hostId, targetId],
    idField: '$id',
  })
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.length > 0

  const runs = useMemo(
    () =>
      entries.map((entry): RunRow => ({
        $id: String(entry.$id),
        entry,
        // Every entry the query returns carries a verdict; the presenter
        // still reads it, so a row renders the way the feed names it.
        result: actionRunResult(entry) ?? 'succeeded',
        trigger: String(entry.trigger ?? ''),
        // `formSubmission` → `Form submitted`.
        triggerLabel: actionTriggerLabel(entry.trigger),
        who: runTriggeredByLabel(entry),
        summary: actionRunSummary(entry),
        createdAtMs:
          typeof entry.createdAt?.seconds === 'number'
            ? entry.createdAt.seconds * 1000
            : null,
      })),
    [entries],
  )
  const refused = useMemo(
    () =>
      listQueryRefusals(plan.refused, {
        fields: RUN_HISTORY_QUERY.fields,
        headers: RUN_HISTORY_HEADERS,
        options: RUN_FILTER_OPTIONS,
      }),
    [plan],
  )

  const columns = useMemo(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'createdAtMs',
            headerName: 'Time',
            width: 120,
            renderCell: ({ row }: { row: RunRow }) => {
              const at = row.entry.createdAt?.toDate?.()
              return (
                <Tooltip title={at ? at.toLocaleString() : ''}>
                  <span>{at ? at.toLocaleTimeString() : '--'}</span>
                </Tooltip>
              )
            },
          },
          {
            field: 'trigger',
            headerName: 'Trigger',
            width: 180,
            renderCell: ({ row }: { row: RunRow }) => row.triggerLabel,
          },
          {
            field: 'who',
            headerName: 'Who',
            description: 'Who set this run off: the person, visitor, key or system whose act fired the trigger.',
            width: 200,
            renderCell: ({ row }: { row: RunRow }) => row.who,
          },
          {
            field: 'result',
            headerName: 'Result',
            width: 120,
            renderCell: ({ row }: { row: RunRow }) => (
              <Chip
                size="small"
                variant="outlined"
                color={RESULT_COLOR[row.result]}
                label={RESULT_LABEL[row.result]}
              />
            ),
          },
          {
            field: 'summary',
            headerName: 'What happened',
            flex: 1,
            minWidth: 220,
            renderCell: ({ row }: { row: RunRow }) => (
              <Stack sx={{ minWidth: 0, py: 0.75 }}>
                <Typography variant="body2">{row.summary}</Typography>
                {row.entry.durationMs != null ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${row.entry.durationMs}ms`}
                  </Typography>
                ) : null}
                {/*
                What other plugins add to a failed run (AGL-2919): the
                `automationRun` zone, through the shell's gated slot.
              */}
                {RunZone && zoneTarget && row.result === 'failed' ? (
                  <RunZone
                    slot={AUTOMATION_RUN_ZONE.id}
                    hostId={hostId}
                    orgId={orgId}
                    target={zoneTarget}
                    runId={row.$id}
                  />
                ) : null}
              </Stack>
            ),
          },
        ] as GridColDef[],
        RUN_HISTORY_QUERY.fields,
        RUN_FILTER_OPTIONS,
        RUN_HISTORY_HEADERS,
      ),
    [RunZone, zoneTarget, hostId, orgId],
  )

  return (
    <CardDisplay
      header={header}
      help={help}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {!filtering && page === 0 && runs.length === 0 && status === 'success' ? (
        <Typography variant="body2" color="text.secondary">
          {'No runs yet — every run of this automation is logged here, ' +
            'including the ones a condition skipped.'}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <ListFilterChips
            fields={RUN_HISTORY_QUERY.fields}
            headers={RUN_HISTORY_HEADERS}
            clauses={gridFilter.clauses}
            onChange={gridFilter.setClauses}
            options={RUN_FILTER_OPTIONS}
          />
          <ListQueryNotices refused={refused} notices={plan.notices} />
          <ListTable
            aria-label="Run history"
            rows={runs}
            columns={columns}
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            quickFilter
            // Newest first is the query's one order.
            sortingMode="server"
            disableColumnSorting
            // A failed run carries what other plugins add under its summary.
            getRowHeight={() => 'auto'}
            // `ListPagination` below pages the query.
            hideFooter
            noRowsLabel="No runs match these filters"
          />
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={runs.length}
            hasMore={hasMore}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </Stack>
      )}
    </CardDisplay>
  )
}
HostRunHistoryCard.displayName = 'HostRunHistoryCard'

export default HostRunHistoryCard
