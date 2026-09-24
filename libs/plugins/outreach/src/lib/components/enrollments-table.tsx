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
import { hiddenFilterVisibility, type ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  filterListRows,
  inMemoryListField,
  listFilterGridColumns,
  type ListFilterClause,
  type ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import {
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  outreachClickCountLabel,
  outreachClickSummary,
  type OutreachClickSummary,
} from '../model/enrollment-engagement'
import {
  OUTREACH_ENROLLMENT_STATUSES,
  OUTREACH_TASK_KIND_LABELS,
  type OutreachEnrollment,
  type OutreachSequenceStep,
} from '../model/outreach.types'
import { useOutreachEnrollmentActions } from './enrollment-actions'
import { OUTREACH_CLICKED_FILTER_VALUE } from './enrollment-filter-params'
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
  /**
   * Opens one person's page (AGL-3332): a row's click, Enter on a focused
   * row, or the name on a phone's card. The row's menu never opens it.
   */
  onOpen?: (enrollment: OutreachEnrollment) => void
  /** The person's page, for the name on a phone's card, which is a real link. */
  hrefFor?: (enrollment: OutreachEnrollment) => string
  /**
   * The clauses the table is narrowed by, when the page holds them — so the
   * Results card's "Clicked" and "Links followed" can set one (AGL-3332).
   * Omitted, the table holds its own.
   */
  clauses?: readonly ListFilterClause[]
  onClausesChange?: (clauses: ListFilterClause[]) => void
  /** Destinations the sequence's links went to, for the "Link followed" filter's choices. */
  linkOptions?: readonly ListFilterOption[]
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

/** Whether the step the enrollment is on goes out as this person's own copy (AGL-3324). */
export function outreachStepIsCurated(
  enrollment: Pick<OutreachEnrollment, 'stepIndex' | 'stepOverrides'>,
): boolean {
  return Boolean(enrollment.stepOverrides?.[String(enrollment.stepIndex)])
}

/*
 * What the enrollments grid's Filters panel offers (AGL-3317). Status and
 * whether the person is a lead are picked; the name, the address and the
 * stop reason are typed. `target` and `email` are no column of their own,
 * so they are hidden columns the panel can still reach.
 *
 * A sequence that counts clicks adds two more (AGL-3332): whether the person
 * clicked, and a destination they followed — each of their destinations
 * matched whole, never by a piece of its address, so "followed /pricing"
 * does not also list the people who followed "/pricing/enterprise".
 */
const BASE_FILTER_FIELDS: ListFilterField[] = [
  inMemoryListField('status', 'select'),
  inMemoryListField('target', 'select'),
  inMemoryListField('contactName', 'text'),
  inMemoryListField('email', 'text'),
  inMemoryListField('stopReason', 'text'),
]
const CLICK_FILTER_FIELDS: ListFilterField[] = [
  inMemoryListField('clicked', 'select'),
  { ...inMemoryListField('link', 'select'), tokensPath: 'link', verbatimTokens: true },
]
const ENROLLMENT_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
  target: 'Enrolled as',
  contactName: 'Name',
  email: 'Email',
  stopReason: 'Stop reason',
  clicked: 'Clicked',
  link: 'Link followed',
}
const BASE_FILTER_OPTIONS: Record<string, readonly ListFilterOption[]> = {
  status: OUTREACH_ENROLLMENT_STATUSES.map((status) => ({
    value: status,
    label: OUTREACH_ENROLLMENT_STATUS_LABELS[status],
  })),
  target: [
    { value: 'contact', label: 'Contact' },
    { value: 'lead', label: 'Lead' },
  ],
}
const CLICKED_OPTIONS: readonly ListFilterOption[] = [
  { value: OUTREACH_CLICKED_FILTER_VALUE, label: 'Yes' },
  { value: 'no', label: 'No' },
]
/** What the quick search reads on an enrollment row. */
const ENROLLMENT_SEARCH_FIELDS = ['contactName', 'email', 'step', 'stopReason'] as const
/** Columns a reader can show from the column chooser, off until they do (AGL-3332). */
const CLICK_DETAIL_COLUMNS = ['linksFollowed', 'lastClick', 'scannerClicks'] as const

/** The table's grammar, with the click fields when the sequence counts clicks. */
function filterFieldsFor(trackClicks: boolean): ListFilterField[] {
  return trackClicks ? [...BASE_FILTER_FIELDS, ...CLICK_FILTER_FIELDS] : BASE_FILTER_FIELDS
}

/** What the panel, the chips and `filterListRows` read off one enrollment. */
function filterRow(
  enrollment: OutreachEnrollment,
  steps: readonly OutreachSequenceStep[],
  clicks: OutreachClickSummary,
) {
  return {
    enrollment,
    status: enrollment.status,
    target: enrollment.target === 'lead' ? 'lead' : 'contact',
    contactName: enrollment.contactName,
    email: enrollment.email,
    step: outreachCurrentStepLabel(enrollment, steps),
    stopReason: outreachStopLabel(enrollment),
    clicked: clicks.clicks > 0 ? OUTREACH_CLICKED_FILTER_VALUE : 'no',
    link: clicks.followed,
  }
}

/** The stop reason: its short label, with every word of it on hover and on the person's page. */
function StopReasonCell(props: { enrollment: OutreachEnrollment }) {
  const { enrollment } = props
  if (!enrollment.stopReason) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    )
  }
  const label = OUTREACH_STOP_REASON_LABELS[enrollment.stopReason] ?? ''
  const text = (
    <Typography
      variant="body2"
      sx={{
        whiteSpace: 'normal',
        lineHeight: 1.3,
        ...(enrollment.stopDetail
          ? { textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'help' }
          : {}),
      }}
    >
      {label}
    </Typography>
  )
  return enrollment.stopDetail ? (
    <Tooltip title={outreachStopLabel(enrollment)} describeChild>
      {text}
    </Tooltip>
  ) : (
    text
  )
}

/** The table's columns; the person and the actions are drawn from the row's enrollment. */
function columns(
  rowActions: (enrollment: OutreachEnrollment) => ReactNode,
  trackClicks: boolean,
): NonNullable<ListTableProps['columns']> {
  return [
    {
      field: 'person',
      headerName: 'Person',
      flex: 1.2,
      minWidth: 190,
      sortable: false,
      // What the export writes for a column that is drawn rather than read.
      valueGetter: (_value: unknown, row: { enrollment: OutreachEnrollment }) =>
        row.enrollment.contactName
          ? `${row.enrollment.contactName} <${row.enrollment.email}>`
          : row.enrollment.email,
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
      width: 110,
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
    { field: 'nextSend', headerName: 'Next send', width: 170, sortable: false },
    {
      field: 'lastActivity',
      headerName: 'Last activity',
      width: 170,
      sortable: false,
    },
    ...(trackClicks
      ? [
          {
            field: 'clicks',
            headerName: 'Clicks',
            description: 'A person’s clicks, and how many different links they followed. Scanners are not counted.',
            width: 110,
            sortable: false,
            renderCell: ({ row }: { row: { clicks: string } }) => (
              <Typography variant="body2" color={row.clicks === '—' ? 'text.secondary' : undefined}>
                {row.clicks}
              </Typography>
            ),
          },
          {
            field: 'linksFollowed',
            headerName: 'Links followed',
            flex: 1,
            minWidth: 220,
            sortable: false,
          },
          { field: 'lastClick', headerName: 'Last click', width: 170, sortable: false },
          {
            field: 'scannerClicks',
            headerName: 'Scanner clicks',
            description: 'Clicks a security scanner made, which are not counted as the person’s.',
            width: 130,
            sortable: false,
          },
        ]
      : []),
    {
      field: 'stopReason',
      headerName: 'Stop reason',
      flex: 1,
      minWidth: 170,
      renderCell: ({ row }) => <StopReasonCell enrollment={row.enrollment} />,
    },
    listActionsColumn((row) => rowActions(row.enrollment), { width: 72 }),
  ]
}

/** A plain click on a link, which the page handles itself; any other is the browser's. */
const plainClick = (event: MouseEvent) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey

/**
 * A sequence's enrollments (AGL-2980): who is in it, where each person
 * stands, when their next step goes out in the mailbox's timezone, and the
 * four things a member can do about it — pause, resume, stop, and mark
 * do-not-contact. A table on wider screens, a list of cards on a phone.
 *
 * Each row opens the person's own page (AGL-3332), which holds everything
 * else known about them: so a cell says one thing, whole, and the detail
 * behind it is a click away rather than cut off at the column's edge.
 */
export function OutreachEnrollmentsTable(props: OutreachEnrollmentsTableProps) {
  const { enrollments, steps, timeZone, api, onOpen, hrefFor } = props
  const trackClicks = props.trackClicks === true
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const actions = useOutreachEnrollmentActions({ api, steps })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const fields = useMemo(() => filterFieldsFor(trackClicks), [trackClicks])
  const gridFilter = useListGridFilter({
    selectFields: ['status', 'target', 'clicked', 'link'],
    ...(props.clauses !== undefined
      ? { clauses: props.clauses, onChange: props.onClausesChange }
      : {}),
  })
  const filtering = gridFilter.clauses.length > 0 || gridFilter.searchWords.length > 0
  /*
   * The rows the grid is handed, every clause and the search answered over
   * the enrollments read so far — a window that grows as the reader pages
   * past it, so a filter reaches further the further they go.
   */
  const searchKey = gridFilter.searchWords.join(' ')
  const loadedData = enrollments.data
  const summaries = useMemo(
    () =>
      new Map(
        loadedData.map((enrollment) => [enrollment.id, outreachClickSummary(enrollment.engagement)]),
      ),
    [loadedData],
  )
  const clicksOf = (enrollment: OutreachEnrollment) =>
    summaries.get(enrollment.id) ?? outreachClickSummary(enrollment.engagement)
  const matching = useMemo(
    () =>
      filterListRows(
        loadedData.map((enrollment) => filterRow(enrollment, steps, clicksOf(enrollment))),
        fields,
        gridFilter.clauses,
        { paths: ENROLLMENT_SEARCH_FIELDS, words: gridFilter.searchWords },
      ).map((row) => row.enrollment),
    // `searchKey` stands for the words, which are a new array each render;
    // `summaries` for `clicksOf`, which reads nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedData, summaries, steps, fields, gridFilter.clauses, searchKey],
  )
  // A narrowed list starts again at its first page.
  useEffect(() => setPage(0), [gridFilter.clauses, searchKey])

  /*
   * The destinations the "Link followed" filter offers: the sequence's own
   * rollup, and any a loaded person followed that it does not list — the
   * rollup is capped, and a filter that could not name a destination a
   * person followed would hide them from it.
   */
  const linkOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const option of props.linkOptions ?? []) options.set(option.value, option.label)
    for (const summary of summaries.values()) {
      for (const url of summary.followed) if (!options.has(url)) options.set(url, url)
    }
    return [...options].map(([value, label]) => ({ value, label }))
  }, [props.linkOptions, summaries])
  const filterOptions = useMemo(
    () =>
      trackClicks
        ? { ...BASE_FILTER_OPTIONS, clicked: CLICKED_OPTIONS, link: linkOptions }
        : BASE_FILTER_OPTIONS,
    [trackClicks, linkOptions],
  )
  const hiddenColumns = useMemo(
    () => ({
      ...hiddenFilterVisibility(fields, ['status', 'stopReason']),
      ...(trackClicks
        ? Object.fromEntries(CLICK_DETAIL_COLUMNS.map((column) => [column, false]))
        : {}),
    }),
    [fields, trackClicks],
  )
  /*
   * A person who followed this destination before each click was recorded
   * on its own, and another link after it, is known by their LAST link only
   * — so a "Link followed" filter says it may miss them rather than
   * implying the list is whole.
   */
  const linkFilterMayMiss =
    trackClicks &&
    gridFilter.clauses.some((clause) => clause.field === 'link') &&
    [...summaries.values()].some((summary) => summary.linkCount === null)

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
      items={actions.menuItems(enrollment)}
    />
  )
  const nextSend = (enrollment: OutreachEnrollment) =>
    enrollment.status === 'active' || enrollment.status === 'paused'
      ? formatOutreachTime(enrollment.nextDueAtMs, timeZone)
      : '—'
  const personName = (enrollment: OutreachEnrollment) => {
    const name = enrollment.contactName || enrollment.email
    if (!hrefFor) return <Typography variant="body2">{name}</Typography>
    return (
      <Link
        href={hrefFor(enrollment)}
        variant="body2"
        underline="hover"
        onClick={(event) => {
          if (!onOpen || !plainClick(event)) return
          event.preventDefault()
          onOpen(enrollment)
        }}
      >
        {name}
      </Link>
    )
  }
  const person = (enrollment: OutreachEnrollment) => (
    <Stack spacing={0}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        {personName(enrollment)}
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
        fields={fields}
        headers={ENROLLMENT_FILTER_HEADERS}
        clauses={gridFilter.clauses}
        onChange={gridFilter.setClauses}
        options={filterOptions}
      />
      {filtering && enrollments.hasMore ? (
        <Typography variant="caption" color="text.secondary">
          {`Filtering the ${enrollments.data.length} enrollments read so far — the next page reads more.`}
        </Typography>
      ) : null}
      {linkFilterMayMiss ? (
        <Typography variant="caption" color="text.secondary">
          Clicks made before each one was recorded on its own kept only the person’s last link, so
          someone who followed this link and then another back then is not listed here.
        </Typography>
      ) : null}
      {narrow ? (
        <Stack
          spacing={1}
          component="ul"
          sx={{ listStyle: 'none', p: 0, m: 0 }}
          aria-label="Enrollments"
        >
          {pageRows.map((enrollment) => {
            const clicks = clicksOf(enrollment)
            return (
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
                    {trackClicks && clicks.clicks ? (
                      <Typography variant="body2" color="text.secondary">
                        {`Clicks: ${outreachClickCountLabel(clicks)}`}
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
            )
          })}
        </Stack>
      ) : (
        <ListTable
          aria-label="Enrollments"
          columns={listFilterGridColumns(
            columns(rowActions, trackClicks),
            fields,
            filterOptions,
            ENROLLMENT_FILTER_HEADERS,
          )}
          initialState={{ columns: { columnVisibilityModel: hiddenColumns } }}
          rows={pageRows.map((enrollment) => {
            const clicks = clicksOf(enrollment)
            return {
              $id: enrollment.id,
              ...filterRow(enrollment, steps, clicks),
              nextSend: nextSend(enrollment),
              lastActivity: formatOutreachTime(
                lastActivityMs(enrollment),
                timeZone,
              ),
              // What the export writes; the cells draw these their own way.
              clicks: outreachClickCountLabel(clicks),
              linksFollowed: clicks.followed.join(' ') || '—',
              lastClick: clicks.clicks
                ? formatOutreachTime(enrollment.engagement?.lastClickAtMs, timeZone)
                : '—',
              scannerClicks: clicks.machineClicks ? String(clicks.machineClicks) : '—',
              stopReason: outreachStopLabel(enrollment) || '—',
            }
          })}
          onOpen={
            onOpen
              ? (_id, row: { enrollment: OutreachEnrollment }) => onOpen(row.enrollment)
              : undefined
          }
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
      {actions.dialogs}
    </Stack>
  )
}
OutreachEnrollmentsTable.displayName = 'OutreachEnrollmentsTable'

export default OutreachEnrollmentsTable
