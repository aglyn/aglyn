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

import { pluginDocsHelp, type ConsolePluginOrgMount } from '@aglyn/aglyn'
import { mdiPlus } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListTable,
  type ListTableProps,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import {
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useMemo } from 'react'
import {
  OUTREACH_SEQUENCE_STATUSES,
  type OutreachMailbox,
  type OutreachSequence,
} from '../model/outreach.types'
import { OUTREACH_SEQUENCE_LIST_QUERY } from '../model/sequence-list-query'
import {
  OUTREACH_SEQUENCE_STATUS_LABELS,
  OutreachLink,
  OutreachLoading,
  OutreachLoadProblem,
  OutreachSequenceStatusChip,
  useOutreachNavigate,
} from './outreach-ui'
import {
  OutreachSequenceDetail,
  type OutreachSequenceTab,
} from './sequence-detail'
import { OutreachSequenceEditor } from './sequence-editor'
import { useOutreachApi } from './use-outreach-api'
import {
  type OutreachSequenceCounts,
  useOutreachSequenceCounts,
  useOutreachSequenceList,
} from './use-outreach-data'
import { useOutreachMailboxes } from './use-outreach-mailboxes'
import { useOutreachComplianceSettings } from './use-outreach-settings'

export interface OutreachSequencesSectionProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
  orgMount?: ConsolePluginOrgMount
  org?: Record<string, unknown> | null
  /** The section's own path: `/[orgSlug]/outreach/sequences`. */
  sectionPath: string
  /** The path below the section: `[]`, `['new']`, `[id]` or `[id, 'enrollments']`. */
  subpath: readonly string[]
  /** The Mailboxes section: `/[orgSlug]/outreach/mailboxes`. */
  mailboxesPath: string
  /** The Compliance section: `/[orgSlug]/outreach/compliance`. */
  compliancePath: string
}

/** The new-sequence page's segment below the section. */
export const OUTREACH_NEW_SEQUENCE_SEGMENT = 'new'

/**
 * The Sequences section (AGL-2980), and the pages below it: the list, a new
 * sequence, and one sequence's steps and enrollments. Each is a real URL, so
 * a sequence is a link a rep can keep and the back button walks them.
 */
export function OutreachSequencesSection(props: OutreachSequencesSectionProps) {
  const { orgId, sectionPath, subpath } = props
  const api = useOutreachApi(orgId)
  const settings = useOutreachComplianceSettings(api, orgId)
  const mailboxes = useOutreachMailboxes(orgId)
  const navigate = useOutreachNavigate()

  if (!orgId) return <OutreachLoading label="Loading sequences…" />
  const [first, second] = subpath
  if (first === OUTREACH_NEW_SEQUENCE_SEGMENT) {
    return (
      <Stack spacing={2}>
        <OutreachLink href={sectionPath}>Sequences</OutreachLink>
        <Typography variant="h5" component="h2">
          New sequence
        </Typography>
        <OutreachSequenceEditor
          orgId={orgId}
          orgMount={props.orgMount}
          sequence={null}
          settings={settings}
          mailboxes={mailboxes}
          mailboxesPath={props.mailboxesPath}
          onSaved={(sequence) => navigate(`${sectionPath}/${sequence.id}`)}
          onCancel={() => navigate(sectionPath)}
        />
      </Stack>
    )
  }
  if (first) {
    return (
      <OutreachSequenceDetail
        orgId={orgId}
        orgMount={props.orgMount}
        org={props.org}
        sectionPath={sectionPath}
        sequenceId={first}
        tab={
          (second === 'enrollments'
            ? 'enrollments'
            : 'steps') as OutreachSequenceTab
        }
        settings={settings}
        mailboxes={mailboxes}
        mailboxesPath={props.mailboxesPath}
        compliancePath={props.compliancePath}
      />
    )
  }
  return (
    <OutreachSequenceList
      orgId={orgId}
      sectionPath={sectionPath}
      mailboxes={mailboxes.mailboxes}
    />
  )
}
OutreachSequencesSection.displayName = 'OutreachSequencesSection'

const COUNT_COLUMNS: ReadonlyArray<[keyof OutreachSequenceCounts, string]> = [
  ['enrolled', 'Enrolled'],
  ['active', 'Active'],
  ['replied', 'Replied'],
  ['bounced', 'Bounced'],
  ['optedOut', 'Opted out'],
]

/*
 * What the sequences grid's Filters panel offers (AGL-3317), each field on
 * the list's Firestore query (AGL-3321, `OUTREACH_SEQUENCE_LIST_QUERY`).
 */
const SEQUENCE_FILTER_FIELDS = OUTREACH_SEQUENCE_LIST_QUERY.fields
const SEQUENCE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Name',
  mailbox: 'Mailbox',
  status: 'Status',
  created: 'Created',
}
/** `created` is no column of its own: a filter-only column, never shown. */
const SEQUENCE_HIDDEN_COLUMNS = hiddenFilterVisibility(SEQUENCE_FILTER_FIELDS, [
  'name',
  'mailbox',
  'status',
])
const SEQUENCE_STATUS_OPTIONS = OUTREACH_SEQUENCE_STATUSES.map((status) => ({
  value: status,
  label: OUTREACH_SEQUENCE_STATUS_LABELS[status],
}))

/** How a mailbox reads in the list: the address it sends as. */
const mailboxName = (mailbox: OutreachMailbox) => mailbox.sendAs || mailbox.email

/**
 * Every sequence: its mailbox, its status, and how many people it enrolled
 * and where they stand — a table on wider screens, cards on a phone.
 *
 * ## Asked of Firestore, a page at a time
 *
 * The Filters panel and the search box are the grid's; the clauses and the
 * words go onto ONE query over the organization's sequences, newest first,
 * and each page is a page of that query's matches (AGL-3321). A clause the
 * query cannot hold beside the others is not applied, and the notice above
 * the list says which and why — never answered over the sequences that
 * happen to be loaded.
 */
export function OutreachSequenceList(props: {
  orgId: string
  sectionPath: string
  mailboxes: readonly OutreachMailbox[]
}) {
  const { orgId, sectionPath } = props
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const navigate = useOutreachNavigate()
  const gridFilter = useListGridFilter({ selectFields: ['status', 'mailbox'] })
  const sequences = useOutreachSequenceList(orgId, {
    clauses: gridFilter.clauses,
    search: gridFilter.searchWords,
  })
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())
  const filterOptions = useMemo(
    () => ({
      status: SEQUENCE_STATUS_OPTIONS,
      mailbox: props.mailboxes.map((mailbox) => ({
        value: mailbox.id,
        label: mailboxName(mailbox),
      })),
    }),
    [props.mailboxes],
  )
  const mailboxLabel = (sequence: OutreachSequence) => {
    const mailbox = props.mailboxes.find(
      (entry) => entry.id === sequence.mailboxId,
    )
    return mailbox
      ? mailboxName(mailbox)
      : sequence.mailboxId
        ? 'Mailbox removed'
        : 'No mailbox yet'
  }
  const pageRows = sequences.rows
  // Counted for the page on screen only: five aggregations a sequence.
  const counts = useOutreachSequenceCounts(
    orgId,
    pageRows.map((sequence) => sequence.id),
  )
  const footer = (
    <ListPagination
      page={sequences.page}
      pageSize={sequences.pageSize}
      rowCount={pageRows.length}
      hasMore={sequences.hasMore}
      onPageChange={sequences.setPage}
      onPageSizeChange={sequences.setPageSize}
    />
  )
  const newHref = `${sectionPath}/${OUTREACH_NEW_SEQUENCE_SEGMENT}`
  const newButton = (
    <Button
      variant="contained"
      startIcon={<MdiIcon path={mdiPlus.path} fontSize="small" />}
      href={newHref}
      onClick={(event) => {
        event.preventDefault()
        navigate(newHref)
      }}
    >
      New sequence
    </Button>
  )
  const count = (
    sequence: OutreachSequence,
    key: keyof OutreachSequenceCounts,
  ) => (counts[sequence.id] ? String(counts[sequence.id][key]) : '—')

  const chips = (
    <ListFilterChips
      fields={SEQUENCE_FILTER_FIELDS}
      headers={SEQUENCE_FILTER_HEADERS}
      clauses={gridFilter.clauses}
      onChange={gridFilter.setClauses}
      options={filterOptions}
    />
  )
  const notices = (
    <ListQueryNotices
      refused={listQueryRefusals(sequences.plan.refused, {
        fields: SEQUENCE_FILTER_FIELDS,
        headers: SEQUENCE_FILTER_HEADERS,
        options: filterOptions,
      })}
      notices={sequences.plan.notices}
    />
  )
  /** Nothing stored at all — not a filter that matched nothing. */
  const none =
    sequences.status === 'ready' &&
    !pageRows.length &&
    !filtering &&
    sequences.page === 0
  let body
  if (sequences.status === 'loading' && !filtering)
    body = <OutreachLoading label="Loading sequences…" />
  else if (sequences.status === 'error' || sequences.status === 'refused') {
    body = (
      <Stack spacing={1}>
        {chips}
        <OutreachLoadProblem status={sequences.status} what="sequences" />
      </Stack>
    )
  } else if (none) {
    body = (
      <Card variant="outlined">
        <EmptyStateComponent
          label="No sequences yet"
          description="A sequence is the emails, and the tasks between them, one person gets from one rep."
          action={newButton}
        />
      </Card>
    )
  } else if (narrow) {
    body = (
      <Stack spacing={1}>
        {chips}
        {notices}
        {pageRows.length ? (
          <Stack
            spacing={1}
            component="ul"
            sx={{ listStyle: 'none', p: 0, m: 0 }}
            aria-label="Sequences"
          >
            {pageRows.map((sequence) => (
              <Card key={sequence.id} variant="outlined" component="li">
                <CardContent>
                  <Stack spacing={1}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <OutreachLink href={`${sectionPath}/${sequence.id}`}>
                        {sequence.name || 'Untitled'}
                      </OutreachLink>
                      <OutreachSequenceStatusChip status={sequence.status} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {mailboxLabel(sequence)}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
                    >
                      {COUNT_COLUMNS.map(([key, label]) => (
                        <Chip
                          key={key}
                          size="small"
                          variant="outlined"
                          label={`${label} ${count(sequence, key)}`}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {sequences.status === 'loading'
              ? 'Loading sequences…'
              : 'No sequences match these filters'}
          </Typography>
        )}
        {footer}
      </Stack>
    )
  } else {
    const columns: NonNullable<ListTableProps['columns']> = listFilterGridColumns([
      { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
      { field: 'mailbox', headerName: 'Mailbox', flex: 1, minWidth: 180 },
      {
        field: 'status',
        headerName: 'Status',
        width: 110,
        renderCell: ({ row }) => (
          <OutreachSequenceStatusChip status={row.status} />
        ),
      },
      ...COUNT_COLUMNS.map(([key, label]) => ({
        field: key,
        headerName: label,
        width: 96,
        align: 'right' as const,
        headerAlign: 'right' as const,
      })),
    ], SEQUENCE_FILTER_FIELDS, filterOptions, SEQUENCE_FILTER_HEADERS)
    body = (
      <Stack spacing={1}>
        {chips}
        {notices}
        <ListTable
          aria-label="Sequences"
          columns={columns}
          initialState={{ columns: { columnVisibilityModel: SEQUENCE_HIDDEN_COLUMNS } }}
          rows={pageRows.map((sequence) => ({
            $id: sequence.id,
            name: sequence.name || 'Untitled',
            mailbox: mailboxLabel(sequence),
            status: sequence.status,
            ...Object.fromEntries(
              COUNT_COLUMNS.map(([key]) => [key, count(sequence, key)]),
            ),
          }))}
          onOpen={(id) => navigate(`${sectionPath}/${id}`)}
          loading={sequences.status === 'loading'}
          /*
           * The panel and the search are the grid's; every clause and the
           * search word are on the list's query (AGL-3321), and the grid
           * neither filters nor sorts the page it is handed: the query's
           * one order, newest first, is the list's.
           */
          filterMode="server"
          filterModel={gridFilter.filterModel}
          onFilterModelChange={gridFilter.onFilterModelChange}
          quickFilter
          disableColumnSorting
          noRowsLabel="No sequences match these filters"
          hideFooter
        />
        {footer}
      </Stack>
    )
  }

  return (
    <CardDisplay
      header="Sequences"
      help={pluginDocsHelp('sequences', { anchor: '#sequences' })}
      HeaderProps={{
        action: none || sequences.status === 'loading' ? undefined : newButton,
      }}
      contentGutterX
      contentGutterY
    >
      {body}
    </CardDisplay>
  )
}
OutreachSequenceList.displayName = 'OutreachSequenceList'

export default OutreachSequencesSection
