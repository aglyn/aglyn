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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Link,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { checkOrgSeatQuota } from '../constants/entitlements'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'
import useCurrentOrg from '../hooks/use-current-org'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import useHostActivityLogger from '../hooks/use-host-activity-logger'
import useOrgPermissions from '../hooks/use-org-permissions'

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'admin', label: 'Admin' },
]

export interface HostMembersCardProps {
  hostId: string
}

/**
 * Host user manager (AGL-107): manual add-by-email with a role, role
 * changes, and removal — all through /api/hosts/members (Admin SDK: email →
 * uid lookup, `memberRoles` sync, member-seat quota AGL-112). Roles
 * beyond admin/non-admin are recorded now and enforced with granular rules
 * (AGL-108 follow-up); the card says so instead of overpromising.
 */
export function HostMembersCard(props: HostMembersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org } = useCurrentOrg()
  const logActivity = useHostActivityLogger(hostId)
  const { permissions } = useOrgPermissions()
  const canManage = permissions.manageMembers
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [busy, setBusy] = useState(false)

  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: memberDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'members'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const members = useMemo(
    () =>
      [...(memberDocs ?? [])].sort((a, b) =>
        String(a.email ?? '').localeCompare(String(b.email ?? '')),
      ),
    [memberDocs],
  )
  const seatQuota = checkOrgSeatQuota(org, 'members', members.length)

  const request = useCallback(
    async (method: string, body: Record<string, unknown>) => {
      setBusy(true)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/hosts/members', {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, ...body }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'Member operation failed', {
            variant: 'warning',
            persist: false,
          })
          return null
        }
        return payload
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Member operation failed', { variant: 'error' })
        return null
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  const handleAdd = useCallback(async () => {
    const value = email.trim().toLowerCase()
    if (!value) return
    const payload = await request('POST', { email: value, role })
    if (!payload) return
    enqueueSnackbar(
      payload.status === 'invited'
        ? `Invited ${value} — access starts when they sign up`
        : `Added ${value}`,
      { variant: 'success', persist: false },
    )
    logActivity('Added member', { type: 'member', name: value })
    setEmail('')
  }, [email, role, request, enqueueSnackbar, logActivity])

  const handleRoleChange = useCallback(
    (member: any) => async (event: { target: { value: string } }) => {
      const payload = await request('PATCH', {
        memberId: member.$id,
        role: event.target.value,
      })
      if (!payload) return
      enqueueSnackbar('Role updated', { variant: 'success', persist: false })
      logActivity('Changed member role', {
        type: 'member',
        name: member.email,
      })
    },
    [request, enqueueSnackbar, logActivity],
  )

  const handleRemove = useCallback(
    (member: any) => async () => {
      const confirmed = await confirm({
        title: 'Remove this member?',
        description: `"${member.email}" loses access to this host.`,
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const payload = await request('DELETE', { memberId: member.$id })
      if (!payload) return
      enqueueSnackbar('Member removed', { variant: 'success', persist: false })
      logActivity('Removed member', { type: 'member', name: member.email })
    },
    [confirm, request, enqueueSnackbar, logActivity],
  )

  return (
    <CardDisplay
      header={'Users'}
      help={docsHelp('team', {
        anchor: '#site-membership',
        excerpt:
          'Teammates with console access to this site — add by email ' +
          'with a role; membership uses your plan’s member seats.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          {'Site users are organization members scoped to this site — the '}
          <Link href={buildRoute(Route.MANAGE_TEAM, { orgSlug })} color="secondary">
            {'organization Team page'}
          </Link>
          {' manages everyone in one place.'}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            select
            size="small"
            label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            sx={{ minWidth: 110 }}
          >
            {ROLE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            size="small"
            variant="contained"
            color="secondary"
            disabled={busy || !email.trim() || !canManage}
            onClick={handleAdd}
          >
            {'Add'}
          </Button>
        </Stack>
        {Number.isFinite(seatQuota.limit) ? (
          <Typography variant="caption" color="text.secondary">
            {`${members.length} of ${seatQuota.limit} member seats used`}
            {seatQuota.upgradeRequired ? (
              ' — upgrade for more'
            ) : seatQuota.addonPriceUsd != null ? (
              <>
                {` — extra seats $${seatQuota.addonPriceUsd}/mo in `}
                <Link href="/org/billing#addons">{'Billing'}</Link>
              </>
            ) : null}
          </Typography>
        ) : null}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Member'}</TableCell>
              <TableCell>{'Role'}</TableCell>
              <TableCell align="right">{'Actions'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <span>{host?.memberRoles?.[user?.uid ?? ''] === 'admin'
                    ? (user?.email ?? 'Owner')
                    : 'Account owner'}</span>
                  <Chip label="Owner" color="secondary" size="small" />
                </Stack>
              </TableCell>
              <TableCell>{'Admin'}</TableCell>
              <TableCell align="right">{'--'}</TableCell>
            </TableRow>
            {members.map((member) => (
              <TableRow key={member.$id} hover>
                <TableCell>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <span>{member.email}</span>
                    {member.status === 'invited' ? (
                      <Chip label="Invited" size="small" variant="outlined" />
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell>
                  <TextField
                    select
                    size="small"
                    variant="standard"
                    value={member.role ?? 'editor'}
                    onChange={handleRoleChange(member)}
                    disabled={busy || !canManage}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    color="error"
                    disabled={busy || !canManage}
                    onClick={handleRemove(member)}
                  >
                    {'Remove'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary">
          {'Admins get full console access to this host today; per-role ' +
            'restrictions for editors and viewers are recorded and roll ' +
            'out with granular permissions.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
HostMembersCard.displayName = 'HostMembersCard'

export default HostMembersCard
