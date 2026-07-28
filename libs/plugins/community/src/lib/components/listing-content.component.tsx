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
  isPrivateListing,
  resolveInstallPlan,
  resolveOrgInstallSummary,
  resolvePluginInstallState,
  type InstallTargeting,
} from '../model/community'
import {
  buildRoute,
  parseMarkdownLite,
  PLUGIN_HOST_ABI_VERSION,
  resolveUpdateState,
  Route,
  updateStateLabel,
  type MarkdownBlock,
  type MarkdownInline,
} from '@aglyn/aglyn'
import { mdiCheckCircle, mdiStorefrontOutline } from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
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
import PluginSiteSet from './plugin-site-set.component'
import { MenuItem, TextField } from '@mui/material'
import { useCommunityActions } from '../hooks/use-community-actions'
import { useArtifactUpdate } from '../hooks/use-artifact-update'
import ArtifactUpdateDialog from './artifact-update-dialog.component'

interface ListingVersionEntry {
  version: string
  changelog?: string
  trust?: string
  hostAbi?: number
  publishedAtMs: number | null
  /** Installs that ever landed on this version (AGL-1036). */
  installCount?: number
  /** Installs on it right now — the "who is still on v1" number. */
  activeInstalls?: number
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
  // Updating a COPIED artifact is never a plain re-install (AGL-1018): the
  // copy has been edited in the workspace, so the update is previewed field by
  // field before anything is written.
  const {
    preview: updatePreview,
    loading: updateLoading,
    loadPreview,
    applyUpdate,
    setPreview: setUpdatePreview,
  } = useArtifactUpdate(hostId)
  const [updateOpen, setUpdateOpen] = useState(false)
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
  // Every site's pin, not just the acting one (AGL-997). At org scope the
  // question is "which of my sites is this on", and the two subscriptions
  // above can only answer for one arbitrary site. Read as a fan-in rather
  // than a subscription per host: the host count is a prop, so a per-host
  // hook would change the hook count between renders, and a collection-group
  // query would need an index plus a rules audit to read other orgs' pins
  // it must never see. `pinsNonce` re-reads after this page's own writes,
  // which are the only thing that changes these docs while it is open.
  const [sitePins, setSitePins] = useState<Record<string, any>>({})
  const [pinsNonce, setPinsNonce] = useState(0)
  const hostIdsKey = (hosts ?? []).map((host) => host.id).join('|')
  useEffect(() => {
    if (!orgScoped || !listingId || !hosts?.length) return
    let active = true
    void Promise.all(
      hosts.map(async (host) => {
        const snapshot = await getDoc(
          doc(firestore, 'hosts', host.id, 'installs', listingId),
        )
        return [host.id, snapshot.exists() ? snapshot.data() : null] as const
      }),
    )
      .then((entries) => {
        if (active) setSitePins(Object.fromEntries(entries))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, listingId, hostIdsKey, orgScoped, pinsNonce])
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

  /**
   * The version this listing actually offers (AGL-1016).
   *
   * For a plugin that is the newest APPROVED version, not `latestVersion`.
   * This page used to compare against `latestVersion`, so publishing v1.1.0
   * lit up "Update to v1.1.0" for every workspace the moment it was uploaded —
   * and the install route then refused it, because AGL-966 only ever hands out
   * reviewed bytes. The badge was advertising what the marketplace would not
   * give you.
   */
  const offeredVersion = isPlugin
    ? listing?.latestApprovedVersion
    : listing?.latestVersion

  const pluginState = useMemo(
    () =>
      resolvePluginInstallState(
        offeredVersion,
        isPlugin ? hostPin : null,
        isPlugin ? orgPin : null,
      ),
    [offeredVersion, isPlugin, hostPin, orgPin],
  )

  // Public version history + trust tier (AGL-431): the pluginVersions
  // docs are server-only, so the community API exposes the buyer-safe
  // subset (version/changelog/trust/hostAbi/date).
  const [versions, setVersions] = useState<ListingVersionEntry[]>([])
  useEffect(() => {
    // Every artifact type now, not just plugins (AGL-1036): the route serves
    // the per-version install counts for all of them, and a component's
    // publisher wants "who is still on v1" as much as a plugin's does.
    if (!listing || !listingId) return
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
  // Somewhere to go from the zero state (AGL-998). Same surface split as
  // every other link here: org route at org scope, host route otherwise,
  // and undefined rather than a link to nowhere when the slug is unresolved.
  const marketplaceHref = orgScoped
    ? orgSlug
      ? buildRoute(Route.ORG_MARKETPLACE, { orgSlug })
      : undefined
    : orgSlug && subdomain
      ? buildRoute(Route.HOST_COMMUNITY, { orgSlug, host: subdomain })
      : undefined
  const installed = isPlugin
    ? pluginState.scope != null
    : Boolean(componentInstall ?? artifactInstall)
  const installedVersion = isPlugin
    ? pluginState.installedVersion
    : (componentInstall?.community?.version ?? artifactInstall?.version)
  const upToDate = isPlugin
    ? installed && !pluginState.updateAvailable
    : componentInstall && installedVersion >= listing?.latestVersion
  /**
   * The same update comparison the Plugins index and the installation page
   * make (AGL-1016), so all three agree on the version pair rather than each
   * re-deriving it. Only rendered when the viewer already has it installed —
   * "you have v1.0.0 · v1.1.0 available" is meaningless to a first-time buyer.
   */
  const updateStatus = useMemo(
    () =>
      resolveUpdateState(
        isPlugin
          ? ((hostPin ?? orgPin) as never)
          : // Copied artifacts are found through four different install
            // collections here, each with its own field for the version, so
            // they are normalised to the one shape provenance reads. The
            // `installedFrom` stamp wins when AGL-1015 wrote one.
            ({
              ...(componentInstall?.installedFrom
                ? { installedFrom: componentInstall.installedFrom }
                : {}),
              ...(installedVersion != null && listingId
                ? { listingId, version: installedVersion }
                : {}),
            } as never),
        listing ?? null,
        artifactType,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isPlugin,
      hostPin,
      orgPin,
      componentInstall,
      installedVersion,
      listingId,
      listing,
      artifactType,
    ],
  )
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

  // The org-wide picture (AGL-997): which sites run this, at which version,
  // and which are still free to add. Only meaningful at org scope for a
  // plugin — everything else installs INTO a site and has no pin to survey.
  const orgPluginScope = Boolean(orgTargeting && isPlugin)
  const orgInstall = useMemo(
    () => resolveOrgInstallSummary(hosts ?? [], sitePins, orgPin ?? null),
    [hosts, sitePins, orgPin],
  )
  /** Run a pin write, then re-read every site's pin. */
  const runSiteEdit = async (work: () => Promise<unknown>) => {
    try {
      await work()
    } finally {
      setPinsNonce((current) => current + 1)
    }
  }

  /**
   * A copied artifact with a newer version on offer (AGL-1018).
   *
   * The distinction that matters: a plugin takes an update by moving a pointer,
   * but a component, layout or dataset schema was copied in and then EDITED
   * here, so "Update" is a merge. It goes through the review dialog, never
   * straight to the install route.
   */
  const copiedUpdatable =
    !isPlugin && installed && updateStatus.state === 'update-available'
  const openUpdateReview = () => {
    setUpdatePreview(null)
    setUpdateOpen(true)
    if (listingId) void loadPreview(listingId)
  }
  /**
   * "Install as a new copy", which means different things per type.
   *
   * Only a component or layout has a link that can be DETACHED, leaving the
   * customised copy in place as an ordinary artifact — the update route does
   * that. For the others a fresh copy is exactly what the ordinary install
   * already produces (another empty dataset, another inactive draft, a replaced
   * template bundle), quota checks included, so it goes there rather than
   * through a second implementation that would drift from it.
   */
  const runCopy = async () => {
    if (artifactType === 'component' || artifactType === 'layout') {
      return void (await runUpdate('copy'))
    }
    setUpdateOpen(false)
    await runSiteEdit(() => install(listing, installTargetScope))
  }
  const runUpdate = async (
    mode: 'merge' | 'copy',
    takePaths: string[] = [],
    confirmDestructive = false,
  ) => {
    if (!listingId) return
    const done = await applyUpdate(listingId, {
      mode,
      takePaths,
      confirmDestructive,
    })
    // Left open on failure — a destructive schema update comes back asking for
    // the confirmation tick, and closing would hide the question.
    if (done) setUpdateOpen(false)
  }

  // The actual pin write, run only after the confirm dialog (AGL-867).
  const runInstall = () => {
    setConfirmOpen(false)
    // Re-read every site's pin afterwards (AGL-997). The acting host's pin is
    // a live subscription, but the other sites' are a fan-in read — without
    // this the page went straight from "Install" to a bare disabled
    // "Installed" button, because the panel that explains WHERE it landed
    // had not seen the write yet.
    void runSiteEdit(() =>
      orgTargeting && !installed
        ? installPlan(listing, installPlanSteps)
        : install(listing, installTargetScope),
    )
  }

  return (
    <>
      <NextPageTitle screen={listing?.displayName ?? 'Community listing'} />
        <Container gutterY maxWidth="xl">
          {/* A designed zero-state, not a loose sentence (AGL-998). This is
              reached by ordinary means — a bookmark to something since
              unpublished, a link from another environment — and the bare
              line it used to print read as a half-rendered page with no way
              out. `missing` is already gated on `status === 'success'`, so
              this never stands in for loading. */}
          {missing ? (
            <CardDisplay contentGutterX contentGutterY>
              <Stack
                spacing={1.5}
                sx={{ alignItems: 'center', textAlign: 'center', py: 6 }}
              >
                <MdiIcon
                  path={mdiStorefrontOutline.path}
                  color="disabled"
                  sx={{ fontSize: 48 }}
                />
                <Typography variant="h6">{'This listing isn’t here'}</Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ maxWidth: 440 }}
                >
                  {'It may have been unpublished by its publisher, taken ' +
                    'down, or the link may point somewhere that no longer ' +
                    'exists. Anything you already installed from it keeps ' +
                    'working.'}
                </Typography>
                {marketplaceHref ? (
                  <AppLink href={marketplaceHref}>
                    <Button
                      variant="contained"
                      color="secondary"
                      component="span"
                    >
                      {'Back to the marketplace'}
                    </Button>
                  </AppLink>
                ) : null}
              </Stack>
            </CardDisplay>
          ) : (
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 8 },
                  // No card header (AGL-1000): the page's hero now carries the
                  // listing's name, and the only route that renders this
                  // widget is the org listing page — the per-site one
                  // redirects to it (AGL-775) — so a heading here would just
                  // print the same words twice, inches apart.
                  children: (
                    <CardDisplay contentGutterX contentGutterY>
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
                          {/* Private listings never reach browse (AGL-993),
                              so this page is the only place their state is
                              ever shown — say it beside Verified rather than
                              letting an approved private plugin read exactly
                              like a marketplace one. */}
                          {isPrivateListing(listing ?? {}) ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label="Private"
                            />
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
                        {isPrivateListing(listing ?? {}) ? (
                          <Alert severity="info">
                            {'Private plugin: it is never listed in the ' +
                              'marketplace, and only your organization’s ' +
                              'sites can install it. It passes the same ' +
                              'review as every other plugin.'}
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
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 4 },
                  children: (
                    <Stack spacing={3}>
                      {/* Install is the point of the page (AGL-1005). It used
                          to be the LAST thing in the left column, under the
                          README, the config table and the code sample — below
                          the fold on any listing with real documentation.
                          Here it leads the sidebar. */}
                      <CardDisplay
                        header={'Install'}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={1.5}>
                          {/* Price and version lead: the two facts someone
                              decides on before they read anything else. */}
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'baseline' }}
                          >
                            <Typography variant="h6">
                              {priceUsd > 0 ? `$${priceUsd}` : 'Free'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {`v${listing?.latestVersion ?? '…'}`}
                            </Typography>
                          </Stack>
                        {/* Where it actually runs (AGL-997). At org scope an
                            install is a SET of sites; this page used to
                            resolve the single acting host and announce
                            "Installed on this site", naming one arbitrary
                            site and saying nothing about the others — and
                            offering an Uninstall that was all-or-nothing. */}
                        {/* The site set (AGL-997), shared with the
                            installation detail page (AGL-1007) so the two
                            surfaces cannot drift apart. */}
                        {/* The version pair, for a viewer who already has this
                            (AGL-1016). Without it the listing could advertise
                            v2 while the workspace quietly ran v1 and no page
                            said so — this is the same `resolveUpdateState` the
                            Plugins index and installation page ask. */}
                        {installed &&
                        updateStatus.state !== 'current' &&
                        updateStatus.installedVersion ? (
                          <Alert
                            severity={
                              updateStatus.state === 'update-available'
                                ? 'info'
                                : 'warning'
                            }
                            variant="outlined"
                          >
                            {updateStateLabel(updateStatus)}
                          </Alert>
                        ) : null}
                        {orgPluginScope ? (
                          <PluginSiteSet
                            listing={listing}
                            hosts={hosts ?? []}
                            orgInstall={orgInstall}
                            latestVersion={offeredVersion}
                            installPlan={installPlan}
                            uninstall={uninstall}
                            onChanged={() =>
                              setPinsNonce((current) => current + 1)
                            }
                          />
                        ) : null}
                        {/* Existing state, told honestly (AGL-656): an org
                            pin applies everywhere, and this site's own pin
                            shadows it. Showing this is the difference between
                            "Add to this site" lying and the truth. The
                            org-scope panel above supersedes this for plugins
                            (AGL-997); this remains for the per-site tab. */}
                        {!orgPluginScope && isPlugin && installed ? (
                          <Stack spacing={1}>
                            {/* A confirmation, not a warning (AGL-1005): a
                                tick and a sentence, where this used to be a
                                pale alert with a red text link under it —
                                which read as something having gone wrong. */}
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'flex-start' }}
                            >
                              <MdiIcon
                                path={mdiCheckCircle.path}
                                color="success"
                                sx={{ fontSize: 20, mt: '2px' }}
                              />
                              <Typography variant="body2">
                                {pluginState.shadowed
                                  ? `Installed on this site (v${installedVersion}), ` +
                                    'overriding the organization-wide install.'
                                  : pluginState.scope === 'org'
                                    ? `Installed for the whole organization ` +
                                      `(v${installedVersion}) — available on every site.`
                                    : `Installed on this site (v${installedVersion}).`}
                                {pluginState.updateAvailable
                                  ? ` A newer version (v${offeredVersion}) is available.`
                                  : ''}
                              </Typography>
                            </Stack>
                          </Stack>
                        ) : null}
                        {/* Install targeting (AGL-773): at org scope, choose
                            All sites vs a chosen subset. Only when NOT already
                            installed — re-asking once it's settled would lie.
                            The per-site tab keeps the simpler org/host choice
                            (AGL-656) below until it's retired. */}
                        {orgTargeting &&
                        !installed &&
                        !(orgPluginScope && orgInstall.installedAnywhere) ? (
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
                            {/* A visible checkbox list, not a multi-select
                                (AGL-996). The MUI `select multiple` this
                                replaced rendered its options as bare rows
                                with no tick and no renderValue, so the
                                control that decides WHERE third-party code
                                gets installed could not be read at all:
                                picked and unpicked sites looked identical,
                                and the closed field showed raw host ids. */}
                            {targeting === 'selected-sites' &&
                            canSelectSites ? (
                              <FormControl
                                component="fieldset"
                                error={!selectedHostIds.length}
                              >
                                <FormLabel
                                  component="legend"
                                  sx={{ typography: 'caption' }}
                                >
                                  {'Sites'}
                                </FormLabel>
                                <FormGroup
                                  // Scrolls rather than pushing Install off
                                  // the page on an org with many sites.
                                  sx={{ maxHeight: 240, overflowY: 'auto' }}
                                >
                                  {(hosts ?? []).map((host) => (
                                    <FormControlLabel
                                      key={host.id}
                                      control={
                                        <Checkbox
                                          size="small"
                                          checked={selectedHostIds.includes(
                                            host.id,
                                          )}
                                          onChange={(event) =>
                                            setSelectedHostIds((current) =>
                                              event.target.checked
                                                ? [...current, host.id]
                                                : current.filter(
                                                    (id) => id !== host.id,
                                                  ),
                                            )
                                          }
                                        />
                                      }
                                      label={host.label}
                                      slotProps={{
                                        typography: { variant: 'body2' },
                                      }}
                                    />
                                  ))}
                                </FormGroup>
                                <FormHelperText>
                                  {selectedHostIds.length
                                    ? `${selectedHostIds.length} of ${
                                        (hosts ?? []).length
                                      } selected.`
                                    : 'Pick at least one site.'}
                                </FormHelperText>
                              </FormControl>
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
                        {/* The org-scope panel owns install once anything is
                            pinned (AGL-997) — it offers add, remove, update
                            and promote, all of which this single button
                            would only duplicate ambiguously. */}
                        <Box
                          sx={{
                            display:
                              orgPluginScope && orgInstall.installedAnywhere
                                ? 'none'
                                : undefined,
                          }}
                        >
                          <Button
                            // Full-width and contained (AGL-1005): in a
                            // sidebar card this is the page's primary action,
                            // and "already installed and current" is the only
                            // state where it steps back to an outline.
                            fullWidth
                            variant={upToDate ? 'outlined' : 'contained'}
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
                                    // first (AGL-867). Updating a copied
                                    // artifact reviews the diff before writing
                                    // anything (AGL-1018).
                                    mustBuy
                                      ? buy(listing)
                                      : copiedUpdatable
                                        ? openUpdateReview()
                                        : setConfirmOpen(true)
                                : () =>
                                    enqueueSnackbar(
                                      'Your team role does not allow installing from the community',
                                      { variant: 'warning', persist: false },
                                    )
                            }
                          >
                            {upToDate
                              ? `Installed (v${installedVersion})`
                              : copiedUpdatable
                                ? // Not "Update": pressing this shows what the
                                  // update would do and writes nothing.
                                  `Review update to v${offeredVersion}`
                                : artifactInstall
                                ? // Re-adding makes another dataset / another
                                  // draft, so this stays enabled (AGL-789).
                                  `${
                                    artifactType === 'emailTemplate'
                                      ? 'Draft added'
                                      : 'Added'
                                  } (v${installedVersion}) · add again`
                                : installed
                                  ? `Update to v${offeredVersion}`
                                  : mustBuy
                                    ? `Buy for $${priceUsd}`
                                    : orgTargeting || installTargets.length > 1
                                      ? 'Install'
                                      : 'Add to this site'}
                          </Button>
                        </Box>
                        {/* Uninstall from the listing too (AGL-881), not only
                            the installed add-ons card; targets the effective
                            pin's scope. Demoted to a quiet full-width
                            secondary below the primary (AGL-1005) — it used
                            to be red text directly under the "installed"
                            notice, which made a successful install look like
                            a problem to undo. */}
                        {!orgPluginScope && isPlugin && installed ? (
                          <Button
                            fullWidth
                            size="small"
                            color="inherit"
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
                        ) : null}
                        </Stack>
                      </CardDisplay>
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
                                        {
                                          orgSlug,
                                          // Handle, not id (AGL-1001); the id
                                          // still resolves for the beat
                                          // before the profile loads.
                                          handle:
                                            profile?.handle ??
                                            listing.profileId,
                                        },
                                      )
                                    : undefined
                                  : orgSlug && subdomain
                                    ? buildRoute(
                                        Route.HOST_COMMUNITY_PUBLISHER,
                                        {
                                          orgSlug,
                                          host: subdomain,
                                          handle:
                                            profile?.handle ??
                                            listing.profileId,
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
                        {versions.length ? (
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
                                {/* Per-version installs (AGL-1036). The
                                    listing total cannot answer "who is still
                                    on the old version" — this can, and that is
                                    the question a publisher asks before
                                    changing anything. Hidden at zero rather
                                    than printed as "0 installs", which reads
                                    as a failure on a version nobody has
                                    reached yet. */}
                                {entry.installCount ||
                                entry.activeInstalls ? (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {`${entry.installCount ?? 0} install${
                                      entry.installCount === 1 ? '' : 's'
                                    } · ${entry.activeInstalls ?? 0} on this version`}
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
          {/* Updating a copy, previewed field by field (AGL-1018). Install
              writes the publisher's version over yours; this shows what would
              be lost first, and keeps your edits by default. */}
          <ArtifactUpdateDialog
            open={updateOpen}
            onClose={() => setUpdateOpen(false)}
            artifactName={listing?.displayName ?? 'this listing'}
            preview={updatePreview}
            loading={updateLoading}
            onApplyMerge={(takePaths, confirmDestructive) =>
              void runUpdate('merge', takePaths, confirmDestructive)
            }
            onApplyCopy={() => void runCopy()}
          />
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
