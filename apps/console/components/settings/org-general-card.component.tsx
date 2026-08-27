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
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useEffect, useState } from 'react'
import { canManageOrg, isValidOrgSlug } from '@aglyn/aglyn'
import { WORKSPACE_DOMAIN } from '../../constants/workspace-domain'
import { docsHelp } from '../../constants/docs-links'
import { useOrgScope } from '../../hooks/use-org-scope'
import useOrgSettingsRequest from '../../hooks/use-org-settings-request'

/**
 * The organization's identity — its name and its workspace URL.
 *
 * Extracted from the settings page when its sections became routes (AGL-693).
 * Both fields prefill from the org-scope projection, and both write through
 * the settings route rather than Firestore so the reverse index that feeds the
 * switcher and the breadcrumbs fans out with the change.
 */
export function OrgGeneralCard() {
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const settingsRequest = useOrgSettingsRequest()
  const canManage = canManageOrg(currentOrg?.role)
  const isOwner = currentOrg?.role === 'owner'
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  useEffect(() => {
    setName(currentOrg?.orgName ?? '')
    setSlug(currentOrg?.slug ?? '')
  }, [currentOrg?.orgName, currentOrg?.slug])
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
  )
}
OrgGeneralCard.displayName = 'OrgGeneralCard'

export default OrgGeneralCard
