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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
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
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import adminNavTabItems from '../../../../../../../constants/admin-nav-tabs'
import { docsHelp } from '../../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import useFirestoreDoc from '../../../../../../../hooks/use-firestore-doc'

const TENANT_ROOT = 'aglyn.app'

/**
 * Staff host detail (AGL-392): a per-site view under an org — live link,
 * names, subdomain + custom domains, and usage (pages, media, storage,
 * members). Staff can retarget the subdomain (audited server-side).
 */
const AdminHostDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ orgId?: string; hostId?: string }>()
  const orgId = params?.orgId ?? ''
  const hostId = params?.hostId ?? ''
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void (user as any)
      ?.getIdTokenResult?.()
      .then((result: any) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      .catch(() => {
        if (active) setIsStaff(false)
      })
    return () => {
      active = false
    }
  }, [user])

  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId || 'missing'),
    [firestore, hostId],
    { idField: '$id' },
  )

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

  const liveUrl = useMemo(() => {
    if (!host) return null
    if (host.cname) return `https://${host.cname}`
    if (host.subdomain) return `https://${host.subdomain}.${TENANT_ROOT}`
    return null
  }, [host])
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
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/host', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
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
    <>
      <NextPageTitle screen={'Host – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_ORGS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_ORGS) },
          {
            children: 'Organization',
            href: buildRoute(Route.ADMIN_ORG_DETAIL, { orgId }),
          },
          { children: host?.displayName ?? hostId },
        ]}
        header={{
          children: host?.displayName ?? 'Host',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="error">{'This area requires the staff role.'}</Alert>
          ) : (
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
                            color="secondary"
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
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                          {host?.cname ? (
                            <Chip size="small" label={`domain: ${host.cname}`} />
                          ) : null}
                          <Chip
                            size="small"
                            variant="outlined"
                            label={host?.published ? 'published' : 'draft'}
                          />
                        </Stack>
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
                        </Stack>
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
                          "Live counts for this site — pages, screens, media, members, and storage — the figures metered against the org's entitlements.",
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack
                        direction="row"
                        spacing={3}
                        sx={{ flexWrap: 'wrap', gap: 2 }}
                      >
                        {stat('Published pages', publishedPages)}
                        {stat('Screens', counts.screens)}
                        {stat('Media files', counts.media)}
                        {stat('Site members', counts.members)}
                        {stat('Storage (MB)', storageMb)}
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12 },
                  children: (
                    <CardDisplay
                      header={'Settings snapshot'}
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          "A read-only snapshot of the site's locales, analytics id, password protection, and store template screens.",
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
              ]}
            />
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
AdminHostDetail.displayName = 'Page:AdminHostDetail'

export default AdminHostDetail
