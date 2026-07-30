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
  canManageOrg,
  checkEntitlement,
  resolveBrandingProfile,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import MediaUrlField from './media-url-field.component'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgScope } from '../hooks/use-org-scope'

/** The editable brand fields (subset of OrgBrandingProfile), all optional. */
interface BrandingDraft {
  productName: string
  fromName: string
  supportUrl: string
  primaryColor: string
  logoUrl: string
  faviconUrl: string
  emailLogoUrl: string
  customConsoleDomain: string
}

const EMPTY_DRAFT: BrandingDraft = {
  productName: '',
  fromName: '',
  supportUrl: '',
  primaryColor: '',
  logoUrl: '',
  faviconUrl: '',
  emailLogoUrl: '',
  customConsoleDomain: '',
}

/**
 * White-label brand settings (White-Label Phase 2). An Agency-tier org admin
 * edits the org's `brandingProfile` — product name, from-name, support URL,
 * primary color, and logo/favicon/email-logo URLs — persisted to the org doc
 * through the Admin-SDK `/api/orgs/settings` route (`update-branding`). Every
 * branded surface (console chrome, published site, transactional email) reads
 * these back through the one shared `resolveBrandingProfile`, so what an admin
 * sets here is exactly what recipients see.
 *
 * Gated on the `whiteLabel` entitlement (Agency tier, or an Enterprise per-org
 * override): a non-entitled org sees an upgrade prompt instead of the editor,
 * mirroring the API keys card.
 */
export function OrgBrandingCard() {
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { org } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  const entitled = checkEntitlement(org, 'whiteLabel')

  const [draft, setDraft] = useState<BrandingDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)

  // Prefill from the stored profile (the raw org-doc values, not the
  // gap-filled resolver output — the editor shows what is set, blanks show
  // the Aglyn default as placeholder text).
  useEffect(() => {
    const profile = (org as { brandingProfile?: Partial<BrandingDraft> })
      ?.brandingProfile
    setDraft({
      productName: String(profile?.productName ?? ''),
      fromName: String(profile?.fromName ?? ''),
      supportUrl: String(profile?.supportUrl ?? ''),
      primaryColor: String(profile?.primaryColor ?? ''),
      logoUrl: String(profile?.logoUrl ?? ''),
      faviconUrl: String(profile?.faviconUrl ?? ''),
      emailLogoUrl: String(profile?.emailLogoUrl ?? ''),
      customConsoleDomain: String(profile?.customConsoleDomain ?? ''),
    })
  }, [org])

  // The Aglyn defaults, shown as placeholders so blanks read as "falls back to
  // Aglyn" rather than looking broken.
  const defaults = resolveBrandingProfile(null)

  const set = (key: keyof BrandingDraft) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const handleSave = async () => {
    if (!currentOrg || busy) return
    setBusy(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          action: 'update-branding',
          brandingProfile: draft,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? 'Saving the brand failed')
      }
      enqueueSnackbar('Brand settings saved', { variant: 'success' })
    } catch (error) {
      console.error(error)
      enqueueSnackbar(
        error instanceof Error ? error.message : 'Saving the brand failed',
        { variant: 'error' },
      )
    } finally {
      setBusy(false)
    }
  }

  if (!currentOrg || !canManage) return null

  return (
    <CardDisplay
      header={'White-label brand'}
      help={docsHelp('billing', {
        anchor: '#tiers--entitlements',
        title: 'White-label',
        excerpt:
          'Replace the Aglyn brand — product name, logo, colors, support ' +
          'URL, and email from-name — across the console, your published ' +
          'sites, and transactional email. Included on the Agency plan.',
      })}
      contentGutterX
      contentGutterY
    >
      {!entitled ? (
        <Alert severity="info">
          {'White-labeling the platform is included on the '}
          <strong>{'Agency'}</strong>
          {' plan — see Billing to upgrade. Enterprise plans can enable it ' +
            'per organization.'}
        </Alert>
      ) : (
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <Typography variant="body2" color="text.secondary">
            {'These replace the Aglyn brand everywhere your organization and ' +
              'its sites are shown. Leave a field blank to keep the Aglyn ' +
              'default for it.'}
          </Typography>

          <TextField
            label="Product name"
            placeholder={defaults.productName}
            value={draft.productName}
            onChange={(event) => set('productName')(event.target.value)}
            helperText="Shown in the console chrome, site badge, and emails."
          />
          <TextField
            label="Email from-name"
            placeholder={defaults.fromName}
            value={draft.fromName}
            onChange={(event) => set('fromName')(event.target.value)}
            helperText="Display name on transactional email (the verified sending address is unchanged)."
          />
          <TextField
            label="Support URL"
            placeholder={defaults.supportUrl}
            value={draft.supportUrl}
            onChange={(event) => set('supportUrl')(event.target.value)}
            helperText="Linked from branded surfaces and email footers."
          />
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1,
                flexShrink: 0,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: draft.primaryColor || 'transparent',
              }}
            />
            <TextField
              fullWidth
              label="Primary color"
              placeholder="#1a73e8"
              value={draft.primaryColor}
              onChange={(event) => set('primaryColor')(event.target.value)}
              helperText="CSS hex color used for the console primary and site badge."
            />
          </Stack>

          {orgId ? (
            <>
              <MediaUrlField
                label="Logo URL"
                helperText="Console chrome + site badge. Browse the org media library or paste an https URL."
                orgId={orgId}
                value={draft.logoUrl}
                onChange={set('logoUrl')}
              />
              <MediaUrlField
                label="Favicon URL"
                helperText="Browser tab icon for branded console surfaces."
                orgId={orgId}
                value={draft.faviconUrl}
                onChange={set('faviconUrl')}
              />
              <MediaUrlField
                label="Email logo URL"
                helperText="Logo shown in transactional email headers (a hosted PNG works best)."
                orgId={orgId}
                value={draft.emailLogoUrl}
                onChange={set('emailLogoUrl')}
              />
            </>
          ) : null}

          <TextField
            label="Custom console domain"
            placeholder="app.youragency.com"
            value={draft.customConsoleDomain}
            onChange={(event) => set('customConsoleDomain')(event.target.value)}
            helperText="Saved now; domain routing to it ships in a later phase."
          />

          <Stack direction="row">
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void handleSave()}
            >
              {busy ? 'Saving…' : 'Save brand'}
            </Button>
          </Stack>
        </Stack>
      )}
    </CardDisplay>
  )
}
OrgBrandingCard.displayName = 'OrgBrandingCard'

export default OrgBrandingCard
