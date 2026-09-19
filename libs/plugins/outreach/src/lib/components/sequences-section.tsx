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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListTable,
  type ListTableProps,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
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
import { useState } from 'react'
import type { OutreachMailbox, OutreachSequence } from '../model/outreach.types'
import {
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
  const pageRows = sequences.data.slice(page * pageSize, (page + 1) * pageSize)
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
      count={sequences.data.length}
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
  const count = (
    sequence: OutreachSequence,
    key: keyof OutreachSequenceCounts,
  ) => (counts[sequence.id] ? String(counts[sequence.id][key]) : '—')

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
    const columns: NonNullable<ListTableProps['columns']> = [
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
    ]
    body = (
      <Stack spacing={1}>
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
          quickFilter={false}
          hideFooter
        />
        {footer}
      </Stack>
    )
  }

  return (
    <CardDisplay
      header="Sequences"
      help={pluginDocsHelp('outreach', { anchor: '#sequences' })}
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
