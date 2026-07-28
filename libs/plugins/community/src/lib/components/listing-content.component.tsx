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

import {
  LISTING_README_MAX_CHARS,
  listingArtifactType,
  listingArtifactLabel,
  installTargetsFor,
  resolveInstallPlan,
  resolvePluginInstallState,
  type InstallTargeting,
} from '../model/community'
import {
  buildRoute,
  parseMarkdownLite,
  PLUGIN_HOST_ABI_VERSION,
  Route,
  type MarkdownBlock,
  type MarkdownInline,
} from '@aglyn/aglyn'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material'
import { collection, doc, getDoc, limit, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostOrgId,
  useUser,
} from '@aglyn/tenant-feature-instance'
import HubTabs from '@aglyn/shared-ui-next/components/hub-tabs'
import ListingReviews from './listing-reviews.component'
import { MenuItem, TextField } from '@mui/material'
import { useCommunityActions } from '../hooks/use-community-actions'

interface ListingVersionEntry {
  version: string
  changelog?: string
  trust?: string
  hostAbi?: number
  publishedAtMs: number | null
}

const renderInlines = (inlines: MarkdownInline[]) =>
  inlines.map((inline, index) => {
    switch (inline.type) {
      case 'bold':
        return <strong key={index}>{inline.text}</strong>
      case 'italic':
        return <em key={index}>{inline.text}</em>
      case 'link':
        return (
          <MuiLink
            key={index}
            href={inline.href}
            target="_blank"
            rel="noopener noreferrer"
            color="secondary"
            underline="hover"
          >
            {inline.text}
          </MuiLink>
        )
      default:
        return <span key={index}>{inline.text}</span>
    }
  })

/**
 * Publisher README (AGL-431), rendered through markdown-lite — the parser
 * only ever emits text/bold/italic/http(s)-links/images, so publisher-
 * written docs can't inject markup or javascript: URLs. Code blocks and
 * tables carry text only (AGL-974); the same guarantee holds for both.
 */
function ListingReadme({ readme }: { readme: string }) {
  const blocks = useMemo<MarkdownBlock[]>(
    () => parseMarkdownLite(readme.slice(0, LISTING_README_MAX_CHARS)),
    [readme],
  )
  return (
    <Stack spacing={1.5}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <Typography
                key={index}
                variant={block.level === 2 ? 'h6' : 'subtitle1'}
              >
                {renderInlines(block.inlines)}
              </Typography>
            )
          case 'image':
            return (
              <Box
                key={index}
                component="img"
                src={block.src}
                alt={block.alt}
                loading="lazy"
                sx={{
                  maxWidth: '100%',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                }}
              />
            )
          case 'list':
            return (
              <Stack key={index} component="ul" spacing={0.5} sx={{ my: 0 }}>
                {block.items.map((item, itemIndex) => (
                  <Typography key={itemIndex} component="li" variant="body2">
                    {renderInlines(item)}
                  </Typography>
                ))}
              </Stack>
            )
          // A README's example snippet (AGL-974). Scrolls rather than wraps —
          // a wrapped command line reads as two commands.
          case 'code':
            return (
              <Box
                key={index}
                component="pre"
                sx={{
                  my: 0,
                  p: 1.5,
                  overflowX: 'auto',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'action.hover',
                  typography: 'body2',
                  fontFamily: 'monospace',
                }}
              >
                <code>{block.text}</code>
              </Box>
            )
          // The config table (AGL-974) — the block a plugin README is
          // mostly made of. Wrapped in its own scroller so a wide table
          // never pushes the page sideways.
          case 'table':
            return (
              <Box key={index} sx={{ overflowX: 'auto' }}>
                <Box
                  component="table"
                  sx={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    '& th, & td': {
                      border: 1,
                      borderColor: 'divider',
                      px: 1,
                      py: 0.5,
                    },
                    '& th': { bgcolor: 'action.hover' },
                  }}
                >
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <Typography
                          key={cellIndex}
                          component="th"
                          variant="body2"
                          sx={{
                            textAlign: block.align[cellIndex] ?? 'left',
                            fontWeight: 600,
                          }}
                        >
                          {renderInlines(cell)}
                        </Typography>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <Typography
                            key={cellIndex}
                            component="td"
                            variant="body2"
                            sx={{ textAlign: block.align[cellIndex] ?? 'left' }}
                          >
                            {renderInlines(cell)}
                          </Typography>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )
          default:
            return (
              <Typography key={index} variant="body2">
                {renderInlines(block.inlines)}
              </Typography>
            )
        }
      })}
    </Stack>
  )
}

export interface CommunityListingContentProps {
  hostId: string
  listingId: string
  /** Org-role permissions resolved by the shell (install gating). */
  permissions: Record<string, boolean | undefined>
  /**
   * Rendered under the org-scope `/marketplace` route (AGL-772) rather than
   * a site's community tab. The publisher page has no org route yet, so the
   * publisher renders as text at org scope instead of linking to a per-site
   * page being retired.
   */
  orgScoped?: boolean
  /**
   * The acting org's slug from the URL (AGL-869). At org scope the publisher
   * link builds from it directly rather than the async host resolution.
   */
  orgSlug?: string
  /**
   * The org's sites, for the install-targeting picker (AGL-773). Present only
   * at org scope; when given (and non-empty) the CTA offers All sites vs
   * Selected sites instead of the single org/host choice.
   */
  hosts?: ReadonlyArray<{ id: string; label: string }>
}

/**
 * Community listing detail (AGL-95/419), relocated from the app route —
 * the app keeps the Dashboard chrome and renders this through the
 * 'communityListing' widget slot. Full description, preview image,
 * version history, publisher block, and the install/buy CTA.
 */
export function CommunityListingContent({
  hostId,
  listingId,
  permissions,
  orgScoped,
  orgSlug: orgSlugProp,
  hosts,
}: CommunityListingContentProps) {
  // The publisher link was `/{hostDocId}/community/publisher/{id}` — the
  // pre-AGL-621 shape, dead since. The sibling browse grid was fixed for
  // exactly this (AGL-673) and this file was missed; both now build the
  // route from the shared table (AGL-685).
  const { orgSlug: resolvedOrgSlug, subdomain } = useConsoleHostRoute(hostId)
  // Prefer the URL slug (AGL-869): synchronous and always present at org scope.
  const orgSlug = orgSlugProp ?? resolvedOrgSlug
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { install, installPlan, buy, uninstall } = useCommunityActions(hostId)
  const [installScope, setInstallScope] = useState<'org' | 'host'>('org')
  // Confirm before writing install pins (AGL-867): the install is deliberate
  // and site-scoped, so it names its targets before committing.
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Screenshot lightbox (AGL-869): the clicked screenshot's URL, or null.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  // Org-scope install targeting (AGL-773): All sites vs a chosen subset. Only
  // engaged at org scope with a known site list; otherwise the per-site tab's
  // simpler org/host choice (AGL-656) still applies.
  const orgTargeting = Boolean(orgScoped && hosts && hosts.length > 0)
  const [targeting, setTargeting] = useState<InstallTargeting>('all-sites')
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([])
  const allHostIds = useMemo(() => (hosts ?? []).map((h) => h.id), [hosts])
  // Listings are org-owned (AGL-652) — "did I publish this" is an org
  // comparison, resolved from the routing mirror like the browse grid.
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

  const { data: listing, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'communityListings', listingId || '-missing-'),
    [firestore, listingId],
    { idField: '$id' },
  )
  // Targets this artifact type can actually install to (AGL-656) — only
  // plugins have an org-scoped pin, so only plugins get a choice.
  const installTargets = useMemo(
    () =>
      listing ? installTargetsFor(listing) : (['host'] as readonly string[]),
    [listing],
  )
  const { data: profile } = useFirestoreDoc<any>(
    () => doc(firestore, 'publisherProfiles', listing?.profileId ?? '-anonymous-'),
    [firestore, listing?.profileId],
    { idField: '$id' },
  )
  const { data: installedDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
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
  const artifactType = listing ? listingArtifactType(listing) : null
  const isPlugin = artifactType === 'plugin'
  // Plugin installs are version PINS, not component snapshots (AGL-656): a
  // host pin lives at `hosts/{h}/installs/{id}`, an org pin at
  // `orgs/{o}/installs/{id}` and applies to every site. Reading only
  // `components` above never sees either, so an installed plugin read as
  // "not installed" here; the two pins tell the honest story, host over org.
  const orgId = useHostOrgId(hostId)
  const { data: hostPin } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'installs', listingId || '-missing-'),
    [firestore, hostId, listingId],
    { idField: '$id' },
  )
  const { data: orgPin } = useFirestoreDoc<any>(
    () =>
      doc(
        firestore,
        'orgs',
        orgId ?? '-pending-',
        'installs',
        listingId || '-missing-',
      ),
    [firestore, orgId, listingId],
    { idField: '$id' },
  )
  // datasetSchema/emailTemplate installs live in neither collection above
  // (AGL-789) — they become an org dataset or a draft email version, each
  // stamped with the listing it came from. Scoped to this listing rather than
  // reading the whole collection, since the detail page only speaks for one.
  const { data: datasetInstalls } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId ?? '-pending-', 'datasets'),
        where('source.listingId', '==', listingId || '-missing-'),
        limit(20),
      ),
    [firestore, orgId, listingId],
    { idField: '$id' },
  )
  const { data: emailInstalls } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'emailTemplates'),
        where('installedFrom.listingId', '==', listingId || '-missing-'),
        limit(20),
      ),
    [firestore, hostId, listingId],
    { idField: '$id' },
  )
  const artifactInstall = useMemo(() => {
    if (artifactType === 'datasetSchema') {
      const hit = (datasetInstalls ?? []).find((entry: any) => !entry.deletedAt)
      return hit ? { version: hit.source?.version ?? null } : undefined
    }
    if (artifactType === 'emailTemplate') {
      const hit = (emailInstalls ?? []).find((entry: any) => !entry.deletedAt)
      return hit ? { version: hit.installedFrom?.version ?? null } : undefined
    }
    return undefined
  }, [artifactType, datasetInstalls, emailInstalls])

  const pluginState = useMemo(
    () =>
      resolvePluginInstallState(
        listing?.latestVersion,
        isPlugin ? hostPin : null,
        isPlugin ? orgPin : null,
      ),
    [listing?.latestVersion, isPlugin, hostPin, orgPin],
  )

  // Public version history + trust tier (AGL-431): the pluginVersions
  // docs are server-only, so the community API exposes the buyer-safe
  // subset (version/changelog/trust/hostAbi/date).
  const [versions, setVersions] = useState<ListingVersionEntry[]>([])
  useEffect(() => {
    if (!listing || listingArtifactType(listing) !== 'plugin' || !listingId) return
    let active = true
    void fetch(
      `/api/community/listing-versions?listingId=${encodeURIComponent(listingId)}`,
    )
      .then((response) => (response.ok ? response.json() : { versions: [] }))
      .then((payload) => {
        if (active) setVersions(payload?.versions ?? [])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // Keyed on the listing's id, not its legacy `type` (AGL-864): an
    // artifactType-only plugin has no `type`, so keying on it left the effect
    // stuck at its undefined first value and the versions fetch never fired.
  }, [listing?.$id, listingId])
  const latestEntry = versions[0]
  const realmTrusted = versions.some((entry) => entry.trust === 'realm')
  const abiIncompatible =
    latestEntry?.hostAbi != null &&
    latestEntry.hostAbi !== PLUGIN_HOST_ABI_VERSION

  // Component listings still install into `hosts/{h}/components`; plugin
  // state comes from the pins above. `installed` unifies the two so the CTA
  // and the buy gate read the same for either artifact type.
  const componentInstall = useMemo(
    () =>
      (installedDocs ?? []).find(
        (definition: any) =>
          definition?.community?.listingId === listingId &&
          !definition.deletedAt,
      ),
    [installedDocs, listingId],
  )
  const purchased = useMemo(
    () =>
      (purchaseDocs ?? []).some(
        (purchase: any) => purchase.listingId === listingId,
      ),
    [purchaseDocs, listingId],
  )

  const missing =
    status === 'success' && (!listing?.profileId || listing?.deletedAt)
  const installed = isPlugin
    ? pluginState.scope != null
    : Boolean(componentInstall ?? artifactInstall)
  const installedVersion = isPlugin
    ? pluginState.installedVersion
    : (componentInstall?.community?.version ?? artifactInstall?.version)
  const upToDate = isPlugin
    ? installed && !pluginState.updateAvailable
    : componentInstall && installedVersion >= listing?.latestVersion
  const priceUsd = Number(listing?.priceUsd ?? 0)
  const mustBuy =
    priceUsd > 0 && !purchased && listing?.profileId !== viewerOrgId && !installed
  // Updating an installed plugin stays at its current scope; a fresh install
  // uses the picker (plugins) or the artifact's only target (everything else).
  const installTargetScope: 'org' | 'host' | undefined =
    isPlugin && installed
      ? (pluginState.scope ?? undefined)
      : installTargets.length > 1
        ? installScope
        : undefined
  // Org-scope targeting (AGL-773): "Selected sites" is only offered when the
  // artifact can host-pin (plugins, components, templates, layouts) — an
  // org-only artifact can't target a subset.
  const canSelectSites = installTargets.includes('host')
  const installPlanSteps = useMemo(
    () =>
      listing
        ? resolveInstallPlan(listing, targeting, {
            selectedHostIds,
            allHostIds,
          })
        : [],
    [listing, targeting, selectedHostIds, allHostIds],
  )
  const versionHistory: any[] = Array.isArray(listing?.versionHistory)
    ? [...listing.versionHistory].sort((a, b) => b.version - a.version)
    : []

  // Human summary of exactly where this install lands (AGL-867), read from the
  // same targeting the CTA acts on. An org pin covers every site (now and
  // future); host pins are named so "Selected sites" can't silently mean
  // something else.
  const installTargetSummary = (): string => {
    if (orgTargeting && !installed) {
      if (
        installPlanSteps.length === 1 &&
        installPlanSteps[0]?.scope === 'org'
      ) {
        return 'the whole organization — every site, including sites added later'
      }
      const names = installPlanSteps
        .filter((step) => step.scope === 'host')
        .map(
          (step) =>
            (hosts ?? []).find((host) => host.id === step.hostId)?.label ??
            step.hostId,
        )
      if (names.length) {
        return `${names.length} site${names.length === 1 ? '' : 's'}: ${names.join(
          ', ',
        )}`
      }
      return 'the selected targets'
    }
    // Org-only artifacts (dataset schema) always land org-wide — including on
    // re-add, where installTargetScope isn't set (AGL-867).
    if (
      installTargetScope === 'org' ||
      (installTargets.length === 1 && installTargets[0] === 'org')
    ) {
      return 'the whole organization — every site'
    }
    return 'this site'
  }

  // The actual pin write, run only after the confirm dialog (AGL-867).
  const runInstall = () => {
    setConfirmOpen(false)
    if (orgTargeting && !installed) {
      void installPlan(listing, installPlanSteps)
    } else {
      void install(listing, installTargetScope)
    }
  }

  return (
    <>
      <NextPageTitle screen={listing?.displayName ?? 'Community listing'} />
        <Container gutterY maxWidth="xl">
          {missing ? (
            <Typography variant="body2" color="text.secondary">
              {'This listing does not exist or was unpublished.'}
            </Typography>
          ) : (
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 8 },
                  children: (
                    <CardDisplay
                      header={listing?.displayName ?? '…'}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={2}>
                        {listing?.previewImageUrl ? (
                          <Box
                            component="img"
                            src={listing.previewImageUrl}
                            alt={`${listing?.displayName} preview`}
                            sx={{
                              width: '100%',
                              maxHeight: 360,
                              objectFit: 'cover',
                              borderRadius: 1,
                              border: 1,
                              borderColor: 'divider',
                            }}
                          />
                        ) : null}
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          {listing?.logoUrl ? (
                            <Box
                              component="img"
                              src={listing.logoUrl}
                              alt={`${listing?.displayName} logo`}
                              sx={{
                                width: 32,
                                height: 32,
                                borderRadius: 1,
                                objectFit: 'cover',
                              }}
                            />
                          ) : null}
                          {/* What kind of thing this is, said plainly and
                              first (AGL-864) — a plugin, a site template, a
                              layout, etc. Filled so it reads as the primary
                              classification, ahead of the softer category
                              chips. */}
                          {listing ? (
                            <Chip
                              size="small"
                              color="primary"
                              label={listingArtifactLabel(listing)}
                            />
                          ) : null}
                          {(listing?.categories ?? []).map((entry: string) => (
                            <Chip key={entry} size="small" label={entry} />
                          ))}
                          {listing?.category &&
                          !(listing?.categories ?? []).length ? (
                            <Chip size="small" label={listing.category} />
                          ) : null}
                          {listing?.license ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={listing.license}
                            />
                          ) : null}
                          {isPlugin ? (
                            realmTrusted ? (
                              <Chip
                                size="small"
                                color="success"
                                label="Realm-trusted"
                              />
                            ) : (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Sandboxed"
                              />
                            )
                          ) : null}
                          {listing?.reviewStatus === 'verified' ? (
                            <Chip size="small" color="info" label="Verified" />
                          ) : null}
                          <Chip
                            size="small"
                            color={priceUsd > 0 ? 'secondary' : 'default'}
                            label={priceUsd > 0 ? `$${priceUsd}` : 'Free'}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {`v${listing?.latestVersion ?? '…'}`}
                            {listing?.installCount
                              ? ` · ${listing.installCount} install${
                                  listing.installCount === 1 ? '' : 's'
                                }`
                              : ''}
                            {/* Active pins vs the cumulative total (AGL-880). */}
                            {typeof listing?.activeInstalls === 'number' &&
                            listing?.installCount
                              ? ` · ${listing.activeInstalls} active`
                              : ''}
                          </Typography>
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {listing?.description ?? 'No description provided.'}
                        </Typography>
                        {isPlugin &&
                        !realmTrusted &&
                        listing?.reviewStatus !== 'verified' ? (
                          <Alert severity="info">
                            {'Community plugin: runs sandboxed and cannot ' +
                              'access your site data directly. Review the ' +
                              'publisher and docs before installing.'}
                          </Alert>
                        ) : null}
                        {abiIncompatible ? (
                          <Alert severity="warning">
                            {`Built for platform generation ${latestEntry?.hostAbi}; ` +
                              `this platform runs ${PLUGIN_HOST_ABI_VERSION}. ` +
                              'It will not load until the publisher ships a ' +
                              'compatible version.'}
                          </Alert>
                        ) : null}
                        {(listing?.screenshots ?? []).length ? (
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ overflowX: 'auto', pb: 0.5 }}
                          >
                            {listing.screenshots.map((url: string) => (
                              // Click to zoom (AGL-869) — the strip thumbnails
                              // are too small to actually evaluate a UI from.
                              <Box
                                key={url}
                                component="img"
                                src={url}
                                alt={`${listing?.displayName} screenshot`}
                                loading="lazy"
                                onClick={() => setLightboxUrl(url)}
                                sx={{
                                  height: 180,
                                  borderRadius: 1,
                                  border: 1,
                                  borderColor: 'divider',
                                  cursor: 'zoom-in',
                                }}
                              />
                            ))}
                          </Stack>
                        ) : null}
                        {listing?.readme ? (
                          <>
                            <Divider />
                            <ListingReadme readme={listing.readme} />
                          </>
                        ) : null}
                        {/* Existing state, told honestly (AGL-656): an org
                            pin applies everywhere, and this site's own pin
                            shadows it. Showing this is the difference between
                            "Add to this site" lying and the truth. */}
                        {isPlugin && installed ? (
                          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                            <Alert
                              severity="success"
                              icon={false}
                              sx={{ py: 0.5, width: '100%' }}
                            >
                              {pluginState.shadowed
                                ? `Installed on this site (v${installedVersion}), ` +
                                  'overriding the organization-wide install.'
                                : pluginState.scope === 'org'
                                  ? `Installed for the whole organization ` +
                                    `(v${installedVersion}) — available on every site.`
                                  : `Installed on this site (v${installedVersion}).`}
                              {pluginState.updateAvailable
                                ? ` A newer version (v${listing?.latestVersion}) is available.`
                                : ''}
                            </Alert>
                            {/* Uninstall from the listing too (AGL-881), not
                                only the installed add-ons card. Targets the
                                effective pin's scope. */}
                            <Button
                              size="small"
                              color="error"
                              onClick={() =>
                                void uninstall(
                                  listing,
                                  pluginState.scope ?? undefined,
                                )
                              }
                            >
                              {pluginState.scope === 'org'
                                ? 'Uninstall org-wide'
                                : 'Uninstall'}
                            </Button>
                          </Stack>
                        ) : null}
                        {/* Install targeting (AGL-773): at org scope, choose
                            All sites vs a chosen subset. Only when NOT already
                            installed — re-asking once it's settled would lie.
                            The per-site tab keeps the simpler org/host choice
                            (AGL-656) below until it's retired. */}
                        {orgTargeting && !installed ? (
                          <Stack spacing={1.5} sx={{ maxWidth: 420 }}>
                            <TextField
                              select
                              size="small"
                              label="Install to"
                              value={targeting}
                              onChange={(event) =>
                                setTargeting(
                                  event.target.value as InstallTargeting,
                                )
                              }
                              helperText={
                                targeting === 'all-sites'
                                  ? installTargets.includes('org')
                                    ? 'Available on every site — including sites you add later.'
                                    : `Installs to all ${allHostIds.length} site` +
                                      (allHostIds.length === 1 ? '' : 's') +
                                      ". New sites won't get it automatically."
                                  : 'Installs only to the sites you choose.'
                              }
                            >
                              <MenuItem value="all-sites">
                                {'All sites'}
                              </MenuItem>
                              {canSelectSites ? (
                                <MenuItem value="selected-sites">
                                  {'Selected sites'}
                                </MenuItem>
                              ) : null}
                            </TextField>
                            {targeting === 'selected-sites' &&
                            canSelectSites ? (
                              <TextField
                                select
                                size="small"
                                label="Sites"
                                value={selectedHostIds}
                                onChange={(event) =>
                                  setSelectedHostIds(
                                    typeof event.target.value === 'string'
                                      ? event.target.value.split(',')
                                      : (event.target
                                          .value as unknown as string[]),
                                  )
                                }
                                slotProps={{ select: { multiple: true } }}
                                helperText={
                                  selectedHostIds.length
                                    ? ' '
                                    : 'Pick at least one site.'
                                }
                              >
                                {(hosts ?? []).map((host) => (
                                  <MenuItem key={host.id} value={host.id}>
                                    {host.label}
                                  </MenuItem>
                                ))}
                              </TextField>
                            ) : null}
                          </Stack>
                        ) : installTargets.length > 1 && !installed ? (
                          <TextField
                            select
                            size="small"
                            label="Install to"
                            value={installScope}
                            onChange={(event) =>
                              setInstallScope(event.target.value as 'org' | 'host')
                            }
                            helperText={
                              installScope === 'org'
                                ? 'Available to every site in this organization. A site can still override it for itself.'
                                : 'This site only.'
                            }
                            sx={{ maxWidth: 360 }}
                          >
                            <MenuItem value="org">
                              {'This organization — all sites'}
                            </MenuItem>
                            <MenuItem value="host">{'This site only'}</MenuItem>
                          </TextField>
                        ) : null}
                        <Box>
                          <Button
                            variant={installed ? 'outlined' : 'contained'}
                            color="secondary"
                            disabled={
                              Boolean(upToDate) ||
                              !listing?.profileId ||
                              // Nothing selected to install to (AGL-773).
                              (orgTargeting &&
                                !installed &&
                                !mustBuy &&
                                installPlanSteps.length === 0)
                            }
                            onClick={
                              permissions.installPlugins
                                ? () =>
                                    // Buying goes straight to Stripe checkout,
                                    // which is its own confirmation; a free or
                                    // entitled install confirms its targets
                                    // first (AGL-867).
                                    mustBuy ? buy(listing) : setConfirmOpen(true)
                                : () =>
                                    enqueueSnackbar(
                                      'Your team role does not allow installing from the community',
                                      { variant: 'warning', persist: false },
                                    )
                            }
                          >
                            {upToDate
                              ? `Installed (v${installedVersion})`
                              : artifactInstall
                                ? // Re-adding makes another dataset / another
                                  // draft, so this stays enabled (AGL-789).
                                  `${
                                    artifactType === 'emailTemplate'
                                      ? 'Draft added'
                                      : 'Added'
                                  } (v${installedVersion}) · add again`
                                : installed
                                  ? `Update to v${listing?.latestVersion}`
                                  : mustBuy
                                    ? `Buy for $${priceUsd}`
                                    : orgTargeting || installTargets.length > 1
                                      ? 'Install'
                                      : 'Add to this site'}
                          </Button>
                        </Box>
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 4 },
                  children: (
                    <Stack spacing={3}>
                      <CardDisplay
                        header={'Publisher'}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={0.5}>
                          {/* Link to the publisher's storefront (AGL-869):
                              the org-scope publisher page at org scope, the
                              per-site publisher page otherwise. */}
                          <MuiLink
                            href={
                              !listing?.profileId
                                ? undefined
                                : orgScoped
                                  ? orgSlug
                                    ? buildRoute(
                                        Route.ORG_MARKETPLACE_PUBLISHER,
                                        { orgSlug, profileId: listing.profileId },
                                      )
                                    : undefined
                                  : orgSlug && subdomain
                                    ? buildRoute(
                                        Route.HOST_COMMUNITY_PUBLISHER,
                                        {
                                          orgSlug,
                                          host: subdomain,
                                          profileId: listing.profileId,
                                        },
                                      )
                                    : undefined
                            }
                            color="secondary"
                            underline="hover"
                            variant="body2"
                          >
                            {profile?.displayName ??
                              (profile?.handle ? `@${profile.handle}` : '…')}
                          </MuiLink>
                          {profile?.handle ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {`@${profile.handle}`}
                            </Typography>
                          ) : null}
                          {profile?.bio ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {profile.bio}
                            </Typography>
                          ) : null}
                        </Stack>
                      </CardDisplay>
                      {listing?.homepageUrl || listing?.repositoryUrl ? (
                        <CardDisplay
                          header={'Links'}
                          contentGutterX
                          contentGutterY
                        >
                          <Stack spacing={0.5}>
                            {listing?.homepageUrl ? (
                              <MuiLink
                                href={listing.homepageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                color="secondary"
                                underline="hover"
                                variant="body2"
                              >
                                {'Homepage'}
                              </MuiLink>
                            ) : null}
                            {listing?.repositoryUrl ? (
                              <MuiLink
                                href={listing.repositoryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                color="secondary"
                                underline="hover"
                                variant="body2"
                              >
                                {'Source repository'}
                              </MuiLink>
                            ) : null}
                          </Stack>
                        </CardDisplay>
                      ) : null}
                      {/* ONE version timeline (AGL-869) — the plugin API's
                          rich entries (changelog + trust) when present, the
                          stored versionHistory otherwise. Two differently-
                          shaped cards for the same idea read as unfinished. */}
                      <CardDisplay
                        header={'Version history'}
                        contentGutterX
                        contentGutterY
                      >
                        {isPlugin && versions.length ? (
                          <Stack spacing={1}>
                            {versions.map((entry, index) => (
                              <Stack key={entry.version} spacing={0.25}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: 'center' }}
                                >
                                  <Typography variant="body2">
                                    {`v${entry.version}`}
                                  </Typography>
                                  {index === 0 ? (
                                    <Chip size="small" label="Latest" />
                                  ) : null}
                                  {entry.trust === 'realm' ? (
                                    <Chip
                                      size="small"
                                      color="success"
                                      label="Realm-trusted"
                                    />
                                  ) : null}
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {entry.publishedAtMs
                                      ? new Date(
                                          entry.publishedAtMs,
                                        ).toLocaleDateString()
                                      : ''}
                                  </Typography>
                                </Stack>
                                {entry.changelog ? (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {entry.changelog}
                                  </Typography>
                                ) : null}
                              </Stack>
                            ))}
                          </Stack>
                        ) : versionHistory.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            {`Latest version: v${listing?.latestVersion ?? '…'}`}
                          </Typography>
                        ) : (
                          <Stack spacing={0.5}>
                            {versionHistory.map((entry, index) => (
                              <Stack
                                key={entry.version}
                                direction="row"
                                spacing={1}
                                sx={{ alignItems: 'center' }}
                              >
                                <Typography variant="body2">
                                  {`v${entry.version}`}
                                </Typography>
                                {index === 0 ? (
                                  <Chip size="small" label="Latest" />
                                ) : null}
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {entry.publishedAt?.toDate
                                    ? entry.publishedAt
                                        .toDate()
                                        .toLocaleDateString()
                                    : ''}
                                </Typography>
                              </Stack>
                            ))}
                          </Stack>
                        )}
                      </CardDisplay>
                      <ListingReviews
                        listingId={listingId}
                        listing={listing}
                      />
                    </Stack>
                  ),
                },
              ]}
            />
          )}
          {/* Install confirmation (AGL-867): names the artifact, its version,
              and exactly which sites before any pin is written. */}
          <Dialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            maxWidth="xs"
            fullWidth
          >
            <DialogTitle>
              {installed ? 'Update this listing?' : 'Install this listing?'}
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={1}>
                <Typography variant="body2">
                  {installed ? 'Update ' : 'Install '}
                  <strong>{listing?.displayName}</strong>
                  {listing
                    ? ` (${listingArtifactLabel(listing)}, v${
                        listing?.latestVersion
                      })`
                    : ''}
                  {'.'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {'This will be installed to '}
                  <strong>{installTargetSummary()}</strong>
                  {'.'}
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmOpen(false)}>{'Cancel'}</Button>
              <Button
                variant="contained"
                color="secondary"
                onClick={runInstall}
              >
                {installed ? 'Update' : 'Install'}
              </Button>
            </DialogActions>
          </Dialog>
          {/* Screenshot lightbox (AGL-869). */}
          <Dialog
            open={Boolean(lightboxUrl)}
            onClose={() => setLightboxUrl(null)}
            maxWidth="lg"
          >
            {lightboxUrl ? (
              <Box
                component="img"
                src={lightboxUrl}
                alt={`${listing?.displayName} screenshot`}
                onClick={() => setLightboxUrl(null)}
                sx={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '85vh',
                  cursor: 'zoom-out',
                }}
              />
            ) : null}
          </Dialog>
        </Container>
    </>
  )
}

export default CommunityListingContent
