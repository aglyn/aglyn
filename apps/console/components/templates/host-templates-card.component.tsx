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

import type { TemplateKind } from '@aglyn/aglyn'
import {
  AppLink,
  CardDisplay,
  DataTableComponent,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { GridActionsCellItem, type GridColDef } from '@mui/x-data-grid'
import {
  mdiDownloadOutline,
  mdiFileMultipleOutline,
  mdiPencilOutline,
  mdiPlusBoxOutline,
  mdiTrashCanOutline,
} from '@aglyn/shared-data-mdi'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  useFirestore,
  useHostResourceApi,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Chip, Tooltip } from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { checkOrgQuota } from '../../constants/entitlements'
import { TABLE_ROW_HEIGHT } from '../../constants/shared'
import { buildRoute, Route } from '../../constants/route-links'
import { useHostSubdomain } from '../host-id-provider'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import createPageFromTemplate from './create-page-from-template'
import UseTemplateDialog from './use-template-dialog.component'

/**
 * Row order for the table's default sort. The three kinds are used in
 * completely different places — a page template makes a screen, a component
 * template goes onto one — and grouping them that way was the useful part of
 * the sectioned layout this table replaced.
 */
const KIND_ORDER: TemplateKind[] = ['page', 'component', 'layout']

/**
 * Provenance badge (AGL-666), qualified once the copy has been edited
 * locally (AGL-681).
 *
 * `source` is server-managed so a marketplace claim cannot be forged. But
 * once someone edits a downloaded template, "Marketplace" alone starts
 * vouching for content the publisher never wrote — so an edited copy says
 * so. `editedAt` is client-written on purpose: it is a claim nobody gains
 * anything by faking about their own copy.
 */
function sourceChip(
  source: { type?: string; listingId?: string } | undefined,
  editedAt?: unknown,
) {
  const edited = Boolean(editedAt)
  if (source?.type === 'marketplace') {
    return {
      label: edited ? 'Marketplace · edited' : 'Marketplace',
      color: 'secondary' as const,
    }
  }
  if (source?.type === 'starter') {
    return {
      label: edited ? 'Starter · edited' : 'Starter',
      color: 'default' as const,
    }
  }
  return { label: 'Saved here', color: 'default' as const }
}

/**
 * Templates library (AGL-667).
 *
 * Templates are inert: nothing here is on the live site until it is used,
 * which is what lets marketplace downloads land somewhere safe instead of
 * publishing pages the moment you click install.
 *
 * Grouped by kind rather than listed flat because the three kinds are used
 * in completely different places — a page template makes a screen, a
 * component template goes onto one.
 */
export function HostTemplatesCard({ hostId }: { hostId: string }) {
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { queueLoading } = useLoading()
  const { data: user } = useUser()
  const { org } = useCurrentOrg()
  const createHostResource = useHostResourceApi()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const router = useRouter()
  const [useTemplate, setUseTemplate] = useState<Record<string, any> | null>(
    null,
  )
  const [updating, setUpdating] = useState<string | null>(null)
  /**
   * Listing id → latest published version (AGL-671).
   *
   * "An update is available" needs no new data: a listing already records
   * `latestVersion`, and an installed template records the version it came
   * from. This is that comparison.
   */
  const [latestByListing, setLatestByListing] = useState<
    Map<string, number | string>
  >(new Map())
  const { data: templateDocs, status } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'templates'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )

  /**
   * One row per template, EXCEPT that a starter's pages collapse into a
   * single row keyed by `source.starterId`.
   *
   * A multi-page starter materializes one document per screen (AGL-687), so
   * flat it would put five rows in the library for something the gallery
   * presents as one card. Grouping keeps the two surfaces agreeing, and
   * AGL-696 confirmed it after looking at a real five-page starter — but
   * only once the row's ACTIONS were made to mean the bundle rather than
   * silently mean its first page. A grouped row now uses and deletes all of
   * its pages; per-page Edit and Use live on the detail page, which lists the
   * siblings. `pages` is what makes that possible, so it is carried on the
   * row rather than recomputed per action.
   */
  const rows = useMemo(() => {
    const seenStarters = new Set<string>()
    const out: Array<{
      key: string
      /** Row's representative document — the first page of a bundle. */
      template: any
      /** Every document the row stands for; length 1 when not a bundle. */
      pages: any[]
      displayName: string
      description?: string
    }> = []
    const live = (templateDocs ?? []).filter((entry: any) => !entry.deletedAt)
    // Kind order first, then name.
    const kindRank = (kind: string) => KIND_ORDER.indexOf(kind as TemplateKind)
    const sorted = [...live].sort((a: any, b: any) => {
      const byRank = kindRank(a.kind ?? 'page') - kindRank(b.kind ?? 'page')
      if (byRank !== 0) return byRank
      return String(a.displayName ?? '').localeCompare(
        String(b.displayName ?? ''),
      )
    })
    for (const template of sorted) {
      const starterId = template.source?.starterId as string | undefined
      if (starterId) {
        if (seenStarters.has(starterId)) continue
        seenStarters.add(starterId)
        const pages = live
          .filter((entry: any) => entry.source?.starterId === starterId)
          .sort(
            (a: any, b: any) =>
              Number(a.source?.starterOrder ?? 0) -
              Number(b.source?.starterOrder ?? 0),
          )
        out.push({
          key: `starter:${starterId}`,
          template: pages[0] ?? template,
          pages: pages.length ? pages : [template],
          displayName:
            template.source?.starterName ?? template.displayName ?? starterId,
          description: template.source?.starterDescription,
        })
        continue
      }
      out.push({
        key: template.$id,
        template,
        pages: [template],
        displayName: template.displayName ?? template.$id,
        description: template.description,
      })
    }
    return out
  }, [templateDocs])

  const listingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of templateDocs ?? []) {
      if (entry.deletedAt) continue
      const id = entry.source?.listingId
      if (entry.source?.type === 'marketplace' && id) ids.add(id)
    }
    return Array.from(ids).sort().join(',')
  }, [templateDocs])

  useEffect(() => {
    if (!listingIds) return
    let active = true
    void Promise.all(
      listingIds.split(',').map(async (id) => {
        try {
          const snapshot = await getDoc(doc(firestore, 'communityListings', id))
          const version = snapshot.get('latestVersion')
          return version == null ? null : ([id, version] as const)
        } catch {
          // Listing removed or unreadable — no badge rather than a wrong one.
          return null
        }
      }),
    ).then((entries) => {
      if (!active) return
      setLatestByListing(
        new Map(entries.filter(Boolean) as Array<readonly [string, any]>),
      )
    })
    return () => {
      active = false
    }
  }, [firestore, listingIds])

  const hasUpdate = useCallback(
    (template: any) => {
      if (template.source?.type !== 'marketplace') return false
      const latest = latestByListing.get(template.source.listingId)
      if (latest == null || template.source.version == null) return false
      // Versions are numbers in practice but typed loosely; compare
      // numerically when both parse, otherwise fall back to inequality.
      const a = Number(template.source.version)
      const b = Number(latest)
      return Number.isFinite(a) && Number.isFinite(b)
        ? b > a
        : String(latest) !== String(template.source.version)
    },
    [latestByListing],
  )

  const handleUpdate = useCallback(
    (template: any) => async () => {
      const listingId = template.source?.listingId
      if (!listingId || updating) return
      // Updating re-installs and replaces the bundle (AGL-671). If this copy
      // was edited locally (AGL-681) those edits go with it, so ask first —
      // silently discarding someone's work to fetch a newer version is the
      // worst possible reading of "update".
      if (template.editedAt) {
        const confirmed = await confirm({
          title: 'Replace your edited copy?',
          description:
            `You have edited "${template.displayName ?? template.$id}" since ` +
            'installing it. Updating replaces it with the publisher’s latest ' +
            'version, and your changes to this template are lost. Pages you ' +
            'already created from it are unaffected.',
          confirmationText: 'Replace',
          confirmationButtonProps: { color: 'error' },
        })
          .then(() => true)
          .catch(() => false)
        if (!confirmed) return
      }
      setUpdating(template.$id)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/install-template', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId, hostId }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Update failed', {
            variant: response.status === 402 ? 'warning' : 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(
          `Updated to v${payload.version} — pages you already created are ` +
            'unchanged.',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Update failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setUpdating(null)
      }
    },
    [updating, confirm, user, hostId, enqueueSnackbar],
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
    (row: { displayName: string; pages: any[] }) => async () => {
      const count = row.pages.length
      const confirmed = await confirm({
        title: count > 1 ? `Delete all ${count} pages?` : 'Delete this template?',
        description:
          count > 1
            ? `"${row.displayName}" is a starter of ${count} page templates, ` +
              'and all of them are removed from your library: ' +
              `${row.pages
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
      const deletedAt = Timestamp.now()
      await Promise.all(
        row.pages.map((page: any) =>
          updateDoc(doc(firestore, 'hosts', hostId, 'templates', page.$id), {
            deletedAt,
          }),
        ),
      )
      enqueueSnackbar(
        count > 1 ? `Deleted ${count} page templates` : 'Template deleted',
        { variant: 'success', persist: false },
      )
    },
    [confirm, firestore, hostId, enqueueSnackbar],
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
    (row: { displayName: string; pages: any[] }) => async () => {
      const pages = row.pages
      const confirmed = await confirm({
        title: `Add ${pages.length} pages from "${row.displayName}"?`,
        description:
          `Creates one page per template — ${pages
            .map((page: any) => page.displayName ?? page.$id)
            .join(', ')} — and publishes each at its own address. Existing ` +
          'screens are never touched, and the templates stay in your library.',
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
            `This starter needs ${pages.length} screens and this site has ` +
              `${screenCount} — your plan allows ${quota.limit}. See Billing ` +
              'to upgrade.',
            { variant: 'warning', persist: false },
          )
        }
        const used = new Set<string>(Object.values(routes))
        for (const page of pages) {
          // Same helper the single-template Use flow calls (AGL-672), so
          // create-screen → write-version → publish-route and its slug
          // de-confliction have one implementation.
          await createPageFromTemplate(firestore, createHostResource as any, {
            hostId,
            displayName: page.displayName ?? page.$id,
            nodes: (page.nodes ?? {}) as Record<string, unknown>,
            description: page.description,
            seo: page.seo,
            slug: page.slug,
            usedSlugs: used,
          })
          created += 1
        }
        enqueueSnackbar(
          `Added ${pages.length} screens from "${row.displayName}"`,
          { variant: 'success', persist: false },
        )
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
      createHostResource,
      enqueueSnackbar,
    ],
  )

  // Matches the layouts and screens column/action shape (AGL-694).
  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      renderCell: ({ row }: any) => (
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
        const chip = sourceChip(row.template.source, row.template.editedAt)
        return (
          // Provenance is server-managed (AGL-666), so this badge means
          // something — a client cannot claim a marketplace origin.
          <Tooltip
            title={
              row.template.source?.type === 'marketplace'
                ? 'Installed from the marketplace'
                : row.template.source?.type === 'starter'
                  ? 'A first-party starter'
                  : 'Saved from this site'
            }
          >
            <Chip size="small" label={chip.label} color={chip.color} />
          </Tooltip>
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
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 160,
      getActions: ({ row }: any) => {
        const template = row.template
        const bundle = row.pages.length > 1
        const actions = [
          // Edit is per-page and has no bundle meaning — there is no single
          // canvas behind five documents — so a grouped row offers the page
          // list instead, and the detail page carries the per-page Edit
          // (AGL-696).
          bundle ? (
            <GridActionsCellItem
              key="action-pages"
              icon={<MdiIcon path={mdiFileMultipleOutline.path} />}
              label={`Open ${row.pages.length} pages`}
              LinkComponent={AppLink as any}
              {...({
                href: buildRoute(Route.TEMPLATE_DETAILS, {
                  orgSlug,
                  host,
                  templateId: template.$id,
                }),
              } as any)}
            />
          ) : (
            <GridActionsCellItem
              key="action-edit"
              icon={<MdiIcon path={mdiPencilOutline.path} />}
              label="Edit in besigner"
              LinkComponent={AppLink as any}
              {...({
                href: buildRoute(Route.TEMPLATE_BESIGNER, {
                  orgSlug,
                  host,
                  templateId: template.$id,
                }),
              } as any)}
            />
          ),
          <GridActionsCellItem
            key="action-use"
            icon={<MdiIcon path={mdiPlusBoxOutline.path} />}
            label={bundle ? `Use all ${row.pages.length} pages` : 'Use'}
            onClick={
              bundle ? handleUseBundle(row) : () => setUseTemplate(template)
            }
          />,
          <GridActionsCellItem
            key="action-delete"
            icon={<MdiIcon path={mdiTrashCanOutline.path} />}
            label={bundle ? `Delete all ${row.pages.length} pages` : 'Delete'}
            showInMenu
            onClick={handleDelete(row)}
          />,
        ]
        if (hasUpdate(template)) {
          actions.unshift(
            <GridActionsCellItem
              key="action-update"
              icon={<MdiIcon path={mdiDownloadOutline.path} />}
              label="Update available"
              disabled={updating === template.$id}
              onClick={handleUpdate(template)}
            />,
          )
        }
        return actions
      },
    },
  ]

  return (
    <CardDisplay>
      <DataTableComponent
        rowHeight={TABLE_ROW_HEIGHT}
        getRowId={(row) => row.key}
        columns={columns}
        noRowsLabel="No templates yet — use Create template above, save one from a screen, or install one from the marketplace"
        rows={rows}
        onRowClick={({ row }) =>
          router.push(
            buildRoute(Route.TEMPLATE_DETAILS, {
              orgSlug,
              host,
              templateId: row.template.$id,
            }),
          )
        }
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        loading={status === 'loading'}
        initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        pageSizeOptions={[5, 10, 15]}
        pagination
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
