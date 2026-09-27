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
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  useListQuery,
  type UseListQueryResult,
} from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { Alert, Chip, Stack } from '@mui/material'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  type ListGridFilter,
  useListGridFilter,
} from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { GridColDef } from '@mui/x-data-grid'
import { collection } from 'firebase/firestore'
import { type ReactNode, useMemo } from 'react'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { listingPath } from '../model/marketplace-paths'
import {
  EVERY_WORKSPACE,
  HELD_LICENCE_QUERY,
  licenceBase,
  MINE_LICENCE_QUERY,
  mineLicenceClauses,
} from '../model/listing-query'
import {
  useListingNameLookup,
  useListingNames,
} from '../hooks/use-listing-name-lookup'
import EmptyState from '@aglyn/shared-ui-jsx/components/read-gated-empty-state.component'
import type { ReadOutcome } from '@aglyn/shared-ui-jsx/utils/read-outcome'

/*
 * What each license grid's Filters panel offers, and how its search reads —
 * every clause and the search on the QUERY (AGL-3321). They were matched over
 * the rows each list had loaded (the retired window filter), which answered "no
 * match" for a license past what was read.
 *
 *   - "This workspace" filters by who bought it — You, by uid equality. "A
 *     colleague" was an in-memory negation; Firestore's `!=` would lead the
 *     order by buyer and needs a composite per clause beside it, so it is not
 *     offered.
 *   - "Bought by you" filters by the workspace a license landed in, or the
 *     every-workspace grant a purchase naming none carries (`buyerOrgId`
 *     null).
 *   - The search is the listing's NAME: the listings holding the word are
 *     asked first, and the license query asks for their ids
 *     (`useListingNameLookup`).
 */
const HELD_FILTER_HEADERS: Readonly<Record<string, string>> = {
  buyerUid: 'Bought by',
}
const MINE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  buyerOrgId: 'Licensed to',
}

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

  /** Workspace id → the name the member already sees in the org switcher. */
  const orgNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const workspace of viewerOrgs ?? []) names[workspace.id] = workspace.name
    return names
  }, [viewerOrgs])

  const heldOptions = useMemo(
    () => ({ buyerUid: uid ? [{ value: uid, label: 'You' }] : [] }),
    [uid],
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
  const heldFilter = useListGridFilter({ selectFields: ['buyerUid'] })
  const mineFilter = useListGridFilter({ selectFields: ['buyerOrgId'] })
  const heldLookup = useListingNameLookup(heldFilter.searchWords)
  const mineLookup = useListingNameLookup(mineFilter.searchWords)

  /*
   * Both lists read `marketplacePurchases`, which is buyer/org/seller-gated —
   * the org clause landed with AGL-2331 for exactly this list. Held at null
   * until the org and uid resolve: a rules-shaped LIST is evaluated against
   * the QUERY, so a sentinel value is a guaranteed denial retried on the
   * refusal cadence (AGL-1440), not an empty list. A search whose listing
   * lookup is still out holds too, and one that named no listing is answered
   * with no rows rather than an `in []` Firestore refuses.
   *
   * A refunded purchase is not a licence (AGL-1546) and must not be listed as
   * one — the whole point of this panel is deciding whether to buy, and a row
   * that says "you own this" when the install route answers 402 is worse than
   * no row. `refundedAt == null` is on both queries (`licenceBase`).
   */
  const purchases = useMemo(
    () => collection(firestore, 'marketplacePurchases'),
    [firestore],
  )
  const heldRead = useListQuery<any>({
    collection:
      orgId && !heldLookup.pending && heldLookup.ids?.length !== 0
        ? purchases
        : null,
    declaration: HELD_LICENCE_QUERY,
    request: {
      clauses: heldFilter.clauses,
      base: orgId
        ? licenceBase({ path: 'buyerOrgId', value: orgId }, heldLookup.ids)
        : [],
    },
    deps: [firestore, orgId, heldLookup.pending, (heldLookup.ids ?? []).join(',')],
    idField: '$id',
  })
  const mineRead = useListQuery<any>({
    collection:
      uid && !mineLookup.pending && mineLookup.ids?.length !== 0 ? purchases : null,
    declaration: MINE_LICENCE_QUERY,
    request: {
      clauses: mineLicenceClauses(mineFilter.clauses),
      base: uid ? licenceBase({ path: 'buyerUid', value: uid }, mineLookup.ids) : [],
    },
    deps: [firestore, uid, mineLookup.pending, (mineLookup.ids ?? []).join(',')],
    idField: '$id',
  })
  const heldNamedNone = heldLookup.ids?.length === 0
  const mineNamedNone = mineLookup.ids?.length === 0
  const heldRows = useMemo(
    () => (heldNamedNone ? [] : heldRead.rows),
    [heldNamedNone, heldRead.rows],
  )
  const mineRows = useMemo(
    () => (mineNamedNone ? [] : mineRead.rows),
    [mineNamedNone, mineRead.rows],
  )

  /**
   * Listing id → display name, read by id for the rows on screen. It was a
   * window of the first two hundred listings, past which a license printed
   * its listing's raw id.
   */
  const listingNames = useListingNames(
    [...heldRows, ...mineRows].map((row) => String(row.listingId ?? '')),
  )

  const held = useMemo(
    () =>
      heldRows.map((row: any) => ({
        ...row,
        boughtBy: row.buyerUid === uid ? 'You' : 'A colleague',
      })),
    [heldRows, uid],
  )
  const mine = mineRows

  const heldColumns = useMemo<GridColDef[]>(
    () =>
      listFilterGridColumns(
        [
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
            // Drawn as who it was, whatever the select's one choice is.
            renderCell: ({ row }) => row.boughtBy,
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
        HELD_LICENCE_QUERY.fields,
        heldOptions,
        HELD_FILTER_HEADERS,
      ),
    [listingNames, basePath, heldOptions],
  )
  const mineColumns = useMemo<GridColDef[]>(
    () =>
      listFilterGridColumns(
        [
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
        MINE_LICENCE_QUERY.fields,
        mineOptions,
        MINE_FILTER_HEADERS,
      ),
    [listingNames, orgId, orgNames, mineOptions],
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

  const filtering = (filter: ListGridFilter) =>
    filter.clauses.length > 0 || filter.searchWords.length > 0

  return (
    <Stack spacing={3}>
      <Alert severity="info">
        {'A marketplace purchase licenses one organization. Any member with ' +
          'install permission can install what this workspace owns — and a ' +
          'second workspace needs its own license.'}
      </Alert>

      {held.length === 0 && heldRead.page === 0 && !filtering(heldFilter) ? (
        <EmptyState
          read={outcome(heldRead)}
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
          <LicenceTable
            label="Licenses this workspace holds"
            declaration={HELD_LICENCE_QUERY}
            headers={HELD_FILTER_HEADERS}
            options={heldOptions}
            gridFilter={heldFilter}
            lookup={heldLookup}
            read={heldRead}
            rows={held}
            columns={heldColumns}
          />
        </CardDisplay>
      )}

      {mine.length === 0 && mineRead.page === 0 && !filtering(mineFilter) ? (
        <EmptyState
          read={outcome(mineRead)}
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
          <LicenceTable
            label="Licenses you bought"
            declaration={MINE_LICENCE_QUERY}
            headers={MINE_FILTER_HEADERS}
            options={mineOptions}
            gridFilter={mineFilter}
            lookup={mineLookup}
            read={mineRead}
            rows={mine}
            columns={mineColumns}
          />
        </CardDisplay>
      )}
    </Stack>
  )
}

/**
 * One license grid: its clause chips, what the query refused or said, the
 * grid (filtered and searched by the query, not by itself) and its pager.
 */
function LicenceTable(props: {
  label: string
  declaration: ListQueryDeclaration
  headers: Readonly<Record<string, string>>
  options: Readonly<Record<string, readonly ListFilterOption[]>>
  gridFilter: ListGridFilter
  lookup: ReturnType<typeof useListingNameLookup>
  read: UseListQueryResult<any>
  rows: any[]
  columns: GridColDef[]
}): ReactNode {
  const {
    label,
    declaration,
    headers,
    options,
    gridFilter,
    lookup,
    read,
    rows,
    columns,
  } = props
  const refused = listQueryRefusals([...lookup.refused, ...read.plan.refused], {
    fields: declaration.fields,
    headers,
    options,
  })
  return (
    <Stack spacing={1}>
      <ListFilterChips
        fields={declaration.fields}
        headers={headers}
        clauses={gridFilter.clauses}
        onChange={gridFilter.setClauses}
        options={options}
      />
      <ListQueryNotices refused={refused} notices={lookup.notices} />
      <ListTable
        aria-label={label}
        rows={rows}
        columns={columns}
        filterMode="server"
        filterModel={gridFilter.filterModel}
        onFilterModelChange={gridFilter.onFilterModelChange}
        quickFilter
        // The query's order is the purchases' own; the grid does not re-sort a page.
        sortingMode="server"
        disableColumnSorting
        // `ListPagination` below pages the query.
        hideFooter
        rowHeight={TABLE_ROW_HEIGHT}
        noRowsLabel="No licenses match these filters"
      />
      <ListPagination
        page={read.page}
        pageSize={read.pageSize}
        rowCount={rows.length}
        hasMore={read.hasMore}
        onPageChange={read.setPage}
        onPageSizeChange={read.setPageSize}
      />
    </Stack>
  )
}

export default OrgLicencesPanel
