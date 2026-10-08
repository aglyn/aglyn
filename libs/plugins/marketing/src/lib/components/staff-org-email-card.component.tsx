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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiEyeOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import ListQueryNotices from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import { useFirestore, usePagedCollection } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'
import { type ReactNode, useMemo, useState } from 'react'

/*
 * AN ORGANIZATION'S EMAIL WORK, AS STAFF SEE IT (AGL-3380).
 *
 * The staff organization page is about a customer the staffer is not a
 * member of, so nothing here sends, schedules or edits. Each tab is a paged
 * walk of one collection in document-id order. A send opens the message it
 * stored, drawn in a frame that runs nothing, or the design it was composed
 * from in the staff preview.
 */

type Row = { $id: string } & Record<string, any>

const whenOf = (value: any): string => {
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString()
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toLocaleString()
  if (typeof value === 'number') return new Date(value).toLocaleString()
  return '—'
}

/** When a send went, or is due: the sent stamp, else the schedule, else its creation. */
const sendWhen = (row: Row): string =>
  row['sentAt']
    ? whenOf(row['sentAt'])
    : row['sendAtMs']
      ? `due ${whenOf(row['sendAtMs'])}`
      : whenOf(row['createdAtMs'])

/** The staff preview of the design a send was composed from, if it names one. */
const designPreviewHref = (row: Row): string | undefined =>
  typeof row['templateScreenId'] === 'string' &&
  row['templateScreenId'] &&
  typeof row['hostId'] === 'string' &&
  row['hostId']
    ? buildRoute(Route.ADMIN_SITE_PREVIEW, {
        hostId: row['hostId'],
        kind: 'screen',
        docId: row['templateScreenId'],
      })
    : undefined

/**
 * A stored message body, in a frame with `sandbox` and no permissions: a
 * customer's HTML is only ever pixels on the staff page.
 */
function MessageDialog(props: { row: Row | null; onClose: () => void }) {
  const { row, onClose } = props
  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{row ? String(row['subject'] || row.$id) : ''}</DialogTitle>
      <DialogContent>
        {row?.['preheader'] ? (
          <Typography variant="caption" color="text.secondary">
            {String(row['preheader'])}
          </Typography>
        ) : null}
        <Box
          component="iframe"
          title="Message"
          sandbox=""
          srcDoc={String(row?.['body'] ?? '')}
          sx={{ mt: 1, width: '100%', height: 560, border: 1, borderColor: 'divider', bgcolor: '#fff' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}

/** One paged table of an organization subcollection. */
/*
 * EVERY HEADER SORTS (AGL-3680). Both tables walk their collection by id;
 * the name column orders the QUERY by its lower-cased key instead — a send's
 * `subjectLower`, a campaign's `nameLower`, each stamped by every writer
 * (`campaignSendSearchFields`, `campaignContainerSearchFields`) and on older
 * records by `backfill-campaign-list-fields.mjs`. With no filter on these
 * staff tables, an order on the unscoped collection needs no composite.
 * The rest is drawn from several fields, or a value a send may not carry
 * (a draft names no audience), and sorts the page.
 */
const nameSorts = (path: string, column: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label },
  { path, direction: 'desc', column, label },
]
const SEND_SORTS = nameSorts('subjectLower', 'subject', 'Subject')
const CAMPAIGN_SORTS = nameSorts('nameLower', 'name', 'Campaign')
const millisOf = (value: any): number | null =>
  typeof value?.toMillis === 'function'
    ? value.toMillis()
    : typeof value?.seconds === 'number'
      ? value.seconds * 1000
      : typeof value === 'number'
        ? value
        : null
const SEND_PAGE_SORTS = {
  status: (row: Row) => String(row['status'] ?? 'draft'),
  audience: (row: Row) => (row['audience'] ? String(row['audience']) : null),
  when: (row: Row) => millisOf(row['sentAt']) ?? millisOf(row['sendAtMs']) ?? millisOf(row['createdAtMs']),
}
const SEND_PAGE_SORT_HEADERS = { status: 'Status', audience: 'Audience', when: 'When' }
const CAMPAIGN_PAGE_SORTS = {
  visibleTo: (row: Row) => (Array.isArray(row['visibleTo']) ? row['visibleTo'].join(', ') : null),
  window: (row: Row) => millisOf(row['startAtMs']) ?? millisOf(row['endAtMs']),
}
const CAMPAIGN_PAGE_SORT_HEADERS = { visibleTo: 'Runs on', window: 'Window' }

function OrgCollectionTable(props: {
  orgId: string
  collectionId: string
  columns: GridColDef[]
  emptyLabel: string
  onOpen?: (row: Row) => void
  sorts: readonly ListQuerySort[]
  pageSorts: Readonly<Record<string, (row: Row) => string | number | null>>
  sortHeaders: Readonly<Record<string, string>>
}) {
  const { orgId, collectionId, columns, emptyLabel, onOpen, sorts, pageSorts, sortHeaders } = props
  const firestore = useFirestore()
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(null)
  const paged = usePagedCollection<Row>(
    (pageLimit) =>
      orgId
        ? query(
            collection(firestore, 'orgs', orgId, collectionId),
            askedSort ? orderBy(askedSort.path, askedSort.direction) : orderBy(documentId()),
            limit(pageLimit),
          )
        : null,
    [firestore, orgId, collectionId, askedSort?.path, askedSort?.direction],
    { idField: '$id' },
  )
  const columnSort = useListColumnSort<Row>({
    sorts,
    sort: askedSort,
    onSortChange: setAskedSort,
    rows: paged.rows,
    pageSorts,
    headers: sortHeaders,
  })
  const byId = useMemo(() => new Map(paged.rows.map((row) => [row.$id, row])), [paged.rows])
  return (
    <Stack spacing={1}>
      <ListQueryNotices refused={[]} notices={columnSort.notices} />
      <ListTable
        rows={columnSort.rows}
        columns={columns}
        loading={paged.status === 'loading'}
        columnSort={columnSort}
        noRowsLabel={emptyLabel}
        onOpen={
          onOpen
            ? (id) => {
                const row = byId.get(String(id))
                if (row) onOpen(row)
              }
            : undefined
        }
        hideFooter
        rowHeight={TABLE_ROW_HEIGHT}
      />
      <ListPagination
        page={paged.page}
        pageSize={paged.pageSize}
        rowCount={paged.rows.length}
        hasMore={paged.hasMore}
        onPageChange={paged.setPage}
        onPageSizeChange={paged.setPageSize}
      />
    </Stack>
  )
}

const chips = (items: Array<{ label: string; color?: 'success' | 'warning' | 'error' }>): ReactNode => (
  <Stack direction="row" spacing={0.5} useFlexGap sx={{ alignItems: 'center', height: '100%', flexWrap: 'wrap' }}>
    {items.map((item) => (
      <Chip
        key={item.label}
        size="small"
        label={item.label}
        color={item.color ?? 'default'}
        variant={item.color ? 'filled' : 'outlined'}
      />
    ))}
  </Stack>
)

type EmailTab = 'sends' | 'campaigns'

/**
 * The staff organization page's email card (`adminOrgDetail` zone): every
 * campaign send with its state and numbers, and the campaign containers
 * with the sites each runs on.
 */
export function StaffOrgEmailCard(props: { orgId: string }) {
  const { orgId } = props
  const [tab, setTab] = useState<EmailTab>('sends')
  const [message, setMessage] = useState<Row | null>(null)

  const sendColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'subject',
        headerName: 'Subject',
        flex: 1.4,
        minWidth: 200,
        valueGetter: (_value, row: Row) => String(row['subject'] || '(no subject)'),
        renderCell: ({ row }: { row: Row }) => (
          <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
            <Typography variant="body2" noWrap sx={{ lineHeight: 1.25 }}>
              {String(row['subject'] || '(no subject)')}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ fontFamily: 'monospace', lineHeight: 1.25 }}
            >
              {String(row['hostId'] ?? 'no site')}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 1.4,
        minWidth: 220,
        valueGetter: (_value, row: Row) => String(row['status'] ?? 'draft'),
        renderCell: ({ row }: { row: Row }) => {
          const stats = row['stats'] ?? {}
          return chips([
            {
              label: String(row['status'] ?? 'draft'),
              color: row['status'] === 'sent' ? 'success' : row['status'] === 'failed' ? 'error' : undefined,
            },
            ...(row['staffReview']?.state === 'held'
              ? [{ label: 'held for review', color: 'warning' as const }]
              : []),
            ...(typeof stats.sent === 'number' ? [{ label: `${stats.sent} sent` }] : []),
            ...(typeof stats.uniqueOpens === 'number' ? [{ label: `${stats.uniqueOpens} opened` }] : []),
            ...(typeof stats.uniqueClicks === 'number' ? [{ label: `${stats.uniqueClicks} clicked` }] : []),
            ...(stats.bounced ? [{ label: `${stats.bounced} bounced`, color: 'error' as const }] : []),
          ])
        },
      },
      {
        field: 'audience',
        headerName: 'Audience',
        flex: 0.6,
        minWidth: 110,
        valueGetter: (_value, row: Row) => String(row['audience'] ?? '—'),
      },
      {
        field: 'when',
        headerName: 'When',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: Row) => sendWhen(row),
      },
      listActionsColumn(
        (row: Row) => {
          const design = designPreviewHref(row)
          return (
            <ListRowActions
              label={String(row['subject'] || row.$id)}
              quick={{
                icon: mdiEyeOutline.path,
                label: 'View message',
                onClick: () => setMessage(row),
                unavailableReason: row['body'] ? undefined : 'No message body was stored',
              }}
              items={[
                {
                  key: 'design',
                  label: 'Open design preview',
                  href: design,
                  external: true,
                  disabled: !design,
                  disabledReason: design ? undefined : 'This send was not composed from a design',
                },
                {
                  key: 'site',
                  label: 'Open site',
                  href: row['hostId']
                    ? buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: String(row['hostId']) })
                    : undefined,
                  disabled: !row['hostId'],
                  disabledReason: row['hostId'] ? undefined : 'This send names no site',
                },
              ]}
            />
          )
        },
        { width: 110 },
      ),
    ],
    [],
  )

  const campaignColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Campaign',
        flex: 1.4,
        minWidth: 200,
        valueGetter: (_value, row: Row) => String(row['name'] || row.$id),
      },
      {
        field: 'visibleTo',
        headerName: 'Runs on',
        flex: 1.2,
        minWidth: 180,
        valueGetter: (_value, row: Row) =>
          (Array.isArray(row['visibleTo']) ? row['visibleTo'] : []).join(', '),
        renderCell: ({ row }: { row: Row }) =>
          chips([
            ...(Array.isArray(row['visibleTo']) ? (row['visibleTo'] as string[]) : []).map((token) => ({
              label: token === 'org' ? 'every site' : token.replace(/^host:/, ''),
            })),
            ...(row['deletedAt'] ? [{ label: 'deleted', color: 'error' as const }] : []),
          ]),
      },
      {
        field: 'window',
        headerName: 'Window',
        flex: 1,
        minWidth: 180,
        valueGetter: (_value, row: Row) =>
          row['startAtMs'] || row['endAtMs']
            ? `${whenOf(row['startAtMs'])} – ${row['endAtMs'] ? whenOf(row['endAtMs']) : 'open'}`
            : '—',
      },
    ],
    [],
  )

  return (
    <>
      <CardDisplay
        header={'Email campaigns'}
        help={pluginDocsHelp('staffConsole', {
          anchor: '#staff-org-email',
          excerpt:
            "The organization's campaign sends and campaigns. A send opens its stored message or its design preview.",
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Tabs
            value={tab}
            onChange={(_event, next: EmailTab) => setTab(next)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >

            <Tab value="sends" label="Sends" />
            <Tab value="campaigns" label="Campaigns" />
          </Tabs>
          {tab === 'sends' ? (
            <OrgCollectionTable
              key="sends"
              orgId={orgId}
              collectionId="campaigns"
              columns={sendColumns}
              sorts={SEND_SORTS}
              pageSorts={SEND_PAGE_SORTS}
              sortHeaders={SEND_PAGE_SORT_HEADERS}
              emptyLabel="This organization has sent no campaigns"
              onOpen={(row) => (row['body'] ? setMessage(row) : undefined)}
            />
          ) : (
            <OrgCollectionTable
              key="campaigns"
              orgId={orgId}
              collectionId="emailCampaigns"
              columns={campaignColumns}
              sorts={CAMPAIGN_SORTS}
              pageSorts={CAMPAIGN_PAGE_SORTS}
              sortHeaders={CAMPAIGN_PAGE_SORT_HEADERS}
              emptyLabel="This organization has no email campaigns"
            />
          )}
        </Stack>
      </CardDisplay>
      <MessageDialog row={message} onClose={() => setMessage(null)} />
    </>
  )
}
