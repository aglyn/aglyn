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
  type AglynOrgCustomRole,
  consentGroupsAwaitConfirmation,
  type OrgPermission,
  orgPermissionLabel,
  pluginDocsHelp,
  readConsentGroups,
  resolveOrgPermissions,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useEmailOrgMount } from './email-org-mount'

/**
 * What `/api/orgs/settings` asks of a member for this switch: the route's own
 * gate, and the permission that opens this console.
 */
const REQUIRED_PERMISSIONS: readonly OrgPermission[] = [
  'org.settings',
  'data.manage',
]

/** A membership document, as the permission resolver reads one. */
type MemberRecord = NonNullable<Parameters<typeof resolveOrgPermissions>[0]>

/**
 * Which permission the signed-in member lacks for this switch — its label, or
 * `null` when they hold both — and whether that is known yet.
 *
 * Read off the member's own membership document, and their custom role when
 * they hold one, both of which the rules let a member read. The shell's
 * permission map carries the legacy keys and the plugin-declared ones, not
 * these two, and the CRM's org settings cards answer the same question the
 * same way. `ready` separates "no" from "not yet", so the switch disables
 * with a reason instead of hiding until the read lands. A membership that
 * cannot be read resolves no permission at all; the route decides either way.
 */
export function useConsentGroupConfirmationAccess(orgId: string | undefined): {
  missing: string | null
  ready: boolean
} {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const memberRead = useFirestoreDoc<MemberRecord>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  const member = memberRead.status === 'success' ? memberRead.data : undefined
  const roleId = typeof member?.roleId === 'string' ? member.roleId : ''
  const roleRead = useFirestoreDoc<AglynOrgCustomRole>(
    () => (orgId && roleId ? doc(firestore, 'orgs', orgId, 'roles', roleId) : null),
    [firestore, orgId, roleId],
  )
  // A reference that is never built stays `loading`, so a member with no
  // custom role has nothing left to wait for.
  const ready =
    Boolean(orgId && uid) &&
    memberRead.status !== 'loading' &&
    (!roleId || roleRead.status !== 'loading')
  const granted = resolveOrgPermissions(
    member ?? null,
    roleId && roleRead.status === 'success' ? (roleRead.data ?? null) : null,
  )
  const lacking = REQUIRED_PERMISSIONS.find((key) => granted[key] !== true)
  return { missing: lacking ? orgPermissionLabel(lacking) : null, ready }
}

export interface ConsentGroupConfirmationCardProps {
  /** The org document the shell passes, kept live by its listener. */
  org?: Record<string, unknown> | null
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
  const { org } = props
  const orgId = useEmailOrgMount()?.orgId
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { missing, ready } = useConsentGroupConfirmationAccess(orgId)

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
