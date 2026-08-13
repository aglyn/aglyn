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

import { mdiCheckDecagram } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Chip,
  Tooltip,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, getDoc, limit, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildRoute, type OrgPermissions, Route } from '@aglyn/aglyn'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostOrgId,
  useUser,
  useScopeTokens,
} from '@aglyn/tenant-feature-instance'
import {
  isListingBrowsable,
  isListingDeleted,
  isPrivateListing,
  listingArtifactType,
  listingArtifactLabel,
  resolvePluginInstallState,
} from '../model/marketplace'
import { ListingImage } from './listing-image.component'

// The console route table is shared (AGL-685), so these go through
// buildRoute rather than being reassembled from a base string — the shape
// of `/[orgSlug]/hosts/[host]/marketplace/…` is not this plugin's to know.

export interface MarketplaceBrowseProps {
  hostId: string
  /** Signed-in user's org permissions, supplied by the shell (AGL-395). */
  permissions?: Partial<OrgPermissions>
  /**
   * Rendered inside the org-scope `/marketplace` route (AGL-772) rather
   * than a site's marketplace tab. Only affects link targets — the grid
   * still installs through the acting `hostId` until targeting lands
   * (AGL-773) — so detail links resolve to the org route, not a per-site
   * one that is being retired.
   */
  orgScoped?: boolean
  /**
   * The acting org's slug from the URL (AGL-867). When given at org scope,
   * detail links build from it directly instead of the async
   * `hostIndex`→`orgs` resolution, which can return empty and leave the detail
   * page — the only place installs happen now — unreachable from browse.
   */
  orgSlug?: string
  /**
   * Restrict the grid to one publisher's listings (AGL-869), for the org-scope
   * publisher page. Omitted on the main browse, which shows everyone.
   */
  publisherId?: string
}

/**
 * Marketplace components browse (AGL-44). A read-only catalogue: each card links
 * to the listing's detail page, which is the only place an install happens
 * (AGL-867) — installing from a grid card was too easy and skipped the
 * site-targeting choice. The card still shows install STATE (installed,
 * org-wide) so the shelf reads honestly, but carries no install action.
 */
export function MarketplaceBrowse(props: MarketplaceBrowseProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { orgScoped, orgSlug: orgSlugProp, publisherId } = props
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
  // Card links were built as `/{hostDocId}/marketplace/…`, a shape that has
  // not resolved since AGL-621/622 — every listing and publisher link on
  // this grid 404'd. One shared resolution (AGL-673); null renders plain
  // text rather than a link to nowhere.
  const { orgSlug: resolvedOrgSlug, subdomain } = useConsoleHostRoute(hostId)
  // Prefer the URL-supplied slug (AGL-867) — synchronous and always present at
  // org scope — over the async host resolution, which the per-site route still
  // relies on.
  const orgSlug = orgSlugProp ?? resolvedOrgSlug

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
        ? buildRoute(Route.ORG_MARKETPLACE_LISTING, {
            orgSlug,
            listingId,
          })
        : undefined
  // Storefront links carry the publisher's HANDLE (AGL-1001), the identity
  // shown right beside them on the card. The id remains a valid segment on
  // the page itself, so a publisher whose handle hasn't loaded yet still
  // links somewhere real rather than nowhere.
  const publisherHref = (profileId: string) =>
    orgScoped
      ? // Org-scope publisher storefront (AGL-869): all of one publisher's
        // listings. Needs the URL slug, which is passed in at org scope.
        orgSlug
        ? buildRoute(Route.ORG_MARKETPLACE_PUBLISHER, {
            orgSlug,
            handle: handles[profileId] ?? profileId,
          })
        : undefined
      : orgSlug && subdomain
        ? buildRoute(Route.ORG_MARKETPLACE_PUBLISHER, {
            orgSlug,
            handle: handles[profileId] ?? profileId,
          })
        : undefined

  /**
   * NO `where('deletedAt','==',null)` HERE — soft-deleted listings are dropped
   * in `items` below instead (AGL-1196).
   *
   * `deletedAt` flips every time a publisher unpublishes or republishes. A
   * document that stops matching a live query leaves the query target, and the
   * client can cache a `noDocument` tombstone at its own path — which is then
   * served to every reader of that path, including the detail page, which
   * reads `marketplaceListings/{id}` BY ID. So a browse session open across an
   * unpublish could 404 a listing that exists, and republishing would not
   * clear it: a resumed listen only pulls deltas, so an otherwise-unchanged
   * document is never re-sent (AGL-827, AGL-929).
   *
   * Dropping the predicate removes the mechanism rather than healing it: with
   * no `where`, no document can stop matching. The rule permits it —
   * `marketplaceListings` is `allow read: if true`, with no `resource.data`
   * term, so an unconstrained list is not denied. (That is NOT true of the
   * scoped `datasets` query below, which is why this fix does not generalise.)
   *
   * It also fixes a quieter bug: `== null` matches only an EXPLICIT null, and
   * Firestore cannot express "field is absent". Every publish path stamps
   * `deletedAt: null` today, so this happens to be exact — but any future
   * write path that omits the field would make a live listing silently
   * invisible. An in-memory falsy check treats absent as live, which is what
   * the dataset and email-template filters in this file already do.
   *
   * The cap counts CANDIDATES, not results — private and unreviewed listings
   * already consume slots and get filtered below, so this is the same class of
   * consumption, nudged up to leave room for soft-deleted rows. Measured on
   * production 2026-08-03: 7 listings, 0 soft-deleted, 0 missing the field.
   */
  const { data: listings } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'marketplaceListings'), limit(90)),
    [firestore],
    { idField: '$id' },
  )
  const { data: installedDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )

  // listingId → installed component doc (deleted installs don't count).
  const installed = useMemo(() => {
    const map: Record<string, any> = {}
    for (const definition of installedDocs ?? []) {
      const listingId = definition?.marketplace?.listingId
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
  // Held at null while `useHostOrgId` is in flight, never `orgs/-pending-`
  // (AGL-1440): the AGL-1047 comment seven lines below records the same
  // denial-every-mount shape for `useScopeTokens` — this listen had it too.
  const { data: orgPinDocs } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(collection(firestore, 'orgs', orgId, 'installs'), limit(100))
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )
  // Scoped (AGL-1044): an unfiltered list is REJECTED for a scoped member,
  // not filtered, so this would error without the constraint.
  //
  // Wait for the member doc before listing (AGL-1047). `useScopeTokens`
  // reports `orgWide: true` while loading, so without `scopeLoaded` a scoped
  // collaborator's first render computes `needsScope: false` and sends an
  // UNFILTERED list that the AGL-1041 rules deny per document. It recovers
  // on the next render, which is what makes it easy to miss: the page looks
  // right and logs a denial every mount.
  const {
    tokens: scopeTokens,
    orgWide: viewerOrgWide,
    loaded: scopeLoaded,
  } = useScopeTokens(orgId ?? undefined)
  const needsScope = Boolean(orgId) && !viewerOrgWide
  // The AGL-657 types land in neither the components collection nor a pin
  // (AGL-789): a dataset schema becomes an org dataset, an email template a
  // draft version. Both installers stamp the source listing, so read those.
  const { data: datasetDocs } = useFirestoreCollection<any>(
    () =>
      orgId && scopeLoaded
        ? query(
            collection(firestore, 'orgs', orgId, 'datasets'),
            ...(needsScope
              ? [where('visibleTo', 'array-contains-any', scopeTokens)]
              : []),
            limit(200),
          )
        : null,
    [firestore, orgId, scopeLoaded, needsScope, scopeTokens],
    // `visibleTo` is MUTABLE — every scope edit rewrites it — so this query
    // can tombstone a dataset the way AGL-827 tombstoned a host. The rule
    // requires the constraint for anyone who is not org-wide, so unlike the
    // listings query above the predicate cannot simply be dropped (AGL-1196).
    { idField: '$id', confirmDisappearances: true },
  )
  const { data: emailDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'emailTemplates'),
        limit(100),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  // A theme is not a document in a collection — it is a field on the site
  // (AGL-1020) — so its install is read from the host doc rather than from a
  // per-artifact query like the two above.
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )

  // listingId → the newest install of it. A schema install deliberately makes
  // a NEW dataset every time, so this is genuinely one-to-many; the highest
  // installed version is what the card should speak for.
  const artifactInstalls = useMemo(() => {
    const map: Record<string, { version: string | null }> = {}
    const note = (listingId: unknown, version: unknown) => {
      const id = listingId ? String(listingId) : ''
      if (!id) return
      const next = version != null ? String(version) : null
      const seen = map[id]?.version
      if (!seen || (next && next > seen)) map[id] = { version: next }
    }
    for (const dataset of datasetDocs ?? []) {
      if (dataset.deletedAt) continue
      note(dataset.source?.listingId, dataset.source?.version)
    }
    for (const template of emailDocs ?? []) {
      if (template.deletedAt) continue
      note(template.installedFrom?.listingId, template.installedFrom?.version)
    }
    note(hostDoc?.themeInstalledFrom?.listingId, hostDoc?.themeInstalledFrom?.version)
    return map
  }, [datasetDocs, emailDocs, hostDoc])

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

  // Resolve each listing's publisher handle once. `handles` must NOT be a
  // dependency here: the effect writes `handles`, so listing it would make the
  // effect re-run on its own output. During the post-load window, when
  // `listings` arrives while every other subscription on this always-mounted
  // grid is also settling, that self-retrigger adds render+effect cycles to an
  // already dense flurry — enough that a concurrent update elsewhere can trip
  // React's nested-update limit (AGL-785). A ref of already-requested ids
  // dedupes instead, so the effect depends only on `listings`.
  const requestedHandles = useRef<Set<string>>(new Set())
  useEffect(() => {
    const profileIds = [
      ...new Set((listings ?? []).map((listing: any) => listing.profileId)),
    ].filter(
      (profileId) =>
        profileId && !requestedHandles.current.has(String(profileId)),
    )
    if (!profileIds.length) return
    for (const profileId of profileIds)
      requestedHandles.current.add(String(profileId))
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
  }, [listings, firestore])

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
      // Private plugins never appear here, not even for the org that owns
      // them (AGL-968/993). The owner exemption below exists so a publisher
      // can watch their own SUBMISSION move through review — but a private
      // listing is not waiting to be listed, it is deliberately not for the
      // marketplace, and showing it in this grid is the one thing "private"
      // promises will not happen. Owners reach theirs from
      // Marketplace › Listings, whose View opens the same detail page
      // installs happen on.
      // Soft-deleted listings used to be excluded by the query itself; they
      // are dropped here now so no mutable field sits in a `where`
      // (AGL-1196). Unconditional — unlike the review gate below, deletion
      // has no owner exemption.
      if (isListingDeleted(listing)) return false
      if (isPrivateListing(listing)) return false
      // Review queue gate (AGL-432): unreviewed/rejected plugin listings
      // stay off the public browse; the owner still sees their own (the
      // detail page shows them the status). UX-level only — the docs are
      // public-readable by design.
      if (!isListingBrowsable(listing) && listing.profileId !== viewerOrgId) {
        return false
      }
      // Publisher page (AGL-869): only this publisher's listings.
      if (publisherId && listing.profileId !== publisherId) return false
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
  }, [listings, search, category, sort, publisherId, user?.uid])

  return (
    <CardDisplay header={'Marketplace components'} contentGutterX contentGutterY>
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
            color={category === value ? 'primary' : 'default'}
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
          {'No marketplace components published yet — publish one of your ' +
            'reusable components from the Setup page to be the first.'}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {items.map((listing: any) => {
            const artifactType = listingArtifactType(listing)
            const isPlugin = artifactType === 'plugin'
            const pluginState = resolvePluginInstallState(
              listing.latestVersion,
              isPlugin ? hostPins[listing.$id] : null,
              isPlugin ? orgPins[listing.$id] : null,
            )
            const componentInstall = installed[listing.$id]
            // datasetSchema/emailTemplate installs are tracked by the source
            // listing stamped on what they created (AGL-789).
            const artifactInstall =
              artifactType === 'datasetSchema' ||
              artifactType === 'emailTemplate' ||
              artifactType === 'theme'
                ? artifactInstalls[listing.$id]
                : undefined
            const isInstalled = isPlugin
              ? pluginState.scope != null
              : Boolean(componentInstall ?? artifactInstall)
            const installedVersion = isPlugin
              ? pluginState.installedVersion
              : (componentInstall?.marketplace?.version ??
                artifactInstall?.version)
            const priceUsd = Number(listing.priceUsd ?? 0)
            const detailHref = listingHref(listing.$id)
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
                  {/* Resolved, never raw (AGL-1424) — the stored value may be
                      a `media:` reference. */}
                  <ListingImage
                    src={listing.previewImageUrl}
                    alt={`${listing.displayName} preview`}
                    sx={{
                      width: '100%',
                      height: 120,
                      objectFit: 'cover',
                      borderRadius: 1,
                    }}
                  />
                  {/* The name gets the whole line (AGL-1002). Sharing a row
                      with the chips meant the title was the only thing that
                      gave way when they did not fit — "Promo Countdown"
                      truncated to "Promo Coun…" beside chips with room to
                      spare, which inverts what matters on a browse card. */}
                  <AppLink
                    href={listingHref(listing.$id)}
                    color="inherit"
                    underline="hover"
                    variant="subtitle2"
                  >
                    {listing.displayName}
                  </AppLink>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                  >
                    {/* Primary classification, said first (AGL-864). */}
                    <Chip
                      size="small"
                      color="primary"
                      label={listingArtifactLabel(listing)}
                    />
                    {listing.category ? (
                      <Chip size="small" label={listing.category} />
                    ) : null}
                    {/* The reviewed badge belongs HERE most of all
                        (AGL-1002): the detail page showed it, but browse is
                        where someone is comparing options and deciding whose
                        code to run.

                        TWO CLAIMS, SHOWN SEPARATELY (AGL-1121). This chip
                        vouches for the PUBLISHER; the one beside it says
                        whether THESE bytes were reviewed. They were a single
                        "Verified" chip driven by `reviewStatus`, which lives
                        on the listing and deliberately survives a version
                        bump — so a publisher verified on v1.0.0 could ship
                        v1.9.0 containing anything and still be badged as
                        though the code had been read. */}
                    {listing.reviewStatus === 'verified' ? (
                      <Tooltip
                        title={
                          'A human at Aglyn confirmed who this publisher is, ' +
                          'and that the listing describes what the code does. ' +
                          'It is a claim about the publisher, not about this ' +
                          'release — it survives a version bump.'
                        }
                      >
                      <Chip
                        size="small"
                        color="info"
                        label="Verified publisher"
                        // Carries more weight than the neighbouring
                        // classification chips on purpose: it is the only one
                        // that says a human vouched for the code, and the
                        // rest are just taxonomy. The icon is what makes it
                        // findable when scanning a grid rather than reading
                        // one card.
                        icon={
                          <MdiIcon
                            path={mdiCheckDecagram.path}
                            sx={{ fontSize: 16 }}
                          />
                        }
                        sx={{ fontWeight: 600 }}
                      />
                      </Tooltip>
                    ) : null}
                    {/* The bytes on offer, not the person who wrote them.
                        Absent on a listing published before this field
                        existed, which reads as "not reviewed" — the safe
                        direction for a claim about code. */}
                    {listing.latestVersionReviewState === 'approved' ? (
                      <Tooltip
                        title={
                          'A human at Aglyn read these exact bytes — the ' +
                          'version on offer — against a required checklist. ' +
                          'Re-earned per version, so a new release starts ' +
                          'without it. Not a security guarantee: every plugin ' +
                          'runs in the same sandbox either way.'
                        }
                      >
                        <Chip size="small" color="success" label="Reviewed" />
                      </Tooltip>
                    ) : null}
                    {priceUsd > 0 ? (
                      <Chip
                        size="small"
                        color="primary"
                        label={`$${priceUsd}`}
                      />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {`v${listing.latestVersion}`}
                    {handles[listing.profileId] ? (
                      <>
                        {' · by '}
                        <AppLink
                          href={publisherHref(listing.profileId)}
                          color="primary"
                          underline="hover"
                        >
                          {`@${handles[listing.profileId]}`}
                        </AppLink>
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
                      // Four lines, then ellipsis (AGL-1002). Grid rows
                      // stretch to their tallest card, so one publisher's
                      // essay used to leave every card beside it mostly white
                      // space; the full text is one click away.
                      //
                      // Plain `style`, not `sx`: emotion drops the
                      // `-webkit-box` display value on the way through, and
                      // without it the other three properties clamp nothing
                      // (measured — `display` computed to `flow-root` while
                      // line-clamp and box-orient came through fine). Nothing
                      // here reads the theme, so there is nothing to lose.
                      style={{
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 4,
                        overflow: 'hidden',
                      }}
                    >
                      {listing.description}
                    </Typography>
                  ) : (
                    <span style={{ flex: 1 }} />
                  )}
                  {/* Read-only state, then a link to the detail page — the
                      only place an install happens (AGL-867). No install/buy
                      action lives on the grid. */}
                  {/* Install state reads as one statement (AGL-1002): the
                      scope belongs with "Installed", not up in the chip row
                      among the type and category pills, which say what the
                      listing IS rather than what this workspace has done
                      with it. Org-wide installs apply to every site
                      (AGL-656). */}
                  {isInstalled ? (
                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="caption" color="success.main">
                        {`Installed${
                          installedVersion ? ` (v${installedVersion})` : ''
                        }`}
                      </Typography>
                      {isPlugin && pluginState.scope === 'org' ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={
                            pluginState.shadowed
                              ? 'Org-wide (shadowed)'
                              : 'Org-wide'
                          }
                        />
                      ) : null}
                    </Stack>
                  ) : null}
                  <AppLink
                    componentVariant="button"
                    size="small"
                    variant="outlined"
                    color="primary"
                    href={detailHref ?? ''}
                    disabled={!detailHref}
                  >
                    {priceUsd > 0 && !isInstalled
                      ? `View details · $${priceUsd}`
                      : 'View details'}
                  </AppLink>
                </Stack>
              </Grid>
            )
          })}
        </Grid>
      )}
    </CardDisplay>
  )
}
MarketplaceBrowse.displayName = 'MarketplaceBrowse'

export default MarketplaceBrowse
