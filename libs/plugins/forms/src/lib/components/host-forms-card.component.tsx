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
import type { AglynOrgBilling } from '@aglyn/aglyn'
import {
  buildRoute,
  isFormArchived,
  PageHeaderActions,
  pluginDocsHelp,
  Route,
  useTransferLauncher,
} from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { ICON_VARIANT_SHOW_DETAIL } from '@aglyn/shared-data-enums'
import {
  mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline,
  mdiContentCopy,
  mdiEyeOutline,
  mdiVectorSquare,
} from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import ListTable, {
  ListRowActions,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  type ListFilterClause,
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Alert, Button, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  doc,
  getCountFromServer,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  DUPLICATE_MENU_LABEL,
  useConsoleHostRoute,
  useDuplicateResource,
  useFirestore,
  useSiteContainerOptions,
  useHostResourceApi,
  useLiveArtifactCount,
} from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BUNDLE_ID, FORMS_DOCUMENT_SEGMENT } from '../constants/bundle-common'
import {
  FORM_IN_CAMPAIGN_OPTIONS,
  FORM_LEAD_ROUTING_OPTIONS,
  FORM_LIST_FILTER_FIELDS,
  FORM_LIST_FILTER_HEADERS,
  FORM_LIST_QUERY,
  FORM_LIST_SELECT_FIELDS,
  FORM_STATUS_OPTIONS,
  formListRequest,
} from './form-list-query'
import { FORM_SUBMISSIONS_TRANSFER_KEY } from '../transfer/form-submissions-transfer-key'
import { HOST_FORMS_ZONE } from './form-zones'

/**
 * The filterable columns the table shows. The rest of the declaration —
 * Status, Lead routing, Campaign, In a campaign — reaches the Filters panel as hidden
 * columns (`hiddenFilterColumns`).
 */
const FORM_VISIBLE_FILTER_COLUMNS = [
  'displayName',
  'slug',
  'submissions',
  'leads',
  'lastSubmission',
  'updatedAt',
]
const FORM_HIDDEN_COLUMNS = hiddenFilterVisibility(
  FORM_LIST_FILTER_FIELDS,
  FORM_VISIBLE_FILTER_COLUMNS,
)

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
  /**
   * The org billing document, from the shell.
   *
   * The quota readout's denominator resolves from it. `undefined` means the
   * plan is not known rather than that it is Free — the shell holds this
   * surface behind a spinner until the org read settles, so it reads that way
   * only when the read failed — and the readout says so instead of naming a
   * cap it cannot support.
   */
  org?: Partial<AglynOrgBilling>
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
 * ## The two numeric columns, and when one is honestly blank
 *
 * `stats.submissions` and `stats.leads` are both incremented by
 * `/api/forms/submit` on a write that was happening anyway, and recounted
 * from their rows after a removal (AGL-3330), so both are real numbers.
 * `leads` is counted only for a form whose `routing.lead` is set — it holds
 * `0` there until the first lead — so a form that has never routed to leads
 * carries no figure at all and renders as a dash rather than as `0`. A zero
 * would say this form has produced no leads, which for an unrouted form is a
 * measurement nobody took.
 *
 * ## Export submissions, in the card header
 *
 * Every form's submissions on this site, through the console's export dialog
 * (`forms.submissions`, unfiltered): each form's questions are a group of
 * columns, so one file holds the whole site. One form's alone is exported
 * from that form's page. There is no Import: a submission is what a visitor
 * sent, and a file cannot have sent one.
 */
export function HostFormsCard(props: HostFormsCardProps) {
  const { hostId, basePath, org } = props
  const router = useRouter()
  const transfer = useTransferLauncher()
  // Duplicate (AGL-2936): the copy is a form of its own — its submissions
  // start empty — and opens on its detail page once made.
  const duplicate = useDuplicateResource({
    hostId,
    onDuplicated: (_kind, copy) => router.push(formHref(copy.id)),
  })
  const { orgSlug, subdomain: host } = useConsoleHostRoute(hostId)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  /**
   * The shell's zone renderer (AGL-3043), for other ways to start a form; `null`
   * outside the console shell, where there is no workspace to gate on.
   */
  const CreateZone = useConsoleWidgetSlot()

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
  const [retireError, setRetireError] = useState<string | null>(null)
  /** Bumped by each retire or restore, so the retired count is asked again. */
  const [retiredEpoch, setRetiredEpoch] = useState(0)

  /**
   * Retire a form, or put it back (AGL-2671).
   *
   * A write of one field, client-side like every other edit on this document:
   * the rules already admit it for a host writer, fencing off only `stats`.
   *
   * ⛔ NOT a delete, and the difference is the whole feature. The submissions,
   * the leads and the contact timeline they built are filed under this form,
   * so the document is what makes that history readable; deleting it to stop
   * collection would throw away the reason the merchant kept the form.
   *
   * `Date.now()` is the browser's clock rather than `serverTimestamp()`
   * because {@link isFormArchived} asks for a number greater than zero, and a
   * server sentinel reads as `null` on the local echo — the row would stay
   * looking live until the write round-tripped. The value is a marker, never
   * an audit fact: nothing computes a duration from it.
   */
  const setRetired = useCallback(
    async (formId: string, retired: boolean) => {
      setRetireError(null)
      try {
        await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), {
          archivedAt: retired ? Date.now() : null,
          // The mirror the list's query asks (AGL-3330).
          retired,
          // Retiring and restoring are edits, and Updated says when the form
          // was last edited (AGL-3330): a write that skipped it left a form
          // retired today reading as untouched for weeks.
          updatedAt: Timestamp.now(),
        })
        setRetiredEpoch((epoch) => epoch + 1)
      } catch {
        setRetireError(
          retired
            ? 'Could not retire that form. Try again shortly.'
            : 'Could not restore that form. Try again shortly.',
        )
      }
    },
    [firestore, hostId],
  )

  /*
   * THE LIST IS ITS QUERY (AGL-3330, on the AGL-3321 list query plan).
   *
   * The grid's Filters panel and search box edit the clauses and the words;
   * `useListQuery` puts every one of them on ONE Firestore query and pages
   * that query, so a page is a page of matches and a form whose only match
   * is past the first page is still found. What one query cannot hold — a
   * second range, a second array clause — is refused by name above the list
   * (`ListQueryNotices`) rather than matched over the rows read. See
   * `form-list-query.ts` for every field and the indexes they cost.
   *
   * Unfiltered it reads in document order, as it always has: `orderBy` on a
   * name would drop every form stored without one rather than mis-sort it.
   *
   * A retired form is a TOMBSTONE, not a row, unless the reader asks for
   * Status (AGL-2671). The query leaves them out (`retired == false`), so a
   * page is a page of forms in use; a Status clause replaces that with the
   * reader's own choice. Retiring a form removes it from the list, and
   * without the Status filter that would be a one-way door: the row is the
   * only route back to Restore.
   */
  const [formClauses, setFormClauses] = useState<ListFilterClause[]>([])
  const gridFilter = useListGridFilter({
    clauses: formClauses,
    onChange: setFormClauses,
    selectFields: FORM_LIST_SELECT_FIELDS,
  })
  const filtering = gridFilter.clauses.length > 0 || gridFilter.searchWords.length > 0
  const formsCollection = useMemo(
    () => collection(firestore, 'hosts', hostId, 'forms'),
    [firestore, hostId],
  )
  const {
    status,
    rows: forms,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
  } = useListQuery<any>({
    collection: formsCollection,
    declaration: FORM_LIST_QUERY,
    request: formListRequest(gridFilter.clauses, gridFilter.searchWords),
    deps: [firestore, hostId],
    idField: '$id',
  })

  /*
   * The Campaign filter's choices: the campaigns placed on this site, by
   * name, and any campaign a clause names that the list does not, by its id,
   * so the chip can still be read and cleared.
   *
   * Read once the reader opens the Filters panel, not on every visit: the
   * names cost the org lookup and up to fifty campaign documents, which a
   * reader who came to open one form would pay for a filter they never
   * touched. Until they land the column has no choices, and the panel lists
   * it a moment later.
   */
  const [wantsCampaigns, setWantsCampaigns] = useState(false)
  const siteCampaigns = useSiteContainerOptions('campaign', hostId, {
    enabled: wantsCampaigns || formClauses.some((clause) => clause.field === 'campaignIds'),
  })
  const formFilterOptions = useMemo<Record<string, ListFilterOption[]>>(() => {
    const named = siteCampaigns.options.map((option) => ({
      value: option.value,
      label: option.label,
    }))
    const unnamed = formClauses
      .filter((clause) => clause.field === 'campaignIds')
      .flatMap((clause) => clause.value.split(','))
      .map((value) => value.trim())
      .filter((value) => value && !named.some((option) => option.value === value))
      .map((value) => ({ value, label: value }))
    return {
      status: FORM_STATUS_OPTIONS,
      leadRouting: FORM_LEAD_ROUTING_OPTIONS,
      campaignIds: [...named, ...unnamed],
      inCampaign: FORM_IN_CAMPAIGN_OPTIONS,
    }
  }, [siteCampaigns.options, formClauses])

  /*
   * The COUNT is a server aggregate, not the length of a page. `forms` is one
   * page, and publishing that as the site's form count would read as room to
   * spare on a site that is already at the ceiling.
   */
  const liveFormCount = useLiveArtifactCount(hostId, 'forms')
  // Pending or refused, the page stands in: a LOWER bound, never a confident
  // zero.
  const formsUsed = liveFormCount ?? forms.length
  /*
   * How many forms are retired, for the "keep their slot" line (AGL-2674).
   * An aggregate, because the list no longer reads a retired row unless it is
   * asked for one; asked again after this card retires or restores a form.
   */
  const [retiredCount, setRetiredCount] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    getCountFromServer(query(formsCollection, where('retired', '==', true)))
      .then((snapshot) => {
        if (active) setRetiredCount(snapshot.data().count)
      })
      .catch(() => {
        // The line is a courtesy; without the count it is simply not shown.
      })
    return () => {
      active = false
    }
  }, [formsCollection, retiredEpoch])

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
        // The route's own words when it refused: a spent `formsPerHost`
        // allowance answers "Your plan includes N forms — upgrade in Billing
        // for more", which is the upgrade path a generic failure would hide.
        setCreateError(
          error instanceof Error && error.message && error.message !== 'Create failed'
            ? error.message
            : 'Could not create that form',
        )
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
       * A dash rather than a `0` whenever the field holds no number.
       *
       * `stats.leads` is counted only for a form whose `routing.lead` is set
       * (`0` there until its first lead), so a form that has never routed to
       * leads has no recorded figure. Rendering `0` there would read as "this
       * form has produced no leads", which is a claim about a measurement
       * nobody took.
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
    /*
     * Status and Lead routing, hidden until Columns shows them (AGL-3330).
     * Each is a select the Filters panel offers either way, and draws the
     * choice its value names. Status reads the FACT, `archivedAt`, rather
     * than the `retired` mirror the query asks, so a form the backfill has
     * not reached yet still reads true.
     */
    {
      field: 'status',
      headerName: 'Status',
      minWidth: 110,
      valueGetter: (_value: any, row: any) => String(isFormArchived(row)),
    },
    {
      field: 'leadRouting',
      headerName: 'Lead routing',
      minWidth: 120,
      valueGetter: (_value: any, row: any) => String(row?.routing?.lead === true),
    },
    /*
     * In a campaign, hidden like the two above. Reads the ids the form is
     * filed under — the fact `inCampaign` mirrors for the query — so a form
     * the backfill has not reached still draws the truth.
     */
    {
      field: 'inCampaign',
      headerName: 'In a campaign',
      minWidth: 130,
      valueGetter: (_value: any, row: any) =>
        String(Aglyn.readContainerIds(row, 'campaign').length > 0),
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
                  to: buildRoute(Route.PLUGIN_DOCUMENT_PREVIEW, {
                    orgSlug,
                    host,
                    documentSegment: FORMS_DOCUMENT_SEGMENT,
                    docId: form.$id,
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
                  ? buildRoute(Route.PLUGIN_DOCUMENT_BESIGNER, {
                      orgSlug,
                      host,
                      documentSegment: FORMS_DOCUMENT_SEGMENT,
                      docId: form.$id,
                      versionId,
                    })
                  : formHref(form.$id),
            },
            /*
             * Retire / Restore (AGL-2671). Last in the menu, and the only item
             * here that writes.
             *
             * The label says what it DOES to the form rather than what it does
             * to this list — "Archive" reads like a filing action, and the
             * consequence a merchant needs to weigh is that the form stops
             * collecting. `/api/forms/submit` refuses a retired form, so one
             * still placed on a published page will turn visitors away.
             */
            {
              key: 'duplicate',
              label: DUPLICATE_MENU_LABEL,
              icon: <MdiIcon path={mdiContentCopy.path} size={0.8} />,
              onClick: () =>
                duplicate.request('form', {
                  id: form.$id,
                  name: form.displayName ?? '',
                }),
            },
            isFormArchived(form)
              ? {
                  key: 'restore',
                  label: 'Restore — start collecting again',
                  icon: <MdiIcon path={mdiArchiveArrowUpOutline.path} size={0.8} />,
                  onClick: () => void setRetired(form.$id, false),
                }
              : {
                  key: 'retire',
                  label: 'Retire — stop collecting, keep the history',
                  icon: <MdiIcon path={mdiArchiveArrowDownOutline.path} size={0.8} />,
                  onClick: () => void setRetired(form.$id, true),
                },
          ]}
        />
      )
    }),
  ]

  return (
    <>
      {duplicate.dialog}
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
          {/*
            The denominator is `formsPerHost` — the allowance
            `/api/hosts/resources` refuses the create at, resolved through the
            same `checkQuota` the route calls, so the number offered and the
            number enforced cannot drift apart. `FORMS_MAX_PER_HOST` bounds a
            READ of the catalog and sits above every plan's allowance, so
            quoting it advertises room the server will not honor.
          */}
          <QuotaReadoutComponent
            ready={org != null}
            used={formsUsed}
            limit={Aglyn.checkQuota(org, 'formsPerHost', formsUsed).limit}
            noun="form"
          />
          {/*
            A retired form keeps its slot, and the readout says so rather than
            leaving a merchant to work out why a catalog of three is using five
            (AGL-2674). The count comes from the same aggregate
            `/api/hosts/resources` enforces on, which subtracts deleted forms
            and nothing else — so retirement is deliberately not a way to buy
            room back, and the number here is the number the server will
            refuse a create at.

            Shown only when the site has retired a form (an aggregate — the
            list reads no retired row unless asked): the line answers a
            question nobody is asking on a site that has never retired
            anything.
          */}
          {retiredCount ? (
            <Typography variant="caption" color="text.secondary">
              {'Retired forms keep their slot'}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1}>
            {/*
              Other ways to start a form, from plugins (AGL-3043): the
              `hostForms` zone this plugin declares, drawn through the shell's
              own gated slot. A plugin page cannot mount that slot itself, so
              the shell hands it down, and a widget here passes the gates a
              console page's would.
            */}
            {CreateZone ? (
              <CreateZone slot={HOST_FORMS_ZONE.id} hostId={hostId} orgId={org?.$id} />
            ) : null}
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
        </Stack>
      </PageHeaderActions>
      <CardDisplay
        header="Forms"
        help={pluginDocsHelp('forms', {
          anchor: '#find-a-form',
          excerpt:
            'A form collects submissions into the Inbox, and its design is ' +
            'drawn in the besigner like any other artifact.',
        })}
        HeaderProps={
          transfer?.can('export', { resource: FORM_SUBMISSIONS_TRANSFER_KEY, scope: 'host', hostId })
            ? {
                action: (
                  <Button
                    size="small"
                    onClick={() =>
                      transfer?.openExport({
                        resource: FORM_SUBMISSIONS_TRANSFER_KEY,
                        scope: 'host',
                        hostId,
                      })
                    }
                  >
                    {'Export submissions'}
                  </Button>
                ),
              }
            : undefined
        }
      >
        {retireError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {retireError}
          </Alert>
        ) : null}
        <ListFilterChips
          fields={FORM_LIST_FILTER_FIELDS}
          headers={FORM_LIST_FILTER_HEADERS}
          clauses={gridFilter.clauses}
          onChange={gridFilter.setClauses}
          options={formFilterOptions}
        />
        <ListQueryNotices
          refused={listQueryRefusals(plan.refused, {
            fields: FORM_LIST_FILTER_FIELDS,
            headers: FORM_LIST_FILTER_HEADERS,
            options: formFilterOptions,
          })}
          notices={plan.notices}
        />
        <ListTable
          rowHeight={TABLE_ROW_HEIGHT}
          columns={listFilterGridColumns(
            columns,
            FORM_LIST_FILTER_FIELDS,
            formFilterOptions,
            FORM_LIST_FILTER_HEADERS,
          )}
          initialState={{ columns: { columnVisibilityModel: FORM_HIDDEN_COLUMNS } }}
          /*
           * The grid must NOT also filter. The query answers the panel and
           * the search, so a second pass in the browser could only drop rows
           * that already matched — it compares what a column DRAWS, and the
           * query compares what the document stores.
           */
          filterMode="server"
          filterModel={gridFilter.filterModel}
          onFilterModelChange={gridFilter.onFilterModelChange}
          quickFilter
          // The Campaign filter's names are read once the panel is opened.
          onPreferencePanelOpen={(params) => {
            if (params.openedPanelValue === 'filters') setWantsCampaigns(true)
          }}
          {...(filtering
            ? { noRowsLabel: 'No forms match these filters' }
            : {
                noRowsLabel: 'No forms yet',
                noRowsDescription:
                  'A form collects submissions, dedupes the people who send them, and can route them to a lead. Its design is drawn in the besigner and published like any other artifact.',
                noRowsAction: (
                  <Button variant="contained" onClick={() => setCreateOpen(true)}>
                    {'Create your first form'}
                  </Button>
                ),
              })}
          rows={forms}
          // The whole row opens the detail page; the action cluster stops
          // propagation so a menu click never navigates underneath it.
          onOpen={(id) => router.push(formHref(String(id)))}
          // An empty table while the read is in flight reads as "you have none"
          // rather than "these are on their way".
          loading={status === 'loading'}
          // Paged by the footer below, so the grid must not also slice.
          hideFooter
          // The rows keep the query's order; a header sort would order only
          // the page on screen and read as the whole list's.
          disableColumnSorting
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
