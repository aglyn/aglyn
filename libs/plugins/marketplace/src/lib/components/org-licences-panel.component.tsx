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

import { ICON_VARIANT_COMPONENT } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Alert, Chip, Stack } from '@mui/material'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { listingPath } from '../model/marketplace-paths'
import EmptyState from '@aglyn/shared-ui-jsx/components/read-gated-empty-state.component'
import type { ReadOutcome } from '@aglyn/shared-ui-jsx/utils/read-outcome'

/*
 * What each license grid's Filters panel offers. Both lists hold every row
 * they describe, so the panel and the search answer over all of them. The
 * Listing column filters by the listing's name; who bought a license and
 * which workspace one landed in are picked.
 */
const HELD_FILTER_FIELDS = [
  inMemoryListField('listingId', 'text', 'listingName'),
  inMemoryListField('buyerUid', 'select', 'boughtBy'),
]
const HELD_FILTER_HEADERS: Readonly<Record<string, string>> = {
  listingId: 'Listing',
  buyerUid: 'Bought by',
}
const HELD_FILTER_OPTIONS = {
  buyerUid: [
    { value: 'you', label: 'You' },
    { value: 'colleague', label: 'A colleague' },
  ],
}
const MINE_FILTER_FIELDS = [
  inMemoryListField('listingId', 'text', 'listingName'),
  inMemoryListField('buyerOrgId', 'select', 'licensedTo'),
]
const MINE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  listingId: 'Listing',
  buyerOrgId: 'Licensed to',
}
/** A purchase that names no organization, which entitles its buyer everywhere. */
const EVERY_WORKSPACE = 'every'
/** What the quick search reads on a license row. */
const LICENSE_SEARCH_FIELDS = ['listingName'] as const

/**
 * WHICH WORKSPACE HOLDS A LICENCE (AGL-2331).
 *
 * A marketplace purchase licenses the installing ORGANIZATION, not the person
 * who paid. That is the model the Publisher Agreement already publishes and
 * the model the install routes now enforce — and it is unusable without a
 * surface, because the two questions it creates have no answer anywhere else
 * in the console:
 *
 *   "Does THIS workspace own that component, or was it the other client's?"
 *   "I bought this once — which workspace did the licence land in?"
 *
 * An agency is the population this matters to most, and an agency is exactly
 * the population that cannot answer either question from memory. Before this
 * panel the only signal was a Buy button, and a Buy button is the same
 * whether you own nothing or own three of them in other workspaces.
 *
 * TWO LISTS, deliberately, because they are two different facts:
 *
 *   `This workspace` is the org's inventory — what any member with install
 *   rights may install here, including licences a colleague bought and
 *   licences bought by someone who has since left. It is the list that
 *   decides whether a Buy is needed.
 *
 *   `Bought by you` is the buyer's own receipt trail across every workspace
 *   they belong to. It is what turns "I already bought this" into "…for
 *   Northwind, and this is Contoso".
 *
 * Both read `marketplacePurchases`, which is buyer/org/seller-gated — the org
 * clause landed with AGL-2331 for exactly this list. Held at null until the
 * org and uid resolve: a rules-shaped LIST is evaluated against the QUERY, so
 * a sentinel value is a guaranteed denial retried on the refusal cadence
 * (AGL-1440), not an empty list.
 *
 * ## Presentation (AGL-2486)
 *
 * Each list is a card, like every sibling Marketplace tab — it shipped as two
 * bare `subtitle1` headings with a loose sentence under each, which on a page
 * built from cards reads as an unfinished tab rather than an empty one.
 *
 * More than cosmetic: the sentences became `EmptyState`s, so they are now
 * GATED on the read having succeeded (AGL-1066). "You have not bought
 * anything" is a claim about someone's purchase history, and a refused or
 * unfinished read supports no such claim — on a tab whose whole purpose is
 * answering "do we already own this?", a zero-state produced by a dead
 * session is an invitation to buy something twice. Both queries are held at
 * `null` until the scope resolves, which reads as `loading` and can never
 * reach the zero-state; a listen the server has REFUSED keeps painting from
 * cache with `status: 'success'`, which is why `serverDenied` is checked
 * alongside it rather than trusting the status alone.
 */
export function OrgLicencesPanel({
  orgId,
  basePath,
  viewerOrgs,
}: {
  orgId?: string | null
  /**
   * Where the marketplace hub is mounted under this organization, from the
   * shell (AGL-3080) — each row links to its listing beneath it. It replaced
   * an org slug and the console's route table, which a plugin may not
   * import.
   */
  basePath: string
  /**
   * Every workspace the reader belongs to, from the shell, so the "Licensed
   * to" column can name the one a purchase landed in instead of printing its
   * id. A purchase licenses an ORGANIZATION (AGL-2331), which is the whole
   * subject of this panel, and the reader's other workspaces are the answer
   * to half of it.
   */
  viewerOrgs?: readonly { id: string; name: string }[]
}) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid

  /** The licences this workspace holds — whoever in it did the buying. */
  const orgLicencesRead = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(
            collection(firestore, 'marketplacePurchases'),
            where('buyerOrgId', '==', orgId),
          )
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )
  /** Everything this person has ever bought, in any workspace. */
  const myPurchasesRead = useFirestoreCollection<any>(
    () =>
      uid
        ? query(
            collection(firestore, 'marketplacePurchases'),
            where('buyerUid', '==', uid),
          )
        : null,
    [firestore, uid],
    { idField: '$id' },
  )

  /**
   * Listing id → display name.
   *
   * One subscription rather than a read per row: `marketplaceListings` is
   * world-readable (it is the catalogue), the browse grid on the sibling tab
   * already listens to it, and a per-row hook would change the hook count
   * between renders as licences arrive.
   */
  const { data: listings } = useFirestoreCollection<any>(
    /*
     * ORDERED, so the window is a reachable 200 rather than a sample.
     *
     * A capped read with no `orderBy` is answered in document-id order
     * anyway, so naming it changes no row — what it changes is that the
     * ordering is a decision rather than an accident, and that the obvious
     * next edit is caught: `orderBy('displayName')` would drop every listing
     * saved without one out of the map, and a licence whose listing is
     * missing from the map is a row that names itself by raw id.
     *
     * Ordering on the document NAME, which is what a listing id already is
     * here, keeps the map's keys and the walk in the same space. Past 200
     * listings a licence still renders — the fallback below prints the
     * listing id — so the cap degrades the label and never the row.
     */
    () =>
      query(
        collection(firestore, 'marketplaceListings'),
        orderBy(documentId()),
        limit(200),
      ),
    [firestore],
    { idField: '$id' },
  )
  const listingNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const listing of listings ?? []) {
      names[listing.$id] = String(listing.displayName ?? listing.$id)
    }
    return names
  }, [listings])

  /** Workspace id → the name the member already sees in the org switcher. */
  const orgNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const workspace of viewerOrgs ?? []) names[workspace.id] = workspace.name
    return names
  }, [viewerOrgs])

  /**
   * A refunded purchase is not a licence (AGL-1546) and must not be listed as
   * one — the whole point of this panel is deciding whether to buy, and a row
   * that says "you own this" when the install route answers 402 is worse than
   * no row.
   */
  const live = (rows: any[] | undefined): any[] =>
    (rows ?? []).filter((row) => !row?.refundedAt)

  const held = useMemo(
    () =>
      live(orgLicencesRead.data).map((row) => ({
        ...row,
        listingName:
          listingNames[String(row.listingId ?? '')] ?? String(row.listingId ?? ''),
        boughtBy: row.buyerUid === uid ? 'you' : 'colleague',
      })),
    [orgLicencesRead.data, listingNames, uid],
  )
  const mine = useMemo(
    () =>
      live(myPurchasesRead.data).map((row) => ({
        ...row,
        listingName:
          listingNames[String(row.listingId ?? '')] ?? String(row.listingId ?? ''),
        licensedTo: String(row.buyerOrgId ?? '') || EVERY_WORKSPACE,
      })),
    [myPurchasesRead.data, listingNames],
  )

  const mineOptions = useMemo(
    () => ({
      buyerOrgId: [
        ...(orgId ? [{ value: orgId, label: 'This workspace' }] : []),
        ...(viewerOrgs ?? [])
          .filter((workspace) => workspace.id !== orgId)
          .map((workspace) => ({ value: workspace.id, label: workspace.name })),
        { value: EVERY_WORKSPACE, label: 'Every workspace you belong to' },
      ],
    }),
    [orgId, viewerOrgs],
  )
  const heldFilter = useListRowsFilter({
    rows: held,
    fields: HELD_FILTER_FIELDS,
    options: HELD_FILTER_OPTIONS,
    headers: HELD_FILTER_HEADERS,
    search: LICENSE_SEARCH_FIELDS,
  })
  const mineFilter = useListRowsFilter({
    rows: mine,
    fields: MINE_FILTER_FIELDS,
    options: mineOptions,
    headers: MINE_FILTER_HEADERS,
    search: LICENSE_SEARCH_FIELDS,
  })

  /*==========================================
   * BOTH LISTS ARE WHOLE, so the grid pages them and its counts are TOTALS.
   *
   * Neither query is capped: each reads one workspace's purchases or one
   * person's, whole. So the card holds the entire list it is describing, the
   * refund filter above has already run over all of it, and the grid's
   * footer counts the collection's real size rather than a window's length —
   * the one case where a client page can state a total without qualifying it.
   *
   * Server-paging either one would break that. `refundedAt` is filtered after
   * reading, so a ten-document page arrives holding anywhere from zero to ten
   * licences, and an agency deciding whether to buy a component again is
   * exactly the reader who must not be shown a short page as a complete
   * answer.
   *=========================================*/
  const heldColumns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'listingId',
        headerName: 'Listing',
        flex: 1,
        minWidth: 220,
        valueGetter: (_value, row) =>
          listingNames[String(row.listingId ?? '')] ?? String(row.listingId ?? ''),
        renderCell: ({ row, value }) => (
          <AppLink href={listingPath(basePath, String(row.listingId ?? ''))}>
            {value}
          </AppLink>
        ),
      },
      {
        field: 'buyerUid',
        headerName: 'Bought by',
        width: 150,
        // The select's value; the grid shows its label, You or A colleague.
        valueGetter: (_value, row) => row.boughtBy,
      },
      {
        field: 'amountCents',
        headerName: 'Paid',
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        width: 120,
        // What the licence cost before tax, which is what a reader compares.
        valueGetter: (_value, row) =>
          (Number(row.amountCents ?? 0) - Number(row.taxCents ?? 0)) / 100,
        valueFormatter: (value: number) => `$${value.toFixed(2)}`,
      },
    ],
    [listingNames, basePath],
  )
  const mineColumns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'listingId',
        headerName: 'Listing',
        flex: 1,
        minWidth: 220,
        valueGetter: (_value, row) =>
          listingNames[String(row.listingId ?? '')] ?? String(row.listingId ?? ''),
      },
      {
        field: 'buyerOrgId',
        headerName: 'Licensed to',
        flex: 1,
        minWidth: 220,
        valueGetter: (_value, row) => {
          const licensedOrg = String(row.buyerOrgId ?? '')
          if (!licensedOrg) return 'Every workspace you belong to'
          return licensedOrg === orgId
            ? 'This workspace'
            : (orgNames[licensedOrg] ?? licensedOrg)
        },
        renderCell: ({ row, value }) => {
          const licensedOrg = String(row.buyerOrgId ?? '')
          // A purchase made before AGL-2331 named no organization, so it is
          // not reinterpreted as belonging to one — it keeps entitling this
          // buyer everywhere, exactly as it did when they paid for it. Saying
          // "every workspace" rather than guessing an org is the whole reason
          // nobody loses access here.
          if (!licensedOrg) return <Chip size="small" label={value} />
          return licensedOrg === orgId ? (
            <Chip size="small" color="primary" label={value} />
          ) : (
            <Chip size="small" variant="outlined" label={value} />
          )
        },
      },
    ],
    [listingNames, orgId, orgNames],
  )

  /**
   * "You own nothing here" is a claim about this workspace's purchases, and a
   * refused read supports no such claim (AGL-1066). Both queries are ALSO
   * held at `null` until the org and the uid resolve, which the hook reports
   * as `loading` — so an unresolved scope can never reach the zero-state
   * either. `serverDenied` is folded in beside `status`: a listen the server
   * has refused past its retry budget keeps painting whatever the local cache
   * holds, and `status` alone still reads `success` for it.
   */
  const outcome = (read: {
    status: string
    serverDenied: boolean
  }): ReadOutcome =>
    read.status === 'error' || read.serverDenied === true
      ? 'unavailable'
      : read.status === 'success'
        ? 'loaded'
        : 'loading'

  return (
    <Stack spacing={3}>
      <Alert severity="info">
        {'A marketplace purchase licenses one organization. Any member with ' +
          'install permission can install what this workspace owns — and a ' +
          'second workspace needs its own license.'}
      </Alert>

      {held.length === 0 ? (
        <EmptyState
          read={outcome(orgLicencesRead)}
          subject="this workspace’s licenses"
          iconPath={ICON_VARIANT_COMPONENT.path}
          title={'This workspace holds no licenses'}
          description={
            'Anything bought for this workspace shows up here, whoever on ' +
            'the team paid for it.'
          }
        />
      ) : (
        <CardDisplay
          header={'This workspace'}
          help={pluginDocsHelp('publisherHandbook', {
            anchor: '#how-installs-work-the-buyer-side',
            excerpt:
              'What this workspace owns — installable by any member with ' +
              'install permission, whoever on the team paid for it.',
          })}
          subheader={
            'Installable by any member with install permission, whoever ' +
            'on the team bought it'
          }
          contentGutterX
          contentGutterY
        >
          <Stack spacing={1}>
            <ListFilterChips {...heldFilter.chipsProps} />
            <ListTable
              aria-label="Licenses this workspace holds"
              rows={heldFilter.rows}
              columns={heldFilter.filterColumns(heldColumns)}
              {...heldFilter.gridProps}
              rowHeight={TABLE_ROW_HEIGHT}
              noRowsLabel="No licenses match these filters"
            />
          </Stack>
        </CardDisplay>
      )}

      {mine.length === 0 ? (
        <EmptyState
          read={outcome(myPurchasesRead)}
          subject="your purchases"
          iconPath={ICON_VARIANT_COMPONENT.path}
          title={'You have not bought anything yet'}
          description={
            'Your own marketplace receipts appear here, across every ' +
            'workspace you belong to.'
          }
        />
      ) : (
        <CardDisplay
          header={'Bought by you'}
          help={pluginDocsHelp('publisherHandbook', {
            anchor: '#how-installs-work-the-buyer-side',
            excerpt:
              'Your own purchases across every workspace you belong to — a ' +
              'purchase licenses one organization, so this says which.',
          })}
          subheader={
            'Your own receipts, and which workspace each license landed in'
          }
          contentGutterX
          contentGutterY
        >
          <Stack spacing={1}>
            <ListFilterChips {...mineFilter.chipsProps} />
            <ListTable
              aria-label="Licenses you bought"
              rows={mineFilter.rows}
              columns={mineFilter.filterColumns(mineColumns)}
              {...mineFilter.gridProps}
              rowHeight={TABLE_ROW_HEIGHT}
              noRowsLabel="No licenses match these filters"
            />
          </Stack>
        </CardDisplay>
      )}
    </Stack>
  )
}

export default OrgLicencesPanel
