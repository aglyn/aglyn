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
import {
  filterListRows,
  inMemoryListField,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
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
import { useEffect, useMemo, useState } from 'react'
import {
  OUTREACH_SEQUENCE_STATUSES,
  type OutreachMailbox,
  type OutreachSequence,
} from '../model/outreach.types'
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
  useOutreachSequences,
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
 * What the sequences grid's Filters panel offers (AGL-3317). The list holds
 * every sequence it read, so each clause and the quick search are answered
 * over that whole set before it is paged, never over the page on screen.
 */
const SEQUENCE_FILTER_FIELDS = [
  inMemoryListField('name', 'text'),
  inMemoryListField('mailbox', 'text'),
  inMemoryListField('status', 'select'),
]
const SEQUENCE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Name',
  mailbox: 'Mailbox',
  status: 'Status',
}
const SEQUENCE_FILTER_OPTIONS = {
  status: OUTREACH_SEQUENCE_STATUSES.map((status) => ({
    value: status,
    label: OUTREACH_SEQUENCE_STATUS_LABELS[status],
  })),
}
/** What the quick search reads on a sequence row. */
const SEQUENCE_SEARCH_FIELDS = ['name', 'mailbox'] as const

/**
 * Every sequence: its mailbox, its status, and how many people it enrolled
 * and where they stand — a table on wider screens, cards on a phone.
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
  const sequences = useOutreachSequences(orgId)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const gridFilter = useListGridFilter({ selectFields: ['status'] })
  const mailboxLabel = (sequence: OutreachSequence) => {
    const mailbox = props.mailboxes.find(
      (entry) => entry.id === sequence.mailboxId,
    )
    return mailbox
      ? mailbox.sendAs || mailbox.email
      : sequence.mailboxId
        ? 'Mailbox removed'
        : 'No mailbox yet'
  }
  /*
   * Filtered BEFORE the page is cut: the list read every sequence (under
   * `OUTREACH_SEQUENCES_LIMIT`), so a clause or a search word answers over
   * all of them, and the footer counts the matches.
   */
  const searchKey = gridFilter.searchWords.join(' ')
  const matching = useMemo(
    () =>
      filterListRows(
        sequences.data.map((sequence) => ({
          sequence,
          name: sequence.name || 'Untitled',
          mailbox: mailboxLabel(sequence),
          status: sequence.status,
        })),
        SEQUENCE_FILTER_FIELDS,
        gridFilter.clauses,
        { paths: SEQUENCE_SEARCH_FIELDS, words: gridFilter.searchWords },
      ).map((row) => row.sequence),
    // `searchKey` stands for the words, which are a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sequences.data, props.mailboxes, gridFilter.clauses, searchKey],
  )
  // A narrowed list starts again at its first page.
  useEffect(() => setPage(0), [gridFilter.clauses, searchKey])
  const pageRows = matching.slice(page * pageSize, (page + 1) * pageSize)
  // Counted for the page on screen only: five aggregations a sequence.
  const counts = useOutreachSequenceCounts(
    orgId,
    pageRows.map((sequence) => sequence.id),
  )
  const footer = (
    <ListPagination
      page={page}
      pageSize={pageSize}
      rowCount={pageRows.length}
      count={matching.length}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
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
      options={SEQUENCE_FILTER_OPTIONS}
    />
  )
  let body
  if (sequences.status === 'loading')
    body = <OutreachLoading label="Loading sequences…" />
  else if (sequences.status === 'error' || sequences.status === 'refused') {
    body = <OutreachLoadProblem status={sequences.status} what="sequences" />
  } else if (!sequences.data.length) {
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
    ], SEQUENCE_FILTER_FIELDS, SEQUENCE_FILTER_OPTIONS, SEQUENCE_FILTER_HEADERS)
    body = (
      <Stack spacing={1}>
        {chips}
        <ListTable
          aria-label="Sequences"
          columns={columns}
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
          /*
           * The panel and the search are the grid's; the list answers them
           * over every sequence it read (AGL-3317).
           */
          filterMode="server"
          filterModel={gridFilter.filterModel}
          onFilterModelChange={gridFilter.onFilterModelChange}
          quickFilter
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
        action:
          sequences.status === 'ready' && sequences.data.length
            ? newButton
            : undefined,
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
