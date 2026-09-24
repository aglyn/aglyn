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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { mdiTrashCanOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListTable,
  listActionsColumn,
  type ListTableProps,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  filterListRows,
  inMemoryListField,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, Chip, IconButton, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { normalizeOutreachDomain } from '../engine/do-not-contact-domain'
import {
  OUTREACH_DO_NOT_CONTACT_REASONS,
  type OutreachDoNotContactDomainEntry,
  type OutreachDoNotContactReason,
} from '../model/outreach.types'
import { OutreachLoading, OutreachLoadProblem } from './outreach-ui'
import { useOutreachApi } from './use-outreach-api'
import { useOutreachDoNotContactDomains } from './use-outreach-data'

export interface OutreachDoNotContactDomainsCardProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
}

/** Why a domain is on the list, as the card says it. */
export const OUTREACH_DO_NOT_CONTACT_REASON_LABELS: Record<OutreachDoNotContactReason, string> = {
  manual: 'Added by a member',
  opt_out_reply: 'A reply asked not to be emailed',
  unsubscribe: 'Unsubscribed',
  hard_bounce: 'Mail bounced',
  gateway_block: 'Its mail gateway blocked the sender',
}

/** Accessible names of the card's controls, spelled once for the specs. */
export const DO_NOT_CONTACT_DOMAIN_LABELS = {
  field: 'Domain',
  add: 'Add domain',
  remove: (domain: string) => `Remove ${domain}`,
} as const

/** What the field says under a value that is not a domain. */
export const DO_NOT_CONTACT_DOMAIN_HINT = 'A domain, such as example.com. Every address at it is refused.'

/*
 * What the domains grid's Filters panel offers (AGL-3317). The card reads
 * every listed domain, so the panel and the search answer over all of them.
 */
const DOMAIN_FILTER_FIELDS = [
  inMemoryListField('domain', 'text'),
  inMemoryListField('reason', 'select'),
  inMemoryListField('detail', 'text'),
]
const DOMAIN_FILTER_HEADERS: Readonly<Record<string, string>> = {
  domain: 'Domain',
  reason: 'Why',
  detail: 'Detail',
}
const DOMAIN_FILTER_OPTIONS = {
  reason: OUTREACH_DO_NOT_CONTACT_REASONS.map((reason) => ({
    value: reason,
    label: OUTREACH_DO_NOT_CONTACT_REASON_LABELS[reason],
  })),
}
/** What the quick search reads on a domain row. */
const DOMAIN_SEARCH_FIELDS = ['domain', 'detail'] as const

function addedOn(entry: OutreachDoNotContactDomainEntry): string {
  if (!entry.addedAtMs) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(entry.addedAtMs)
}

/** The grid's columns; the remove button names its domain for a screen reader. */
function domainColumns(
  busy: boolean,
  remove: (domain: string) => void,
): NonNullable<ListTableProps['columns']> {
  return listFilterGridColumns(
    [
      {
        field: 'domain',
        headerName: 'Domain',
        flex: 1,
        minWidth: 160,
        renderCell: ({ row }) => (
          <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>
            {row.domain}
          </Typography>
        ),
      },
      {
        field: 'reason',
        headerName: 'Why',
        flex: 1,
        minWidth: 200,
        renderCell: ({ row }) => (
          <Chip
            size="small"
            variant="outlined"
            color={row.reason === 'gateway_block' ? 'warning' : 'default'}
            label={
              OUTREACH_DO_NOT_CONTACT_REASON_LABELS[row.reason as OutreachDoNotContactReason] ??
              row.reason
            }
          />
        ),
      },
      {
        field: 'addedAtMs',
        headerName: 'Added',
        width: 140,
        renderCell: ({ row }) => row.added,
      },
      { field: 'detail', headerName: 'Detail', flex: 1, minWidth: 160 },
      listActionsColumn(
        (row) => (
          <IconButton
            size="small"
            aria-label={DO_NOT_CONTACT_DOMAIN_LABELS.remove(row.domain)}
            disabled={busy}
            onClick={() => remove(row.domain)}
          >
            <MdiIcon path={mdiTrashCanOutline.path} fontSize="small" />
          </IconButton>
        ),
        { width: 72 },
      ),
    ],
    DOMAIN_FILTER_FIELDS,
    DOMAIN_FILTER_OPTIONS,
    DOMAIN_FILTER_HEADERS,
  )
}

/**
 * Sequences → Compliance → Do not contact domains (AGL-3244): the domains no
 * sequence emails anyone at, whoever enrolls them.
 *
 * A member adds one by hand — a company that asked, or one whose gateway is
 * known to block cold mail — and the sending runtime adds one when a hard
 * bounce reads as the domain's gateway refusing the sender. Either way it
 * is listed here with why, and a member takes it off by name.
 */
export function OutreachDoNotContactDomainsCard(props: OutreachDoNotContactDomainsCardProps) {
  const { orgId } = props
  const api = useOutreachApi(orgId)
  const listed = useOutreachDoNotContactDomains(orgId)
  const { enqueueSnackbar } = useSnackbar()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const normalized = normalizeOutreachDomain(draft)
  const invalid = draft.trim() !== '' && normalized === null
  const gridFilter = useListGridFilter({ selectFields: ['reason'] })
  const searchKey = gridFilter.searchWords.join(' ')
  const rows = useMemo(
    () =>
      filterListRows(
        listed.data.map((entry) => ({
          $id: entry.domain,
          domain: entry.domain,
          reason: entry.reason,
          added: addedOn(entry),
          addedAtMs: entry.addedAtMs ?? 0,
          detail: entry.detail ?? '',
        })),
        DOMAIN_FILTER_FIELDS,
        gridFilter.clauses,
        { paths: DOMAIN_SEARCH_FIELDS, words: gridFilter.searchWords },
      ),
    // `searchKey` stands for the words, which are a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listed.data, gridFilter.clauses, searchKey],
  )

  const change = async (action: 'add' | 'remove', domain: string) => {
    setBusy(domain)
    try {
      const answer = await api.changeDoNotContactDomain(action, domain)
      if (action === 'add') setDraft('')
      enqueueSnackbar(
        answer.changed
          ? action === 'add'
            ? `${answer.domain} is on the do-not-contact list.`
            : `${answer.domain} is off the do-not-contact list.`
          : action === 'add'
            ? `${answer.domain} was already on the list.`
            : `${answer.domain} was not on the list.`,
        { variant: answer.changed ? 'success' : 'info' },
      )
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <CardDisplay
      header="Do not contact domains"
      help={pluginDocsHelp('sequences', { anchor: '#do-not-contact-domains' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'No sequence emails anyone at these domains, whoever enrolls them. Add a company that asked not ' +
            'to hear from you, or one whose mail gateway blocks you. When an email bounces because the ' +
            'recipient’s gateway refused it — rather than because the address is unknown — the domain is ' +
            'added here automatically, so the next person at that company is not tried.'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            label={DO_NOT_CONTACT_DOMAIN_LABELS.field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && normalized && !busy) {
                event.preventDefault()
                void change('add', normalized)
              }
            }}
            error={invalid}
            helperText={invalid ? 'That is not a domain.' : DO_NOT_CONTACT_DOMAIN_HINT}
            size="small"
            sx={{ flexGrow: 1 }}
          />
          <Button
            variant="outlined"
            disabled={!normalized || busy !== null}
            onClick={() => normalized && void change('add', normalized)}
          >
            {DO_NOT_CONTACT_DOMAIN_LABELS.add}
          </Button>
        </Stack>
        {listed.status === 'loading' ? (
          <OutreachLoading label="Loading domains…" />
        ) : listed.status === 'error' || listed.status === 'refused' ? (
          <OutreachLoadProblem status={listed.status} what="the do-not-contact domains" />
        ) : listed.data.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No domains yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            <ListFilterChips
              fields={DOMAIN_FILTER_FIELDS}
              headers={DOMAIN_FILTER_HEADERS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
              options={DOMAIN_FILTER_OPTIONS}
            />
            <ListTable
              aria-label="Do not contact domains"
              columns={domainColumns(busy !== null, (domain) => void change('remove', domain))}
              rows={rows}
              /*
               * The panel and the search are the grid's; the card answers
               * them over every listed domain (AGL-3317).
               */
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              quickFilter
              noRowsLabel="No domains match these filters"
            />
          </Stack>
        )}
      </Stack>
    </CardDisplay>
  )
}
OutreachDoNotContactDomainsCard.displayName = 'OutreachDoNotContactDomainsCard'

export default OutreachDoNotContactDomainsCard
