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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import {
  Alert,
  Chip,
  Tooltip,
  Grid,
  MenuItem,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  documentId,
  getDoc,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildRoute,
  type OrgPermissions,
  PLATFORM_BRAND_NAME,
  pluginDocsHelp,
  Route,
} from '@aglyn/aglyn'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostOrgId,
  useScopeTokens,
} from '@aglyn/tenant-feature-instance'
/*
 * The MODULE, not the barrel, for the two PURE helpers — the specs that render
 * this grid mock `@aglyn/tenant-feature-instance` wholesale to stage their
 * Firestore hooks, and a query builder imported through that barrel disappears
 * under the mock. Neither of these is a hook.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import {
  LISTING_CATEGORIES,
  listingArtifactType,
  listingArtifactLabel,
  resolvePluginInstallState,
} from '../model/marketplace'
import {
  BROWSE_SORTS,
  type BrowseSort,
  browseBase,
  MARKETPLACE_BROWSE_QUERY,
} from '../model/listing-query'
import { ListingImage } from './listing-image.component'

// The console route table is shared (AGL-685), so these go through
// buildRoute rather than being reassembled from a base string — the shape
// of `/[orgSlug]/hosts/[host]/marketplace/…` is not this plugin's to know.

/**
 * How many install records the shelf reads to decide what it already runs.
 *
 * One number for the five collections that answer that question, because the
 * card reads them together and a reader comparing a plugin's chip to a
 * dataset's should not have to know which window was twice the other. It
 * bounds an install-state LOOKUP, not the shelf: the listings query has its
 * own cap, and the grid pages what survives the filters.
 */
const INSTALL_STATE_CEILING = 100

/** How the browse clauses read in a refusal. */
const BROWSE_HEADERS: Readonly<Record<string, string>> = { category: 'Category' }
/** How long the search box waits for typing to stop before it asks again. */
const SEARCH_SETTLE_MS = 300

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
  const { orgScoped, orgSlug: orgSlugProp, publisherId } = props
  const [handles, setHandles] = useState<Record<string, string>>({})
  // Listings are org-owned (AGL-652), so "is this mine" is an org comparison.
  // Resolved from the routing mirror rather than a new prop so the component
  // stays self-contained; hostIndex is signed-in readable. `undefined` while
  // it resolves: the shelf's query names the viewer's org in its audience
  // clause, so it waits for the answer rather than asking twice. A failed
  // lookup settles at `null` — the public shelf, without the viewer's own
  // listings in review.
  const [viewerOrgId, setViewerOrgId] = useState<string | null | undefined>(
    undefined,
  )
  useEffect(() => {
    let active = true
    setViewerOrgId(undefined)
    void getDoc(doc(firestore, 'hostIndex', hostId))
      .then((snapshot) => {
        if (active) setViewerOrgId((snapshot.get('orgId') as string) ?? null)
      })
      .catch(() => {
        if (active) setViewerOrgId(null)
      })
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

  /*
   * THE SHELF IS ITS QUERY (AGL-3321).
   *
   * Browse read the newest ninety listings and resolved everything else in
   * memory — the search box, the category chips, the three sorts, and the
   * gates that keep deleted, private and unreviewed listings off the shelf.
   * A listing that was not among those ninety could not be found by any of
   * them, and "Most installed" sorted a sample.
   *
   * Every one of them is on the query now. The gates are one clause, the
   * listing's written `browseAudience` (see `listingBrowseAudience`), asked
   * with `array-contains-any` for everyone (`*`) and the viewer's own org —
   * the owner exemption the in-memory gate carried (AGL-432): a publisher
   * sees their own listing while it waits on review. A publisher page asks
   * the same scopes joined to that publisher. The search folds into the same
   * clause through `browseTokens`, a category is an equality, and each sort
   * is the query's order; `MARKETPLACE_BROWSE_QUERY` declares them and its
   * spec pins the composites that serve them.
   *
   * `browseAudience` is MUTABLE — an unpublish, a takedown or a verdict
   * rewrites it — so a document can stop matching mid-session and be cached
   * as a `noDocument` tombstone at the path the detail page reads by id
   * (AGL-827/929). That was why the `deletedAt` predicate came off this query
   * in AGL-1196; `confirmDisappearances` is the repair that hook documents
   * for a predicate that cannot be dropped, and this one cannot.
   */
  const gridFilter = useListGridFilter({ selectFields: ['category'] })
  const [search, setSearch] = useState('')
  const [searchWords, setSearchWords] = useState<string[]>([])
  useEffect(() => {
    const timer = setTimeout(
      () => setSearchWords(search.split(/\s+/).filter(Boolean)),
      SEARCH_SETTLE_MS,
    )
    return () => clearTimeout(timer)
  }, [search])
  const [sort, setSort] = useState<BrowseSort>('newest')
  const category =
    gridFilter.clauses.find((clause) => clause.field === 'category')?.value ??
    null
  const listingsRef = useMemo(
    () =>
      viewerOrgId === undefined
        ? null
        : collection(firestore, 'marketplaceListings'),
    [firestore, viewerOrgId],
  )
  const {
    rows: shown,
    status: shelfStatus,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
  } = useListQuery<any>({
    collection: listingsRef,
    declaration: MARKETPLACE_BROWSE_QUERY,
    request: {
      clauses: gridFilter.clauses,
      search: searchWords,
      sort: BROWSE_SORTS[sort],
      base: browseBase(viewerOrgId, publisherId),
    },
    deps: [firestore, viewerOrgId, publisherId],
    idField: '$id',
    confirmDisappearances: true,
  })
  const listings = shown
  const filtering = Boolean(category) || searchWords.length > 0
  const refusals = useMemo(
    () =>
      listQueryRefusals(plan.refused, {
        fields: MARKETPLACE_BROWSE_QUERY.fields,
        headers: BROWSE_HEADERS,
      }),
    [plan],
  )
  /*
   * ## The install-state lookups are ORDERED too, and they are not lists
   *
   * The five queries below (this one, the two pin collections, the org
   * datasets and the site's email templates) answer one question per card:
   * has this listing already been installed here. None of them is rendered —
   * each is folded into a map keyed by listing id — so the fix that suits the
   * shelf above does not suit them: there is no page to walk and no footer to
   * put a control in.
   *
   * What they share with it is the defect. A bare `limit` is answered in
   * DOCUMENT-ID order, so an unnamed window is an arbitrary slice of its
   * collection, and a lookup MISS is indistinguishable from a genuine
   * not-installed: a workspace past such a window is shown "Add to this site"
   * beside something it already runs, and the detail page — which reads its
   * own pins by id — disagrees with the grid it was reached from.
   *
   * `collectionCeiling` names the order and asks for one row past the
   * ceiling, which is what turns "the window may have bitten" into a fact the
   * shelf can state rather than a silence it cannot.
   */
  const { data: installedRead } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'components'),
        INSTALL_STATE_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: installedDocs, truncated: installedTruncated } = useMemo(
    () => ceilingedWindow<any>(installedRead, INSTALL_STATE_CEILING),
    [installedRead],
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
  const { data: hostPinRead } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'installs'),
        INSTALL_STATE_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: hostPinDocs, truncated: hostPinsTruncated } = useMemo(
    () => ceilingedWindow<any>(hostPinRead, INSTALL_STATE_CEILING),
    [hostPinRead],
  )
  // Held at null while `useHostOrgId` is in flight, never `orgs/-pending-`
  // (AGL-1440): the AGL-1047 comment seven lines below records the same
  // denial-every-mount shape for `useScopeTokens` — this listen had it too.
  const { data: orgPinRead } = useFirestoreCollection<any>(
    () =>
      orgId
        ? collectionCeiling(
            collection(firestore, 'orgs', orgId, 'installs'),
            INSTALL_STATE_CEILING,
          )
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )
  const { rows: orgPinDocs, truncated: orgPinsTruncated } = useMemo(
    () => ceilingedWindow<any>(orgPinRead, INSTALL_STATE_CEILING),
    [orgPinRead],
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
  /*
   * `documentId()` rather than a field, for the reason the audience sweep in
   * `campaign-send.ts` gives: Firestore's automatic single-field index for an
   * array member is keyed on the value and the document name, so
   * `array-contains-any` plus `orderBy(__name__)` is served by it. Ordering on
   * anything else would need a composite index per scope shape.
   *
   * The ceiling is the shared one. It is not sized for the dataset
   * collection: it is sized for the number of LISTINGS whose install state a
   * shelf of ninety cards can describe, which is the same question its four
   * neighbours answer, so it is the same number.
   */
  const { data: datasetRead } = useFirestoreCollection<any>(
    () =>
      orgId && scopeLoaded
        ? query(
            collection(firestore, 'orgs', orgId, 'datasets'),
            ...(needsScope
              ? [where('visibleTo', 'array-contains-any', scopeTokens)]
              : []),
            orderBy(documentId()),
            limit(INSTALL_STATE_CEILING + 1),
          )
        : null,
    [firestore, orgId, scopeLoaded, needsScope, scopeTokens],
    // `visibleTo` is MUTABLE — every scope edit rewrites it — so this query
    // can tombstone a dataset the way AGL-827 tombstoned a host. The rule
    // requires the constraint for anyone who is not org-wide, so unlike the
    // listings query above the predicate cannot simply be dropped (AGL-1196).
    { idField: '$id', confirmDisappearances: true },
  )
  const { rows: datasetDocs, truncated: datasetsTruncated } = useMemo(
    () => ceilingedWindow<any>(datasetRead, INSTALL_STATE_CEILING),
    [datasetRead],
  )
  const { data: emailRead } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'emailTemplates'),
        INSTALL_STATE_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: emailDocs, truncated: emailsTruncated } = useMemo(
    () => ceilingedWindow<any>(emailRead, INSTALL_STATE_CEILING),
    [emailRead],
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

  /**
   * The install-state lookups did not read everything they were asked about.
   *
   * Said on the SHELF rather than on the card that is wrong, because there is
   * no way to know which card that is: a miss and a genuine not-installed are
   * the same absence from the same map. What the reader can act on is that the
   * chips are a floor — anything marked installed is installed, and something
   * unmarked may still be.
   */
  const installStateTruncated =
    installedTruncated ||
    hostPinsTruncated ||
    orgPinsTruncated ||
    datasetsTruncated ||
    emailsTruncated

  return (
    <CardDisplay
      header={'Marketplace components'}
      help={pluginDocsHelp('plugins', { anchor: '#install--upgrade' })}
      contentGutterX
      contentGutterY
    >
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
        {/* The fixed taxonomy (AGL-430), not the categories the loaded page
            happened to hold: a chip is a question for the query, and one
            missing because no listing on this page had it could never be
            asked. */}
        {LISTING_CATEGORIES.map((value) => (
          <Chip
            key={value}
            label={value}
            variant={category === value ? 'filled' : 'outlined'}
            color={category === value ? 'primary' : 'default'}
            onClick={() =>
              gridFilter.setClauses(
                category === value
                  ? []
                  : [{ field: 'category', op: 'equals', value }],
              )
            }
          />
        ))}
        <TextField
          value={sort}
          onChange={(event) => setSort(event.target.value as BrowseSort)}
          size="small"
          select
          sx={{ ml: 'auto', minWidth: 150 }}
        >
          <MenuItem value="newest">{'Newest'}</MenuItem>
          <MenuItem value="installed">{'Most installed'}</MenuItem>
          <MenuItem value="rated">{'Highest rated'}</MenuItem>
        </TextField>
      </Stack>
      {installStateTruncated ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {`Installed state is resolved from the first ${INSTALL_STATE_CEILING} ` +
            'install records in this workspace, ordered by id. There are ' +
            'more, so a card may not be marked installed even though it is. ' +
            'Open a listing to see what this workspace actually runs.'}
        </Alert>
      ) : null}
      <ListQueryNotices refused={refusals} notices={plan.notices} />
      {shown.length === 0 && page === 0 ? (
        shelfStatus === 'success' ? (
          <Typography variant="body2" color="text.secondary">
            {filtering
              ? 'No components match this search.'
              : 'No marketplace components published yet — publish one of ' +
                'your reusable components from the Setup page to be the first.'}
          </Typography>
        ) : null
      ) : (
        <>
        <Grid container spacing={2}>
          {shown.map((listing: any) => {
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
            //
            // `emailStarter` is deliberately absent. Every other type has ONE
            // install per site to point at — a pin, a dataset, a draft on a
            // fixed catalog key, the site's theme — so "Installed" names
            // something. A starter installs as a NEW email each time, and a
            // site may keep five of them; there is no single copy for a chip
            // to describe, and marking the listing installed would grey out
            // the button that makes the sixth.
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
                        though the code had been read.

                        Both tooltips name `PLATFORM_BRAND_NAME` rather than
                        the viewing org's `productName` (AGL-2351). They say
                        who did the verifying and the reading — the
                        deployment's own review queue, one catalog shared by
                        every org — and a white-label agency's brand here would
                        claim the agency vetted a publisher it has never heard
                        of. */}
                    {listing.reviewStatus === 'verified' ? (
                      <Tooltip
                        title={
                          `A human at ${PLATFORM_BRAND_NAME} confirmed who ` +
                          'this publisher is, ' +
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
                          `A human at ${PLATFORM_BRAND_NAME} read these exact ` +
                          'bytes — the ' +
                          'version on offer — against a required checklist. ' +
                          'Re-earned per version, so a new release starts ' +
                          'without it. Not a security guarantee: every plugin ' +
                          'runs in the same sandbox either way.'
                        }
                      >
                        <Chip size="small" color="success" label="Reviewed" />
                      </Tooltip>
                    ) : null}
                    {/*
                      Price on EVERY card, `Free` included (AGL-2173). The
                      chip only rendered above zero, so the four free
                      listings the marketplace mockup shows carried no
                      price at all — and "no chip" is the one reading a
                      shopper cannot distinguish from "we forgot", on the
                      row where the paid listing beside it says $29.
                     */}
                    <Chip
                      size="small"
                      color={priceUsd > 0 ? 'primary' : 'success'}
                      variant={priceUsd > 0 ? 'filled' : 'outlined'}
                      label={priceUsd > 0 ? `$${priceUsd}` : 'Free'}
                    />
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
                  </Typography>
                  {/*
                    Stars, as the mockup draws them (AGL-2173). The count
                    stays alongside the average: "5.0" from one rating and
                    from forty are not the same claim (AGL-655). An unrated
                    listing says so rather than rendering nothing — silence
                    read as "no stars", which is the opposite of "not yet
                    rated".
                   */}
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ alignItems: 'center' }}
                  >
                    {listing.ratingCount ? (
                      <>
                        <Rating
                          size="small"
                          readOnly
                          precision={0.1}
                          value={Number(listing.ratingAverage ?? 0)}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {`${listing.ratingAverage ?? 0} (${listing.ratingCount})`}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {'Not yet rated'}
                      </Typography>
                    )}
                  </Stack>
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
        {/* The query pages the shelf, so the total is not known — only
            whether another page exists. */}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={shown.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        </>
      )}
    </CardDisplay>
  )
}
MarketplaceBrowse.displayName = 'MarketplaceBrowse'

export default MarketplaceBrowse
