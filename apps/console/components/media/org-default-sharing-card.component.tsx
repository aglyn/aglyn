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

import { canManageOrg, defaultMediaScopeOf } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { MenuItem, Skeleton, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgScope } from '../../hooks/use-org-scope'
import useOrgSettingsRequest from '../../hooks/use-org-settings-request'

/** Which of the two defaults a card sets (AGL-3662). */
export type OrgDefaultSharingKind = 'media' | 'data'

/**
 * Everything that differs between the two cards. They were one card and one
 * field, `defaultResourceScope`, until AGL-3662 split media out: an org can
 * want its photos on every site and its datasets on one.
 */
const SHARING_KINDS = {
  media: {
    header: 'Default sharing for new media',
    label: 'New files and folders are shared with',
    action: 'set-default-media-scope',
    field: 'defaultMediaScope',
    help: docsHelp('media', {
      anchor: '#who-an-asset-is-shared-with',
      excerpt:
        'Sets what a NEW upload or folder is shared with. Existing ' +
        'ones keep the sharing they already have.',
    }),
    helperText:
      'Only affects files and folders added from now on. Added from the ' +
      'organization Media page there is no site to limit them to, so ' +
      'those stay shared with all sites either way.',
  },
  data: {
    header: 'Default sharing for new datasets',
    label: 'New datasets are shared with',
    action: 'set-default-resource-scope',
    field: 'defaultResourceScope',
    help: docsHelp('datasets', {
      anchor: '#who-a-dataset-is-shared-with',
      excerpt:
        'Sets what a NEW dataset is shared with. Existing ones keep the ' +
        'sharing they already have.',
    }),
    helperText:
      'Only affects datasets created from now on, on a site’s Data page. ' +
      'Created here there is no site to limit them to, so those stay ' +
      'shared with all sites either way.',
  },
} as const

/**
 * What a NEW dataset, or a new upload or folder, starts out shared with
 * (AGL-1048) — one card per kind, each on the page where those things are
 * created: media on the organization Media page, datasets on the
 * organization Data page.
 *
 * Changes nothing that already exists — narrowing a whole library from a
 * toggle would break live pages with no confirmation, which is exactly what
 * the per-resource "Shared with" flow prevents.
 *
 * ## Why this is not in organization settings
 *
 * It was a card inside `org-profile-card.component.tsx`, so it rendered under
 * Settings → Profile beside the logo and the contact email. It is not
 * organization identity: it is the default `visibleTo` that
 * `defaultScopeForNewResource` stamps on the next upload, folder or dataset,
 * and the place someone reasons about that is the library those things land
 * in.
 *
 * ## Why the value comes from the org document
 *
 * Both fields are stored on `orgs/{orgId}`, and the membership reverse-index
 * entry behind `useOrgScope().currentOrg` does not carry them —
 * `UserOrgMembership` has `role`, `orgName`, `slug` and `orgWide`, and
 * nothing else. Reading it from there answered `undefined` on every render,
 * so the control displayed "All sites" for an org actually stored as `host`:
 * it reported the default rather than the setting. This reads the same value
 * the creators read when they stamp a new resource — `defaultMediaScopeOf`
 * for media, which falls back to the dataset field while media is unset — so
 * the control and the behavior cannot disagree.
 */
export function OrgDefaultSharingCard(props: { kind: OrgDefaultSharingKind }) {
  const kind = SHARING_KINDS[props.kind]
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const settingsRequest = useOrgSettingsRequest()
  const canManage = canManageOrg(currentOrg?.role)
  const [busy, setBusy] = useState(false)

  const stored =
    props.kind === 'media'
      ? defaultMediaScopeOf(org as any)
      : (org as any)?.defaultResourceScope
  const scope = String(stored ?? 'org')
  const handleChange = async (value: string) => {
    setBusy(true)
    try {
      await settingsRequest({ action: kind.action, [kind.field]: value })
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
      header={kind.header}
      help={kind.help}
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
            label={kind.label}
            value={scope}
            disabled={!canManage || busy}
            onChange={(event) => void handleChange(event.target.value)}
            helperText={kind.helperText}
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
