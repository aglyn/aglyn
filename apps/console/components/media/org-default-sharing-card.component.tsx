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

import { canManageOrg } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { MenuItem, Skeleton, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgScope } from '../../hooks/use-org-scope'
import useOrgSettingsRequest from '../../hooks/use-org-settings-request'

/**
 * What a NEW dataset or upload starts out shared with (AGL-1048).
 *
 * Changes nothing that already exists — narrowing a whole library from a
 * toggle would break live pages with no confirmation, which is exactly what
 * the per-resource "Shared with" flow prevents.
 *
 * ## Why this lives on the media page and not in organization settings
 *
 * It was a card inside `org-profile-card.component.tsx`, so it rendered under
 * Settings → Profile beside the logo and the contact email. It is not
 * organization identity: it is the default `visibleTo` that
 * `defaultScopeForNewResource` stamps on the next upload, folder or dataset,
 * and the place someone reasons about that is the library those things land
 * in. The organization Data page would hide it from exactly the orgs that
 * still need it — that page refuses without the `dataStore` entitlement, and
 * media uploads are not entitlement-gated.
 *
 * ## Why the value comes from the org document
 *
 * `defaultResourceScope` is stored on `orgs/{orgId}`, and the membership
 * reverse-index entry behind `useOrgScope().currentOrg` does not carry it —
 * `UserOrgMembership` has `role`, `orgName`, `slug` and `orgWide`, and
 * nothing else. Reading it from there answered `undefined` on every render,
 * so the control displayed "All sites" for an org actually stored as `host`:
 * it reported the default rather than the setting. This reads the same field
 * the media library reads when it stamps a new folder, so the control and the
 * behavior cannot disagree.
 */
export function OrgDefaultSharingCard() {
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const settingsRequest = useOrgSettingsRequest()
  const canManage = canManageOrg(currentOrg?.role)
  const [busy, setBusy] = useState(false)

  const scope = String((org as any)?.defaultResourceScope ?? 'org')
  const handleChange = async (value: string) => {
    setBusy(true)
    try {
      await settingsRequest({
        action: 'set-default-resource-scope',
        defaultResourceScope: value,
      })
      enqueueSnackbar('Default sharing updated', {
        variant: 'success',
        persist: false,
      })
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Saving the default failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header={'Default sharing for new data and media'}
      help={docsHelp('media', {
        anchor: '#who-an-asset-is-shared-with',
        excerpt:
          'Sets what a NEW dataset or upload is shared with. Existing ' +
          'ones keep the sharing they already have.',
      })}
      contentGutterX
      contentGutterY
      sx={{ mb: 3 }}
    >
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        {!orgReady ? (
          // A placeholder, not a defaulted value. Rendering the select before
          // the org document resolves would show "All sites" to an org stored
          // as `host` for a render or two, and a settings control that states
          // the wrong current value is worse than one that is not there yet.
          <Skeleton variant="rounded" height={40} />
        ) : (
          <TextField
            select
            size="small"
            label="New datasets and files are shared with"
            value={scope}
            disabled={!canManage || busy}
            onChange={(event) => void handleChange(event.target.value)}
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
        )}
      </Stack>
    </CardDisplay>
  )
}
OrgDefaultSharingCard.displayName = 'OrgDefaultSharingCard'

export default OrgDefaultSharingCard
