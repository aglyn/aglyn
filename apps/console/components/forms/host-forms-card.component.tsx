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
import { ICON_VARIANT_SHOW_DETAIL } from '@aglyn/shared-data-enums'
import { mdiEyeOutline, mdiVectorSquare } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListTable, {
  ListRowActions,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { Button, Stack } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useFirestore, usePagedCollection } from '@aglyn/tenant-feature-instance'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import DocumentPresenceChips from '../document-presence-chips.component'
import { useHostSubdomain } from '../host-id-provider'
import { buildRoute, Route } from '../../constants/route-links'
import { TABLE_ROW_HEIGHT } from '../../constants/shared'
import usePresenceSummary from '../../hooks/use-presence-summary'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useLiveArtifactCount from '../../hooks/use-live-artifact-count'
import { hostArtifactQuery } from '../../utils/host-artifact-queries'

/** The count and cap a forms readout renders. */
export interface FormQuotaReadout {
  ready: boolean
  used: number
  limit: number
}

export interface HostFormsCardProps {
  hostId: string
  /**
   * Publishes the form count and cap so the PAGE can render the readout beside
   * its create button — the same wire the components and templates cards use,
   * and for the same reason: the card owns the listener the count comes from,
   * so a page that counted separately would be a second source for one fact.
   */
  onQuota?: (readout: FormQuotaReadout) => void
  /**
   * The empty state's way OUT. The card owns the list and therefore the empty
   * state, but the PAGE owns the create drawer, so the button comes down
   * rather than being rebuilt here.
   */
  onCreate?: () => void
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
 * It was a paragraph and a button. That reads as a smaller feature than it is:
 * a form is a thing with a slug, a submission count and a version history, and
 * none of that is visible until the reader has already committed to making
 * one. Rendering the columns with the empty overlay inside them teaches the
 * shape of the artifact BEFORE the first one exists — which is what the
 * components list has always done, and the only reason it was not done here is
 * that this list started as a stub.
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
  const { hostId, onQuota, onCreate } = props
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()

  /**
   * The list PAGES, over an ordered walk.
   *
   * `hostArtifactQuery` holds the ordering decision and the reason it is the
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
    (pageLimit) => hostArtifactQuery(firestore, hostId, 'forms', pageLimit),
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
  useEffect(() => {
    onQuota?.({
      ready: status !== 'loading',
      used: formsUsed,
      limit: Aglyn.FORMS_MAX_PER_HOST,
    })
  }, [onQuota, status, formsUsed])

  /**
   * Who is already in each form, beside its name.
   *
   * ONE request for the whole list, and rolled up across VERSIONS because a
   * row names a document and not a version — the chip's own copy carries that
   * caveat.
   */
  const { peopleIn } = usePresenceSummary(hostId)

  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      renderCell: ({ id, value }: any) => (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <AppLink
            href={buildRoute(Route.FORM_DETAILS, {
              orgSlug,
              host,
              formId: id as string,
            })}
          >
            {value || (id as string)}
          </AppLink>
          <DocumentPresenceChips people={peopleIn('form', id as string)} />
        </Stack>
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
            ...(versionId
              ? {
                  to: buildRoute(Route.FORM_PREVIEW, {
                    orgSlug,
                    host,
                    formId: form.$id,
                    versionId,
                  }),
                }
              : {
                  unavailableReason:
                    'Nothing to preview yet — open it in the besigner once.',
                }),
          }}
          items={[
            {
              key: 'details',
              label: 'View details',
              icon: <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} size={0.8} />,
              href: buildRoute(Route.FORM_DETAILS, {
                orgSlug,
                host,
                formId: form.$id,
              }),
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
              href: versionId
                ? buildRoute(Route.FORM_BESIGNER, {
                    orgSlug,
                    host,
                    formId: form.$id,
                    versionId,
                  })
                : buildRoute(Route.FORM_DETAILS, {
                    orgSlug,
                    host,
                    formId: form.$id,
                  }),
            },
          ]}
        />
      )
    }),
  ]

  // No card header: the page header already says "Forms", and the other
  // artifact lists do not repeat theirs either.
  return (
    <CardDisplay>
      <ListTable
        rowHeight={TABLE_ROW_HEIGHT}
        columns={columns}
        noRowsLabel="No forms yet"
        noRowsDescription="A form collects submissions, dedupes the people who send them, and can route them to a lead. Its design is drawn in the besigner and published like any other artifact."
        noRowsAction={
          onCreate ? (
            <Button variant="contained" onClick={onCreate}>
              {'Create your first form'}
            </Button>
          ) : null
        }
        rows={forms}
        // The whole row opens the detail page; the action cluster stops
        // propagation so a menu click never navigates underneath it.
        onOpen={(id) =>
          router.push(buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId: id }))
        }
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
    </CardDisplay>
  )
}
HostFormsCard.displayName = 'HostFormsCard'

export default HostFormsCard
