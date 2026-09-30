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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useEffect, useState } from 'react'
import { canManageOrg, isValidOrgSlug, supportedTimeZones } from '@aglyn/aglyn'
import { WORKSPACE_DOMAIN } from '../../constants/workspace-domain'
import { docsHelp } from '../../constants/docs-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgScope } from '../../hooks/use-org-scope'
import useOrgSettingsRequest from '../../hooks/use-org-settings-request'

/**
 * The organization's name, its workspace URL and its time zone.
 *
 * Extracted from the settings page when its sections became routes (AGL-2501).
 * The name and URL prefill from the org-scope projection, and both write
 * through the settings route rather than Firestore so the reverse index that
 * feeds the switcher and the breadcrumbs fans out with the change.
 *
 * The time zone is the one every site in the workspace inherits unless the
 * site sets its own (AGL-3252). It is not on the membership projection, so it
 * prefills from the org DOCUMENT, and nothing saves it until that document has
 * loaded: before then the field reads empty, and empty is a real value — UTC —
 * so a save inside the loading window would reset the zone rather than keep it.
 */
export function OrgGeneralCard() {
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const settingsRequest = useOrgSettingsRequest()
  const { org, ready: orgReady } = useCurrentOrg()
  const canManage = canManageOrg(currentOrg?.role)
  const isOwner = currentOrg?.role === 'owner'
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const storedTimeZone = String((org as any)?.timeZone ?? '')
  const [timeZone, setTimeZone] = useState('')
  useEffect(() => {
    setName(currentOrg?.orgName ?? '')
    setSlug(currentOrg?.slug ?? '')
  }, [currentOrg?.orgName, currentOrg?.slug])
  useEffect(() => {
    setTimeZone(storedTimeZone)
  }, [storedTimeZone])
  const nameChanged =
    Boolean(name.trim()) && name.trim() !== (currentOrg?.orgName ?? '')
  const timeZoneChanged = orgReady && timeZone !== storedTimeZone
  // Only a NEW address is judged. The saved one was valid under the rules of
  // the day it was taken, and the rules have since grown (the brand screen,
  // AGL-3362) — flagging it red would call a working address broken, and
  // there is nothing to fix until someone types a different one.
  const slugChanged = slug !== (currentOrg?.slug ?? '')
  const slugInvalid = Boolean(slug) && slugChanged && !isValidOrgSlug(slug)
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

  const handleSave = async () => {
    if (!currentOrg || busy || (!nameChanged && !timeZoneChanged)) return
    setBusy(true)
    try {
      if (nameChanged) {
        // API-routed so the reverse-index orgName (switcher, breadcrumbs)
        // fans out with the rename.
        await settingsRequest({ action: 'rename', name: name.trim() })
      }
      if (timeZoneChanged) {
        await settingsRequest({ action: 'set-time-zone', timeZone })
      }
      enqueueSnackbar('Organization settings saved', { variant: 'success' })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Saving failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
<CardDisplay
  header={'General'}
  help={docsHelp('glossary', {
    anchor: '#workspace',
    excerpt:
      'Rename the organization, change its workspace URL and set the ' +
      'time zone its sites inherit — "workspace" is the console word for ' +
      'your organization\'s home.',
  })}
  contentGutterX
  contentGutterY
>
  <Stack spacing={2}>
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
        error={slugInvalid}
        helperText={
          !isOwner
            ? 'Only the organization owner can change the URL.'
            : slugInvalid
              ? 'Use 3–30 lowercase letters, digits or dashes. Reserved ' +
                'names and brand names are not available.'
              : `Full address: ${slug || '…'}.${WORKSPACE_DOMAIN}. ` +
                'Old URLs keep redirecting after a change.'
        }
        sx={{ flexGrow: 1 }}
      />
      {isOwner ? (
        <Button
          variant="outlined"
          disabled={busy || !slugChanged || !isValidOrgSlug(slug)}
          onClick={() => void handleSlugChange()}
          sx={{ mt: 1 }}
        >
          {'Change URL'}
        </Button>
      ) : null}
    </Stack>
    <TextField
      select
      label="Time zone"
      value={timeZone}
      disabled={!canManage || !orgReady || busy}
      helperText={
        'Every site in this workspace dates its posts and pages in this ' +
        'zone, unless the site sets its own under Admin → General. Left on ' +
        'UTC, a post published at 7pm Central is dated the next day.'
      }
      onChange={(event) => setTimeZone(event.target.value)}
      // Empty is UTC, a real choice with a label of its own — without
      // `displayEmpty` the select renders it as a blank field.
      slotProps={{
        select: { displayEmpty: true },
        inputLabel: { shrink: true },
      }}
    >
      {/*
        Empty is the default rather than a missing choice: an org that has
        never set one renders its dates in UTC, and this row is how it says
        so out loud.
      */}
      <MenuItem value="">UTC (default)</MenuItem>
      {supportedTimeZones().map((zone) => (
        <MenuItem key={zone} value={zone}>
          {zone.replace(/_/g, ' ')}
        </MenuItem>
      ))}
    </TextField>
    <Typography variant="body2" color="text.secondary">
      {`Your role: ${currentOrg?.role ?? '—'}. Plan, billing and ` +
        'suspension are managed under Manage → Billing.'}
    </Typography>
    {canManage ? (
      <Stack direction="row">
        <Button
          variant="contained"
          disabled={busy || (!nameChanged && !timeZoneChanged)}
          onClick={() => void handleSave()}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </Stack>
    ) : (
      <Alert severity="info">
        {'Changing these settings requires the admin role.'}
      </Alert>
    )}
  </Stack>
</CardDisplay>
  )
}
OrgGeneralCard.displayName = 'OrgGeneralCard'

export default OrgGeneralCard
