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
  mdiEmailOutline,
  mdiGithub,
  mdiLifebuoy,
  mdiLinkedin,
  mdiStorefrontOutline,
  mdiTwitter,
  mdiWeb,
} from '@aglyn/shared-data-mdi'
import { pluginDocsHelp, PageHeaderHelp, PageHeaderRecord } from '@aglyn/aglyn'
import {
  isFirstPartyMediaSrc,
  MEDIA_REF_PREFIX,
} from '@aglyn/aglyn/app-utils/media-ref'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Alert, Avatar, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { collection, doc, limit, query, where } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
} from '@aglyn/tenant-feature-instance'
import MarketplaceBrowse from './marketplace-browse.component'
import { publisherPath } from '../model/marketplace-paths'

/**
 * Org-scope publisher storefront (AGL-869): every marketplace listing from one
 * publisher, reached from a listing's Publisher card or a browse card's
 * "by @handle" link. The body is the marketplace plugin's browse widget filtered
 * to this publisher — the app stays plugin-free and reuses one grid.
 */
// Render-time https guard (AGL-1009), mirroring the marketplace model's
// `safePublisherHref` — the console can't import across the aglyn:addons
// boundary. The save route only ever stores https URLs, but this renderer
// must not trust stored data it did not write: a `javascript:` URL that
// somehow reached the doc renders as nothing, not as a link.
/**
 * `publisherHandles/{handle}` — the marketplace's handle reservations, and
 * since AGL-2312 the rename tombstones this page follows.
 *
 * Spelled out rather than imported for the same reason `safeHref` is: the
 * console cannot cross the `aglyn:addons` boundary. The collection is a
 * public read (`allow read: if true`), so a client lookup is legitimate here.
 */
const PUBLISHER_HANDLES = 'publisherHandles'

const safeHref = (url: unknown): string | undefined =>
  typeof url === 'string' && /^https:\/\//i.test(url) && url.length <= 500
    ? url
    : undefined

/**
 * The LOGO's guard (AGL-3260), which is not the link guard above.
 *
 * `avatarUrl` holds what the media picker returned — since AGL-1215 the
 * media-id-keyed CDN path, which is root-relative and so failed `safeHref`
 * on every profile that had a logo at all. The predicates are imported here
 * rather than restated: `media-ref` is a leaf module with no dependencies,
 * which is what kept `safeHref` hand-written and is no obstacle to these.
 */
const safeImageSrc = (src: unknown): string | undefined =>
  isFirstPartyMediaSrc(src) &&
  src.length <= 500 &&
  !src.startsWith(MEDIA_REF_PREFIX)
    ? src
    : undefined

export function PublisherProfilePage(props: {
  /** The handle (or legacy org id) in the URL, from the shell's segments. */
  segment: string
  basePath: string
  /** The site an install acts through — the org's first, as it always was. */
  actingHost: string
  permissions?: Record<string, boolean | undefined>
  orgSlug: string
}) {
  const { segment, basePath, actingHost, permissions, orgSlug } = props
  const firestore = useFirestore()

  // The URL carries the publisher's HANDLE (AGL-1001) — the identity they
  // chose and the one shown on every browse card — not the opaque org
  // document id it used to. Both resolve: the handle query runs first, and
  // an id read backs it up so links already in the wild keep working. A
  // handle is `^[a-z0-9][a-z0-9-]{2,29}$`, which an id can also match, so
  // neither lookup can be skipped on the shape of the segment alone.
  const { data: byHandle, status: byHandleStatus } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'publisherProfiles'),
        where('handle', '==', segment || '-missing-'),
        limit(1),
      ),
    [firestore, segment],
    { idField: '$id' },
  )
  const { data: byId, status: byIdStatus } = useFirestoreDoc<any>(
    () => doc(firestore, 'publisherProfiles', segment || '-missing-'),
    [firestore, segment],
    { idField: '$id' },
  )
  const profile = (byHandle ?? [])[0] ?? byId
  const profileId = String(profile?.$id ?? '')

  /**
   * A RENAMED HANDLE STILL RESOLVES (AGL-2312).
   *
   * `claimPublisherHandle` leaves `{ orgId, movedTo, renamedAt }` on the old
   * handle when a publisher renames, and says why: *"so old marketplace links
   * can still resolve"*. Nothing read it. A publisher who renamed silently
   * broke every existing link to their storefront — SEO and referral traffic
   * to PAID listings — and the page rendered the bare title `'Publisher'`.
   *
   * The org-slug tombstone written identically in `organizations.ts` IS read:
   * `/api/orgs/slug-verdict` feeds `middleware.ts`, which issues the redirect.
   * That asymmetry is what makes this an omission rather than a decision, and
   * this is the same move one layer in — client-side because the handle lives
   * in a path segment the middleware does not resolve, and because
   * `publisherHandles` is a public read.
   *
   * `redirect` rather than `push`: the old URL is not a place to come back to.
   */
  const router = useRouter()
  const { data: handleTombstone, status: tombstoneStatus } =
    useFirestoreDoc<any>(
      () => doc(firestore, PUBLISHER_HANDLES, segment || '-missing-'),
      [firestore, segment],
    )
  /**
   * Only once BOTH profile lookups have settled to nothing.
   *
   * A tombstone that arrives before the profile does must not bounce a handle
   * that resolves: re-claiming a handle replaces the reservation wholesale and
   * clears `movedTo`, so the two states cannot coexist for long — but they can
   * for one render, and a redirect fired on a half-loaded page is a redirect
   * nobody can reproduce.
   */
  const movedTo =
    !profile &&
    byHandleStatus === 'success' &&
    byIdStatus !== 'loading' &&
    tombstoneStatus === 'success'
      ? String(handleTombstone?.['movedTo'] ?? '')
      : ''
  useEffect(() => {
    if (!movedTo || movedTo === segment) return
    router.replace(publisherPath(basePath, movedTo))
  }, [movedTo, segment, basePath, router])

  const title = profile?.displayName ?? (profile?.handle ? `@${profile.handle}` : 'Publisher')

  return (
    <>
      {/*
        The publisher's own name in the heading and the trail (AGL-1000/1001)
        — the surface's declaration says "Marketplace", which reads identically
        on every publisher's page, and a trail that repeats the page type tells
        you nothing the hero above it did not already say.
      */}
      <PageHeaderRecord title={title} />
      <PageHeaderHelp topic="publishAPlugin" anchor="#your-publisher-profile" />
        <Stack spacing={2}>
          <CardDisplay header={title}
            help={pluginDocsHelp('publisherHandbook', {
              excerpt:
                'The public face of a publisher — the profile customers read before ' +
                'deciding to trust a listing.',
            })} contentGutterX contentGutterY>
            <Stack direction="row" spacing={2}>
              {/* Logo (AGL-1009) — only a first-party image is ever emitted
                  (AGL-3260); a profile without one falls back to the
                  initial. */}
              <Avatar
                src={safeImageSrc(profile?.avatarUrl)}
                alt={title}
                variant="rounded"
                sx={{ width: 64, height: 64 }}
              >
                {String(title).slice(0, 1).toUpperCase()}
              </Avatar>
              <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                {profile?.handle ? (
                  <Typography variant="body2" color="text.secondary">
                    {`@${profile.handle}`}
                  </Typography>
                ) : null}
                {profile?.bio ? (
                  <Typography variant="body2">{profile.bio}</Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {'Everything this publisher has shared to the marketplace.'}
                  </Typography>
                )}
                {/* Contact and external links (AGL-1009): a fixed icon row,
                    each guarded https-only at render as well as at write. */}
                {(() => {
                  const links = [
                    {
                      key: 'website',
                      label: 'Website',
                      icon: mdiWeb.path,
                      href: safeHref(profile?.website),
                    },
                    {
                      key: 'support',
                      label: 'Support',
                      icon: mdiLifebuoy.path,
                      href: safeHref(profile?.supportUrl),
                    },
                    {
                      key: 'github',
                      label: 'GitHub',
                      icon: mdiGithub.path,
                      href: safeHref(profile?.githubUrl),
                    },
                    {
                      key: 'x',
                      label: 'X',
                      icon: mdiTwitter.path,
                      href: safeHref(profile?.xUrl),
                    },
                    {
                      key: 'linkedin',
                      label: 'LinkedIn',
                      icon: mdiLinkedin.path,
                      href: safeHref(profile?.linkedinUrl),
                    },
                  ].filter((link) => link.href)
                  const email =
                    typeof profile?.supportEmail === 'string' &&
                    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.supportEmail)
                      ? profile.supportEmail
                      : undefined
                  if (!links.length && !email) return null
                  return (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {email ? (
                        <Tooltip title={`Support: ${email}`}>
                          <IconButton
                            size="small"
                            component="a"
                            href={`mailto:${email}`}
                            aria-label={`Email support at ${email}`}
                          >
                            <MdiIcon
                              path={mdiEmailOutline.path}
                              fontSize="small"
                            />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {links.map((link) => (
                        <Tooltip key={link.key} title={link.label}>
                          <IconButton
                            size="small"
                            component="a"
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={link.label}
                          >
                            <MdiIcon path={link.icon} fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ))}
                    </Stack>
                  )
                })()}
              </Stack>
            </Stack>
          </CardDisplay>
          {/* The same grid browse uses, filtered to this publisher —
              rendered directly rather than through the `orgMarketplace` zone.
              That zone exists so a console page can show the marketplace
              without importing this plugin; here the plugin is already the
              thing rendering. */}
          {actingHost ? (
            <MarketplaceBrowse
              hostId={actingHost}
              permissions={permissions}
              orgScoped
              orgSlug={orgSlug}
              publisherId={profileId}
            />
          ) : (
            <Alert severity="info">
              {'Add a site to your organization to browse and install ' +
                'marketplace items.'}
            </Alert>
          )}
        </Stack>
    </>
  )
}
PublisherProfilePage.displayName = 'PublisherProfilePage'

export default PublisherProfilePage
