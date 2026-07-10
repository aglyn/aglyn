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

import { canManageOrg, isValidOrgSlug } from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import orgNavTabItems from '../../../constants/org-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgWorkspace } from '../../../hooks/use-org-workspace'

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Org settings without host context (AGL-236): rename (the only
 * client-writable org-doc key — everything else is Admin-SDK-only) and
 * workspace info. Slug changes and deletion stay deliberate future flows.
 */
const OrgSettings: NextPageWithLayout = () => {
  const { currentOrg, loading } = useOrgWorkspace()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const canManage = canManageOrg(currentOrg?.role)
  const isOwner = currentOrg?.role === 'owner'

  useEffect(() => {
    setName(currentOrg?.orgName ?? '')
  }, [currentOrg?.orgName])
  useEffect(() => {
    setSlug(currentOrg?.slug ?? '')
  }, [currentOrg?.slug])

  const settingsRequest = async (body: Record<string, unknown>) => {
    const idToken = await (user as any)?.getIdToken?.()
    const response = await fetch('/api/orgs/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ orgId: currentOrg?.$id, ...body }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error ?? 'Request failed')
    }
    return response.json()
  }

  const handleSlugChange = async () => {
    const next = slug.trim().toLowerCase()
    if (!currentOrg || !next || next === currentOrg.slug || busy) return
    const accepted = await confirm({
      title: 'Change the workspace URL?',
      description:
        `Your workspace moves to ${next}.${WORKSPACE_DOMAIN} immediately. ` +
        'The old URL keeps redirecting, but share the new one going forward.',
      confirmationText: 'Change URL',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await settingsRequest({ action: 'change-slug', slug: next })
      enqueueSnackbar(`Workspace URL is now ${next}.${WORKSPACE_DOMAIN}`, {
        variant: 'success',
      })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Changing the URL failed', {
        variant: 'error',
      })
      setSlug(currentOrg.slug ?? '')
    } finally {
      setBusy(false)
    }
  }

  // Ownership transfer (AGL-232): owner-only; the roster comes from the
  // members API so the picker only offers actual members.
  const [members, setMembers] = useState<any[]>([])
  const [transferTarget, setTransferTarget] = useState('')
  useEffect(() => {
    if (!isOwner || !currentOrg?.$id) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (!idToken) return
        const response = await fetch(
          `/api/orgs/members?orgId=${encodeURIComponent(currentOrg.$id)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )
        if (!response.ok) return
        const payload = await response.json()
        if (active) setMembers(payload.members ?? [])
      } catch {
        // The card simply stays empty; transfer is still possible later.
      }
    })()
    return () => {
      active = false
    }
  }, [isOwner, currentOrg?.$id, user])

  const handleTransfer = async () => {
    if (!currentOrg || !transferTarget || busy) return
    const target = members.find((member) => member.$id === transferTarget)
    const accepted = await confirm({
      title: 'Transfer ownership?',
      description:
        `${target?.email ?? transferTarget} becomes the organization ` +
        'owner (billing, workspace URL, and ownership transfers). You ' +
        'step down to admin. This cannot be undone by you afterwards.',
      confirmationText: 'Transfer ownership',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await settingsRequest({
        action: 'transfer-ownership',
        targetUid: transferTarget,
      })
      enqueueSnackbar('Ownership transferred — you are now an admin', {
        variant: 'success',
      })
      setTransferTarget('')
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Transfer failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleRename = async () => {
    if (!currentOrg || !name.trim() || busy) return
    setBusy(true)
    try {
      // API-routed so the reverse-index orgName (switcher, breadcrumbs)
      // fans out with the rename.
      await settingsRequest({ action: 'rename', name: name.trim() })
      enqueueSnackbar('Organization renamed', { variant: 'success' })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Renaming failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <NextPageTitle screen={'Settings – Organization'} />
      <DashboardLayout
        navTabItems={orgNavTabItems()}
        activeTab={buildRoute(Route.ORG_SETTINGS)}
        breadcrumbItems={[
          {
            children: currentOrg?.orgName ?? 'Organization',
            href: buildRoute(Route.MANAGE_TEAM),
          },
          { children: 'Settings', href: buildRoute(Route.ORG_SETTINGS) },
        ]}
        header={{
          children: 'Organization Settings',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {!loading && !currentOrg ? (
            <Alert severity="info">
              {'Create your first site to start an organization, or accept ' +
                'a pending invite from your dashboard.'}
            </Alert>
          ) : (
            <CardDisplay header={'General'} contentGutterX contentGutterY>
              <Stack spacing={2} sx={{ maxWidth: 480 }}>
                <TextField
                  label="Organization name"
                  value={name}
                  disabled={!canManage}
                  onChange={(event) => setName(event.target.value)}
                />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField
                    label="Workspace URL"
                    value={slug}
                    disabled={!isOwner || busy}
                    onChange={(event) =>
                      setSlug(event.target.value.toLowerCase())
                    }
                    error={Boolean(slug) && !isValidOrgSlug(slug)}
                    helperText={
                      isOwner
                        ? `Full address: ${slug || '…'}.${WORKSPACE_DOMAIN}. ` +
                          'Old URLs keep redirecting after a change.'
                        : 'Only the organization owner can change the URL.'
                    }
                    sx={{ flexGrow: 1 }}
                  />
                  {isOwner ? (
                    <Button
                      variant="outlined"
                      disabled={
                        busy ||
                        !isValidOrgSlug(slug) ||
                        slug === (currentOrg?.slug ?? '')
                      }
                      onClick={() => void handleSlugChange()}
                      sx={{ mt: 1 }}
                    >
                      {'Change URL'}
                    </Button>
                  ) : null}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {`Your role: ${currentOrg?.role ?? '—'}. Plan, billing and ` +
                    'suspension are managed under Manage → Billing.'}
                </Typography>
                {canManage ? (
                  <Stack direction="row">
                    <Button
                      variant="contained"
                      disabled={
                        busy ||
                        !name.trim() ||
                        name.trim() === (currentOrg?.orgName ?? '')
                      }
                      onClick={() => void handleRename()}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </Button>
                  </Stack>
                ) : (
                  <Alert severity="info">
                    {'Renaming the organization requires the admin role.'}
                  </Alert>
                )}
              </Stack>
            </CardDisplay>
          )}
          {currentOrg && isOwner ? (
            <CardDisplay
              header={'Transfer ownership'}
              contentGutterX
              contentGutterY
              sx={{ mt: 3 }}
            >
              <Stack spacing={2} sx={{ maxWidth: 480 }}>
                <Typography variant="body2" color="text.secondary">
                  {'Hand the organization to another member. They gain ' +
                    'billing, workspace-URL and transfer powers; you step ' +
                    'down to admin.'}
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <TextField
                    select
                    label="New owner"
                    value={transferTarget}
                    disabled={busy}
                    onChange={(event) =>
                      setTransferTarget(event.target.value)
                    }
                    sx={{ flexGrow: 1 }}
                    helperText={
                      members.length <= 1
                        ? 'Invite a member from the Team page first.'
                        : ''
                    }
                  >
                    {members
                      .filter((member) => member.$id !== (user as any)?.uid)
                      .map((member) => (
                        <MenuItem key={member.$id} value={member.$id}>
                          {member.email ?? member.displayName ?? member.$id}
                        </MenuItem>
                      ))}
                  </TextField>
                  <Button
                    color="error"
                    variant="outlined"
                    disabled={busy || !transferTarget}
                    onClick={() => void handleTransfer()}
                    sx={{ mt: 1 }}
                  >
                    {'Transfer'}
                  </Button>
                </Stack>
              </Stack>
            </CardDisplay>
          ) : null}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgSettings.displayName = 'Page:OrgSettings'
OrgSettings.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Settings – Organization' } },
]

export default OrgSettings
