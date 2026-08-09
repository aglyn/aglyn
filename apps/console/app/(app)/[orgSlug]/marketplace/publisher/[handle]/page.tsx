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
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { CardDisplay, Container, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Alert, Avatar, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { collection, doc, limit, query, where } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../../components/plugin-widget-slot.component'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgHosts } from '../../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

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
const safeHref = (url: unknown): string | undefined =>
  typeof url === 'string' && /^https:\/\//i.test(url) && url.length <= 500
    ? url
    : undefined

const OrgMarketplacePublisher: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { permissions } = useOrgPermissions()
  const params = useParams<{ handle: string }>()
  const segment = String(params.handle ?? '')

  // The URL carries the publisher's HANDLE (AGL-1001) — the identity they
  // chose and the one shown on every browse card — not the opaque org
  // document id it used to. Both resolve: the handle query runs first, and
  // an id read backs it up so links already in the wild keep working. A
  // handle is `^[a-z0-9][a-z0-9-]{2,29}$`, which an id can also match, so
  // neither lookup can be skipped on the shape of the segment alone.
  const { data: byHandle } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'publisherProfiles'),
        where('handle', '==', segment || '-missing-'),
        limit(1),
      ),
    [firestore, segment],
    { idField: '$id' },
  )
  const { data: byId } = useFirestoreDoc<any>(
    () => doc(firestore, 'publisherProfiles', segment || '-missing-'),
    [firestore, segment],
    { idField: '$id' },
  )
  const profile = (byHandle ?? [])[0] ?? byId
  const profileId = String(profile?.$id ?? '')

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (currentOrg?.$id ?? null),
  )
  const actingHost = useMemo(
    () =>
      ((hosts as Array<{ $id: string }>) ?? [])[0]?.$id ?? '',
    [hosts],
  )

  const title = profile?.displayName ?? (profile?.handle ? `@${profile.handle}` : 'Publisher')

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Marketplace',
          href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
        },
        {
          // The handle, not the word "Publisher" (AGL-1000/1001) — a
          // breadcrumb that repeats the page type tells you nothing the hero
          // above it didn't already say.
          children: profile?.handle ? `@${profile.handle}` : 'Publisher',
          href: buildRoute(Route.ORG_MARKETPLACE_PUBLISHER, {
            orgSlug,
            handle: String(profile?.handle ?? segment),
          }),
        },
      ]}
      header={{
        children: title,
        icon: { path: mdiStorefrontOutline.path },
      }}
      help="plugins"
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <Stack spacing={2}>
          <CardDisplay header={title} contentGutterX contentGutterY>
            <Stack direction="row" spacing={2}>
              {/* Logo (AGL-1009) — only an https URL is ever emitted; a
                  profile without one falls back to the initial. */}
              <Avatar
                src={safeHref(profile?.avatarUrl)}
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
          {actingHost ? (
            <PluginWidgetSlot
              slot="orgMarketplace"
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
      </Container>
    </DashboardLayout>
  )
}
OrgMarketplacePublisher.displayName = 'Page:OrgMarketplacePublisher'

export default OrgMarketplacePublisher
