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
import { RetentionFunnelDialog } from '../../../../components/billing/retention-funnel.dialog'
import DataExportCard from '../../../../components/data-export-card.component'
import {
  canManageOrg,
  isLiveSubscriptionStatus,
  isValidOrgSlug,
  type OrgPlan,
} from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  AppLink,
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  AlertTitle,
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
import OrgBrandingCard from '../../../../components/org-branding-card.component'
import OrgSsoCard from '../../../../components/org-sso-card.component'
import useCurrentOrg from '../../../../hooks/use-current-org'
import HubTabs from '../../../../components/hub-tabs.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../hooks/use-org-permissions'

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

/**
 * Org settings without host context (AGL-236): rename (the only
 * client-writable org-doc key — everything else is Admin-SDK-only) and
 * workspace info. Slug changes and deletion stay deliberate future flows.
 */
const OrgSettings: NextPageWithLayout<Record<string, never>> = () => {
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
  // Account deletion shares the retention funnel with subscription cancel
  // (AGL-1863) — it is the same departure, and a churn breakdown that only
  // counted one of them would understate churn by exactly the orgs that
  // deleted instead of canceling.
  const [deleteFunnelOpen, setDeleteFunnelOpen] = useState(false)
  const deleteRequest = async (
    action: 'request' | 'cancel',
    funnelId?: string | null,
  ) => {
    const idToken = await (user as any)?.getIdToken?.()
    const response = await fetch('/api/orgs/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        orgId: currentOrg?.$id,
        action,
        ...(funnelId ? { funnelId } : {}),
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error ?? 'Request failed')
    }
    return response.json()
  }
  /**
   * Opens the funnel rather than the old single confirm. The type-the-org-name
   * gate in the Danger Zone still stands in front of this, so deletion keeps
   * BOTH guards — the funnel is added friction on the way out, not a
   * replacement for the one that was already there.
   */
  const handleRequestDeletion = async () => {
    if (!currentOrg || busy) return
    setDeleteFunnelOpen(true)
  }
  /** The funnel ran to the end and they still want the org gone. */
  const handleDeleteLeave = async (funnelId: string | null) => {
    setBusy(true)
    try {
      await deleteRequest('request', funnelId)
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
  /**
   * The downsell, from the deletion path. Interval is deliberately absent —
   * the subscription route keeps the subscription's CURRENT interval when the
   * request does not state one, and this page has no billing toggle to read.
   */
  const handleDeleteDownsell = async (targetPlan: OrgPlan) => {
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId: currentOrg?.$id,
          action: 'switch',
          plan: targetPlan,
        }),
      })
      if (!response.ok) {
        enqueueSnackbar('Could not switch plans — nothing has changed.', {
          variant: 'warning',
        })
        return false
      }
      const payload = await response.json().catch(() => ({}))
      enqueueSnackbar(
        payload?.scheduled && payload?.effectiveAt
          ? `Moving to ${targetPlan} on ${new Date(
              payload.effectiveAt,
            ).toLocaleDateString()} — your organization stays put.`
          : `Switched to ${targetPlan} — your organization stays put.`,
        { variant: 'success' },
      )
      return true
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
  const { org, ready: orgReady } = useCurrentOrg()
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
    // Structured (AGL-1133) — this is the address an invoice uses, so it has
    // to be parseable. A free-text blob reads as an address to a human and
    // is unusable to Stripe Tax.
    contactAddressLine1: '',
    contactAddressLine2: '',
    contactAddressCity: '',
    contactAddressState: '',
    contactAddressPostalCode: '',
    contactAddressCountry: '',
  })
  useEffect(() => {
    const address = ((org as any)?.contact?.address ?? {}) as Record<
      string,
      string | undefined
    >
    setProfile({
      logoUrl: String((org as any)?.logoUrl ?? ''),
      contactEmail: String((org as any)?.contact?.email ?? ''),
      contactPhone: String((org as any)?.contact?.phone ?? ''),
      contactWebsite: String((org as any)?.contact?.website ?? ''),
      // `?? {}` above rather than a String() cast: the field was a string
      // before this change, and casting an object would have painted
      // "[object Object]" into the form.
      contactAddressLine1: String(address.line1 ?? ''),
      contactAddressLine2: String(address.line2 ?? ''),
      contactAddressCity: String(address.city ?? ''),
      contactAddressState: String(address.state ?? ''),
      contactAddressPostalCode: String(address.postalCode ?? ''),
      contactAddressCountry: String(address.country ?? ''),
    })
  }, [org])
  // Written by the settings route after it tells Stripe about an address
  // change — or finds it cannot (AGL-1133).
  const stripeAddressDiverged = Boolean(
    (org as any)?.billing?.addressDivergedFromStripe,
  )
  const stripeAddressReason = String(
    (org as any)?.billing?.addressDivergedReason ?? '',
  )
  const handleProfileSave = async () => {
    if (!currentOrg || busy) return
    // AGL-1422. This form is a PREFILL of the org doc, so before `org`
    // resolves every field above is the empty string it was initialised to —
    // and `update-profile` posts the whole object. A save inside the loading
    // window therefore does not fail, it SUCCEEDS at erasing the logo,
    // contact email, phone, website and the billing address Stripe Tax
    // reads. Nothing here is worth saving until there is something to have
    // loaded.
    if (!orgReady) {
      return void enqueueSnackbar(
        'Still loading this organization’s profile — try again in a moment',
        { variant: 'info', persist: false },
      )
    }
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
    <DashboardLayout
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
                        <>
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
              {/* Structured, and labelled as the billing address (AGL-1133):
                  this is the one that goes on an invoice, and it is distinct
                  from the owner's personal address in Manage Account. Saying
                  which is which at the field is the cheapest way to stop
                  someone entering a home address here. */}
              <TextField
                label="Billing address"
                helperText="Used on your invoices and receipts"
                value={profile.contactAddressLine1}
                onChange={(event) =>
                  setProfile((prev) => ({
                    ...prev,
                    contactAddressLine1: event.target.value,
                  }))
                }
              />
              <TextField
                label="Apartment, suite, etc."
                value={profile.contactAddressLine2}
                onChange={(event) =>
                  setProfile((prev) => ({
                    ...prev,
                    contactAddressLine2: event.target.value,
                  }))
                }
              />
              <TextField
                label="City"
                value={profile.contactAddressCity}
                onChange={(event) =>
                  setProfile((prev) => ({
                    ...prev,
                    contactAddressCity: event.target.value,
                  }))
                }
              />
              <TextField
                label="State / Province"
                value={profile.contactAddressState}
                onChange={(event) =>
                  setProfile((prev) => ({
                    ...prev,
                    contactAddressState: event.target.value,
                  }))
                }
              />
              <TextField
                label="Postal code"
                value={profile.contactAddressPostalCode}
                onChange={(event) =>
                  setProfile((prev) => ({
                    ...prev,
                    contactAddressPostalCode: event.target.value,
                  }))
                }
              />
              <TextField
                label="Country"
                helperText="Two-letter code, e.g. US — required for tax"
                value={profile.contactAddressCountry}
                onChange={(event) =>
                  setProfile((prev) => ({
                    ...prev,
                    contactAddressCountry: event.target.value,
                  }))
                }
              />
              {/* The address here and the one Stripe bills from can be out
                  of step, and used to be so invisibly (AGL-1133). Clearing
                  this form deliberately does not clear Stripe's copy —
                  that is what an active subscription's invoices carry and
                  what tax is computed from — so the difference is said out
                  loud instead. The flag is written from what Stripe was
                  ASKED, not assumed, so this cannot cry wolf. */}
              {stripeAddressDiverged && (
                <Alert severity="warning">
                  <AlertTitle>{'Invoices use a different address'}</AlertTitle>
                  {stripeAddressReason === 'sync-failed'
                    ? 'The last change here did not reach Stripe, so invoices ' +
                      'and tax still use the previous address. Saving again ' +
                      'will retry.'
                    : 'Stripe still has a billing address on file for this ' +
                      'organization, and invoices and tax will keep using it. ' +
                      'Clearing the fields here does not remove it — an ' +
                      'invoice with no address cannot have tax calculated. ' +
                      'Enter the correct address and save to replace it.'}
                </Alert>
              )}
              <Stack direction="row">
                <Button
                  variant="contained"
                  disabled={busy || !orgReady}
                  onClick={() => void handleProfileSave()}
                >
                  {busy ? 'Saving…' : 'Save profile'}
                </Button>
              </Stack>
            </Stack>
          </CardDisplay>
          {/* Default sharing (AGL-1048): what a NEW dataset or upload
              starts as. Changes nothing that already exists — narrowing a
              whole library from a toggle would break live pages with no
              confirmation, which is what the per-resource flow prevents. */}
          <CardDisplay
            header={'Default sharing for new data and media'}
            help={docsHelp('datasets', {
              excerpt:
                'Sets what a NEW dataset or upload is shared with. Existing ' +
                'ones keep the sharing they already have.',
            })}
            contentGutterX
            contentGutterY
            sx={{ mt: 3 }}
          >
            <Stack spacing={2} sx={{ maxWidth: 480 }}>
              <TextField
                select
                size="small"
                label="New datasets and files are shared with"
                value={currentOrg?.defaultResourceScope ?? 'org'}
                disabled={!canManage || busy}
                onChange={(event) =>
                  void settingsRequest({
                    action: 'set-default-resource-scope',
                    defaultResourceScope: event.target.value,
                  })
                    .then(() =>
                      enqueueSnackbar('Default sharing updated', {
                        variant: 'success',
                        persist: false,
                      }),
                    )
                    .catch((error: Error) =>
                      enqueueSnackbar(error.message, { variant: 'error' }),
                    )
                }
                helperText={
                  'Only affects things created from now on. Created from ' +
                  'an organization page there is no site to limit them to, ' +
                  'so those stay shared with all sites either way.'
                }
              >
                <MenuItem value="org">{'All sites'}</MenuItem>
                <MenuItem value="host">
                  {'Only the site they were created in'}
                </MenuItem>
              </TextField>
            </Stack>
          </CardDisplay>
                        </>
                      ),
                    },
                    {
                      id: 'plugins',
                      label: 'Plugins',
                      content: (
                        <CardDisplay
                          header={'Plugins'}
                          help={docsHelp('installYourFirstPlugin', {
                            anchor: '#step-7-off',
                            excerpt:
                              'Turning plugins on and off moved to its own ' +
                              'Plugins section. This card points you there.',
                          })}
                          contentGutterX
                          contentGutterY
                        >
                          <Typography variant="body2" color="text.secondary">
                            {'Enabling plugins, configuring them, and ' +
                              'managing marketplace installs now live in '}
                            <AppLink
                              href={`${buildRoute(Route.ORG_MARKETPLACE, {
                                orgSlug,
                              })}?tab=installed`}
                            >
                              {'Marketplace › Installed'}
                            </AppLink>
                            {'.'}
                          </Typography>
                        </CardDisplay>
                      ),
                    },
                    {
                      id: 'api-keys',
                      label: 'API keys',
                      content: <OrgApiKeysCard />,
                    },
                    {
                      id: 'branding',
                      label: 'Branding',
                      content: <OrgBrandingCard />,
                    },
                    {
                      id: 'sso',
                      label: 'Single sign-on',
                      // Shown to every admin, not only entitled orgs (AGL-1210):
                      // the unentitled state explains that SSO comes with
                      // Enterprise and that setup is self-serve once there.
                      // Hiding the tab would leave "can I do SSO?" unanswerable
                      // from inside the product.
                      content: <OrgSsoCard />,
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
        <Stack spacing={3}>
          {/* AGL-1974. This tab has told owners to "export anything you want
              to keep first" since it existed, and there was nothing to export
              with — one of six surfaces giving that instruction. The answer
              now sits in the same panel as the instruction. */}
          <DataExportCard user={user as never} orgId={currentOrg?.$id} />
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
                    'removed for 7 days and you can cancel, then erasure is ' +
                    'irreversible and we keep no copy of it. Export ' +
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
        </Stack>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        {/* Plugin zone (AGL-433): orgSettings widgets. The org-settings twin
            of the Data page's hold (AGL-1380/1422) — these widgets run
            `checkEntitlement`/`checkQuota` on the `org` handed to them, where
            undefined is the FREE tier rather than "unknown", so mounting them
            early has them quote a limit against no plan at all. */}
        {currentOrg?.$id && orgReady ? (<PluginWidgetSlot slot="orgSettings" orgId={currentOrg.$id} org={org} />) : null}
        {/* The deletion half of the leave path (AGL-1863). `orgReady` gates
            the subscription read: `undefined` while loading would answer "no
            subscription" and silently drop the downsell and winback steps
            for a paying org. */}
        <RetentionFunnelDialog
          open={deleteFunnelOpen}
          surface="account_delete"
          orgId={currentOrg?.$id ?? ''}
          subscriptionActive={
            orgReady &&
            isLiveSubscriptionStatus((org as any)?.subscription?.status)
          }
          currentPlan={org?.plan as OrgPlan | undefined}
          onClose={() => setDeleteFunnelOpen(false)}
          onDownsell={handleDeleteDownsell}
          onLeave={handleDeleteLeave}
        />
      </Container>
    </DashboardLayout>
  )
}
OrgSettings.displayName = 'Page:OrgSettings'

export default OrgSettings
