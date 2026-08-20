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

import { AppLink } from '@aglyn/shared-ui-jsx'
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
  Typography,
} from '@mui/material'
import { collection, limit, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgScope } from '../hooks/use-org-scope'

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
  const { data: orgLicences } = useFirestoreCollection<any>(
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
  const { data: myPurchases } = useFirestoreCollection<any>(
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
    () => query(collection(firestore, 'marketplaceListings'), limit(200)),
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

  const held = live(orgLicences)
  const mine = live(myPurchases)

  return (
    <Stack spacing={3}>
      <Alert severity="info">
        {'A marketplace purchase licenses one organization. Any member with ' +
          'install permission can install what this workspace owns — and a ' +
          'second workspace needs its own licence.'}
      </Alert>

      <Stack spacing={1}>
        <Typography variant="subtitle1">{'This workspace'}</Typography>
        {held.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'This workspace holds no paid marketplace licences yet.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Listing'}</TableCell>
                <TableCell>{'Bought by'}</TableCell>
                <TableCell align="right">{'Paid'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {held.map((row) => (
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
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle1">{'Bought by you'}</Typography>
        {mine.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'You have not bought anything from the marketplace.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Listing'}</TableCell>
                <TableCell>{'Licensed to'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mine.map((row) => {
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
        )}
      </Stack>
    </Stack>
  )
}

export default OrgLicencesPanel
