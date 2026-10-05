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

import { pluginDocsHelp, useTransferLauncher } from '@aglyn/aglyn'
import { mdiTrashCanOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListTable,
  listActionsColumn,
  type ListTableProps,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, Chip, IconButton, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY } from '../constants/transfer-resources'
import { normalizeOutreachDomain } from '../engine/do-not-contact-domain'
import { OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY } from '../model/do-not-contact-domain-list-query'
import {
  OUTREACH_DO_NOT_CONTACT_REASON_LABELS,
  OUTREACH_DO_NOT_CONTACT_REASONS,
  type OutreachDoNotContactDomainEntry,
  type OutreachDoNotContactReason,
} from '../model/outreach.types'
import { OutreachLoading, OutreachLoadProblem } from './outreach-ui'
import { useOutreachApi } from './use-outreach-api'
import { useOutreachDoNotContactDomainList } from './use-outreach-data'

export interface OutreachDoNotContactDomainsCardProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
}

/** Why a domain is on the list, as the card says it. */
export { OUTREACH_DO_NOT_CONTACT_REASON_LABELS }

/** Accessible names of the card's controls, spelled once for the specs. */
export const DO_NOT_CONTACT_DOMAIN_LABELS = {
  field: 'Domain',
  add: 'Add domain',
  remove: (domain: string) => `Remove ${domain}`,
  import: 'Import',
  export: 'Export',
} as const

/** What the export dialog calls the list's search and filters. */
export const DO_NOT_CONTACT_EXPORT_FILTER_LABEL = 'The domains matching this list’s search and filters'

/** What the field says under a value that is not a domain. */
export const DO_NOT_CONTACT_DOMAIN_HINT = 'A domain, such as example.com. Every address at it is refused.'

/*
 * What the domains grid's Filters panel offers (AGL-3317), each field on the
 * list's Firestore query (AGL-3321, `OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY`):
 * the whole domain, why it is listed, and when it was added. The search box
 * reads the domain, each of its labels and the words of its detail.
 */
const DOMAIN_FILTER_FIELDS = OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY.fields
const DOMAIN_FILTER_HEADERS: Readonly<Record<string, string>> = {
  domain: 'Domain',
  reason: 'Why',
  addedAtMs: 'Added',
}
const DOMAIN_FILTER_OPTIONS = {
  reason: OUTREACH_DO_NOT_CONTACT_REASONS.map((reason) => ({
    value: reason,
    label: OUTREACH_DO_NOT_CONTACT_REASON_LABELS[reason],
  })),
}

/** The grid toolbar without its page-only CSV and print export. */
const GRID_EXPORT_OFF = {
  toolbar: { csvOptions: { disableToolbarButton: true }, printOptions: { disableToolbarButton: true } },
}

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
  const { enqueueSnackbar } = useSnackbar()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const normalized = normalizeOutreachDomain(draft)
  const invalid = draft.trim() !== '' && normalized === null
  const gridFilter = useListGridFilter({ selectFields: ['reason'] })
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())
  /*
   * One page of the domains, alphabetical, with every clause and the search
   * word on the query (AGL-3321) — never matched over the domains that
   * happen to be loaded.
   */
  const listed = useOutreachDoNotContactDomainList(orgId, {
    clauses: gridFilter.clauses,
    search: gridFilter.searchWords,
  })
  const rows = listed.rows.map((entry) => ({
    $id: entry.domain,
    domain: entry.domain,
    reason: entry.reason,
    added: addedOn(entry),
    addedAtMs: entry.addedAtMs ?? 0,
    detail: entry.detail ?? '',
  }))
  /** Nothing listed at all — not a filter that matched nothing. */
  const none =
    listed.status === 'ready' && !listed.rows.length && !filtering && listed.page === 0

  /*
   * Import adds domains and addresses from a file; Export downloads the
   * domains, narrowed to the list's search and filters when it has any (the
   * export reads them as the same Firestore query). Outside the console
   * shell there is no launcher, and no buttons.
   */
  const transfer = useTransferLauncher()
  const transferTarget = { resource: OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY, scope: 'org' as const }
  // Import for those who may write the records, Export for those who may read them.
  const canImport = Boolean(transfer?.can('import', transferTarget))
  const canExport = Boolean(transfer?.can('export', transferTarget))
  const transferActions =
    transfer && (canImport || canExport) ? (
      <Stack direction="row" spacing={1}>
        {canImport && (
          <Button size="small" onClick={() => transfer.openImport(transferTarget)}>
            {DO_NOT_CONTACT_DOMAIN_LABELS.import}
          </Button>
        )}
        {canExport && (
          <Button
            size="small"
            onClick={() =>
              transfer.openExport({
                ...transferTarget,
                ...(filtering
                  ? {
                      filter: {
                        label: DO_NOT_CONTACT_EXPORT_FILTER_LABEL,
                        value: {
                          clauses: gridFilter.clauses.map(({ field, op, value }) => ({ field, op, value })),
                          search: gridFilter.searchWords,
                        },
                      },
                    }
                  : {}),
              })
            }
          >
            {DO_NOT_CONTACT_DOMAIN_LABELS.export}
          </Button>
        )}
      </Stack>
    ) : undefined

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
      HeaderProps={{ action: transferActions }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'No sequence emails anyone at these domains, whoever enrolls them. Add a company that asked not ' +
            'to hear from you, or one whose mail gateway blocks you. When an email bounces because the ' +
            'recipient’s gateway refused it — rather than because the address is unknown — the domain is ' +
            'added here automatically, so the next person at that company is not tried. Import adds ' +
            'domains and email addresses from a file; Export downloads the domains.'}
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
        {listed.status === 'loading' && !filtering ? (
          <OutreachLoading label="Loading domains…" />
        ) : listed.status === 'error' || listed.status === 'refused' ? (
          <OutreachLoadProblem status={listed.status} what="the do-not-contact domains" />
        ) : none ? (
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
            <ListQueryNotices
              refused={listQueryRefusals(listed.plan.refused, {
                fields: DOMAIN_FILTER_FIELDS,
                headers: DOMAIN_FILTER_HEADERS,
                options: DOMAIN_FILTER_OPTIONS,
              })}
              notices={listed.plan.notices}
            />
            <ListTable
              aria-label="Do not contact domains"
              columns={domainColumns(busy !== null, (domain) => void change('remove', domain))}
              rows={rows}
              loading={listed.status === 'loading'}
              /*
               * The panel and the search are the grid's; every clause and
               * the search word are on the list's query (AGL-3321). The grid
               * neither filters nor sorts the page it is handed: the query's
               * order — alphabetical, or newest added while a date applies —
               * is the list's.
               */
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              quickFilter
              disableColumnSorting
              noRowsLabel="No domains match these filters"
              /*
               * The grid's own export writes the page on screen; with the
               * header's Export, which writes every matching domain, it
               * would be a second button by the same name doing less.
               */
              slotProps={transfer ? GRID_EXPORT_OFF : undefined}
              hideFooter
            />
            <ListPagination
              page={listed.page}
              pageSize={listed.pageSize}
              rowCount={rows.length}
              hasMore={listed.hasMore}
              onPageChange={listed.setPage}
              onPageSizeChange={listed.setPageSize}
            />
          </Stack>
        )}
      </Stack>
    </CardDisplay>
  )
}
OutreachDoNotContactDomainsCard.displayName = 'OutreachDoNotContactDomainsCard'

export default OutreachDoNotContactDomainsCard
