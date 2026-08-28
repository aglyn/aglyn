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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  AlertTitle,
  Avatar,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useEffect, useState } from 'react'
import MediaUrlField from '../media-url-field.component'
import { SITE_LOGO_HINT } from '../../constants/media-size-hints'
import { docsHelp } from '../../constants/docs-links'
import { buildRoute, Route } from '../../constants/route-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgScope, useOrgSlug } from '../../hooks/use-org-scope'
import useOrgSettingsRequest from '../../hooks/use-org-settings-request'

/**
 * The organization's identity — logo and contact details (AGL-363).
 *
 * Extracted from the settings page when its sections became routes (AGL-2501).
 * It owns its own form state and its own save: the section is a module now,
 * not a panel sharing the page's closure.
 *
 * ## What this card deliberately does not edit
 *
 * The platform billing address is READ-ONLY here. It is a tax input — Stripe
 * computes `automatic_tax` from it — and it had two editors, this card and
 * Billing → Settings, writing one stored field by two different code paths.
 * Whichever saved last won, so an address corrected on the billing page was
 * silently reverted by an unrelated logo change here. Billing → Settings is
 * the single editor; this card shows the value and links to it, because a
 * field that vanishes from the page someone knows it by reads as data loss.
 *
 * Three addresses exist in this product and none of them is the others:
 * the PLATFORM BILLING address below (what the org pays Aglyn, and the tax on
 * it); the SELLER PAYOUT identity, which lives in Stripe Connect and reaches
 * it through the hosted onboarding flow under Marketplace → Payouts; and the
 * STOREFRONT TAX ORIGIN, which is per-site and set in Commerce → Settings →
 * Taxes. Editing one must never look like editing another, which is why each
 * says at the field what it affects.
 */
export function OrgProfileCard() {
  const { currentOrg } = useOrgScope()
  const orgSlug = useOrgSlug()
  const { org, ready: orgReady } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const settingsRequest = useOrgSettingsRequest()
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState({
    logoUrl: '',
    contactEmail: '',
    contactPhone: '',
    contactWebsite: '',
  })
  useEffect(() => {
    setProfile({
      logoUrl: String((org as any)?.logoUrl ?? ''),
      contactEmail: String((org as any)?.contact?.email ?? ''),
      contactPhone: String((org as any)?.contact?.phone ?? ''),
      contactWebsite: String((org as any)?.contact?.website ?? ''),
    })
  }, [org])
  // The stored billing address, shown but not edited. Structured since
  // AGL-1133, so it renders as lines rather than as one opaque blob.
  const billingAddress = ((org as any)?.contact?.address ?? null) as {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  } | null
  const billingAddressLines = [
    billingAddress?.line1,
    billingAddress?.line2,
    [billingAddress?.city, billingAddress?.state, billingAddress?.postalCode]
      .filter(Boolean)
      .join(' '),
    billingAddress?.country,
  ]
    .map((line) => String(line ?? '').trim())
    .filter(Boolean)
  // Written when a save could not be carried across to Stripe (AGL-1133).
  // The fix is on the billing page now, so the copy sends people there
  // rather than telling them to save a form this card no longer has.
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
    // contact email, phone and website. Nothing here is worth saving until
    // there is something to have loaded.
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

  return (
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
        helperText={`Browse the org media library or paste an https URL. ${SITE_LOGO_HINT}`}
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
{/* The billing address, SHOWN and not edited. Its editor is
    Billing → Settings, which writes Stripe first and refuses the
    save when Stripe rejects it — a second best-effort writer here
    could only ever put a stale address back over an accepted one.
    Left visible because this is the page people know the address
    by, and a field that simply disappears reads as data loss. */}
<CardDisplay
  header={'Billing address'}
  help={docsHelp('billing', {
    excerpt:
      'The address Aglyn issues this organization’s invoices to, and ' +
      'the input sales tax on your Aglyn subscription is computed from.',
  })}
  contentGutterX
  contentGutterY
  sx={{ mt: 3 }}
>
  <Stack spacing={2} sx={{ maxWidth: 480 }}>
    {billingAddressLines.length ? (
      <Stack>
        {billingAddressLines.map((line) => (
          <Typography key={line} variant="body2">
            {line}
          </Typography>
        ))}
      </Stack>
    ) : (
      <Typography variant="body2" color="text.secondary">
        {'No billing address on file.'}
      </Typography>
    )}
    {/* Which of the three addresses this is. A merchant who reads
        "billing address" and assumes it keys their payouts has been
        misled by us, so the two it is NOT are named here. */}
    <Typography variant="body2" color="text.secondary">
      {'Where Aglyn bills this organization, and the tax input on what ' +
        'you pay us. It does not set where your marketplace payouts ' +
        'are sent — that identity lives in Stripe, under Marketplace → ' +
        'Payouts — and it is not the origin address sales tax on your ' +
        'own storefront’s orders is calculated from, which is set per ' +
        'site in Commerce → Settings → Taxes.'}
    </Typography>
    {/* The stored address and the one Stripe bills from can be out of
        step (AGL-1133). The flag is written from what Stripe was
        ASKED, not assumed, so this cannot cry wolf; saving on the
        billing page clears it. */}
    {stripeAddressDiverged && (
      <Alert severity="warning">
        <AlertTitle>{'Invoices use a different address'}</AlertTitle>
        {stripeAddressReason === 'sync-failed'
          ? 'The last change did not reach Stripe, so invoices and tax ' +
            'still use the previous address. Saving it again in ' +
            'Billing → Settings will retry.'
          : 'Stripe still has a billing address on file for this ' +
            'organization, and invoices and tax will keep using it — ' +
            'an invoice with no address cannot have tax calculated. ' +
            'Enter the correct address in Billing → Settings to ' +
            'replace it.'}
      </Alert>
    )}
    <Stack direction="row">
      <AppLink
        componentVariant="button"
        size="small"
        variant="outlined"
        href={buildRoute(Route.MANAGE_BILLING_SETTINGS, { orgSlug })}
      >
        {'Edit in Billing settings'}
      </AppLink>
    </Stack>
  </Stack>
</CardDisplay>
              </>
  )
}
OrgProfileCard.displayName = 'OrgProfileCard'

export default OrgProfileCard
