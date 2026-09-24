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

import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
  type ListTableProps,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  filterListRows,
  inMemoryListField,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
  Chip,
} from '@mui/material'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { OutreachCurateStepDialog, outreachNextEmailStepIndex } from './curate-step-dialog'
import { readOutreachEngagement } from '../model/enrollment-engagement'
import type { OutreachEnrollmentAction } from '../model/outreach-api'
import {
  OUTREACH_ENROLLMENT_STATUSES,
  OUTREACH_TASK_KIND_LABELS,
  type OutreachEnrollment,
  type OutreachSequenceStep,
} from '../model/outreach.types'
import {
  formatOutreachTime,
  OUTREACH_ENROLLMENT_STATUS_LABELS,
  OUTREACH_STOP_REASON_LABELS,
  OutreachEnrollmentStatusChip,
  OutreachLoading,
  OutreachLoadProblem,
} from './outreach-ui'
import type { OutreachApi } from './use-outreach-api'
import type { OutreachEnrollmentsLoad } from './use-outreach-data'

export interface OutreachEnrollmentsTableProps {
  enrollments: OutreachEnrollmentsLoad
  steps: readonly OutreachSequenceStep[]
  /**
   * Whether this sequence counts link clicks (AGL-3239). The Clicks column
   * is shown only when it does: a column of dashes for a sequence that
   * measures nothing reads as "nobody clicked", which is a different claim
   * and a false one.
   */
  trackClicks?: boolean
  /** The mailbox's IANA zone, which next sends are read in; `null` for the reader's own. */
  timeZone: string | null
  api: OutreachApi
  /** Shown in the empty state when the sequence takes people. */
  enrollAction?: ReactNode
}

/** The step an enrollment is on, as a person reads it. */
export function outreachCurrentStepLabel(
  enrollment: Pick<OutreachEnrollment, 'status' | 'stepIndex'>,
  steps: readonly OutreachSequenceStep[],
): string {
  if (enrollment.status === 'finished' || enrollment.stepIndex >= steps.length)
    return 'All steps done'
  const step = steps[enrollment.stepIndex]
  const kind =
    step?.kind === 'email'
      ? 'Email'
      : step?.kind === 'task'
        ? OUTREACH_TASK_KIND_LABELS[step.taskKind]
        : 'Step'
  return `Step ${enrollment.stepIndex + 1} of ${steps.length} · ${kind}`
}

/** Why an enrollment stopped, as the table says it; `''` while it runs. */
export function outreachStopLabel(
  enrollment: Pick<OutreachEnrollment, 'stopReason' | 'stopDetail'>,
): string {
  if (!enrollment.stopReason) return ''
  const reason = OUTREACH_STOP_REASON_LABELS[enrollment.stopReason] ?? ''
  return enrollment.stopDetail ? `${reason} — ${enrollment.stopDetail}` : reason
}

/** The last thing that happened: a send, a stop, or the enrollment itself. */
function lastActivityMs(enrollment: OutreachEnrollment): number {
  return Math.max(
    enrollment.lastSentAtMs ?? 0,
    enrollment.stoppedAtMs ?? 0,
    enrollment.createdAtMs ?? 0,
  )
}

/** The row's actions: the four the action route takes, and curating the next step (AGL-3324). */
type RowAction = OutreachEnrollmentAction | 'curate'

/** What a member may do to an enrollment in the status it is in. */
function actionsFor(
  enrollment: OutreachEnrollment,
  steps: readonly OutreachSequenceStep[],
): RowAction[] {
  const actions: RowAction[] = []
  // Rewrite the next email for this one person, while one is still to go.
  if (outreachNextEmailStepIndex(enrollment, steps) !== null) actions.push('curate')
  if (enrollment.status === 'active') actions.push('pause', 'stop')
  if (enrollment.status === 'paused') actions.push('resume', 'stop')
  if (enrollment.status !== 'opted_out') actions.push('do_not_contact')
  return actions
}

const ACTION_LABELS: Record<RowAction, string> = {
  curate: 'Curate next step',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  do_not_contact: 'Mark do-not-contact',
}

/** Whether the step the enrollment is on goes out as this person's own copy (AGL-3324). */
export function outreachStepIsCurated(
  enrollment: Pick<OutreachEnrollment, 'stepIndex' | 'stepOverrides'>,
): boolean {
  return Boolean(enrollment.stepOverrides?.[String(enrollment.stepIndex)])
}

/** What the snackbar says once an action lands. */
const DONE_LABELS: Record<
  Exclude<OutreachEnrollmentAction, 'do_not_contact'>,
  string
> = {
  pause: 'Paused.',
  resume: 'Resumed.',
  stop: 'Stopped.',
}

/** The two actions that end something for good ask first. */
const CONFIRM: Partial<
  Record<
    OutreachEnrollmentAction,
    { title: string; body: string; label: string }
  >
> = {
  stop: {
    title: 'Stop this enrollment?',
    body: 'They won’t get any more steps from this sequence, and they can’t be enrolled in it again.',
    label: 'Stop',
  },
  do_not_contact: {
    title: 'Mark do-not-contact?',
    body:
      'The address goes on your organization’s do-not-contact list, which every sequence checks before ' +
      'every send, and they are stopped in every sequence they are in.',
    label: 'Mark do-not-contact',
  },
}

/*
 * What the enrollments grid's Filters panel offers (AGL-3317). Status and
 * whether the person is a lead are picked; the name, the address and the
 * stop reason are typed. `target` and `email` are no column of their own,
 * so they are hidden columns the panel can still reach.
 */
const ENROLLMENT_FILTER_FIELDS = [
  inMemoryListField('status', 'select'),
  inMemoryListField('target', 'select'),
  inMemoryListField('contactName', 'text'),
  inMemoryListField('email', 'text'),
  inMemoryListField('stopReason', 'text'),
]
const ENROLLMENT_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
  target: 'Enrolled as',
  contactName: 'Name',
  email: 'Email',
  stopReason: 'Stop reason',
}
const ENROLLMENT_FILTER_OPTIONS = {
  status: OUTREACH_ENROLLMENT_STATUSES.map((status) => ({
    value: status,
    label: OUTREACH_ENROLLMENT_STATUS_LABELS[status],
  })),
  target: [
    { value: 'contact', label: 'Contact' },
    { value: 'lead', label: 'Lead' },
  ],
}
/** What the quick search reads on an enrollment row. */
const ENROLLMENT_SEARCH_FIELDS = ['contactName', 'email', 'step', 'stopReason'] as const
/** The filter-only columns never show. */
const ENROLLMENT_HIDDEN_COLUMNS = hiddenFilterVisibility(ENROLLMENT_FILTER_FIELDS, [
  'status',
  'stopReason',
])

/** The table's columns; the person and the actions are drawn from the row's enrollment. */
function columns(
  rowActions: (enrollment: OutreachEnrollment) => ReactNode,
  trackClicks: boolean,
): NonNullable<ListTableProps['columns']> {
  return [
    {
      field: 'person',
      headerName: 'Person',
      flex: 1,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack
          spacing={0}
          sx={{ justifyContent: 'center', height: '100%', minWidth: 0 }}
        >
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.enrollment.contactName || row.enrollment.email}
            </Typography>
            {row.enrollment.target === 'lead' ? (
              <Chip size="small" variant="outlined" label="Lead" />
            ) : null}
          </Stack>
          {row.enrollment.contactName ? (
            <Typography variant="caption" color="text.secondary" noWrap>
              {row.enrollment.email}
            </Typography>
          ) : null}
        </Stack>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: ({ row }) => (
        <OutreachEnrollmentStatusChip status={row.status} />
      ),
    },
    {
      field: 'step',
      headerName: 'Current step',
      flex: 1,
      minWidth: 170,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', height: '100%', minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {row.step}
          </Typography>
          {outreachStepIsCurated(row.enrollment) ? (
            <Chip size="small" variant="outlined" color="success" label="Curated" />
          ) : null}
        </Stack>
      ),
    },
    { field: 'nextSend', headerName: 'Next send', width: 190, sortable: false },
    {
      field: 'lastActivity',
      headerName: 'Last activity',
      width: 190,
      sortable: false,
    },
    ...(trackClicks
      ? [
          {
            field: 'clicks',
            headerName: 'Clicks',
            width: 130,
            sortable: false,
            renderCell: ({ row }: { row: { enrollment: OutreachEnrollment } }) => {
              const engagement = readOutreachEngagement(row.enrollment.engagement)
              if (!engagement.clicks) {
                return (
                  <Typography variant="body2" color="text.secondary">
                    —
                  </Typography>
                )
              }
              return (
                <Stack spacing={0} sx={{ justifyContent: 'center', height: '100%' }}>
                  <Typography variant="body2">
                    {engagement.clicks === 1 ? '1 click' : `${engagement.clicks} clicks`}
                  </Typography>
                  {engagement.lastClickUrl ? (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {engagement.lastClickUrl}
                    </Typography>
                  ) : null}
                </Stack>
              )
            },
          },
        ]
      : []),
    { field: 'stopReason', headerName: 'Stop reason', flex: 1, minWidth: 170 },
    listActionsColumn((row) => rowActions(row.enrollment), { width: 72 }),
  ]
}

/**
 * A sequence's enrollments (AGL-2980): who is in it, where each person
 * stands, when their next step goes out in the mailbox's timezone, and the
 * four things a member can do about it — pause, resume, stop, and mark
 * do-not-contact. A table on wider screens, a list of cards on a phone.
 */
export function OutreachEnrollmentsTable(props: OutreachEnrollmentsTableProps) {
  const { enrollments, steps, timeZone, api } = props
  const trackClicks = props.trackClicks === true
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const { enqueueSnackbar } = useSnackbar()
  const [confirming, setConfirming] = useState<{
    enrollment: OutreachEnrollment
    action: OutreachEnrollmentAction
  } | null>(null)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [curating, setCurating] = useState<OutreachEnrollment | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const gridFilter = useListGridFilter({ selectFields: ['status', 'target'] })
  const filtering = gridFilter.clauses.length > 0 || gridFilter.searchWords.length > 0
  /*
   * The rows the grid is handed, every clause and the search answered over
   * the enrollments read so far — a window that grows as the reader pages
   * past it, so a filter reaches further the further they go.
   */
  const searchKey = gridFilter.searchWords.join(' ')
  const loadedData = enrollments.data
  const matching = useMemo(
    () =>
      filterListRows(
        loadedData.map((enrollment) => ({
          enrollment,
          status: enrollment.status,
          target: enrollment.target === 'lead' ? 'lead' : 'contact',
          contactName: enrollment.contactName,
          email: enrollment.email,
          step: outreachCurrentStepLabel(enrollment, steps),
          stopReason: outreachStopLabel(enrollment),
        })),
        ENROLLMENT_FILTER_FIELDS,
        gridFilter.clauses,
        { paths: ENROLLMENT_SEARCH_FIELDS, words: gridFilter.searchWords },
      ).map((row) => row.enrollment),
    // `searchKey` stands for the words, which are a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedData, steps, gridFilter.clauses, searchKey],
  )
  // A narrowed list starts again at its first page.
  useEffect(() => setPage(0), [gridFilter.clauses, searchKey])

  const act = async (
    enrollment: OutreachEnrollment,
    action: OutreachEnrollmentAction,
    why?: string,
  ) => {
    setBusy(enrollment.id)
    try {
      const answer = await api.actOnEnrollment(enrollment.id, action, why)
      const others = answer.stoppedOthers
      enqueueSnackbar(
        action === 'do_not_contact'
          ? `Marked do-not-contact${others ? `, and stopped in ${others} other ${others === 1 ? 'sequence' : 'sequences'}` : ''}.`
          : answer.changed
            ? DONE_LABELS[action]
            : 'Nothing to change.',
        { variant: 'success' },
      )
    } catch (error) {
      enqueueSnackbar((error as Error).message, {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(null)
    }
  }

  const choose = (
    enrollment: OutreachEnrollment,
    action: RowAction,
  ) => {
    if (action === 'curate') {
      setCurating(enrollment)
    } else if (CONFIRM[action]) {
      setDetail('')
      setConfirming({ enrollment, action })
    } else {
      void act(enrollment, action)
    }
  }

  if (enrollments.status === 'loading')
    return <OutreachLoading label="Loading enrollments…" />
  if (enrollments.status === 'error' || enrollments.status === 'refused') {
    return (
      <OutreachLoadProblem status={enrollments.status} what="enrollments" />
    )
  }
  if (!enrollments.data.length) {
    return (
      <Card variant="outlined">
        <EmptyStateComponent
          label="Nobody is enrolled yet"
          description="People you enroll show here, with where each of them is in the sequence."
          action={props.enrollAction}
        />
      </Card>
    )
  }

  const rowActions = (enrollment: OutreachEnrollment) => (
    <ListRowActions
      label={enrollment.contactName || enrollment.email}
      items={actionsFor(enrollment, steps).map((action) => ({
        key: action,
        label: ACTION_LABELS[action],
        onClick: () => choose(enrollment, action),
        destructive: action === 'stop' || action === 'do_not_contact',
        disabled: busy === enrollment.id,
      }))}
    />
  )
  const nextSend = (enrollment: OutreachEnrollment) =>
    enrollment.status === 'active' || enrollment.status === 'paused'
      ? formatOutreachTime(enrollment.nextDueAtMs, timeZone)
      : '—'
  const person = (enrollment: OutreachEnrollment) => (
    <Stack spacing={0}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <Typography variant="body2">
          {enrollment.contactName || enrollment.email}
        </Typography>
        {enrollment.target === 'lead' ? (
          <Chip size="small" variant="outlined" label="Lead" />
        ) : null}
      </Stack>
      {enrollment.contactName ? (
        <Typography variant="caption" color="text.secondary">
          {enrollment.email}
        </Typography>
      ) : null}
    </Stack>
  )

  const loaded = matching
  const pageRows = loaded.slice(page * pageSize, (page + 1) * pageSize)
  const lastLoadedPage = Math.max(0, Math.ceil(loaded.length / pageSize) - 1)
  /** Past the rows read so far, the next page reads another window first. */
  const turnTo = (next: number) => {
    if ((next + 1) * pageSize > loaded.length && enrollments.hasMore)
      enrollments.showMore()
    setPage(next)
  }

  return (
    <Stack spacing={1.5}>
      <ListFilterChips
        fields={ENROLLMENT_FILTER_FIELDS}
        headers={ENROLLMENT_FILTER_HEADERS}
        clauses={gridFilter.clauses}
        onChange={gridFilter.setClauses}
        options={ENROLLMENT_FILTER_OPTIONS}
      />
      {filtering && enrollments.hasMore ? (
        <Typography variant="caption" color="text.secondary">
          {`Filtering the ${enrollments.data.length} enrollments read so far — the next page reads more.`}
        </Typography>
      ) : null}
      {narrow ? (
        <Stack
          spacing={1}
          component="ul"
          sx={{ listStyle: 'none', p: 0, m: 0 }}
          aria-label="Enrollments"
        >
          {pageRows.map((enrollment) => (
            <Card key={enrollment.id} variant="outlined" component="li">
              <CardContent>
                <Stack spacing={1}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'flex-start' }}
                  >
                    <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                      {person(enrollment)}
                    </Stack>
                    <OutreachEnrollmentStatusChip status={enrollment.status} />
                    {rowActions(enrollment)}
                  </Stack>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      {outreachCurrentStepLabel(enrollment, steps)}
                    </Typography>
                    {outreachStepIsCurated(enrollment) ? (
                      <Chip size="small" variant="outlined" color="success" label="Curated" />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {`Next send: ${nextSend(enrollment)} · Last activity: ${formatOutreachTime(lastActivityMs(enrollment), timeZone)}`}
                  </Typography>
                  {trackClicks && readOutreachEngagement(enrollment.engagement).clicks ? (
                    <Typography variant="body2" color="text.secondary">
                      {`Clicked ${readOutreachEngagement(enrollment.engagement).clicks} ${
                        readOutreachEngagement(enrollment.engagement).clicks === 1 ? 'time' : 'times'
                      }`}
                    </Typography>
                  ) : null}
                  {outreachStopLabel(enrollment) ? (
                    <Typography variant="body2" color="text.secondary">
                      {outreachStopLabel(enrollment)}
                    </Typography>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : (
        <ListTable
          aria-label="Enrollments"
          columns={listFilterGridColumns(
            columns(rowActions, trackClicks),
            ENROLLMENT_FILTER_FIELDS,
            ENROLLMENT_FILTER_OPTIONS,
            ENROLLMENT_FILTER_HEADERS,
          )}
          initialState={{ columns: { columnVisibilityModel: ENROLLMENT_HIDDEN_COLUMNS } }}
          rows={pageRows.map((enrollment) => ({
            $id: enrollment.id,
            enrollment,
            status: enrollment.status,
            target: enrollment.target === 'lead' ? 'lead' : 'contact',
            contactName: enrollment.contactName,
            email: enrollment.email,
            step: outreachCurrentStepLabel(enrollment, steps),
            nextSend: nextSend(enrollment),
            lastActivity: formatOutreachTime(
              lastActivityMs(enrollment),
              timeZone,
            ),
            stopReason: outreachStopLabel(enrollment) || '—',
          }))}
          /*
           * The panel and the search are the grid's; the table answers them
           * over the enrollments it read (AGL-3317).
           */
          filterMode="server"
          filterModel={gridFilter.filterModel}
          onFilterModelChange={gridFilter.onFilterModelChange}
          quickFilter
          noRowsLabel="No enrollments match these filters"
          hideFooter
        />
      )}
      <ListPagination
        page={page}
        pageSize={pageSize}
        rowCount={pageRows.length}
        count={enrollments.hasMore ? undefined : loaded.length}
        hasMore={enrollments.hasMore || page < lastLoadedPage}
        onPageChange={turnTo}
        onPageSizeChange={setPageSize}
      />

      <OutreachCurateStepDialog
        enrollment={curating}
        steps={steps}
        api={api}
        onClose={() => setCurating(null)}
      />

      <Dialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        fullWidth
        maxWidth="xs"
      >
        {confirming ? (
          <>
            <DialogTitle>{CONFIRM[confirming.action]?.title}</DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                <DialogContentText>
                  {CONFIRM[confirming.action]?.body}
                </DialogContentText>
                <TextField
                  label="Why (optional)"
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => {
                  const { enrollment, action } = confirming
                  setConfirming(null)
                  void act(enrollment, action, detail.trim() || undefined)
                }}
              >
                {CONFIRM[confirming.action]?.label}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </Stack>
  )
}
OutreachEnrollmentsTable.displayName = 'OutreachEnrollmentsTable'

export default OutreachEnrollmentsTable
