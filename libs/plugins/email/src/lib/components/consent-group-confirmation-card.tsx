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
  consentGroupsAwaitConfirmation,
  pluginDocsHelp,
  readConsentGroups,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { type ConsentGroupAccess, useConsentGroupAccess } from './consent-group-access'
import { useEmailOrgMount } from './email-org-mount'

export interface ConsentGroupConfirmationCardProps {
  /** The org document the shell passes, kept live by its listener. */
  org?: Record<string, unknown> | null
  /**
   * Whether the reader may move the switch, when the section already asked.
   * Absent, the card reads the reader's membership itself.
   */
  access?: ConsentGroupAccess
}

/**
 * "Wait for confirmation across a consent group" — the org's one switch over
 * whether a confirmation click one site asked for holds the rest of the
 * group's mail (AGL-3316).
 *
 * ## What it decides
 *
 * A site that asks new subscribers to confirm holds its own mail on that
 * topic until they click. Off — the default — the other sites of a declared
 * consent group go on mailing them. On, every site of the group waits for the
 * click, on every send path that already reads a sibling's unsubscribe. A site
 * in no group has nobody to wait for, so an org that declared none changes
 * nothing by turning it on, and the card says so.
 *
 * ## Written through the route, read from the org document
 *
 * The field is server-owned — the rules deny it, and `consentGroups`, to every
 * client — so the switch posts `set-consent-group-confirmation` and never
 * writes Firestore. The shell's org listener delivers the stored value back,
 * which is what the switch shows; a local copy holds the click only until
 * then, and snaps back when the route refuses.
 */
export function ConsentGroupConfirmationCard(
  props: ConsentGroupConfirmationCardProps,
) {
  const { org, access } = props
  const orgId = useEmailOrgMount()?.orgId
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  // Handed the answer, the card opens no read of its own for it.
  const own = useConsentGroupAccess(access ? undefined : orgId)
  const { missing, ready } = access ?? own

  const stored = consentGroupsAwaitConfirmation(org)
  const declared = Object.keys(readConsentGroups(org)).length > 0
  const [checked, setChecked] = useState(stored)
  const [busy, setBusy] = useState(false)
  // The stored value wins whenever it changes: the click is optimistic, and
  // the org document is what every send path reads.
  useEffect(() => setChecked(stored), [stored])

  const handleChange = async (next: boolean) => {
    // Disabled for a member who may not move it; guarded anyway, because a
    // disabled control can still deliver a change event and the route would
    // refuse it.
    if (!orgId || !user || !ready || missing || busy) return
    setChecked(next)
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/orgs/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          action: 'set-consent-group-confirmation',
          awaitConfirmation: next,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'The setting could not be saved')
      }
      enqueueSnackbar(
        next
          ? 'The sites in a consent group now wait for the confirmation click'
          : 'The sites in a consent group no longer wait for each other',
        { variant: 'success', persist: false },
      )
    } catch (error: any) {
      console.error(error)
      setChecked(stored)
      enqueueSnackbar(error?.message ?? 'The setting could not be saved', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header={'Confirmation across consent groups'}
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#consent-group-confirmation',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={checked}
              disabled={!ready || !!missing || busy || !orgId}
              onChange={(event) => void handleChange(event.target.checked)}
            />
          }
          label="Wait for confirmation across a consent group"
        />
        <FormHelperText>
          {'When one site in a consent group asks someone to confirm by ' +
            'email, the group’s other sites wait for the click too, and send ' +
            'them nothing on that topic until they confirm. This applies only ' +
            'to sites your organization has declared one sender. It is off ' +
            'unless you turn it on.'}
        </FormHelperText>
        {!declared ? (
          <Typography variant="caption" color="text.secondary">
            {'Your organization has not declared a consent group, so this ' +
              'changes nothing until it does.'}
          </Typography>
        ) : null}
        {ready && missing ? (
          <Typography variant="caption" color="text.secondary">
            {`You need the ${missing} permission to change this.`}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
ConsentGroupConfirmationCard.displayName = 'ConsentGroupConfirmationCard'

export default ConsentGroupConfirmationCard
