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
import { useAdminHosts } from '../hooks/use-admin-hosts'
import { useOrgWorkspace } from '../hooks/use-org-workspace'

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
  const { currentOrg } = useOrgWorkspace()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [members, setMembers] = useState<AglynOrgMember[]>([])
  const [invites, setInvites] = useState<any[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('editor')
  const [allHosts, setAllHosts] = useState(true)
  const [busy, setBusy] = useState(false)
  const [accessDraft, setAccessDraft] = useState<AccessDraft | null>(null)
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  // An org admin sees every org host via the memberRoles projection, so
  // this doubles as the org host directory for the access editor.
  const { hosts } = useAdminHosts(firestore, user?.uid, orgId)
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
    const [membersPayload, invitesPayload] = await Promise.all([
      request(`/api/orgs/members?orgId=${orgId}`, 'GET'),
      canManage
        ? request(`/api/orgs/invites?orgId=${orgId}`, 'GET')
        : Promise.resolve({ invites: [] }),
    ])
    if (membersPayload?.members) setMembers(membersPayload.members)
    if (invitesPayload?.invites) setInvites(invitesPayload.invites)
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
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Owners and admins manage the whole organization; editors and ' +
            'viewers can be limited to specific sites.'}
        </Typography>
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
              <TableCell>{'Access'}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.$id}>
                <TableCell>
                  {member.displayName || member.email || member.$id}
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
                  {canManage && member.role !== 'owner' ? (
                    <Button
                      size="small"
                      color="error"
                      onClick={() =>
                        void confirm({
                          title: 'Remove member?',
                          description: `${member.email ?? member.$id} loses access to every site in this organization.`,
                        }).then(async (accepted) => {
                          if (!accepted) return
                          const ok = await request('/api/orgs/members', 'POST', {
                            orgId,
                            action: 'remove',
                            uid: member.$id,
                          })
                          if (ok) await refresh()
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
    </CardDisplay>
  )
}
OrgMembersCard.displayName = 'OrgMembersCard'
OrgMembersCard.aglyn = true

export default OrgMembersCard
