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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  AlertTitle,
  Avatar,
  Button,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useEffect, useState } from 'react'
import MediaUrlField from '../media-url-field.component'
import { SITE_LOGO_HINT } from '../../constants/media-size-hints'
import { docsHelp } from '../../constants/docs-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgScope } from '../../hooks/use-org-scope'
import useOrgSettingsRequest from '../../hooks/use-org-settings-request'
import { canManageOrg } from '@aglyn/aglyn'

/**
 * The organization's public profile — logo, contact details and the billing
 * address Stripe Tax reads (AGL-363, AGL-1133).
 *
 * Extracted from the settings page when its sections became routes (AGL-693).
 * It owns its own form state and its own save: the section is a module now,
 * not a panel sharing the page's closure.
 */
export function OrgProfileCard() {
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const settingsRequest = useOrgSettingsRequest()
  const canManage = canManageOrg(currentOrg?.role)
  const [busy, setBusy] = useState(false)
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
  )
}
OrgProfileCard.displayName = 'OrgProfileCard'

export default OrgProfileCard
