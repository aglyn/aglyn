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

import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import { canManageOrg, isValidOrgSlug } from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  AppLink,
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Avatar,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import MediaUrlField from '../../../../components/media-url-field.component'
import OrgApiKeysCard from '../../../../components/org-api-keys-card.component'
import OrgPluginsCard from '../../../../components/org-plugins-card.component'
import useCurrentOrg from '../../../../hooks/use-current-org'
import HubTabs from '../../../../components/hub-tabs.component'
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../hooks/use-org-permissions'

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Org settings without host context (AGL-236): rename (the only
 * client-writable org-doc key — everything else is Admin-SDK-only) and
 * workspace info. Slug changes and deletion stay deliberate future flows.
 */
const OrgSettings: NextPageWithLayout<Record<string, never>> = () => {
  const orgNavTabs = useOrgNavTabItems()
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const canManage = canManageOrg(currentOrg?.role)
  const isOwner = currentOrg?.role === 'owner'
  const { can, loaded: permissionsLoaded } = useOrgPermissions()

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

  // Self-serve org deletion (AGL-485): owner-only. Sets the erasure flag;
  // the actual hard-delete runs via the guarded staff pipeline after the
  // 7-day hold and is cancelable until then.
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const deleteRequest = async (action: 'request' | 'cancel') => {
    const idToken = await (user as any)?.getIdToken?.()
    const response = await fetch('/api/orgs/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ orgId: currentOrg?.$id, action }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error ?? 'Request failed')
    }
    return response.json()
  }
  const handleRequestDeletion = async () => {
    if (!currentOrg || busy) return
    const accepted = await confirm({
      title: 'Delete this organization?',
      description:
        "After a 7-day hold, this organization's sites, files, and data " +
        'are permanently erased — a final export is produced first. You can ' +
        'cancel any time during the hold.',
      confirmationText: 'Request deletion',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await deleteRequest('request')
      setDeleteConfirmText('')
      enqueueSnackbar(
        'Deletion requested — your data is erased after a 7-day hold. ' +
          'Cancel here to keep the organization.',
        { variant: 'success' },
      )
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not request deletion', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }
  const handleCancelDeletion = async () => {
    if (!currentOrg || busy) return
    setBusy(true)
    try {
      await deleteRequest('cancel')
      enqueueSnackbar('Deletion canceled — your organization is safe.', {
        variant: 'success',
      })
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not cancel deletion', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  // Org profile fields (AGL-363), prefilled from the org doc.
  const { org } = useCurrentOrg()
  // Name to type in the delete confirmation (AGL-485). The org-scope
  // projection's `orgName` isn't always populated, so fall back to the org
  // doc name, then the slug — always something real to type.
  const orgDisplayName =
    (org as any)?.name || currentOrg?.orgName || currentOrg?.slug || ''
  const [profile, setProfile] = useState({
    logoUrl: '',
    contactEmail: '',
    contactPhone: '',
    contactWebsite: '',
    contactAddress: '',
  })
  useEffect(() => {
    setProfile({
      logoUrl: String((org as any)?.logoUrl ?? ''),
      contactEmail: String((org as any)?.contact?.email ?? ''),
      contactPhone: String((org as any)?.contact?.phone ?? ''),
      contactWebsite: String((org as any)?.contact?.website ?? ''),
      contactAddress: String((org as any)?.contact?.address ?? ''),
    })
  }, [org])
  const handleProfileSave = async () => {
    if (!currentOrg || busy) return
    setBusy(true)
    try {
      await settingsRequest({ action: 'update-profile', ...profile })
      enqueueSnackbar('Organization profile saved', { variant: 'success' })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Saving the profile failed', {
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
        navTabItems={orgNavTabs}
        activeTab={buildRoute(Route.ORG_SETTINGS, { orgSlug })}
        breadcrumbItems={[
          { children: 'Settings', href: buildRoute(Route.ORG_SETTINGS, { orgSlug }) },
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
          ) : permissionsLoaded && !can('org.settings') ? (
            // Permission guard (AGL-243): org.settings gates the page.
            <Alert severity="warning">
              {'You do not have permission to manage settings for this ' +
                'organization — ask an organization admin for access.'}
            </Alert>
          ) : (
            <HubTabs
              tabs={[
                {
                  id: 'general',
                  label: 'General',
                  content: (
            <CardDisplay
              header={'General'}
              help={docsHelp('glossary', {
                anchor: '#workspace',
                excerpt:
                  'Rename the organization and change its workspace URL — ' +
                  '"workspace" is the console word for your organization\'s home.',
              })}
              contentGutterX
              contentGutterY
            >
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
                  ),
                },
                ...(currentOrg && canManage
                  ? [
                      {
                        id: 'profile',
                        label: 'Profile',
                        content: (
            <CardDisplay
              header={'Organization profile'}
              help={docsHelp('glossary', {
                anchor: '#organization-org',
                excerpt:
                  'Logo and contact details for the organization — shown in ' +
                  'the console and available to your sites.',
              })}
              contentGutterX
              contentGutterY
              sx={{ mt: 3 }}
            >
              <Stack spacing={2} sx={{ maxWidth: 480 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Avatar
                    src={profile.logoUrl || undefined}
                    variant="rounded"
                    sx={{ width: 56, height: 56 }}
                  >
                    {(currentOrg.orgName ?? '?').slice(0, 1).toUpperCase()}
                  </Avatar>
                  <MediaUrlField
                    label="Logo URL"
                    helperText="Browse the org media library or paste an https URL"
                    orgId={currentOrg.$id}
                    value={profile.logoUrl}
                    onChange={(logoUrl) =>
                      setProfile((prev) => ({ ...prev, logoUrl }))
                    }
                  />
                </Stack>
                <TextField
                  label="Contact email"
                  value={profile.contactEmail}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      contactEmail: event.target.value,
                    }))
                  }
                />
                <TextField
                  label="Phone"
                  value={profile.contactPhone}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      contactPhone: event.target.value,
                    }))
                  }
                />
                <TextField
                  label="Website"
                  value={profile.contactWebsite}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      contactWebsite: event.target.value,
                    }))
                  }
                />
                <TextField
                  label="Address"
                  multiline
                  minRows={2}
                  value={profile.contactAddress}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      contactAddress: event.target.value,
                    }))
                  }
                />
                <Stack direction="row">
                  <Button
                    variant="contained"
                    disabled={busy}
                    onClick={() => void handleProfileSave()}
                  >
                    {busy ? 'Saving…' : 'Save profile'}
                  </Button>
                </Stack>
              </Stack>
            </CardDisplay>
                        ),
                      },
                      {
                        id: 'plugins',
                        label: 'Plugins',
                        content: (
                          <Stack spacing={1}>
                            <OrgPluginsCard
                              org={org}
                              disabled={!canManage || busy}
                              onSave={async (enabledPlugins) => {
                                await settingsRequest({
                                  action: 'set-enabled-plugins',
                                  enabledPlugins,
                                })
                                enqueueSnackbar('Plugins updated', {
                                  variant: 'success',
                                })
                              }}
                            />
                            <Typography variant="body2">
                              {'Marketplace add-ons (installs, upgrades, '}
                              <AppLink
                                href={buildRoute(Route.ORG_PLUGINS, { orgSlug })}
                              >{'uninstalls) live in Plugins & add-ons'}</AppLink>
                              {'.'}
                            </Typography>
                          </Stack>
                        ),
                      },
                      {
                        id: 'api-keys',
                        label: 'API keys',
                        content: <OrgApiKeysCard />,
                      },
                    ]
                  : []),
                ...(currentOrg && isOwner
                  ? [
                      {
                        id: 'ownership',
                        label: 'Ownership',
                        content: (
            <CardDisplay
              header={'Transfer ownership'}
              help={docsHelp('team', {
                anchor: '#team-roles',
                excerpt:
                  'Only the owner can transfer ownership. The new owner ' +
                  'gains billing, workspace-URL, and transfer powers; you ' +
                  'step down to admin.',
              })}
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
                        ),
                      },
                    ]
                  : []),
                ...(currentOrg && isOwner
                  ? [
                      {
                        id: 'danger',
                        label: 'Delete',
                        content: (
            <CardDisplay
              header={'Delete organization'}
              help={docsHelp('downgradingAndCanceling', {
                anchor: '#deleting-your-organization',
              })}
              contentGutterX
              contentGutterY
              sx={{ mt: 3 }}
            >
              {org?.erasureRequestedAt ? (
                <Stack spacing={2} sx={{ maxWidth: 480 }}>
                  <Alert severity="warning">
                    {'This organization is scheduled for deletion. After a ' +
                      '7-day hold, all of its sites, files, and data are ' +
                      'permanently erased. Cancel now to keep it.'}
                  </Alert>
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => void handleCancelDeletion()}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {'Cancel deletion'}
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={2} sx={{ maxWidth: 480 }}>
                  <Typography variant="body2" color="text.secondary">
                    {'Permanently delete this organization and everything in ' +
                      'it — sites, files, datasets, and members. Nothing is ' +
                      'removed for 7 days (a final export is produced and you ' +
                      'can cancel), then erasure is irreversible. Export ' +
                      'anything you want to keep first.'}
                  </Typography>
                  <TextField
                    label={`Type "${orgDisplayName}" to confirm`}
                    value={deleteConfirmText}
                    disabled={busy}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    size="small"
                  />
                  <Button
                    color="error"
                    variant="contained"
                    disabled={
                      busy ||
                      !orgDisplayName ||
                      deleteConfirmText.trim() !== orgDisplayName
                    }
                    onClick={() => void handleRequestDeletion()}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {'Delete organization'}
                  </Button>
                </Stack>
              )}
            </CardDisplay>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          {/* Plugin zone (AGL-433): orgSettings widgets. */}
          {currentOrg?.$id ? (<PluginWidgetSlot slot="orgSettings" orgId={currentOrg.$id} org={org} />) : null}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgSettings.displayName = 'Page:OrgSettings'

export default OrgSettings
