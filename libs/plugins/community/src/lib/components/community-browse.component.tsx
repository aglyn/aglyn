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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Chip,
  Grid,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, getDoc, limit, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { buildRoute, type OrgPermissions, Route } from '@aglyn/aglyn'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useHostOrgId,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  isListingBrowsable,
  listingArtifactType,
  resolvePluginInstallState,
} from '../model/community'
import useCommunityActions from '../hooks/use-community-actions'

// The console route table is shared (AGL-685), so these go through
// buildRoute rather than being reassembled from a base string — the shape
// of `/[orgSlug]/hosts/[host]/community/…` is not this plugin's to know.

export interface CommunityBrowseProps {
  hostId: string
  /** Signed-in user's org permissions, supplied by the shell (AGL-395). */
  permissions?: Partial<OrgPermissions>
  /**
   * Rendered inside the org-scope `/marketplace` route (AGL-772) rather
   * than a site's community tab. Only affects link targets — the grid
   * still installs through the acting `hostId` until targeting lands
   * (AGL-773) — so detail links resolve to the org route, not a per-site
   * one that is being retired.
   */
  orgScoped?: boolean
}

/**
 * Community components browse + install (AGL-44). Installing copies the
 * listing's pinned version snapshot into `hosts/{hostId}/components` (with
 * `community` source metadata), so the element drawer, editor grafting, and
 * tenant compose pipeline all apply unchanged. When a listing publishes a
 * newer version, installed hosts see an explicit Update action — no silent
 * upgrades.
 */
export function CommunityBrowse(props: CommunityBrowseProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { permissions, orgScoped } = props
  const { install: runInstall, buy: runBuy } = useCommunityActions(hostId)
  const [handles, setHandles] = useState<Record<string, string>>({})
  // Listings are org-owned (AGL-652), so "is this mine" is an org comparison.
  // Resolved from the routing mirror rather than a new prop so the component
  // stays self-contained; hostIndex is signed-in readable.
  const [viewerOrgId, setViewerOrgId] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void getDoc(doc(firestore, 'hostIndex', hostId))
      .then((snapshot) => {
        if (active) setViewerOrgId((snapshot.get('orgId') as string) ?? null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [firestore, hostId])
  // Card links were built as `/{hostDocId}/community/…`, a shape that has
  // not resolved since AGL-621/622 — every listing and publisher link on
  // this grid 404'd. One shared resolution (AGL-673); null renders plain
  // text rather than a link to nowhere.
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)

  // Link targets differ by surface (AGL-772): the org marketplace resolves
  // to the org route (`/[orgSlug]/marketplace/[listingId]`), the per-site tab
  // to the host route. Null → plain text, never a link to nowhere. Publisher
  // pages have no org route yet, so they stay text at org scope for now.
  const listingHref = (listingId: string) =>
    orgScoped
      ? orgSlug
        ? buildRoute(Route.ORG_MARKETPLACE_LISTING, { orgSlug, listingId })
        : undefined
      : orgSlug && subdomain
        ? buildRoute(Route.HOST_COMMUNITY_LISTING, {
            orgSlug,
            host: subdomain,
            listingId,
          })
        : undefined
  const publisherHref = (profileId: string) =>
    orgScoped
      ? undefined
      : orgSlug && subdomain
        ? buildRoute(Route.HOST_COMMUNITY_PUBLISHER, {
            orgSlug,
            host: subdomain,
            profileId,
          })
        : undefined

  const { data: listings } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityListings'),
        where('deletedAt', '==', null),
        limit(60),
      ),
    [firestore],
    { idField: '$id' },
  )
  const { data: installedDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )

  // Paid-listing gating (AGL-46): the buyer's purchase records, written by
  // the Stripe webhook.
  const { data: purchaseDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityPurchases'),
        where('buyerUid', '==', user?.uid ?? '-anonymous-'),
        limit(200),
      ),
    [firestore, user?.uid],
    { idField: '$id' },
  )
  const purchased = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const purchase of purchaseDocs ?? []) map[purchase.listingId] = true
    return map
  }, [purchaseDocs])

  // listingId → installed component doc (deleted installs don't count).
  const installed = useMemo(() => {
    const map: Record<string, any> = {}
    for (const definition of installedDocs ?? []) {
      const listingId = definition?.community?.listingId
      if (listingId && !definition.deletedAt) map[listingId] = definition
    }
    return map
  }, [installedDocs])

  // Plugin installs are version PINS, not component snapshots (AGL-656): the
  // `components` map above never holds one, so a plugin already installed —
  // at host or org scope — showed "Add to this site". These two pin
  // collections are what the loader honors (a host pin shadows an org pin).
  const orgId = useHostOrgId(hostId)
  const { data: hostPinDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'installs'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: orgPinDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId ?? '-pending-', 'installs'),
        limit(100),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  const hostPins = useMemo(() => {
    const map: Record<string, any> = {}
    for (const pin of hostPinDocs ?? []) map[pin.$id] = pin
    return map
  }, [hostPinDocs])
  const orgPins = useMemo(() => {
    const map: Record<string, any> = {}
    for (const pin of orgPinDocs ?? []) map[pin.$id] = pin
    return map
  }, [orgPinDocs])

  useEffect(() => {
    const profileIds = [
      ...new Set((listings ?? []).map((listing: any) => listing.profileId)),
    ].filter((profileId) => profileId && !(profileId in handles))
    if (!profileIds.length) return
    let cancelled = false
    Promise.all(
      profileIds.map(async (profileId) => {
        const snapshot = await getDoc(
          doc(firestore, 'publisherProfiles', String(profileId)),
        ).catch(() => null)
        return [profileId, snapshot?.get('handle') ?? ''] as const
      }),
    ).then((entries) => {
      if (!cancelled) {
        setHandles((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [listings, handles, firestore])

  // Server-side install (AGL-46): version snapshots aren't client-readable
  // (paid content), so the API verifies access and copies the definition.
  // Handlers shared with the detail page live in useCommunityActions.
  // A fresh install from the grid lands on this site (the org/host picker
  // lives on the detail page); updating an existing pin keeps its scope so an
  // org-wide install is not silently shadowed by a new host pin (AGL-656).
  const handleInstall =
    (listing: any, scope?: 'org' | 'host') => () =>
      runInstall(listing, scope)
  const handleBuy = (listing: any) => () => runBuy(listing)

  // Browse controls (AGL-95): client-side search/filter/sort over the
  // fetched page of listings.
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<'newest' | 'installed' | 'rated'>(
    'newest',
  )
  const categories = useMemo(
    () =>
      [
        ...new Set(
          (listings ?? [])
            .map((listing: any) => listing.category)
            .filter(Boolean),
        ),
      ].sort() as string[],
    [listings],
  )
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (listings ?? []).filter((listing: any) => {
      // Review queue gate (AGL-432): unreviewed/rejected plugin listings
      // stay off the public browse; the owner still sees their own (the
      // detail page shows them the status). UX-level only — the docs are
      // public-readable by design.
      if (!isListingBrowsable(listing) && listing.profileId !== viewerOrgId) {
        return false
      }
      if (category && listing.category !== category) return false
      if (!needle) return true
      return [listing.displayName, listing.description, listing.category]
        .filter(Boolean)
        .some((value: string) => value.toLowerCase().includes(needle))
    })
    return [...filtered].sort((a: any, b: any) => {
      if (sort === 'installed') {
        return (b.installCount ?? 0) - (a.installCount ?? 0)
      }
      if (sort === 'rated') {
        // Unrated listings sort last rather than as zero-stars — a new
        // listing has not been judged badly, it has not been judged.
        const byAverage =
          (b.ratingAverage ?? -1) - (a.ratingAverage ?? -1)
        return byAverage || (b.ratingCount ?? 0) - (a.ratingCount ?? 0)
      }
      return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
    })
  }, [listings, search, category, sort, user?.uid])

  return (
    <CardDisplay header={'Community components'} contentGutterX contentGutterY>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <TextField
          placeholder="Search components…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        />
        {categories.map((value) => (
          <Chip
            key={value}
            label={value}
            variant={category === value ? 'filled' : 'outlined'}
            color={category === value ? 'secondary' : 'default'}
            onClick={() =>
              setCategory((previous) => (previous === value ? null : value))
            }
          />
        ))}
        <TextField
          value={sort}
          onChange={(event) => setSort(event.target.value as any)}
          size="small"
          select
          sx={{ ml: 'auto', minWidth: 150 }}
        >
          <MenuItem value="newest">{'Newest'}</MenuItem>
          <MenuItem value="installed">{'Most installed'}</MenuItem>
          <MenuItem value="rated">{'Highest rated'}</MenuItem>
        </TextField>
      </Stack>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No community components published yet — publish one of your ' +
            'reusable components from the Setup page to be the first.'}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {items.map((listing: any) => {
            const isPlugin = listingArtifactType(listing) === 'plugin'
            const pluginState = resolvePluginInstallState(
              listing.latestVersion,
              isPlugin ? hostPins[listing.$id] : null,
              isPlugin ? orgPins[listing.$id] : null,
            )
            const componentInstall = installed[listing.$id]
            const isInstalled = isPlugin
              ? pluginState.scope != null
              : Boolean(componentInstall)
            const installedVersion = isPlugin
              ? pluginState.installedVersion
              : componentInstall?.community?.version
            const upToDate = isPlugin
              ? isInstalled && !pluginState.updateAvailable
              : componentInstall && installedVersion >= listing.latestVersion
            const targetScope =
              isPlugin && isInstalled
                ? (pluginState.scope ?? undefined)
                : undefined
            const priceUsd = Number(listing.priceUsd ?? 0)
            const mustBuy =
              priceUsd > 0 &&
              !purchased[listing.$id] &&
              listing.profileId !== viewerOrgId &&
              !isInstalled
            return (
              <Grid key={listing.$id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack
                  spacing={1}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 2,
                    height: '100%',
                  }}
                >
                  {listing.previewImageUrl ? (
                    <Box
                      component="img"
                      src={listing.previewImageUrl}
                      alt={`${listing.displayName} preview`}
                      sx={{
                        width: '100%',
                        height: 120,
                        objectFit: 'cover',
                        borderRadius: 1,
                      }}
                    />
                  ) : null}
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <MuiLink
                      href={listingHref(listing.$id)}
                      color="inherit"
                      underline="hover"
                      variant="subtitle2"
                      sx={{ flex: 1 }}
                      noWrap
                    >
                      {listing.displayName}
                    </MuiLink>
                    {listing.category ? (
                      <Chip size="small" label={listing.category} />
                    ) : null}
                    {/* Org-wide installs apply to every site (AGL-656). */}
                    {isPlugin && pluginState.scope === 'org' ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={pluginState.shadowed ? 'Org-wide (shadowed)' : 'Org-wide'}
                      />
                    ) : null}
                    {priceUsd > 0 ? (
                      <Chip
                        size="small"
                        color="secondary"
                        label={`$${priceUsd}`}
                      />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {`v${listing.latestVersion}`}
                    {handles[listing.profileId] ? (
                      <>
                        {' · by '}
                        <MuiLink
                          href={publisherHref(listing.profileId)}
                          color="secondary"
                          underline="hover"
                        >
                          {`@${handles[listing.profileId]}`}
                        </MuiLink>
                      </>
                    ) : (
                      ''
                    )}
                    {listing.installCount
                      ? ` · ${listing.installCount} install${
                          listing.installCount === 1 ? '' : 's'
                        }`
                      : ''}
                    {/* Count alongside the average: "5.0" from one rating
                        and from forty are not the same claim (AGL-655). */}
                    {listing.ratingCount
                      ? ` · ★ ${listing.ratingAverage ?? 0} (${
                          listing.ratingCount
                        })`
                      : ''}
                  </Typography>
                  {listing.description ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ flex: 1 }}
                    >
                      {listing.description}
                    </Typography>
                  ) : (
                    <span style={{ flex: 1 }} />
                  )}
                  <Button
                    size="small"
                    variant={isInstalled ? 'outlined' : 'contained'}
                    color="secondary"
                    disabled={Boolean(upToDate)}
                    onClick={
                      permissions?.installPlugins
                        ? mustBuy
                          ? handleBuy(listing)
                          : handleInstall(listing, targetScope)
                        : () =>
                            enqueueSnackbar(
                              'Your team role does not allow installing from the community',
                              { variant: 'warning', persist: false },
                            )
                    }
                  >
                    {upToDate
                      ? `Installed (v${installedVersion})`
                      : isInstalled
                        ? `Update to v${listing.latestVersion}`
                        : mustBuy
                          ? `Buy for $${priceUsd}`
                          : 'Add to this site'}
                  </Button>
                </Stack>
              </Grid>
            )
          })}
        </Grid>
      )}
    </CardDisplay>
  )
}
CommunityBrowse.displayName = 'CommunityBrowse'

export default CommunityBrowse
