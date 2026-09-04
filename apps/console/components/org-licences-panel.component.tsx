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
import {
  Alert,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgScope } from '../hooks/use-org-scope'
import EmptyState from './empty-state.component'
import type { ReadOutcome } from '../utils/read-outcome'

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
  orgSlug,
}: {
  orgId?: string | null
  orgSlug: string
}) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { orgs } = useOrgScope()
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
    for (const membership of orgs ?? []) {
      names[membership.$id] = membership.orgName || membership.slug || membership.$id
    }
    return names
  }, [orgs])

  /**
   * A refunded purchase is not a licence (AGL-1546) and must not be listed as
   * one — the whole point of this panel is deciding whether to buy, and a row
   * that says "you own this" when the install route answers 402 is worse than
   * no row.
   */
  const live = (rows: any[] | undefined) =>
    (rows ?? []).filter((row) => !row?.refundedAt)

  const held = live(orgLicencesRead.data)
  const mine = live(myPurchasesRead.data)

  /*==========================================
   * BOTH PAGES ARE SLICES, and the counts are TOTALS.
   *
   * Neither query is capped: each reads one workspace's purchases or one
   * person's, whole. So the card holds the entire list it is describing, the
   * refund filter above has already run over all of it, and `count` is the
   * collection's real size rather than a window's length — the one case where
   * a client slice can state a total without qualifying it.
   *
   * Server-paging either one would break that. `refundedAt` is filtered after
   * reading, so a ten-document page arrives holding anywhere from zero to ten
   * licences, and an agency deciding whether to buy a component again is
   * exactly the reader who must not be shown a short page as a complete
   * answer.
   *=========================================*/
  const [heldPage, setHeldPage] = useState(0)
  const [heldPageSize, setHeldPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleHeld = useMemo(
    () =>
      held.slice(heldPage * heldPageSize, heldPage * heldPageSize + heldPageSize),
    [held, heldPage, heldPageSize],
  )
  const [minePage, setMinePage] = useState(0)
  const [minePageSize, setMinePageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleMine = useMemo(
    () =>
      mine.slice(minePage * minePageSize, minePage * minePageSize + minePageSize),
    [mine, minePage, minePageSize],
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
          subject="this workspace’s licences"
          iconPath={ICON_VARIANT_COMPONENT.path}
          title={'This workspace holds no licences'}
          description={
            'Anything bought for this workspace shows up here, whoever on ' +
            'the team paid for it.'
          }
        />
      ) : (
        <CardDisplay
          header={'This workspace'}
          help={docsHelp('publisherHandbook', {
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
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Listing'}</TableCell>
                <TableCell>{'Bought by'}</TableCell>
                <TableCell align="right">{'Paid'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleHeld.map((row) => (
                <TableRow key={row.$id}>
                  <TableCell>
                    <AppLink
                      href={buildRoute(Route.ORG_MARKETPLACE_LISTING, {
                        orgSlug,
                        listingId: String(row.listingId ?? ''),
                      })}
                    >
                      {listingNames[String(row.listingId ?? '')] ??
                        String(row.listingId ?? '')}
                    </AppLink>
                  </TableCell>
                  <TableCell>
                    {row.buyerUid === uid ? 'You' : 'A colleague'}
                  </TableCell>
                  <TableCell align="right">
                    {`$${((Number(row.amountCents ?? 0) - Number(row.taxCents ?? 0)) / 100).toFixed(2)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination
            page={heldPage}
            pageSize={heldPageSize}
            rowCount={visibleHeld.length}
            // The workspace's licences, in full: the query is uncapped and
            // the refund filter has already run, so this is a total rather
            // than the length of a window.
            count={held.length}
            onPageChange={setHeldPage}
            onPageSizeChange={setHeldPageSize}
          />
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
          help={docsHelp('publisherHandbook', {
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
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Listing'}</TableCell>
                <TableCell>{'Licensed to'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleMine.map((row) => {
                const licensedOrg = String(row.buyerOrgId ?? '')
                return (
                  <TableRow key={row.$id}>
                    <TableCell>
                      {listingNames[String(row.listingId ?? '')] ??
                        String(row.listingId ?? '')}
                    </TableCell>
                    <TableCell>
                      {!licensedOrg ? (
                        // A purchase made before AGL-2331 named no
                        // organization, so it is not reinterpreted as
                        // belonging to one — it keeps entitling this buyer
                        // everywhere, exactly as it did when they paid for it.
                        // Saying "every workspace" rather than guessing an org
                        // is the whole reason nobody loses access here.
                        <Chip size="small" label="Every workspace you belong to" />
                      ) : licensedOrg === orgId ? (
                        <Chip size="small" color="primary" label="This workspace" />
                      ) : (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={orgNames[licensedOrg] ?? licensedOrg}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ListPagination
            page={minePage}
            pageSize={minePageSize}
            rowCount={visibleMine.length}
            // Every purchase this person has made, across every workspace —
            // the same uncapped read, so the same exact total.
            count={mine.length}
            onPageChange={setMinePage}
            onPageSizeChange={setMinePageSize}
          />
        </CardDisplay>
      )}
    </Stack>
  )
}

export default OrgLicencesPanel
