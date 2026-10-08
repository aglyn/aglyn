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

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Divider,
  Drawer,
  Stack,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import useBranding from '../hooks/use-branding'
import useHostActivityLogger from '../hooks/use-host-activity-logger'
import PasswordAdminControls from './password-admin-controls.component'
import PluginWidgetSlot from './plugin-widget-slot.component'

export interface SiteMemberDrawerProps {
  hostId: string
  /** The live siteMember doc (with `$id`); null keeps the drawer closed. */
  member: any | null
  onClose: () => void
}

/**
 * Site member detail drawer (AGL-546): the visitor account itself, its
 * suspend/reactivate — written via the client SDK (the `siteMembers` rules
 * block lets a site content writer change `suspended` and no other field,
 * AGL-3308; the tenant membership APIs enforce the flag at sign-in and
 * account load) — its password help, and its saved addresses.
 *
 * What a plugin holds about the person behind the account — what they
 * bought, what they subscribe to — is drawn by that plugin in the
 * `siteMember` zone, between the password help and the addresses.
 */
export function SiteMemberDrawer(props: SiteMemberDrawerProps) {
  const { hostId, member, onClose } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  // Org-scoped copy names the org's RESOLVED product name (AGL-2319).
  const { branding } = useBranding()
  const logActivity = useHostActivityLogger(hostId)
  const [busy, setBusy] = useState(false)

  const memberId = member ? String(member.$id ?? '') : ''
  const email = member ? String(member.email ?? '') : ''
  const suspended = member?.suspended === true

  const handleToggleSuspended = useCallback(async () => {
    if (!memberId || busy) return
    const next = !suspended
    const confirmed = await confirm(
      next
        ? {
            title: 'Suspend this member?',
            description:
              `"${email}" can no longer sign in on the published site; ` +
              'their account page signs out on next load. Orders and ' +
              'history are kept.',
            confirmationText: 'Suspend',
            confirmationButtonProps: { color: 'error' },
          }
        : {
            title: 'Reactivate this member?',
            description: `"${email}" can sign in again with their existing password.`,
            confirmationText: 'Reactivate',
          },
    )
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'siteMembers', memberId),
        { suspended: next },
      )
      enqueueSnackbar(next ? 'Member suspended' : 'Member reactivated', {
        variant: 'success',
        persist: false,
      })
      logActivity(next ? 'Suspended site member' : 'Reactivated site member', {
        type: 'member',
        name: email,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Could not update the member — check your role', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [
    memberId,
    busy,
    suspended,
    confirm,
    email,
    firestore,
    hostId,
    enqueueSnackbar,
    logActivity,
  ])

  // Password help (AGL-914). Unlike suspend/reactivate above, this cannot go
  // through the client SDK — the scrypt hashing and the session cut-off both
  // have to happen server-side.
  const passwordRequest = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await authorizedFetch(
        user,
        '/api/membership/admin-password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, memberId, ...payload }),
        },
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error ?? 'Request failed')
      return result
    },
    [user, hostId, memberId],
  )

  return (
    <Drawer anchor="right" open={Boolean(member)} onClose={onClose}>
      {member ? (
        <Stack spacing={2} sx={{ width: 400, maxWidth: '100vw', p: 3 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" noWrap sx={{ flex: 1 }}>
              {member.displayName || member.name || email || memberId}
            </Typography>
            {suspended ? (
              <Chip label="Suspended" size="small" color="error" />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {email || '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {member.createdAt?.toDate?.()
              ? `Joined ${member.createdAt.toDate().toLocaleDateString()}`
              : 'Join date unknown'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              color={suspended ? 'primary' : 'error'}
              disabled={busy}
              onClick={handleToggleSuspended}
            >
              {suspended ? 'Reactivate member' : 'Suspend member'}
            </Button>
          </Stack>

          <Divider textAlign="left">{'Password'}</Divider>
          <PasswordAdminControls
            email={email || null}
            subjectLabel={email || memberId}
            description={
              'For a member locked out of their account on this site. This ' +
              'is their site sign-in only — it has nothing to do with any ' +
              `${branding.productName} console account they may also have.`
            }
            onSendReset={async () => {
              await passwordRequest({ action: 'sendPasswordReset' })
              logActivity('Sent a site member a password reset', {
                type: 'member',
                name: email,
              })
            }}
            onSetPassword={async (password) => {
              await passwordRequest({ action: 'setPassword', password })
              logActivity('Set a site member’s password', {
                type: 'member',
                name: email,
              })
            }}
          />

          {/* What a plugin holds about this person: their purchases, say. */}
          <PluginWidgetSlot slot="siteMember" hostId={hostId} member={member} />

          {(member.addresses?.length ?? 0) > 0 ? (
            <>
              <Divider textAlign="left">{'Addresses'}</Divider>
              {(member.addresses ?? []).map((address: any, index: number) => (
                <Typography key={index} variant="body2" color="text.secondary">
                  {[
                    address.name,
                    address.line1,
                    address.line2,
                    `${address.city ?? ''} ${address.state ?? ''} ${
                      address.postalCode ?? ''
                    }`.trim(),
                    address.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Typography>
              ))}
            </>
          ) : null}
        </Stack>
      ) : null}
    </Drawer>
  )
}
SiteMemberDrawer.displayName = 'SiteMemberDrawer'

export default SiteMemberDrawer
