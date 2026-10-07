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

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { RowActionsMenu } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Link as MuiLink,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import StaffOnly from '../../../../../components/staff-only.component'
import { SuperStaffOnly } from '../../../../../components/staff-super-only.component'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import useFirestoreDoc from '../../../../../hooks/use-firestore-doc'
import HostActivityTable from '../../../../../components/host-activity-table.component'
import { StaffDomainCard } from '../../../../../components/staff-domain-card.component'
import PluginWidgetSlot, {
  useSlotWidgets,
} from '../../../../../components/plugin-widget-slot.component'
import StaffEmailDeliveriesCard from '../../../../../components/staff-email-deliveries-card.component'
import StaffOrgOwnershipTransfer from '../../../../../components/staff-org-ownership-transfer.component'
import StaffOrgOwnerHandoff from '../../../../../components/org-owner-handoff.component'
import StaffOrgUpgradeProposal from '../../../../../components/staff-org-upgrade-proposal.component'
import StaffSiteTransfer from '../../../../../components/staff-site-transfer.component'
import StaffSiteContentCard from '../../../../../components/staff-site-content-card.component'
import {
  type StaffSiteRow,
  staffSiteLiveUrl,
} from '../../../../../components/staff-site-row-actions.component'
import { homeScreenId, staffSitePreviewHref } from '../../../../../utils/staff-site-links'
import { staffLeavingNoticeLabel } from '../../../../../utils/staff-leaving-notice'

/**
 * The published-site apex, from the ONE shared source (AGL-2195).
 *
 * Was a bare `'aglyn.app'` literal, so this staff page printed — and linked —
 * Aglyn's apex on a self-hosted install for sites Aglyn does not serve, while
 * `NEXT_PUBLIC_TENANT_DOMAIN` was already honoured by the console's own
 * `tenant-links.ts` and by `/api/screens/revalidate`. Aliased rather than
 * renamed at the call sites below so the diff stays about the value.
 */
const TENANT_ROOT = TENANT_APEX

/**
 * Staff host detail (AGL-392): a per-site view under an org — live link,
 * names, subdomain + custom domains, and usage (pages, media, storage,
 * members). Staff can retarget the subdomain (audited server-side).
 */
const AdminHostDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ hostId?: string }>()
  const hostId = params?.hostId ?? ''
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()

  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId || 'missing'),
    [firestore, hostId],
    { idField: '$id' },
  )
  // The site names its organization; the URL no longer does (AGL-3378).
  const orgId = String(host?.orgId ?? '')

  /*
   * The organization and its owner, as the Sites list reads them: one row of
   * `/api/admin/sites` narrowed to this site's id. The owner's address comes
   * from the auth pools, which only a server route can read.
   */
  const [site, setSite] = useState<StaffSiteRow | null>(null)
  const [siteNonce, setSiteNonce] = useState(0)
  useEffect(() => {
    if (!hostId || !user) return undefined
    let active = true
    const filters = JSON.stringify([{ field: '$id', op: 'equals', value: hostId }])
    void authorizedFetch(user, `/api/admin/sites?filters=${encodeURIComponent(filters)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active) setSite((payload?.sites?.[0] as StaffSiteRow | undefined) ?? null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // `user` identity churns with token refreshes; the uid names the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, (user as { uid?: string } | null)?.uid, siteNonce])
  const homeId = useMemo(() => homeScreenId(host?.screens), [host?.screens])
  // The workspace's leaving-notice window, as the server read it (AGL-3452).
  const leavingNoticeUntil = site?.org?.leavingNoticeUntil ?? null
  const { widgets: staffSiteWidgets } = useSlotWidgets(['staffSite'])

  // Usage counts (AGL-392): screens = pages, media file count, members.
  const [counts, setCounts] = useState<{
    screens: number | null
    media: number | null
    members: number | null
  }>({ screens: null, media: null, members: null })
  useEffect(() => {
    if (!hostId) return
    let active = true
    const load = async (path: string[]) =>
      getCountFromServer(
        collection(firestore, path[0], ...path.slice(1)),
      )
        .then((snap) => snap.data().count)
        .catch(() => null)
    void Promise.all([
      load(['hosts', hostId, 'screens']),
      orgId
        ? load(['orgs', orgId, 'media'])
        : load(['hosts', hostId, 'media']),
      load(['hosts', hostId, 'members']),
    ]).then(([screens, media, members]) => {
      if (active) setCounts({ screens, media, members })
    })
    return () => {
      active = false
    }
  }, [firestore, hostId, orgId])

  const liveUrl = useMemo(
    () =>
      host
        ? (staffSiteLiveUrl({
            subdomain: host.subdomain ?? null,
            cname: host.cname ?? null,
            cnameAttachmentPending: host.cnameAttachmentPending === true,
          }) ?? null)
        : null,
    [host],
  )
  const publishedPages = useMemo(
    () => Object.keys((host?.screens ?? {}) as Record<string, string>).length,
    [host],
  )
  const storageMb = useMemo(() => {
    const bytes = Number(host?.storageBytes ?? 0)
    return bytes ? (bytes / (1024 * 1024)).toFixed(1) : null
  }, [host])

  const [subdomain, setSubdomain] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setSubdomain(String(host?.subdomain ?? '')), [host?.subdomain])
  const handleSubdomainSave = async () => {
    const next = subdomain.trim().toLowerCase()
    if (!next || next === host?.subdomain || busy) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, action: 'set-subdomain', subdomain: next }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Update failed')
      enqueueSnackbar('Subdomain updated', { variant: 'success', persist: false })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Updating the subdomain failed', {
        variant: 'error',
      })
      setSubdomain(String(host?.subdomain ?? ''))
    } finally {
      setBusy(false)
    }
  }

  const stat = (label: string, value: string | number | null) => (
    <Stack>
      <Typography variant="h5">{value ?? '—'}</Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Sites', href: buildRoute(Route.ADMIN_SITES) },
        { children: host?.displayName ?? hostId },
      ]}
      header={{
        children: host?.displayName ?? 'Site',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
      help={{ topic: 'staffConsole', anchor: '#site-detail' }}
      headerRight={
        <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            href={liveUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            disabled={!liveUrl}
          >
            {'Visit live site'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            href={homeId ? staffSitePreviewHref(hostId, 'screen', homeId) : undefined}
            target="_blank"
            rel="noreferrer"
            disabled={!homeId}
            title={homeId ? undefined : 'No home page is published — preview a page from Content'}
          >
            {'Open preview'}
          </Button>
          <RowActionsMenu
            label={host?.displayName ?? hostId}
            items={[
              {
                key: 'org',
                label: 'Open organization',
                href: orgId ? buildRoute(Route.ADMIN_ORG_DETAIL, { orgId }) : undefined,
                disabled: !orgId,
                disabledReason: orgId ? undefined : 'This site belongs to no organization',
              },
              {
                key: 'owner',
                label: 'Open owner',
                href: site?.owner?.uid
                  ? buildRoute(Route.ADMIN_USER_DETAIL, { uid: site.owner.uid })
                  : undefined,
                disabled: !site?.owner?.uid,
                disabledReason: site?.owner?.uid ? undefined : 'The organization records no owner',
              },
            ]}
          />
        </Stack>
      }
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, md: 6 },
                children: (
                  <CardDisplay
                    header={'Site'}
                    help={docsHelp('architectureMultiTenancy', {
                      anchor: '#workspace-subdomains',
                      excerpt:
                        "The site's live URL, custom domain, and publish state. Retargeting the subdomain is audited and takes effect within a minute.",
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={1}>
                      <Typography variant="body2">
                        {host?.displayName ?? '—'}
                      </Typography>
                      {liveUrl ? (
                        <MuiLink
                          href={liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          color="primary"
                          underline="hover"
                        >
                          {liveUrl}
                        </MuiLink>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {'Not published'}
                        </Typography>
                      )}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        {`host id ${hostId}`}
                      </Typography>
                      <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {/*
                          The custom domain moved to its own card below
                          (AGL-2011). It used to be a bare `domain: {cname}`
                          chip here — the domain, with no verdict and no
                          attachment flag, so a broken domain and a working one
                          rendered identically on the page support looks at.
                        */}
                        <Chip
                          size="small"
                          variant="outlined"
                          label={publishedPages ? 'published' : 'unpublished'}
                        />
                        {site?.suspended ? (
                          <Chip size="small" color="error" label="suspended" />
                        ) : null}
                        {host?.maintenance ? (
                          <Chip size="small" color="warning" label="maintenance" />
                        ) : null}
                        {leavingNoticeUntil ? (
                          <Chip
                            size="small"
                            color="info"
                            variant="outlined"
                            label="leaving notice"
                          />
                        ) : null}
                      </Stack>
                      {/*
                        The leaving notice (AGL-3452): a new free workspace's
                        sites send links to other domains through a "You're
                        leaving" page for their first two weeks. Stated either
                        way once the row has loaded, so "off" is an answer
                        rather than a missing line.
                      */}
                      {site ? (
                        <Typography variant="caption" color="text.secondary">
                          {staffLeavingNoticeLabel(leavingNoticeUntil)}
                        </Typography>
                      ) : null}
                      {/* Subdomain edit (AGL-390). */}
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'flex-start', mt: 1 }}
                      >
                        <TextField
                          size="small"
                          label="Subdomain"
                          value={subdomain}
                          onChange={(event) =>
                            setSubdomain(event.target.value.toLowerCase())
                          }
                          helperText={`${subdomain || '…'}.${TENANT_ROOT}`}
                          sx={{ flex: 1 }}
                        />
                        {/* Retargeting a subdomain is super-only at
                            /api/admin/host (AGL-2131). Support staff saw a
                            live Save and got a raw 403. */}
                        <SuperStaffOnly>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={
                              busy ||
                              !subdomain.trim() ||
                              subdomain === (host?.subdomain ?? '')
                            }
                            onClick={() => void handleSubdomainSave()}
                            sx={{ mt: 0.5 }}
                          >
                            {'Save'}
                          </Button>
                        </SuperStaffOnly>
                      </Stack>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6 },
                children: (
                  <CardDisplay
                    header={'Ownership'}
                    help={docsHelp('staffConsole', {
                      anchor: '#site-ownership',
                      excerpt:
                        'The organization this site belongs to and who owns it. Ownership moves with the organization: transferring it here hands every site of the organization to the new owner.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={1.5}>
                      <Stack>
                        <Typography variant="caption" color="text.secondary">
                          {'Organization'}
                        </Typography>
                        {/* An anchor either way: one without an href is
                            the placeholder link, not a different element. */}
                        <AppLink
                          href={orgId ? buildRoute(Route.ADMIN_ORG_DETAIL, { orgId }) : undefined}
                        >
                          {orgId ? (site?.org?.name ?? orgId) : '—'}
                        </AppLink>
                        {site?.org?.plan ? (
                          <Typography variant="caption" color="text.secondary">
                            {`stored plan: ${site.org.plan}`}
                          </Typography>
                        ) : null}
                      </Stack>
                      <Stack>
                        <Typography variant="caption" color="text.secondary">
                          {'Owner'}
                        </Typography>
                        <AppLink
                          href={
                            site?.owner
                              ? buildRoute(Route.ADMIN_USER_DETAIL, { uid: site.owner.uid })
                              : undefined
                          }
                        >
                          {site?.owner
                            ? (site.owner.email ?? site.owner.displayName ?? site.owner.uid)
                            : '—'}
                        </AppLink>
                      </Stack>
                      {orgId ? (
                        <StaffOrgOwnershipTransfer
                          orgId={orgId}
                          orgName={site?.org?.name}
                          ownerUid={site?.org?.ownerUid}
                          onTransferred={() => setSiteNonce((nonce) => nonce + 1)}
                        />
                      ) : null}
                      {/* Handing the workspace to the client the site was
                          built for, and later asking them to upgrade, are
                          the same two acts as on the organization page
                          (AGL-3466). */}
                      {orgId ? (
                        <StaffOrgOwnerHandoff
                          orgId={orgId}
                          orgName={site?.org?.name}
                          onSent={() => setSiteNonce((nonce) => nonce + 1)}
                        />
                      ) : null}
                      {orgId ? (
                        <StaffOrgUpgradeProposal
                          orgId={orgId}
                          org={(site?.org ?? null) as never}
                          onChanged={() => setSiteNonce((nonce) => nonce + 1)}
                        />
                      ) : null}
                      {/* Moving the site itself to another organization
                          (AGL-3381) is super-only at /api/admin/site-transfer. */}
                      <SuperStaffOnly>
                        <StaffSiteTransfer
                          hostId={hostId}
                          currentOrgId={orgId || null}
                          onTransferred={() => setSiteNonce((nonce) => nonce + 1)}
                        />
                      </SuperStaffOnly>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6 },
                children: (
                  <CardDisplay
                    header={'Usage'}
                    help={docsHelp('billing', {
                      anchor: '#usage-meters',
                      excerpt:
                        "Live counts for this site — published and total pages, media, members, and storage — the figures metered against the org's entitlements.",
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack
                      useFlexGap
                      direction="row"
                      spacing={3}
                      sx={{ flexWrap: 'wrap', gap: 2 }}
                    >
                      {stat('Published pages', publishedPages)}
                      {stat('All pages', counts.screens)}
                      {stat('Media files (organization)', counts.media)}
                      {stat('Site members', counts.members)}
                      {stat('Storage (MB)', storageMb)}
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12 },
                children: <StaffDomainCard hostId={hostId} host={host} />,
              },
              {
                size: { xs: 12 },
                children: (
                  <StaffSiteContentCard hostId={hostId} host={host} orgId={orgId} />
                ),
              },
              {
                size: { xs: 12 },
                children: <StaffEmailDeliveriesCard hostId={hostId} />,
              },
              // What a plugin holds for this site — its automations, its
              // sends — shown by the plugin that owns it (AGL-3379).
              ...(staffSiteWidgets.length
                ? [
                    {
                      size: { xs: 12 },
                      children: (
                        <PluginWidgetSlot
                          slot="staffSite"
                          hostId={hostId}
                          orgId={orgId}
                          host={host ?? undefined}
                        />
                      ),
                    },
                  ]
                : []),
              {
                size: { xs: 12 },
                children: (
                  <CardDisplay
                    header={'Settings snapshot'}
                    help={docsHelp('staffConsole', {
                      anchor: '#whats-there',
                      excerpt:
                        "A read-only snapshot of the site's locales, analytics id, password protection, and store template pages.",
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={0.5}>
                      <Typography variant="body2" color="text.secondary">
                        {`Locales: ${(host?.locales ?? []).join(', ') || '—'}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {/* The field lives at analytics.gaMeasurementId —
                            what the Setup form writes and the tenant reads.
                            The flat path never existed, so this always
                            showed '—' even for hosts with GA configured. */}
                        {`GA measurement id: ${
                          (host as { analytics?: { gaMeasurementId?: string } })
                            ?.analytics?.gaMeasurementId ?? '—'
                        }`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {`Password protected: ${host?.protectPassword ? 'yes' : 'no'}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {`Store templates: PDP ${host?.settings?.store?.pdpScreenId ?? '—'}, collection ${host?.settings?.store?.collectionScreenId ?? '—'}`}
                      </Typography>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12 },
                children: (
                  /*
                   * The site's own activity log.
                   *
                   * The same feed the owner reads on Setup → Activity, on the
                   * page staff open when they are working out what happened
                   * to a site. Reading it here meant leaving the staff
                   * console, finding the org slug, and opening the customer's
                   * own console — which is both slower and a different
                   * permission story.
                   */
                  <HostActivityTable hostId={hostId} />
                ),
              },
            ]}
          />
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminHostDetail.displayName = 'Page:AdminHostDetail'

export default AdminHostDetail
