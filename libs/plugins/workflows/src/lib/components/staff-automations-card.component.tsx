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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiEyeOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
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
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  documentId,
  type Firestore,
  limit,
  orderBy,
  query,
  type Query,
  where,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'

/*
 * AUTOMATIONS, AS STAFF SEE THEM (AGL-3379).
 *
 * The staff site and organization pages are about a customer the staffer is
 * not a member of, so nothing here edits, runs or pauses: each table is a
 * paged walk of one collection in document-id order, and a row opens a
 * read-only view of the trigger and the steps. The rules admit staff reads on
 * every site and organization subcollection.
 */

type AutomationRow = { $id: string } & Record<string, any>

const nameOf = (row: AutomationRow): string => String(row['name'] || row['displayName'] || row.$id)

const whenOf = (value: any): string =>
  typeof value?.toDate === 'function' ? value.toDate().toLocaleString() : '—'

/** The trigger and the steps of one automation, read-only. */
function StepsDialog(props: { row: AutomationRow | null; onClose: () => void }) {
  const { row, onClose } = props
  const steps: unknown[] = Array.isArray(row?.['steps']) ? row['steps'] : []
  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{row ? nameOf(row) : ''}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {'Trigger'}
            </Typography>
            <Typography variant="body2">
              {row?.['trigger']?.event ?? 'Manual — runs only when called'}
            </Typography>
            {row?.['trigger']?.filter ? (
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {`when ${row['trigger'].filter}`}
              </Typography>
            ) : null}
          </Box>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {`Steps (${steps.length})`}
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 420,
              }}
            >
              {JSON.stringify(steps, null, 2)}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}

/** One paged, read-only table of automations. */
const millisOf = (value: any): number | null =>
  typeof value?.toMillis === 'function' ? value.toMillis() : null

/*
 * EVERY HEADER SORTS, OVER THE PAGE (AGL-3680). These read-only staff tables
 * walk each collection by document id. Their name falls back across fields
 * that differ by collection (`name`, `displayName`, the id), their status is
 * drawn from the trigger and the pause lists, and `updatedAt` is not stamped
 * by every writer (an imported automation carries none) — so no stored field
 * orders all three, and each header sorts the page on screen and says so.
 */
const AUTOMATION_PAGE_SORTS = {
  name: (row: AutomationRow) => nameOf(row),
  status: (row: AutomationRow) => String(row['trigger']?.event ?? 'manual'),
  updatedAt: (row: AutomationRow) => millisOf(row['updatedAt']),
}
const AUTOMATION_PAGE_SORT_HEADERS = { name: 'Automation', status: 'Status', updatedAt: 'Updated' }
const NO_QUERY_SORTS = [] as const

function AutomationTable(props: {
  title: string
  buildQuery: (firestore: Firestore, pageLimit: number) => Query | null
  deps: readonly unknown[]
  /** The site the table is read for, to mark what it has paused. */
  hostId?: string
  emptyLabel: string
  onOpen: (row: AutomationRow) => void
}) {
  const { title, buildQuery, deps, hostId, emptyLabel, onOpen } = props
  const firestore = useFirestore()
  const paged = usePagedCollection<AutomationRow>(
    (pageLimit) => buildQuery(firestore, pageLimit),
    [firestore, ...deps],
    { idField: '$id' },
  )
  const byId = useMemo(() => new Map(paged.rows.map((row) => [row.$id, row])), [paged.rows])
  const columnSort = useListColumnSort<AutomationRow>({
    sorts: NO_QUERY_SORTS,
    rows: paged.rows,
    pageSorts: AUTOMATION_PAGE_SORTS,
    headers: AUTOMATION_PAGE_SORT_HEADERS,
  })
  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Automation',
        flex: 1.4,
        minWidth: 200,
        valueGetter: (_value, row: AutomationRow) => nameOf(row),
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 1.2,
        minWidth: 200,
        valueGetter: (_value, row: AutomationRow) => String(row['trigger']?.event ?? 'manual'),
        renderCell: ({ row }: { row: AutomationRow }) => {
          const paused: string[] = Array.isArray(row['pausedHostIds']) ? row['pausedHostIds'] : []
          return (
            <Stack
              direction="row"
              spacing={0.5}
              useFlexGap
              sx={{ alignItems: 'center', height: '100%', flexWrap: 'wrap' }}
            >
              <Chip size="small" variant="outlined" label={row['trigger']?.event ?? 'manual'} />
              {row['enabled'] === false ? (
                <Chip size="small" color="warning" label="off" />
              ) : (
                <Chip size="small" color="success" label="on" />
              )}
              {hostId && paused.includes(hostId) ? (
                <Chip size="small" color="warning" label="paused here" />
              ) : !hostId && paused.length ? (
                <Chip size="small" color="warning" label={`paused on ${paused.length}`} />
              ) : null}
              {row['deletedAt'] ? <Chip size="small" color="error" label="deleted" /> : null}
            </Stack>
          )
        },
      },
      {
        field: 'updatedAt',
        headerName: 'Updated',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: AutomationRow) => whenOf(row['updatedAt']),
      },
      listActionsColumn(
        (row: AutomationRow) => (
          <ListRowActions
            label={nameOf(row)}
            quick={{ icon: mdiEyeOutline.path, label: 'View steps', onClick: () => onOpen(row) }}
            items={[]}
          />
        ),
        { width: 110 },
      ),
    ],
    [hostId, onOpen],
  )
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{title}</Typography>
      <ListQueryNotices refused={[]} notices={columnSort.notices} />
      <ListTable
        rows={columnSort.rows}
        columns={columns}
        loading={paged.status === 'loading'}
        columnSort={columnSort}
        noRowsLabel={emptyLabel}
        onOpen={(id) => {
          const row = byId.get(String(id))
          if (row) onOpen(row)
        }}
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

const inIdOrder = (source: Query, pageLimit: number) =>
  query(source, orderBy(documentId()), limit(pageLimit))

/**
 * The staff site page's automations (`staffSite` zone): the site's own
 * automations, the organization automations that run on it, and its
 * workflows.
 */
export function StaffSiteAutomationsCard(props: { hostId: string; orgId?: string }) {
  const { hostId, orgId } = props
  const [open, setOpen] = useState<AutomationRow | null>(null)
  return (
    <>
      <CardDisplay
        header={'Automations'}
        help={pluginDocsHelp('staffConsole', {
          anchor: '#staff-automations',
          excerpt:
            "The site's automations, the organization automations that run on it, and its workflows — read-only, each opening its trigger and steps.",
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={3}>
          <AutomationTable
            title="Site automations"
            buildQuery={(firestore, pageLimit) =>
              hostId ? inIdOrder(collection(firestore, 'hosts', hostId, 'actions'), pageLimit) : null
            }
            deps={[hostId]}
            hostId={hostId}
            emptyLabel="No automations on this site"
            onOpen={setOpen}
          />
          <AutomationTable
            title="Organization automations that run here"
            buildQuery={(firestore, pageLimit) =>
              orgId && hostId
                ? inIdOrder(
                    query(
                      collection(firestore, 'orgs', orgId, 'automations'),
                      where('visibleTo', 'array-contains-any', ['org', `host:${hostId}`]),
                    ),
                    pageLimit,
                  )
                : null
            }
            deps={[orgId, hostId]}
            hostId={hostId}
            emptyLabel="No organization automation runs on this site"
            onOpen={setOpen}
          />
          <AutomationTable
            title="Workflows"
            buildQuery={(firestore, pageLimit) =>
              hostId ? inIdOrder(collection(firestore, 'hosts', hostId, 'workflows'), pageLimit) : null
            }
            deps={[hostId]}
            emptyLabel="No workflows on this site"
            onOpen={setOpen}
          />
        </Stack>
      </CardDisplay>
      <StepsDialog row={open} onClose={() => setOpen(null)} />
    </>
  )
}

/** The staff organization page's automations (`adminOrgDetail` zone). */
export function StaffOrgAutomationsCard(props: { orgId: string }) {
  const { orgId } = props
  const [open, setOpen] = useState<AutomationRow | null>(null)
  return (
    <>
      <CardDisplay
        header={'Organization automations'}
        help={pluginDocsHelp('staffConsole', {
          anchor: '#staff-org-automations',
        })}
        contentGutterX
        contentGutterY
      >
        <AutomationTable
          title="Automations"
          buildQuery={(firestore, pageLimit) =>
            orgId ? inIdOrder(collection(firestore, 'orgs', orgId, 'automations'), pageLimit) : null
          }
          deps={[orgId]}
          emptyLabel="This organization has no automations"
          onOpen={setOpen}
        />
      </CardDisplay>
      <StepsDialog row={open} onClose={() => setOpen(null)} />
    </>
  )
}
