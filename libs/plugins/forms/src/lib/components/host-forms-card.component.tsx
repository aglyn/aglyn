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

import * as Aglyn from '@aglyn/aglyn'
import {
  buildRoute,
  PageHeaderActions,
  pluginDocsHelp,
  Route,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SHOW_DETAIL } from '@aglyn/shared-data-enums'
import { mdiEyeOutline, mdiVectorSquare } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListTable, {
  ListRowActions,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { Alert, Button, Stack } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection } from 'firebase/firestore'
import {
  useConsoleHostRoute,
  useFirestore,
  useHostResourceApi,
  useLiveArtifactCount,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
import { collectionPage } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'

export interface HostFormsCardProps {
  hostId: string
  /**
   * The Forms surface's own absolute console path, from the shell.
   *
   * A row's link is this plus the form's id, resolved synchronously. The
   * alternative is `useConsoleHostRoute`, which answers `null` for a paint
   * while it reads two documents — and a table whose every row links to
   * `/null/...` on first render is worse than one that pays nothing.
   */
  basePath?: string
}

/**
 * THE FORM CATALOG, WITH ITS SHAPE VISIBLE BEFORE THERE IS ANYTHING IN IT.
 *
 * The list is the components list's table, deliberately and not
 * approximately: `ListTable` gives it the row grammar every artifact list has
 * — the row opens the detail page, rows are not selectable, one quick action
 * then the overflow — and `ListPagination` gives it the console's one footer.
 * A form is an artifact like a component, so a reader who has used one list
 * has used this one.
 *
 * ## Why the empty state is a table and not a sentence
 *
 * A paragraph and a button reads as a smaller feature than this is: a form is
 * a thing with a slug, a submission count and a version history, and none of
 * that would be visible until the reader had already committed to making one.
 * Rendering the columns with the empty overlay inside them teaches the shape
 * of the artifact BEFORE the first one exists, which is what the components
 * list has always done.
 *
 * ## The two numeric columns, and the one that is honestly blank
 *
 * `stats.submissions` is incremented by `/api/forms/submit` on a write that
 * was happening anyway, so it is a real number and it is rendered as one.
 * `stats.leads` is DECLARED on `FormStats` and no writer anywhere increments
 * it — so it renders as a dash and never as `0`. A zero would say this form
 * has produced no leads, which is a measurement nobody took: the route creates
 * leads through `addHostLead` and files them under `source: form:{id}` without
 * counting them back onto the form.
 */
export function HostFormsCard(props: HostFormsCardProps) {
  const { hostId, basePath } = props
  const router = useRouter()
  const { orgSlug, subdomain: host } = useConsoleHostRoute(hostId)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()

  /**
   * One form's page, beneath this surface's own path.
   *
   * `basePath` is the shell's answer and needs no read; the route table is the
   * fallback for a caller that has none, and it is the one that can be `null`
   * for a paint.
   */
  const formHref = useCallback(
    (formId: string) =>
      basePath
        ? `${basePath}/${formId}`
        : buildRoute(Route.FORM_DETAILS, {
            orgSlug: orgSlug ?? '',
            host: host ?? '',
            formId,
          }),
    [basePath, orgSlug, host],
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  /**
   * The list PAGES, over an ordered walk.
   *
   * `collectionPage` holds the ordering decision and the reason it is the
   * document id rather than `displayName` — briefly, `orderBy` matches only
   * documents that HAVE the field, and the resources route stores an
   * allow-list it never checks for presence, so ordering on a name would hide
   * every form created without one rather than mis-sorting the list.
   *
   * The page is NOT re-sorted: sorting a server-ordered window in the browser
   * is what makes a pseudo-random sample look like the first page.
   */
  const {
    status,
    rows: formWindow,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<any>(
    (pageLimit) =>
      collectionPage(
        collection(firestore, 'hosts', hostId, 'forms'),
        pageLimit,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  /*
   * An archived form is a TOMBSTONE, not a row. Client-side because it has to
   * be: Firestore cannot ask for the ABSENCE of a field, so a form created
   * through the resources route (which carries no `archivedAt` at all) and one
   * archived later are not one value to filter on. The cost is that a tombstone
   * spends a slot in whichever page it falls in.
   */
  const forms = formWindow.filter((form: any) => !form.archivedAt)

  /*
   * The COUNT is a server aggregate, not the length of a page. `forms` is one
   * page, and publishing that as the site's form count would read as room to
   * spare on a site that is already at the ceiling.
   */
  const liveFormCount = useLiveArtifactCount(hostId, 'forms')
  // Pending or refused, the page window stands in: a LOWER bound, never a
  // confident zero.
  const formsUsed = liveFormCount ?? forms.length

  /**
   * Name first, then create (AGL-700).
   *
   * A form is created with BOTH halves seeded. `fields` is the declaration the
   * submission path reads and starts empty; the canvas is the design, seeded
   * with a root and a form node already bound to this id — so the besigner
   * opens on something that satisfies `checkFormContract` rather than on a
   * blank page whose first publish is a list of violations.
   */
  const handleCreate = useCallback(
    async (values: Record<string, any>) => {
      if (creating) return
      setCreating(true)
      setCreateError(null)
      try {
        const formId = Aglyn.createResourceUid()
        await createHostResource({
          hostId,
          resource: 'form',
          id: formId,
          data: {
            displayName: values['displayName'],
            slug: Aglyn.normalizeFormSlug(values['displayName']) || formId,
            fields: [],
            rootId: Aglyn.CANVAS_ROOT_ELEMENT_ID,
            nodes: {
              [Aglyn.CANVAS_ROOT_ELEMENT_ID]: {
                $id: Aglyn.CANVAS_ROOT_ELEMENT_ID,
                componentId: 'div',
                nodes: ['formRoot'],
              },
              formRoot: {
                $id: 'formRoot',
                componentId: 'form',
                pluginId: BUNDLE_ID,
                parentId: Aglyn.CANVAS_ROOT_ELEMENT_ID,
                props: { formId, formName: values['displayName'] },
                nodes: [],
              },
            },
          },
        })
        setCreateOpen(false)
        router.push(formHref(formId))
      } catch (error) {
        console.error(error)
        setCreateError('Could not create that form')
      } finally {
        setCreating(false)
      }
    },
    [creating, createHostResource, hostId, router, formHref],
  )

  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      renderCell: ({ id, value }: any) => (
        <AppLink href={formHref(id as string)}>
          {value || (id as string)}
        </AppLink>
      ),
    },
    {
      field: 'slug',
      headerName: 'Slug',
      minWidth: 160,
      flex: 1,
      type: 'string',
      // Blank reads as a rendering gap; '--' reads as "nothing here".
      valueFormatter: (value: any) => value || '--',
    },
    {
      field: 'submissions',
      headerName: 'Submissions',
      minWidth: 130,
      type: 'number',
      // Head AND body. `type: 'number'` right-aligns both, and the explicit
      // pair says so at the call site rather than relying on a grid default
      // that a later `renderCell` would silently override.
      align: 'right',
      headerAlign: 'right',
      valueGetter: (_value: any, row: any) => row?.stats?.submissions ?? null,
      valueFormatter: (value: any) =>
        typeof value === 'number' ? value.toLocaleString() : '--',
    },
    {
      field: 'leads',
      headerName: 'Leads',
      minWidth: 100,
      type: 'number',
      align: 'right',
      headerAlign: 'right',
      /*
       * Always a dash, and deliberately.
       *
       * `FormStats.leads` exists on the type and nothing increments it — the
       * submit route creates a lead through `addHostLead` and never counts it
       * back. Reading the field anyway is what keeps this column honest the
       * day a writer appears: it renders the recorded number if there is one
       * and a dash if there is not, and it never renders a `0` that would read
       * as "this form has produced no leads".
       */
      valueGetter: (_value: any, row: any) =>
        typeof row?.stats?.leads === 'number' ? row.stats.leads : null,
      valueFormatter: (value: any) =>
        typeof value === 'number' ? value.toLocaleString() : '--',
    },
    {
      field: 'lastSubmission',
      headerName: 'Last submission',
      minWidth: 170,
      flex: 1,
      type: 'date',
      valueGetter: (_value: any, row: any) =>
        typeof row?.stats?.lastSubmissionAtMs === 'number'
          ? new Date(row.stats.lastSubmissionAtMs)
          : null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      minWidth: 170,
      flex: 1,
      type: 'date',
      // MUI X v9 passes the value positionally. The v6 object form silently
      // destructures undefined off a Date and every row renders '--'.
      valueGetter: (value: any) => value?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    listActionsColumn((row: any) => {
      const form = { ...row, $id: row.$id as string }
      const versionId = form.versionId as string | undefined
      return (
        <ListRowActions
          label={form.displayName ?? form.$id}
          quick={{
            icon: mdiEyeOutline.path,
            label: 'Preview',
            // A form with no version has never been opened in the besigner, so
            // there is no snapshot to render. Disabled and saying so, rather
            // than a link to an empty preview.
            ...(versionId && orgSlug && host
              ? {
                  to: buildRoute(Route.FORM_PREVIEW, {
                    orgSlug,
                    host,
                    formId: form.$id,
                    versionId,
                  }),
                }
              : {
                  unavailableReason: versionId
                    ? 'Resolving this site’s address…'
                    : 'Nothing to preview yet — open it in the besigner once.',
                }),
          }}
          items={[
            {
              key: 'details',
              label: 'View details',
              icon: <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} size={0.8} />,
              href: formHref(form.$id),
            },
            {
              key: 'besigner',
              label: 'Edit in besigner',
              icon: <MdiIcon path={mdiVectorSquare.path} size={0.8} />,
              /*
               * A LINK only once the form has a version. A form that has never
               * been opened has none, and opening it MINTS the first one —
               * that is a write, and the detail page is the one place that
               * decides what an initial version looks like. Sending the reader
               * there rather than minting a second way is what keeps the two
               * from drifting.
               */
              href:
                versionId && orgSlug && host
                  ? buildRoute(Route.FORM_BESIGNER, {
                      orgSlug,
                      host,
                      formId: form.$id,
                      versionId,
                    })
                  : formHref(form.$id),
            },
          ]}
        />
      )
    }),
  ]

  return (
    <>
      {/*
        The readout leads the create button, in the PAGE header — where Sites,
        screens, layouts, components and templates put theirs. Forms declares
        no sections, so it has no vertical rail for a card-header cluster to
        belong beside, and the controls are about the whole surface rather
        than about anything the card is showing.
        Published from the card because the card owns what they say: the count
        comes from the listener already open here, and a page that counted for
        itself would be a second source for one fact and a second read for one
        collection. It publishes from the LIST, so a form's own detail route —
        a different component — leaves the header with nothing to create into.
      */}
      <PageHeaderActions>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <QuotaReadoutComponent
            ready={status !== 'loading'}
            used={formsUsed}
            limit={Aglyn.FORMS_MAX_PER_HOST}
            noun="form"
          />
          <Button
            size="small"
            variant="contained"
            disabled={creating}
            onClick={() => {
              setCreateError(null)
              setCreateOpen(true)
            }}
          >
            {creating ? 'Creating…' : 'Create Form'}
          </Button>
        </Stack>
      </PageHeaderActions>
      <CardDisplay
        header="Forms"
        help={pluginDocsHelp('forms', {
          anchor: '#build-a-form',
          excerpt:
            'A form collects submissions into the Inbox, and its design is ' +
            'drawn in the besigner like any other artifact.',
        })}
      >
        <ListTable
          rowHeight={TABLE_ROW_HEIGHT}
          columns={columns}
          noRowsLabel="No forms yet"
          noRowsDescription="A form collects submissions, dedupes the people who send them, and can route them to a lead. Its design is drawn in the besigner and published like any other artifact."
          noRowsAction={
            <Button variant="contained" onClick={() => setCreateOpen(true)}>
              {'Create your first form'}
            </Button>
          }
          rows={forms}
          // The whole row opens the detail page; the action cluster stops
          // propagation so a menu click never navigates underneath it.
          onOpen={(id) => router.push(formHref(String(id)))}
          // An empty table while the read is in flight reads as "you have none"
          // rather than "these are on their way".
          loading={status === 'loading'}
          // Paged by the footer below, so the grid must not also slice.
          hideFooter
        />
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={forms.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        {/*
          The console's own create drawer, from the shared library rather than a
          second one that looks like it. The empty state and the header open the
          SAME one, so the state that says "creating…" is one state.
         */}
        <CreateArtifactDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Create new form"
          // A form document stores no description: `/api/hosts/resources` filters
          // `data` through a per-kind allow-list, so one typed here is dropped
          // without a word.
          includeDescription={false}
          onSubmit={handleCreate}
          errorSlot={
            createError ? (
              <Alert severity="error" sx={{ mt: 2, mb: 1 }}>
                {createError}
              </Alert>
            ) : null
          }
        />
      </CardDisplay>
    </>
  )
}
HostFormsCard.displayName = 'HostFormsCard'

export default HostFormsCard
