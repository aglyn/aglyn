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
  AppLink,
  CardDisplay,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
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
import MemberAvatar from './member-avatar.component'
import { useOrgSlug } from '../hooks/use-org-scope'
import useCurrentOrg from '../hooks/use-current-org'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import useHostActivityLogger from '../hooks/use-host-activity-logger'
import useOrgPermissions from '../hooks/use-org-permissions'

/** Site collaborators shown per page before "Load more" (AGL-1124). */
const MEMBER_PAGE_SIZE = 25

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
  // Paging (AGL-1124). This used to be a bare `limit(100)` with nothing
  // saying so, which is the worst of both: a site with 120 collaborators
  // showed 100 and looked complete. The window grows a page at a time and
  // over-fetches by one, so "there are more" is a fact rather than a guess
  // from `length === limit` (which is wrong exactly when the count is a
  // multiple of the page size).
  const [pageSize, setPageSize] = useState(MEMBER_PAGE_SIZE)
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'members'),
        limit(pageSize + 1),
      ),
    [firestore, hostId, pageSize],
    { idField: '$id' },
  )
  const hasMore = (memberDocs?.length ?? 0) > pageSize
  const members = useMemo(
    () =>
      [...(memberDocs ?? [])]
        // Drop the over-fetched probe row before rendering.
        .slice(0, pageSize)
        .sort((a, b) =>
          String(a.email ?? '').localeCompare(String(b.email ?? '')),
        ),
    [memberDocs, pageSize],
  )
  const seatQuota = checkOrgSeatQuota(org, 'members', members.length)

  // The owner row is the ORG's owner (AGL-1123). It used to render the
  // signed-in `user` whenever they happened to be an admin on this host, so
  // the row badged "Owner" was really "whoever is looking at this page" — it
  // never showed the owner, and an ownership transfer appeared not to have
  // taken. The owner's address comes from their org-member doc; a failed or
  // absent read falls back to the generic label rather than to the viewer.
  const orgId = (org as any)?.$id as string | undefined
  const ownerUid = (org as any)?.ownerUid as string | undefined
  const { data: ownerMember } = useFirestoreDoc<any>(
    () =>
      orgId && ownerUid
        ? doc(firestore, 'orgs', orgId, 'members', ownerUid)
        : null,
    [firestore, orgId, ownerUid],
  )
  const ownerLabel =
    (ownerMember?.email as string | undefined) ??
    (ownerMember?.displayName as string | undefined) ??
    'Account owner'

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
          <AppLink href={buildRoute(Route.MANAGE_TEAM, { orgSlug })} color="secondary">
            {'organization Team page'}
          </AppLink>
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
                <AppLink
                  href={`${buildRoute(Route.MANAGE_BILLING, { orgSlug })}#addons`}
                >
                  {'Billing'}
                </AppLink>
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
                  {/* The owner is a member row like any other, so it gets a
                      face too — otherwise the top row reads as broken beside
                      the ones that have one. Photo and email come from the
                      owner's org-member doc (AGL-1123), never from the
                      viewer. */}
                  <MemberAvatar
                    photoURL={ownerMember?.photoURL}
                    email={ownerMember?.email}
                    displayName={ownerLabel}
                    size={28}
                  />
                  <span>{ownerLabel}</span>
                  <Chip label="Owner" color="secondary" size="small" />
                  {ownerUid && ownerUid === user?.uid ? (
                    <Chip label="you" size="small" variant="outlined" />
                  ) : null}
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
                    {/* No avatar here at all before AGL-1126. An invited row
                        still gets one — Gravatar works off the email alone,
                        which is all an invite has. */}
                    <MemberAvatar
                      photoURL={member.photoURL}
                      email={member.email}
                      displayName={member.displayName}
                      size={28}
                    />
                    {/* Into the member's detail page, like the org Team
                        table (AGL-1124) — this list was a dead end, with no
                        way through to the person it names. An INVITED row
                        has no account behind it yet, so it stays plain text
                        rather than linking to a member page that cannot
                        exist. */}
                    {member.status === 'invited' ? (
                      <span>{member.email}</span>
                    ) : (
                      <AppLink
                        href={buildRoute(Route.MANAGE_TEAM_MEMBER, {
                          orgSlug,
                          uid: member.$id,
                        })}
                        color="inherit"
                        underline="hover"
                      >
                        {member.email || member.$id}
                      </AppLink>
                    )}
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
        {hasMore ? (
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setPageSize((size) => size + MEMBER_PAGE_SIZE)}
          >
            {'Load more'}
          </Button>
        ) : null}
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
