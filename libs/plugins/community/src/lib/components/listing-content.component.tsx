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
  LISTING_CATEGORIES,
  LISTING_README_MAX_CHARS,
  listingArtifactType,
  installTargetsFor,
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
 * written docs can't inject markup or javascript: URLs.
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

/**
 * Owner-only listing content editor (AGL-430/431): posts the
 * update-listing action so publishers refresh their marketplace docs
 * without republishing code.
 */
function ListingEditCard({
  listing,
  listingId,
}: {
  listing: any
  listingId: string
}) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [values, setValues] = useState({
    readme: '',
    logoUrl: '',
    homepageUrl: '',
    repositoryUrl: '',
    license: '',
    category: '',
    screenshots: '',
  })
  useEffect(() => {
    setValues({
      readme: listing?.readme ?? '',
      logoUrl: listing?.logoUrl ?? '',
      homepageUrl: listing?.homepageUrl ?? '',
      repositoryUrl: listing?.repositoryUrl ?? '',
      license: listing?.license ?? '',
      category: listing?.categories?.[0] ?? '',
      screenshots: (listing?.screenshots ?? []).join('\n'),
    })
  }, [listing?.$id])

  const save = async () => {
    setBusy(true)
    try {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> }
      )?.getIdToken?.()
      const response = await fetch('/api/community/publish-plugin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          action: 'update-listing',
          listingId,
          readme: values.readme,
          logoUrl: values.logoUrl,
          homepageUrl: values.homepageUrl,
          repositoryUrl: values.repositoryUrl,
          license: values.license,
          categories: values.category ? [values.category] : [],
          screenshots: values.screenshots
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok) {
        enqueueSnackbar('Listing updated', { variant: 'success' })
      } else {
        enqueueSnackbar(payload?.error ?? 'Update failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof values) => (event: any) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  return (
    <CardDisplay header={'Edit listing'} contentGutterX contentGutterY>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Shown on this page for every visitor. Markdown supported in ' +
            'the README (headings, lists, links, images).'}
        </Typography>
        <TextField
          label="README (markdown)"
          multiline
          minRows={5}
          value={values.readme}
          onChange={set('readme')}
        />
        <TextField label="Logo URL (https)" value={values.logoUrl} onChange={set('logoUrl')} size="small" />
        <TextField
          label="Screenshot URLs (one per line, https)"
          multiline
          minRows={2}
          value={values.screenshots}
          onChange={set('screenshots')}
          size="small"
        />
        <TextField label="Homepage (https)" value={values.homepageUrl} onChange={set('homepageUrl')} size="small" />
        <TextField label="Repository (https)" value={values.repositoryUrl} onChange={set('repositoryUrl')} size="small" />
        <TextField label="License" value={values.license} onChange={set('license')} size="small" />
        <TextField
          select
          label="Category"
          value={values.category}
          onChange={set('category')}
          size="small"
        >
          <MenuItem value="">{'None'}</MenuItem>
          {LISTING_CATEGORIES.map((entry) => (
            <MenuItem key={entry} value={entry}>
              {entry}
            </MenuItem>
          ))}
        </TextField>
        <Box>
          <Button variant="contained" size="small" disabled={busy} onClick={() => void save()}>
            {'Save listing'}
          </Button>
        </Box>
      </Stack>
    </CardDisplay>
  )
}

export interface CommunityListingContentProps {
  hostId: string
  listingId: string
  /** Org-role permissions resolved by the shell (install gating). */
  permissions: Record<string, boolean | undefined>
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
}: CommunityListingContentProps) {
  // The publisher link was `/{hostDocId}/community/publisher/{id}` — the
  // pre-AGL-621 shape, dead since. The sibling browse grid was fixed for
  // exactly this (AGL-673) and this file was missed; both now build the
  // route from the shared table (AGL-685).
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { install, buy } = useCommunityActions(hostId)
  const [installScope, setInstallScope] = useState<'org' | 'host'>('org')
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
  }, [listing?.type, listingId])
  const latestEntry = versions[0]
  const realmTrusted = versions.some((entry) => entry.trust === 'realm')
  const abiIncompatible =
    latestEntry?.hostAbi != null &&
    latestEntry.hostAbi !== PLUGIN_HOST_ABI_VERSION

  const install_ = useMemo(
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
  const installedVersion = install_?.community?.version
  const upToDate = install_ && installedVersion >= listing?.latestVersion
  const priceUsd = Number(listing?.priceUsd ?? 0)
  const mustBuy =
    priceUsd > 0 && !purchased && listing?.profileId !== viewerOrgId && !install_
  const versionHistory: any[] = Array.isArray(listing?.versionHistory)
    ? [...listing.versionHistory].sort((a, b) => b.version - a.version)
    : []

  return (
    <>
      <NextPageTitle screen={listing?.displayName ?? 'Community listing'} />
        <Container gutterY maxWidth="lg">
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
                          {listing?.type === 'plugin' ? (
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
                          </Typography>
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {listing?.description ?? 'No description provided.'}
                        </Typography>
                        {listing?.type === 'plugin' &&
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
                              <Box
                                key={url}
                                component="img"
                                src={url}
                                alt={`${listing?.displayName} screenshot`}
                                loading="lazy"
                                sx={{
                                  height: 180,
                                  borderRadius: 1,
                                  border: 1,
                                  borderColor: 'divider',
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
                        {/* Install target (AGL-656). Only shown when the
                            artifact actually HAS a choice — offering "this
                            whole organization" for a template would be a
                            lie, since templates only ever land on a site. */}
                        {installTargets.length > 1 ? (
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
                            variant={install_ ? 'outlined' : 'contained'}
                            color="secondary"
                            disabled={Boolean(upToDate) || !listing?.profileId}
                            onClick={
                              permissions.installPlugins
                                ? () =>
                                    mustBuy
                                      ? buy(listing)
                                      : install(
                                          listing,
                                          installTargets.length > 1
                                            ? installScope
                                            : undefined,
                                        )
                                : () =>
                                    enqueueSnackbar(
                                      'Your team role does not allow installing from the community',
                                      { variant: 'warning', persist: false },
                                    )
                            }
                          >
                            {upToDate
                              ? `Installed (v${installedVersion})`
                              : install_
                                ? `Update to v${listing?.latestVersion}`
                                : mustBuy
                                  ? `Buy for $${priceUsd}`
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
                          <MuiLink
                            href={
                              orgSlug && subdomain && listing?.profileId
                                ? buildRoute(Route.HOST_COMMUNITY_PUBLISHER, {
                                    orgSlug,
                                    host: subdomain,
                                    profileId: listing.profileId,
                                  })
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
                      {listing?.type === 'plugin' && versions.length ? (
                        <CardDisplay
                          header={'Versions & changelog'}
                          contentGutterX
                          contentGutterY
                        >
                          <Stack spacing={1}>
                            {versions.map((entry) => (
                              <Stack key={entry.version} spacing={0.25}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: 'center' }}
                                >
                                  <Typography variant="body2">
                                    {`v${entry.version}`}
                                  </Typography>
                                  {entry.trust === 'realm' ? (
                                    <Chip
                                      size="small"
                                      color="success"
                                      label="realm"
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
                        </CardDisplay>
                      ) : null}
                      {/* Org comparison, not uid — see viewerOrgId above
                          (AGL-652). Against `user.uid` this was never true,
                          so the edit card silently never rendered. */}
                      {listing?.profileId &&
                      listing.profileId === viewerOrgId ? (
                        <ListingEditCard
                          listing={listing}
                          listingId={listingId}
                        />
                      ) : null}
                      {listing?.type === 'plugin' && versions.length ? null : (
                      <CardDisplay
                        header={'Version history'}
                        contentGutterX
                        contentGutterY
                      >
                        {versionHistory.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            {`Latest version: v${listing?.latestVersion ?? '…'}`}
                          </Typography>
                        ) : (
                          <Stack spacing={0.5}>
                            {versionHistory.map((entry) => (
                              <Typography key={entry.version} variant="body2">
                                {`v${entry.version}`}
                                <Typography
                                  component="span"
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {entry.publishedAt?.toDate
                                    ? ` · ${entry.publishedAt
                                        .toDate()
                                        .toLocaleDateString()}`
                                    : ''}
                                </Typography>
                              </Typography>
                            ))}
                          </Stack>
                        )}
                      </CardDisplay>
                      )}
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
        </Container>
    </>
  )
}

export default CommunityListingContent
