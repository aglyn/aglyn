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

import { isInstalledTemplateSource } from '@aglyn/aglyn/plugin-manager/plugin-template-sources'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { artifactDeleteListKeys } from '@aglyn/aglyn/app-utils/artifact-list-keys'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { type GridColDef } from '@mui/x-data-grid'
import {
  mdiFileMultipleOutline,
  mdiPencilOutline,
  mdiPlusBoxOutline,
  mdiContentCopy,
  mdiTrashCanOutline,
  mdiEyeOutline,
} from '@aglyn/shared-data-mdi'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  DUPLICATE_MENU_LABEL,
  useDuplicateResource,
  useFirestore,
  useHostResourceApi,
  useHostVersionApi,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Button, Chip, Stack, Tooltip } from '@mui/material'
import DocumentPresenceChips from '../document-presence-chips.component'
import usePresenceSummary from '../../hooks/use-presence-summary'
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { ICON_VARIANT_SHOW_DETAIL } from '@aglyn/shared-data-enums'
import { useRouter } from 'next/navigation'
import ListTable, {
  ListRowActions,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { checkOrgQuota } from '../../constants/entitlements'
import { TABLE_ROW_HEIGHT } from '../../constants/shared'
import { buildRoute, Route } from '../../constants/route-links'
import { useHostSubdomain } from '../host-id-provider'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgSlug } from '../../hooks/use-org-scope'
import {
  TEMPLATE_KIND_OPTIONS,
  TEMPLATE_LIST_BASE,
  TEMPLATE_LIST_HEADERS,
  TEMPLATE_LIST_QUERY,
} from '../../utils/artifact-list-queries'
import createPageFromTemplate, {
  templateScreenAddressRefusal,
  withBundleRootScreen,
} from './create-page-from-template'
import { releaseDefaultHomeRoot } from '../../constants/screen-publishing'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import UseTemplateDialog from './use-template-dialog.component'
import PluginWidgetSlot from '../plugin-widget-slot.component'
import useStarterPages from './use-starter-pages'
import {
  TEMPLATE_SOURCE_OPTIONS,
  templateSourceBadge,
} from './template-source-badge'

/*
 * What the library grid's Filters panel and quick search offer: every clause
 * on the query (AGL-3321) — see `TEMPLATE_LIST_QUERY`, whose note says what
 * each asks and which composite serves it. Kind and Source are the STORED
 * values, which every create writes and the list-keys backfill stamped on
 * the templates that predate them; an installer's Source value is the one it
 * declares (`TEMPLATE_SOURCE_OPTIONS`).
 */
const TEMPLATE_FILTER_OPTIONS = {
  kind: TEMPLATE_KIND_OPTIONS,
  source: TEMPLATE_SOURCE_OPTIONS,
}
const TEMPLATE_SELECT_FIELDS = Object.keys(TEMPLATE_FILTER_OPTIONS)

/**
 * Templates library (AGL-667).
 *
 * Templates are inert: nothing here is on the live site until it is used,
 * which is what lets an installed template land somewhere safe instead of
 * publishing pages the moment someone clicks install.
 *
 * Grouped by kind rather than listed flat because the three kinds are used
 * in completely different places — a page template makes a screen, a
 * component template goes onto one.
 */
/** What the page needs to render the header's plan readout. */
export interface TemplateQuotaReadout {
  ready: boolean
  used: number
  limit: number
}

export function HostTemplatesCard({
  hostId,
  onQuota,
  onCreate,
}: {
  hostId: string
  /**
   * The empty state's way OUT (AGL-1152). The card owns the list, the PAGE
   * owns the create drawer — so the button comes down rather than being
   * rebuilt here against a second drawer that knows nothing about the quota
   * check. Optional: without it the empty state is the illustration and the
   * sentence, which is what this list showed before.
   */
  onCreate?: () => void
  /**
   * Publishes the template count and cap so the PAGE can render the readout in
   * its header. The card keeps ownership of the numbers because it owns the
   * listener they come from — a page that counted separately would be a second
   * source for the same fact.
   */
  onQuota?: (readout: TemplateQuotaReadout) => void
}) {
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  // Duplicate (AGL-2936): one template at a time — a starter bundle's pages
  // are copied by using it, not by copying the bundle row.
  const duplicate = useDuplicateResource({
    hostId,
    onDuplicated: (_kind, copy) =>
      enqueueSnackbar(`Duplicated as “${copy.name}”`, {
        variant: 'success',
        persist: false,
      }),
  })
  const { confirm } = useConfirmationContext()
  const { queueLoading } = useLoading()
  const { data: user } = useUser()
  const { org, ready: orgReady } = useCurrentOrg()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const router = useRouter()
  const [useTemplate, setUseTemplate] = useState<Record<string, any> | null>(
    null,
  )
  /**
   * THE LIBRARY, paged by its query (AGL-3321).
   *
   * It was a whole read — every template document up to a ceiling of two
   * hundred — grouped, sorted and filtered in the browser, because a row is
   * a page GROUP: a multi-page starter materializes one document per screen
   * and collapses into one row (AGL-696), and document-ordered ids scatter a
   * starter's pages across any page-sized window.
   *
   * The grouping is now WRITTEN: the page that leads a starter's row carries
   * `libraryRow: true` and the others `false`, and so does a deleted template
   * (`artifactCreateListKeys`/`artifactDeleteListKeys`). So the query asks for
   * library ROWS — `TEMPLATE_LIST_BASE` — and pages them, with every clause
   * and the search on it, and a starter is one row wherever its pages fall.
   * The rows run in the walk's order (the document id; `hostArtifactQuery`
   * says why) and are never re-sorted.
   */
  const gridFilter = useListGridFilter({ selectFields: TEMPLATE_SELECT_FIELDS })
  const templateList = useListQuery<any>({
    collection: hostId ? collection(firestore, 'hosts', hostId, 'templates') : null,
    declaration: TEMPLATE_LIST_QUERY,
    request: {
      clauses: gridFilter.clauses,
      search: gridFilter.searchWords,
      base: TEMPLATE_LIST_BASE,
    },
    deps: [firestore, hostId],
    idField: '$id',
    /*
     * The scope and every predicate are on MUTABLE fields — a delete clears
     * `libraryRow` — so a document can drop out of the live target
     * mid-session, and the SDK caches that as a tombstone every other reader
     * of the path is then served (AGL-827/929). Confirmed against the server
     * before it is believed.
     */
    confirmDisappearances: true,
  })
  const templatesNarrowed =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.length > 0
  const templateRefusals = useMemo(
    () =>
      listQueryRefusals(templateList.plan.refused, {
        fields: TEMPLATE_LIST_QUERY.fields,
        headers: TEMPLATE_LIST_HEADERS,
        options: TEMPLATE_FILTER_OPTIONS,
      }),
    [templateList.plan],
  )
  const { status } = templateList
  /*
   * A tombstone is never a library row — its delete wrote `libraryRow: false`
   * — so this is a guard for a delete path that did not, not a filter: no
   * clause or search word is matched here.
   */
  const heads = useMemo(
    () => templateList.rows.filter((entry: any) => !entry.deletedAt),
    [templateList.rows],
  )

  /*
   * The pages of each STARTER on this page, read by starter id (AGL-3321) —
   * see `useStarterPages`. `starterPagesEpoch` re-reads them after a delete.
   */
  const [starterPagesEpoch, setStarterPagesEpoch] = useState(0)
  const starterIds = useMemo(
    () =>
      heads
        .map((entry: any) => entry.source?.starterId)
        .filter((id: unknown): id is string => typeof id === 'string' && id !== ''),
    [heads],
  )
  const { pages: starterPages, pagesOf: starterPagesOf } = useStarterPages(
    firestore,
    hostId,
    starterIds,
    starterPagesEpoch,
  )

  /**
   * One row per library row: a template, or a starter led by one of its
   * pages and standing for all of them. `pages` is what makes the bundle
   * actions mean the bundle, so it is carried on the row.
   */
  const rows = useMemo(
    () =>
      heads.map((template: any) => {
        const starterId = template.source?.starterId as string | undefined
        if (starterId) {
          const pages = starterPages.get(starterId) ?? [template]
          return {
            key: `starter:${starterId}`,
            template,
            pages,
            displayName:
              template.source?.starterName ?? template.displayName ?? starterId,
            description: template.source?.starterDescription,
          }
        }
        return {
          key: template.$id,
          template,
          pages: [template],
          displayName: template.displayName ?? template.$id,
          description: template.description,
        }
      }),
    [heads, starterPages],
  )

  /**
   * The pages a row stands for, read FRESH when it is acted on (AGL-3321):
   * a starter's pages by its id — the row may have been drawn before they
   * arrived, and a bundle action must never act on a partial set — and any
   * other row's one template.
   */
  const pagesOf = useCallback(
    async (row: { template: any; pages: any[] }): Promise<any[]> => {
      const starterId = row.template?.source?.starterId
      return starterId ? starterPagesOf(starterId) : row.pages
    },
    [starterPagesOf],
  )

  /**
   * Deletes everything the ROW stands for, which for a grouped starter is
   * all of its pages (AGL-696).
   *
   * Deleting only the representative page — what a row-shaped action did
   * before — left the row in place reading "(4 pages)" after a confirm that
   * said the template had been removed. Either the row means the bundle or
   * it does not; it means the bundle, so this does too.
   */
  const handleDelete = useCallback(
    (row: { displayName: string; template: any; pages: any[] }) => async () => {
      const pages = await pagesOf(row)
      const count = pages.length
      const confirmed = await confirm({
        title: count > 1 ? `Delete all ${count} pages?` : 'Delete this template?',
        description:
          count > 1
            ? `"${row.displayName}" is a starter of ${count} page templates, ` +
              'and all of them are removed from your library: ' +
              `${pages
                .map((page: any) => page.displayName ?? page.$id)
                .join(', ')}. Pages you already created from it are ` +
              'unaffected. To remove just one, open the starter and delete ' +
              'that page from its detail page.'
            : `"${row.displayName}" is removed from your library. Anything ` +
              'you already created from it is unaffected.',
        confirmationText: count > 1 ? `Delete ${count} pages` : 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      // Soft delete, matching reusable components — a template may be the
      // only remaining copy of a page someone deleted.
      // No longer a library row either (AGL-3321), or the library's query
      // would still list it.
      const deletedAt = Timestamp.now()
      await Promise.all(
        pages.map((page: any) =>
          updateDoc(doc(firestore, 'hosts', hostId, 'templates', page.$id), {
            deletedAt,
            ...artifactDeleteListKeys('templates'),
          }),
        ),
      )
      setStarterPagesEpoch((epoch) => epoch + 1)
      enqueueSnackbar(
        count > 1 ? `Deleted ${count} page templates` : 'Template deleted',
        { variant: 'success', persist: false },
      )
    },
    [confirm, firestore, hostId, enqueueSnackbar, pagesOf],
  )

  /**
   * Uses a whole starter bundle: one screen per page, in authored order
   * (AGL-696).
   *
   * This is what "Use" has to mean on a grouped row — the gallery card for
   * the same starter already creates all five pages, and a row-level Use
   * that quietly created only the first would be the grouping lying about
   * its own scope. Per-page Use stays reachable from the detail page.
   */
  const handleUseBundle = useCallback(
    (row: { displayName: string; template: any; pages: any[] }) => async () => {
      const pages = await pagesOf(row)
      // AGL-1422, before the confirmation rather than after it: the quota
      // below reads an undefined `org` as the FREE tier, so inside the
      // loading window this asked the user to confirm adding five pages and
      // then refused with "your plan allows N". Ask about the plan before
      // asking them anything.
      if (!orgReady) {
        return void enqueueSnackbar(
          'Checking your plan — try again in a moment',
          { variant: 'info', persist: false },
        )
      }
      const confirmed = await confirm({
        title: `Add ${pages.length} pages from "${row.displayName}"?`,
        description:
          `Creates one page per template — ${pages
            .map((page: any) => page.displayName ?? page.$id)
            .join(', ')} — and publishes each at its own address. Existing ` +
          'pages are never touched, and the templates stay in your library.',
        confirmationText: `Add ${pages.length} pages`,
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const dequeue = queueLoading()
      // Tracked outside the try so a failure part-way can say how far it
      // actually got. Creating five pages is five writes, not one — there
      // is no transaction to roll back, and silently reporting only the
      // error would leave pages on the site the message never mentioned.
      let created = 0
      // Screens whose address the site cannot serve, named after the run
      // (AGL-2588) — see the same decision in the gallery's own applier.
      const skipped: string[] = []
      try {
        // Read the routing map fresh so the slug check reflects anything
        // published since this page loaded.
        const hostSnapshot = await getDoc(doc(firestore, 'hosts', hostId))
        const routes = (hostSnapshot.get('screens') ?? {}) as Record<
          string,
          string
        >
        // Count screen DOCUMENTS, which is what the server's quota counts —
        // NOT the routing map, which holds only routed screens and so
        // under-counts. Getting this wrong lets a doomed run start and
        // abort half way, which is exactly what it did before this.
        const screenCount = (
          await getCountFromServer(
            collection(firestore, 'hosts', hostId, 'screens'),
          )
        ).data().count
        // `- 1` because checkQuota allows while usage is BELOW the limit, so
        // this asks "is the count after adding them still within plan?"
        const quota = checkOrgQuota(
          org,
          'screensPerHost',
          screenCount + pages.length - 1,
        )
        if (!quota.allowed) {
          return void enqueueSnackbar(
            `This starter needs ${pages.length} pages and this site has ` +
              `${screenCount} — your plan allows ${quota.limit}. See Billing ` +
              'to upgrade.',
            { variant: 'warning', persist: false },
          )
        }
        // A new site is born with a placeholder home page on `/` (AGL-3408).
        // A bundle is somebody's whole site, so it takes the root from that
        // placeholder — and only from it; a home page the owner made is never
        // moved. The placeholder stays in Screens as a draft.
        const releasedRoot =
          pages.length > 0 &&
          (await releaseDefaultHomeRoot(firestore, { hostId, user }))
        const used = new Set<string>(Object.values(routes))
        if (releasedRoot) used.delete(SCREEN_ROOT_PATH)
        // Same rule the gallery applies (AGL-1575): a bundle where nothing
        // claims the site root, applied to a host that has no home page,
        // gives the root to its first page rather than leaving the site 404ing
        // at its own URL. A host that already has a home keeps it.
        for (const page of withBundleRootScreen(pages, used)) {
          // Skip rather than abort or substitute: the rest of the bundle is
          // still worth having, and an address nobody chose is what the slug
          // guards exist to prevent (AGL-2588).
          const refusal = templateScreenAddressRefusal({
            slug: page.slug,
            displayName: page.displayName ?? page.$id,
          })
          if (refusal) {
            skipped.push(`"${page.displayName ?? page.$id}" — ${refusal}`)
            continue
          }
          // Same helper the single-template Use flow calls (AGL-672), so
          // create-screen → write-version → publish-route and its slug
          // de-confliction have one implementation.
          await createPageFromTemplate(
            firestore,
            createHostResource as any,
            createHostVersion as any,
            {
              hostId,
              displayName: page.displayName ?? page.$id,
              nodes: (page.nodes ?? {}) as Record<string, unknown>,
              description: page.description,
              seo: page.seo,
              slug: page.slug,
              usedSlugs: used,
              user,
            },
          )
          created += 1
        }
        if (created) {
          enqueueSnackbar(
            `Added ${created} page${created === 1 ? '' : 's'} from "${
              row.displayName
            }"` +
              (releasedRoot
                ? '. The placeholder home page is kept in Pages as a draft.'
                : ''),
            { variant: 'success', persist: false },
          )
        }
        if (skipped.length) {
          // Persistent: skipping is only honest if the person reads which
          // screens were left out and why.
          enqueueSnackbar(
            `${skipped.length} page${
              skipped.length === 1 ? '' : 's'
            } could not be added: ${skipped.join('; ')}`,
            { variant: 'warning', persist: true },
          )
        }
      } catch (error) {
        console.error(error)
        const reason =
          error instanceof Error ? error.message : 'Could not use the starter.'
        enqueueSnackbar(
          created
            ? `Added ${created} of ${pages.length} pages, then stopped: ` +
              `${reason} The pages already created are on your site.`
            : reason,
          { variant: 'error', allowDuplicate: true },
        )
      } finally {
        dequeue()
      }
    },
    [
      confirm,
      queueLoading,
      firestore,
      hostId,
      org,
      orgReady,
      createHostResource,
      createHostVersion,
      enqueueSnackbar,
      pagesOf,
    ],
  )

  // Matches the layouts and screens column/action shape (AGL-694).
  /**
   * Who is already in each template, beside its name (AGL-2486).
   *
   * ONE request for the whole list. The RTDB rules admit a client to exactly
   * one room at a time, so a chip per row would mean a subscription per row —
   * and the presence tree is sparse enough (2 occupied rooms against a largest
   * host of 69 documents) that ~97% of them would report an empty room.
   *
   * Rolled up across VERSIONS, because a row names a document and not a
   * version. The chip's own copy carries that caveat so the count cannot be
   * read as "already in the one you are about to open".
   */
  const { peopleIn } = usePresenceSummary(hostId)

  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      renderCell: ({ row }: any) => (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <AppLink
            href={buildRoute(Route.TEMPLATE_DETAILS, {
              orgSlug,
              host,
              templateId: row.template.$id,
            })}
          >
            {row.pages.length > 1
              ? `${row.displayName} (${row.pages.length} pages)`
              : row.displayName}
          </AppLink>
          <DocumentPresenceChips
            people={peopleIn('template', row.template.$id)}
          />
        </Stack>
      ),
    },
    {
      field: 'kind',
      headerName: 'Kind',
      minWidth: 110,
      type: 'string',
      valueGetter: (_value: any, row: any) => row.template.kind ?? 'page',
    },
    {
      field: 'source',
      headerName: 'Source',
      minWidth: 150,
      sortable: false,
      renderCell: ({ row }: any) => {
        const badge = templateSourceBadge(row.template.source, {
          editedAt: row.template.editedAt,
        })
        return (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
            {/* Provenance is server-managed (AGL-666), so this badge means
                something — a client cannot claim an installer's origin. */}
            <Tooltip title={badge.title}>
              <Chip size="small" label={badge.label} color={badge.color} />
            </Tooltip>
            {/* What the installer says about this copy — an update to
                install, say (AGL-671) — drawn by the plugin that installed
                it, which reads its own listings and installs through its
                own route (AGL-3080). */}
            {isInstalledTemplateSource(row.template.source?.type) ? (
              <PluginWidgetSlot
                slot="templateInstallStatus"
                hostId={hostId}
                template={row.template}
              />
            ) : null}
          </Stack>
        )
      },
    },
    {
      field: 'description',
      headerName: 'Description',
      flex: 1,
      minWidth: 220,
      type: 'string',
      // Blank reads as a rendering gap; '--' reads as "nothing here",
      // which is what the screens list has always shown.
      valueFormatter: (value: any) => value || '--',
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      flex: 1,
      minWidth: 170,
      type: 'date',
      valueGetter: (_value: any, row: any) =>
        row.template.updatedAt?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      flex: 1,
      minWidth: 170,
      type: 'date',
      valueGetter: (_value: any, row: any) =>
        row.template.createdAt?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    /*
      The shared trailing cluster (AGL-2501). A template's quick action is
      Preview — it is the one artifact with no live address of its own and no
      detail worth a second icon, so "what does it look like" is the question
      the row is actually asked.

      BUNDLES keep their own wording throughout. A five-page template has no
      single canvas behind it, so "Edit in besigner" is meaningless on one and
      the menu offers its page list instead — that distinction is AGL-696's and
      moving the controls must not quietly drop it.
    */
    listActionsColumn((row: any) => {
      const template = row.template
      const bundle = row.pages.length > 1
      const items = [
        {
          key: 'details',
          label: bundle ? `Open ${row.pages.length} pages` : 'View details',
          icon: (
            <MdiIcon
              path={bundle ? mdiFileMultipleOutline.path : ICON_VARIANT_SHOW_DETAIL.path}
              size={0.8}
            />
          ),
          href: buildRoute(Route.TEMPLATE_DETAILS, {
            orgSlug,
            host,
            templateId: template.$id,
          }),
        },
        ...(bundle
          ? []
          : [
              {
                key: 'besigner',
                label: 'Edit in besigner',
                icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
                href: buildRoute(Route.TEMPLATE_BESIGNER, {
                  orgSlug,
                  host,
                  templateId: template.$id,
                }),
              },
            ]),
        {
          key: 'use',
          label: bundle ? `Use all ${row.pages.length} pages` : 'Use',
          icon: <MdiIcon path={mdiPlusBoxOutline.path} size={0.8} />,
          onClick: bundle
            ? handleUseBundle(row)
            : () => setUseTemplate(template),
        },
        ...(bundle
          ? []
          : [
              {
                key: 'duplicate',
                label: DUPLICATE_MENU_LABEL,
                icon: <MdiIcon path={mdiContentCopy.path} size={0.8} />,
                onClick: () =>
                  duplicate.request('template', {
                    id: template.$id,
                    name: template.displayName ?? '',
                  }),
              },
            ]),
        {
          key: 'delete',
          label: bundle ? `Delete all ${row.pages.length} pages` : 'Delete',
          destructive: true,
          icon: <MdiIcon path={mdiTrashCanOutline.path} size={0.8} />,
          onClick: handleDelete(row),
        },
      ]
      return (
        <ListRowActions
          label={template.displayName ?? template.$id}
          quick={{
            icon: mdiEyeOutline.path,
            label: 'Preview',
            to: buildRoute(Route.TEMPLATE_PREVIEW, {
              orgSlug,
              host,
              templateId: template.$id,
            }),
          }}
          items={items}
        />
      )
    }),
  ]

  /**
   * `templatesPerHost` is enforced by `/api/hosts/resources` (AGL-473) and,
   * until AGL-2246, appeared NOWHERE in the console — not on this card, not
   * in the billing meters, not even as a row on the plan-comparison grid. It
   * was the one quota key of 31 with no customer-facing surface at all, so a
   * merchant on Starter learned their 50-template cap by being refused a save.
   *
   * The count is a server aggregate over exactly what the route counts —
   * every template that is not a starter's page — because the list is a page
   * now (AGL-3321) and its length is not the library's size (AGL-1716). It is
   * re-asked whenever the page's rows change, which is when a create or a
   * delete could have moved it.
   */
  const rowsSignature = templateList.rows.map((entry: any) => entry.$id).join(',')
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  useEffect(() => {
    if (!hostId) return
    let active = true
    void getCountFromServer(
      query(
        collection(firestore, 'hosts', hostId, 'templates'),
        where('source.type', '!=', 'starter'),
      ),
    )
      .then((snapshot) => {
        if (active) setTemplateCount(snapshot.data().count)
      })
      .catch(() => {
        // Pending or refused, the page stands in: a LOWER bound.
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, rowsSignature, starterPagesEpoch])
  const quotaUsed = templateCount ?? heads.length
  const templateQuota = checkOrgQuota(org, 'templatesPerHost', quotaUsed)
  /**
   * Hand the page the numbers it needs for the header readout.
   *
   * An effect rather than a render-time call: this fires during the card's
   * render otherwise, and setting state on the parent mid-render is the React
   * warning that turns into a loop. Keyed on the three primitives, so it
   * re-publishes when the count or the plan actually changes and not on every
   * keystroke elsewhere on the page.
   */
  // `quotaLimit`, not `limit` — the bare name is Firestore's `limit()`.
  const quotaLimit = templateQuota.limit
  useEffect(() => {
    onQuota?.({ ready: orgReady, used: quotaUsed, limit: quotaLimit })
  }, [onQuota, orgReady, quotaUsed, quotaLimit])

  return (
    <CardDisplay>
      {duplicate.dialog}
      {/* The readout moved OUT of this card and into the page header, beside
          the create button, matching the Sites page (AGL-2113). It read as a
          caption on a list here; opposite the heading it is a fact about the
          page, which is what it is. `HostTemplatesCard` publishes the numbers
          through `onQuota` so the page can render it without counting the
          documents a second time — two counts of the same thing is how a
          readout and the gate it belongs to come to disagree. */}
      <ListFilterChips
        fields={TEMPLATE_LIST_QUERY.fields}
        headers={TEMPLATE_LIST_HEADERS}
        clauses={gridFilter.clauses}
        onChange={gridFilter.setClauses}
        options={TEMPLATE_FILTER_OPTIONS}
      />
      <ListQueryNotices refused={templateRefusals} notices={templateList.plan.notices} />
      <ListTable
        aria-label="Templates"
        rowHeight={TABLE_ROW_HEIGHT}
        // A template ROW is a page GROUP, not a document — a five-page bundle
        // is one row keyed by its group, so this list keeps its own row id.
        getRowId={(row) => row.key}
        columns={listFilterGridColumns(
          columns,
          TEMPLATE_LIST_QUERY.fields,
          TEMPLATE_FILTER_OPTIONS,
          TEMPLATE_LIST_HEADERS,
        )}
        // A filtered-to-nothing library says so; the empty state and its way
        // out are for a site that has no templates at all.
        {...(templatesNarrowed
          ? {
              noRowsLabel: templateList.hasMore
                ? 'No templates match on this page — the next one has more'
                : 'No templates match these filters',
            }
          : {
              noRowsLabel: 'No templates yet',
              noRowsDescription:
                'A template is a saved starting point for a page or layout. Create one, or save one from a page you have already built.',
              noRowsAction: onCreate ? (
                <Button variant="contained" onClick={onCreate}>
                  {'Create your first template'}
                </Button>
              ) : null,
            })}
        rows={rows}
        // The panel and the search are the grid's; the QUERY answers them
        // (AGL-3321), so the grid filters and sorts nothing.
        filterMode="server"
        filterModel={gridFilter.filterModel}
        onFilterModelChange={gridFilter.onFilterModelChange}
        quickFilter
        disableColumnSorting
        onOpen={(_id, row) =>
          router.push(
            buildRoute(Route.TEMPLATE_DETAILS, {
              orgSlug,
              host,
              templateId: row.template.$id,
            }),
          )
        }
        loading={status === 'loading'}
        // Paged by the footer below, so the grid must not also slice.
        hideFooter
      />
      <ListPagination
        page={templateList.page}
        pageSize={templateList.pageSize}
        rowCount={rows.length}
        hasMore={templateList.hasMore}
        onPageChange={templateList.setPage}
        onPageSizeChange={templateList.setPageSize}
      />
      <UseTemplateDialog
        hostId={hostId}
        template={useTemplate}
        onClose={() => setUseTemplate(null)}
      />
    </CardDisplay>
  )
}

HostTemplatesCard.displayName = 'HostTemplatesCard'

export default HostTemplatesCard
