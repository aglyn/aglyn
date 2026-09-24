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
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { HOST_EVENT_TYPES } from '@aglyn/aglyn/app-utils/workflows'
import type { ConsoleAutomationTarget } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { CardDisplay, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import { Alert, Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'

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
  targetType?: ConsoleAutomationTarget['type']
  targetName?: string
  header?: string
  /** Overrides the default help affordance on the card header. */
  help?: HelpTipContent
}

/**
 * Activity rows read before the run filter.
 *
 * A CEILING rather than a page, and the difference is the client-side filter
 * below. `activity` holds publishes, media saves and member changes as well as
 * runs, and only a document carrying a run verdict is a row here — so a
 * server page of ten activity entries might contain two runs, one, or none,
 * and paging the QUERY would hand the reader pages of wildly different
 * heights with no way to tell a short page from the end of the history.
 *
 * The filter cannot move to the server either: `actionRunResult` falls back to
 * reading the prose `action` for entries written before AGL-2171, which have
 * no `result` field, and `where('result','in',…)` excludes exactly those. That
 * is the same field-presence trap as ordering on an optional field, and it
 * would silently drop every historic run.
 */
const WINDOW = 200

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

/** One run as the grid holds it: the entry, and what it is shown and filtered by. */
interface RunRow {
  $id: string
  entry: any
  result: RunResult
  trigger: string
  triggerLabel: string
  summary: string
  createdAtMs: number | null
}

/*
 * What the run grid's Filters panel offers. The card holds its whole window,
 * so the panel and the search answer over every run it read. Trigger and
 * Result are picked from the event list and the three verdicts; what
 * happened is typed.
 */
const RUN_FILTER_FIELDS = [
  inMemoryListField('createdAtMs', 'date'),
  inMemoryListField('trigger', 'select'),
  inMemoryListField('result', 'select'),
  inMemoryListField('summary', 'text'),
]
const RUN_FILTER_HEADERS: Readonly<Record<string, string>> = {
  createdAtMs: 'Time',
  trigger: 'Trigger',
  result: 'Result',
  summary: 'What happened',
}
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
/** What the quick search reads on a run row. */
const RUN_SEARCH_FIELDS = ['summary', 'triggerLabel'] as const

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
 * `actionRunResult` returning `undefined` is the filter: the activity
 * collection holds far more than runs, and a publish has no verdict. An
 * entry that is not a run simply does not appear, rather than appearing
 * under a `Succeeded` that means nothing for it.
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
  const zoneTarget = useMemo<ConsoleAutomationTarget | null>(
    () => (targetId && targetType ? { type: targetType, id: targetId, name: targetName } : null),
    [targetId, targetType, targetName],
  )
  /*
   * The window is NARROWED BY THE SERVER, not by the client (AGL-2292).
   *
   * A bare `limit(200)` with no ordering is not "the most recent 200 runs" —
   * Firestore answers an unordered limit in `__name__` order, so it is an
   * arbitrary slice of the host's whole activity feed. `activity` also holds
   * publishes, media saves and member changes, and only entries carrying a
   * run result survive the filter below, so a busy site could fill all 200
   * places with rows this card discards and report "No runs yet" for a
   * workflow that had run all day.
   *
   * `target.id` equality is what makes the read proportional to the card:
   * it asks for this workflow's rows rather than the site's. Both shapes
   * order by `createdAt` descending, so the ceiling keeps the NEWEST entries;
   * an equality with no ordering would keep an arbitrary `__name__` slice of
   * the automation's history once it outgrew the window. The targeted shape
   * is served by the `activity` (`target.id` ↑, `createdAt` ↓) composite the
   * console's organization activity route already uses.
   */
  const { data: entries } = useFirestoreCollection<any>(
    () => {
      if (!hostId) return null
      const base = collection(firestore, 'hosts', hostId, 'activity')
      /*
       * `WINDOW + 1` is a PROBE, not an off-by-one (AGL-2501).
       *
       * The card used to say "showing what we read" by saying nothing at all.
       * Reading one document more than the ceiling turns "there is older
       * history than this" into a fact for the price of a single read;
       * comparing `length === WINDOW` cannot, because it is wrong in both
       * directions at exactly the count that equals the ceiling. The probe row
       * is dropped below and never rendered.
       */
      return targetId
        ? query(
            base,
            where('target.id', '==', targetId),
            orderBy('createdAt', 'desc'),
            limit(WINDOW + 1),
          )
        : query(base, orderBy('createdAt', 'desc'), limit(WINDOW + 1))
    },
    // `targetId` belongs here: it now shapes the query, so a card that
    // switched workflows without it would go on showing the first one's runs.
    [firestore, hostId, targetId],
    { idField: '$id' },
  )
  /** The activity ceiling bit — there are older entries than were read. */
  const truncated = (entries?.length ?? 0) > WINDOW

  const runs = useMemo(
    () =>
      [...(entries ?? [])]
        .slice(0, WINDOW)
        .filter((entry) => !targetId || entry.target?.id === targetId)
        .map((entry) => ({ entry, result: actionRunResult(entry) }))
        .filter(
          (row): row is { entry: any; result: RunResult } =>
            Boolean(row.result),
        )
        .sort(
          (a, b) =>
            (b.entry.createdAt?.seconds ?? 0) -
            (a.entry.createdAt?.seconds ?? 0),
        )
        .map(
          ({ entry, result }): RunRow => ({
            $id: String(entry.$id),
            entry,
            result,
            trigger: String(entry.trigger ?? ''),
            // `formSubmission` → `Form submitted`.
            triggerLabel: actionTriggerLabel(entry.trigger),
            summary: actionRunSummary(entry),
            createdAtMs:
              typeof entry.createdAt?.seconds === 'number'
                ? entry.createdAt.seconds * 1000
                : null,
          }),
        ),
    [entries, targetId],
  )
  const listFilter = useListRowsFilter({
    rows: runs,
    fields: RUN_FILTER_FIELDS,
    options: RUN_FILTER_OPTIONS,
    headers: RUN_FILTER_HEADERS,
    search: RUN_SEARCH_FIELDS,
  })
  const matched = listFilter.rows

  /*
   * The page is a SLICE, because the rows are already in hand.
   *
   * Every run in the window has been read and paid for by the query above, so
   * a second query per page would buy nothing and cost a read. What the card
   * lacked was not a cheaper read but a control: it sliced the newest
   * twenty-five off the window and rendered them in one wall, so run
   * twenty-six was read, discarded, and unreachable — on the surface a reader
   * opens precisely to ask "why did it not fire the time before last?".
   */
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // A different workflow is a different history: page three of the last one
  // is not a position in this one, and an out-of-range page renders empty
  // with no explanation, which reads as the runs having gone.
  // A narrowed list starts again at its first page, for the same reason.
  const searchKey = listFilter.gridFilter.searchWords.join(' ')
  useEffect(
    () => setPage(0),
    [targetId, hostId, listFilter.gridFilter.clauses, searchKey],
  )
  const shown = useMemo(
    () => matched.slice(page * pageSize, page * pageSize + pageSize),
    [matched, page, pageSize],
  )

  const { filterColumns } = listFilter
  const columns = useMemo(
    () =>
      filterColumns([
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
                  slot="automationRun"
                  hostId={hostId}
                  orgId={orgId}
                  target={zoneTarget}
                  runId={row.$id}
                />
              ) : null}
            </Stack>
          ),
        },
      ] as GridColDef[]),
    [filterColumns, RunZone, zoneTarget, hostId, orgId],
  )

  return (
    <CardDisplay
      header={header}
      help={help}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No runs yet — every run of this automation is logged here, ' +
            'including the ones a condition skipped.'}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
        <ListFilterChips {...listFilter.chipsProps} />
        <ListTable
          aria-label="Run history"
          rows={shown}
          columns={columns}
          {...listFilter.gridProps}
          // A failed run carries what other plugins add under its summary.
          getRowHeight={() => 'auto'}
          // `ListPagination` below pages the matches.
          hideFooter
          noRowsLabel="No runs match these filters"
        />
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={shown.length}
          // The runs in the window that match, which is a number this card
          // genuinely holds. What it does not know is how many runs are OLDER
          // than the window, and the notice below says so rather than letting
          // the count line imply a total it cannot see.
          count={matched.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        {truncated ? (
          <Alert severity="info">
            {`Runs found in the ${WINDOW} most recent activity entries for ` +
              (targetId ? 'this automation' : 'this site') +
              '. Older runs than that are recorded and are not listed here.'}
          </Alert>
        ) : null}
        </Stack>
      )}
    </CardDisplay>
  )
}
HostRunHistoryCard.displayName = 'HostRunHistoryCard'

export default HostRunHistoryCard
