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

import { buildRoute, pluginDocsHelp, Route } from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import {
  mdiDeleteOutline,
  mdiContentCopy,
  mdiEyeOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  DUPLICATE_MENU_LABEL,
  useConsoleHostRoute,
  useDuplicateResource,
  useFirestore,
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { Button, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, doc, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  EMAIL_TEMPLATE_BASE,
  EMAIL_TEMPLATE_FILTER_HEADERS,
  EMAIL_TEMPLATE_QUERY,
} from '../constants/list-queries'
import { templateProvenance } from '../model/template-provenance'
import { createEmailScreen } from '../utils/create-email-screen'
import { HOST_EMAIL_TEMPLATES_ZONE } from './email-zones'
import { emailTemplateSoftDelete } from '../utils/email-template-soft-delete'

// The besigner route is `/[orgSlug]/hosts/[host]/screens/[screenId]/
// versions/[versionId]/besigner`. This built `/{hostDocId}/screens/…`, the
// pre-AGL-621/622 shape — so every "Edit"/"Design" jump out of the Emails
// page landed on a 404, including the one right after creating a new email
// (AGL-685). Takes the resolved org slug + subdomain, not a host doc id.
/** Origin sorts the loaded page: installed or yours (AGL-3680). */
const TEMPLATE_PAGE_SORTS = {
  origin: (row: any) =>
    templateProvenance(row).origin === 'installed' ? 'installed' : 'local',
}
const TEMPLATE_SORT_HEADERS = { origin: 'Origin' }

const besignerHref = (
  orgSlug: string,
  host: string,
  screenId: string,
  versionId: string,
) =>
  buildRoute(Route.SCREEN_BESIGNER, { orgSlug, host, screenId, versionId })

/**
 * THE TEMPLATES: reusable besigner documents an email is built from.
 *
 * A template is a screen document with `kind: 'email'`, kept out of the main
 * Screens list and opened in the besigner with only email-safe components on
 * offer. It is not itself a message — a message is what a campaign sends, and
 * one template can be behind many of them, which is why the row leads to the
 * template's own page rather than straight into the editor.
 *
 * A template is not necessarily this org's. One installed from a marketplace
 * listing appears here beside the locally authored ones, carries its
 * publisher's provenance on the same document, and opens the same detail
 * page; the chip beside its name is what distinguishes them.
 *
 * ## A table, on the surface's own row grammar
 *
 * The row opens the template, its name is ALSO a real link so it can be
 * middle-clicked and copied, and editing and deleting live behind the shared
 * overflow menu rather than as text buttons in the row — the same grammar the
 * audiences table reads by. Delete in particular: it sat inline, one mis-click
 * from the name beside it.
 *
 * ## The list IS its query
 *
 * `kind == 'email'`, by name, paged by the query — and every Filters clause
 * and search word is a predicate on it (AGL-3321, `EMAIL_TEMPLATE_QUERY`), so
 * a page is a page of the templates that match and none is matched in the
 * browser. The order is `nameLower`, which every screen writer stamps from
 * `displayName`; a deleted template has its name keys cleared with the
 * delete (`emailTemplateSoftDelete`), so the order leaves it out rather than
 * the card dropping it after the read.
 */
export function EmailScreensCard(props: {
  hostId: string
  /** The org the site belongs to, handed to the create zone; `undefined` while it resolves. */
  orgId?: string
  /** The emails hub URL, which every template route hangs beneath. */
  basePath: string
}) {
  const { hostId, orgId, basePath } = props
  /**
   * The shell's zone renderer (AGL-3596), for other ways to start a design —
   * the `hostEmailTemplates` zone this plugin declares; `null` outside the
   * console shell, where there is no workspace to gate on.
   */
  const CreateZone = useConsoleWidgetSlot()
  const createZone = CreateZone ? (
    <CreateZone slot={HOST_EMAIL_TEMPLATES_ZONE.id} hostId={hostId} orgId={orgId} />
  ) : null
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  // Duplicate (AGL-2936): the copy is a design of its own, sent by nothing
  // until a campaign picks it.
  const duplicate = useDuplicateResource({
    hostId,
    onDuplicated: (_kind, copy) =>
      enqueueSnackbar(`Duplicated as “${copy.name}”`, { variant: 'success' }),
  })
  const { confirm } = useConfirmationContext()

  const gridFilter = useListGridFilter()
  /*
   * EVERY HEADER SORTS (AGL-3680). Template orders the QUERY by `nameLower`,
   * A to Z by default and Z to A while nothing narrows the list; Origin is
   * the presence of the install provenance, which no query can order by, so
   * it sorts the page on screen and says so.
   */
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(
    EMAIL_TEMPLATE_QUERY.sorts[0],
  )
  const {
    rows: emailScreens,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
  } = useListQuery<any>({
    collection: collection(firestore, 'hosts', hostId, 'screens'),
    declaration: EMAIL_TEMPLATE_QUERY,
    request: {
      clauses: gridFilter.clauses,
      search: gridFilter.searchWords,
      sort: askedSort,
      base: EMAIL_TEMPLATE_BASE,
    },
    deps: [firestore, hostId],
    idField: '$id',
  })
  const columnSort = useListColumnSort<any>({
    sorts: EMAIL_TEMPLATE_QUERY.sorts,
    defaultSort: EMAIL_TEMPLATE_QUERY.sorts[0],
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: plan.orderBy,
    rows: emailScreens,
    pageSorts: TEMPLATE_PAGE_SORTS,
    headers: TEMPLATE_SORT_HEADERS,
  })
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())
  const refusals = useMemo(
    () =>
      listQueryRefusals(plan.refused, {
        fields: EMAIL_TEMPLATE_QUERY.fields,
        headers: EMAIL_TEMPLATE_FILTER_HEADERS,
      }),
    [plan.refused],
  )

  const handleCreate = async () => {
    try {
      const { screenId, versionId } = await createEmailScreen(
        hostId,
        createHostResource,
        createHostVersion,
      )
      if (orgSlug && subdomain) {
        void router.push(besignerHref(orgSlug, subdomain, screenId, versionId))
      }
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the template failed', {
        variant: 'error',
      })
    }
  }

  const handleDelete = async (screen: any) => {
    const confirmed = await confirm({
      title: 'Delete this template?',
      description:
        `"${screen.displayName ?? 'Untitled template'}" will be removed. ` +
        'Emails already sent from it keep their reports.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await updateDoc(
      doc(firestore, 'hosts', hostId, 'screens', screen.$id),
      emailTemplateSoftDelete(),
    )
  }

  const templateHref = (screen: any) => `${basePath}/templates/${screen.$id}`

  const templateName = (screen: any) =>
    String(screen.displayName ?? 'Untitled template')

  const rowActions = (screen: any): RowActionsMenuItem[] => [
    {
      key: 'details',
      label: 'Open details',
      icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
      href: templateHref(screen),
    },
    {
      key: 'besigner',
      label: 'Edit in besigner',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      /*
        The editor's URL needs the resolved org slug and subdomain. Until the
        host route settles both are empty and a link built from them lands on
        `/null/hosts/null`, so the item is shown DISABLED with the reason
        rather than pointing at a 404.
       */
      href:
        orgSlug && subdomain
          ? besignerHref(orgSlug, subdomain, screen.$id, screen.versionId)
          : undefined,
      disabled: !orgSlug || !subdomain,
      disabledReason: 'This site’s console URL has not resolved yet',
    },
    {
      key: 'duplicate',
      label: DUPLICATE_MENU_LABEL,
      icon: <MdiIcon path={mdiContentCopy.path} size={0.8} />,
      onClick: () =>
        duplicate.request('emailDesign', {
          id: screen.$id,
          name: templateName(screen),
        }),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
      destructive: true,
      onClick: () => void handleDelete(screen),
    },
  ]

  /*
   * The name is a link AND the row opens the template.
   */
  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Template',
      flex: 1,
      minWidth: 220,
      valueGetter: (_value, row) => templateName(row),
      renderCell: ({ row, value }) => (
        <AppLink
          href={templateHref(row)}
          // The row's own handler would fire too and push the same route
          // twice — one history entry per back press.
          onClick={(event: { stopPropagation: () => void }) =>
            event.stopPropagation()
          }
        >
          {value}
        </AppLink>
      ),
    },
    {
      /*
        WHOSE template this is, where the reader is choosing between them. An
        installed one is versioned by its publisher and can be withdrawn, which
        is not a property a name can carry.
       */
      field: 'origin',
      headerName: 'Origin',
      width: 140,
      valueGetter: (_value, row) =>
        templateProvenance(row).origin === 'installed' ? 'installed' : 'local',
      renderCell: ({ value }) =>
        value === 'installed' ? (
          <Chip size="small" label="Installed" />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Yours'}
          </Typography>
        ),
    },
    listActionsColumn(
      (row) => (
        <ListRowActions label={templateName(row)} items={rowActions(row)} />
      ),
      { width: 72 },
    ),
  ]

  return (
    <CardDisplay
      header={'Templates'}
      help={pluginDocsHelp('designedEmails', { anchor: '#find-a-template' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            {createZone}
            <Button
              size="small"
              variant="contained"
              onClick={() => void handleCreate()}
            >
              {'New template'}
            </Button>
          </Stack>
        ),
      }}
    >
      {duplicate.dialog}
      <Stack spacing={1.5}>
        {emailScreens.length === 0 && !hasMore && !filtering ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {'Design a reusable email here, then send it from a campaign. A ' +
                'new template opens in the besigner with email-safe components ' +
                'only.'}
            </Typography>
            {/* Other ways to start a design, the header's zone again. */}
            <Stack direction="row" spacing={1}>
              {createZone}
              <Button variant="contained" onClick={() => void handleCreate()}>
                {'Create your first template'}
              </Button>
            </Stack>
          </>
        ) : (
          <>
            <ListFilterChips
              fields={EMAIL_TEMPLATE_QUERY.fields}
              headers={EMAIL_TEMPLATE_FILTER_HEADERS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
            />
            <ListQueryNotices
              refused={refusals}
              notices={[...plan.notices, ...columnSort.notices]}
            />
            <ListTable
              aria-label="Email templates"
              rows={columnSort.rows}
              columnSort={columnSort}
              columns={listFilterGridColumns(
                columns,
                EMAIL_TEMPLATE_QUERY.fields,
                {},
                EMAIL_TEMPLATE_FILTER_HEADERS,
              )}
              rowHeight={TABLE_ROW_HEIGHT}
              onOpen={(_id, row) => router.push(templateHref(row))}
              // Paged by the footer below, so the grid must not also slice.
              hideFooter
              // The panel, the search and the Template header go to the
              // query (Origin sorts the page, and says so).
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              quickFilter
              noRowsLabel="No templates match these filters"
            />
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={emailScreens.length}
              hasMore={hasMore}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
EmailScreensCard.displayName = 'EmailScreensCard'

export default EmailScreensCard
