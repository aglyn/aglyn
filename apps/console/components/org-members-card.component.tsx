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
  canManageOrg,
  ORG_PERMISSIONS,
  resolveOrgPermissions,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type HostAccessRole,
  type OrgRole,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link as MuiLink,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { checkOrgSeatQuota } from '../constants/entitlements'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgHosts } from '../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'

const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'editor', 'viewer']
const HOST_ROLE_OPTIONS: Array<HostAccessRole | 'none'> = [
  'none',
  'viewer',
  'editor',
  'admin',
]

interface AccessDraft {
  uid: string
  label: string
  role: OrgRole
  allHosts: boolean
  hostAccess: Record<string, HostAccessRole>
}

/**
 * Organization membership manager (AGL-234): the permanent org-role model
 * (owner/admin/editor/viewer + all-hosts toggle) over /api/orgs/members
 * and /api/orgs/invites. People without an Aglyn account get a pending
 * invite they accept on first sign-in; per-site access editing lands with
 * the workspace host picker.
 */
export function OrgMembersCard() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [members, setMembers] = useState<AglynOrgMember[]>([])
  const [invites, setInvites] = useState<any[]>([])
  // Custom roles (AGL-243): named permission sets assignable per member.
  const [roles, setRoles] = useState<Array<{ $id: string; name?: string }>>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('editor')
  const [allHosts, setAllHosts] = useState(true)
  const [busy, setBusy] = useState(false)
  const [accessDraft, setAccessDraft] = useState<AccessDraft | null>(null)
  // Effective-permissions viewer (AGL-270).
  const [permissionsFor, setPermissionsFor] = useState<AglynOrgMember | null>(
    null,
  )
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  // Manager-seat quota hint (AGL-530): the roster counts against
  // managersPerOrg; extra seats sell on the Billing add-ons card.
  const { org } = useCurrentOrg()
  const seatQuota = checkOrgSeatQuota(org, 'managers', members.length)
  // An org admin sees every org host via the memberRoles projection, so
  // this doubles as the org host directory for the access editor.
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId)
  const orgHosts = useMemo(
    () => hosts.filter((host) => host['orgId'] === orgId),
    [hosts, orgId],
  )

  const request = useCallback(
    async (path: string, method: string, body?: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Organization request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [user, enqueueSnackbar],
  )

  const refresh = useCallback(async () => {
    if (!orgId || !user) return
    const [membersPayload, invitesPayload, rolesPayload] = await Promise.all([
      request(`/api/orgs/members?orgId=${orgId}`, 'GET'),
      canManage
        ? request(`/api/orgs/invites?orgId=${orgId}`, 'GET')
        : Promise.resolve({ invites: [] }),
      request(`/api/orgs/roles?orgId=${orgId}`, 'GET'),
    ])
    if (membersPayload?.members) setMembers(membersPayload.members)
    if (invitesPayload?.invites) setInvites(invitesPayload.invites)
    if (rolesPayload?.roles) setRoles(rolesPayload.roles)
  }, [orgId, user, canManage, request])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleAdd = useCallback(async () => {
    const target = email.trim().toLowerCase()
    if (!target || !orgId || busy) return
    setBusy(true)
    try {
      // Direct add when the account exists; fall back to an invite.
      const added = await request('/api/orgs/members', 'POST', {
        orgId,
        action: 'upsert',
        email: target,
        role,
        allHosts,
      })
      if (!added) {
        const invited = await request('/api/orgs/invites', 'POST', {
          orgId,
          action: 'create',
          email: target,
          role,
          allHosts,
        })
        if (!invited) return
        enqueueSnackbar(`Invited ${target}`, { variant: 'success' })
      } else {
        enqueueSnackbar(`Added ${target}`, { variant: 'success' })
      }
      setEmail('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [email, orgId, busy, role, allHosts, request, enqueueSnackbar, refresh])

  if (!currentOrg) return null

  return (
    <CardDisplay
      header={`Organization members — ${currentOrg.orgName ?? currentOrg.$id}`}
      help={docsHelp('inviteTeammates', {
        anchor: '#invite-someone',
        excerpt:
          'Add or invite people by email, set org and custom roles, and ' +
          'limit editors and viewers to specific sites.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Owners and admins manage the whole organization; editors and ' +
            'viewers can be limited to specific sites.'}
        </Typography>
        {Number.isFinite(seatQuota.limit) ? (
          <Typography variant="caption" color="text.secondary">
            {`${members.length} of ${seatQuota.limit} manager seats used`}
            {seatQuota.upgradeRequired ? (
              ' — upgrade for more'
            ) : seatQuota.addonPriceUsd != null ? (
              <>
                {` — extra seats $${seatQuota.addonPriceUsd}/mo in `}
                <MuiLink href="/org/billing#addons">{'Billing'}</MuiLink>
              </>
            ) : null}
          </Typography>
        ) : null}
        {canManage ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              size="small"
              label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              sx={{ minWidth: 240 }}
            />
            <TextField
              size="small"
              select
              label="Role"
              value={role}
              onChange={(event) => setRole(event.target.value as OrgRole)}
              sx={{ width: 120 }}
            >
              {ASSIGNABLE_ROLES.map((value) => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={allHosts}
                  onChange={(event) => setAllHosts(event.target.checked)}
                />
              }
              label="All sites"
            />
            <Button
              variant="contained"
              size="small"
              disabled={busy || !email.trim()}
              onClick={() => void handleAdd()}
            >
              {'Add or invite'}
            </Button>
          </Stack>
        ) : null}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Member'}</TableCell>
              <TableCell>{'Role'}</TableCell>
              <TableCell>{'Custom role'}</TableCell>
              <TableCell>{'Access'}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.$id}>
                <TableCell>
                  {/* Member detail page (AGL-364). */}
                  <MuiLink
                    href={buildRoute(Route.MANAGE_TEAM_MEMBER, { orgSlug, 
                      uid: member.$id,
                    })}
                    color="inherit"
                    underline="hover"
                  >
                    {member.displayName || member.email || member.$id}
                  </MuiLink>
                  {member.title ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="div"
                    >
                      {member.title}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  {canManage && member.role !== 'owner' ? (
                    <TextField
                      size="small"
                      select
                      value={member.role ?? 'viewer'}
                      onChange={(event) =>
                        void request('/api/orgs/members', 'POST', {
                          orgId,
                          action: 'upsert',
                          uid: member.$id,
                          role: event.target.value,
                          allHosts: member.allHosts === true,
                          hostAccess: member.hostAccess ?? {},
                        }).then((ok) => ok && refresh())
                      }
                      sx={{ width: 110 }}
                    >
                      {ASSIGNABLE_ROLES.map((value) => (
                        <MenuItem key={value} value={value}>
                          {value}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <Chip label={member.role ?? 'viewer'} size="small" />
                  )}
                </TableCell>
                <TableCell>
                  {canManage && member.role !== 'owner' ? (
                    <TextField
                      size="small"
                      select
                      value={(member as any).roleId ?? ''}
                      onChange={(event) =>
                        void request('/api/orgs/members', 'POST', {
                          orgId,
                          action: 'upsert',
                          uid: member.$id,
                          role: member.role ?? 'viewer',
                          allHosts: member.allHosts === true,
                          hostAccess: member.hostAccess ?? {},
                          roleId: event.target.value || null,
                        }).then((ok) => ok && refresh())
                      }
                      sx={{ width: 150 }}
                    >
                      <MenuItem value="">{'—'}</MenuItem>
                      {roles.map((customRole) => (
                        <MenuItem key={customRole.$id} value={customRole.$id}>
                          {customRole.name ?? customRole.$id}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (member as any).roleId ? (
                    <Chip
                      size="small"
                      label={
                        roles.find(
                          (customRole) =>
                            customRole.$id === (member as any).roleId,
                        )?.name ?? 'custom'
                      }
                    />
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  {member.role === 'owner' || member.role === 'admin' ? (
                    'All sites'
                  ) : canManage ? (
                    <Button
                      size="small"
                      onClick={() =>
                        setAccessDraft({
                          uid: member.$id,
                          label:
                            member.displayName || member.email || member.$id,
                          role: (member.role ?? 'viewer') as OrgRole,
                          allHosts: member.allHosts === true,
                          hostAccess: { ...(member.hostAccess ?? {}) },
                        })
                      }
                    >
                      {member.allHosts
                        ? 'All sites'
                        : `${Object.keys(member.hostAccess ?? {}).length} site(s)`}
                    </Button>
                  ) : member.allHosts ? (
                    'All sites'
                  ) : (
                    `${Object.keys(member.hostAccess ?? {}).length} site(s)`
                  )}
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    onClick={() => setPermissionsFor(member)}
                  >
                    {'Permissions'}
                  </Button>
                  {canManage && member.role !== 'owner' ? (
                    <Button
                      size="small"
                      color="error"
                      onClick={() =>
                        void confirm({
                          title: 'Remove member?',
                          description: `${member.email ?? member.$id} loses access to every site in this organization.`,
                        })
                          // confirm() resolves on accept and REJECTS on
                          // cancel — the catch is the cancel path.
                          .then(async () => {
                            const ok = await request(
                              '/api/orgs/members',
                              'POST',
                              {
                                orgId,
                                action: 'remove',
                                uid: member.$id,
                              },
                            )
                            if (ok) await refresh()
                          })
                          .catch(() => {
                            // Cancelled — nothing to do.
                          })
                      }
                    >
                      {'Remove'}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canManage && invites.length > 0 ? (
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Pending invites'}</Typography>
            {invites.map((invite) => (
              <Stack
                key={invite.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <Chip label={invite.role} size="small" />
                <Typography variant="body2">{invite.email}</Typography>
                <Button
                  size="small"
                  sx={{ ml: 'auto' }}
                  onClick={() =>
                    void request('/api/orgs/invites', 'POST', {
                      orgId,
                      action: 'revoke',
                      inviteId: invite.$id,
                    }).then((ok) => ok && refresh())
                  }
                >
                  {'Revoke'}
                </Button>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
      <Dialog
        open={Boolean(accessDraft)}
        onClose={() => setAccessDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{`Site access — ${accessDraft?.label ?? ''}`}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={accessDraft?.allHosts ?? false}
                onChange={(event) =>
                  setAccessDraft((draft) =>
                    draft ? { ...draft, allHosts: event.target.checked } : draft,
                  )
                }
              />
            }
            label={`All sites (as ${accessDraft?.role ?? 'member'})`}
          />
          {accessDraft?.allHosts
            ? null
            : orgHosts.map((host) => (
                <Stack
                  key={host.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
                    {host['displayName'] ?? host.$id}
                  </Typography>
                  <TextField
                    size="small"
                    select
                    value={accessDraft?.hostAccess[host.$id] ?? 'none'}
                    onChange={(event) =>
                      setAccessDraft((draft) => {
                        if (!draft) return draft
                        const hostAccess = { ...draft.hostAccess }
                        if (event.target.value === 'none') {
                          delete hostAccess[host.$id]
                        } else {
                          hostAccess[host.$id] = event.target
                            .value as HostAccessRole
                        }
                        return { ...draft, hostAccess }
                      })
                    }
                    sx={{ width: 110 }}
                  >
                    {HOST_ROLE_OPTIONS.map((value) => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccessDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => {
              if (!accessDraft) return
              setBusy(true)
              void request('/api/orgs/members', 'POST', {
                orgId,
                action: 'upsert',
                uid: accessDraft.uid,
                role: accessDraft.role,
                allHosts: accessDraft.allHosts,
                hostAccess: accessDraft.hostAccess,
              })
                .then(async (ok) => {
                  if (ok) {
                    setAccessDraft(null)
                    await refresh()
                  }
                })
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Saving…' : 'Save access'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(permissionsFor)}
        onClose={() => setPermissionsFor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {`Effective permissions — ${
            permissionsFor?.displayName ??
            permissionsFor?.email ??
            permissionsFor?.$id ??
            ''
          }`}
        </DialogTitle>
        <DialogContent>
          {permissionsFor
            ? (() => {
                // Role defaults → custom role → member overrides (AGL-243),
                // resolved with the roles list this card already loads.
                const customRole =
                  ((permissionsFor as any).roleId
                    ? (roles.find(
                        (candidate) =>
                          candidate.$id === (permissionsFor as any).roleId,
                      ) as AglynOrgCustomRole | undefined)
                    : undefined) ?? null
                const granted = resolveOrgPermissions(
                  permissionsFor as any,
                  customRole,
                )
                return (
                  <Stack spacing={0.75} sx={{ pt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {`Org role: ${permissionsFor.role ?? 'viewer'}` +
                        (customRole?.name
                          ? ` · custom role: ${customRole.name}`
                          : '')}
                    </Typography>
                    {ORG_PERMISSIONS.map((definition) => (
                      <Stack
                        key={definition.key}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <Chip
                          size="small"
                          color={granted[definition.key] ? 'success' : 'default'}
                          variant={granted[definition.key] ? 'filled' : 'outlined'}
                          label={granted[definition.key] ? 'yes' : 'no'}
                          sx={{ width: 48 }}
                        />
                        <Typography variant="body2">
                          {definition.label}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                )
              })()
            : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermissionsFor(null)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
OrgMembersCard.displayName = 'OrgMembersCard'
OrgMembersCard.aglyn = true

export default OrgMembersCard
