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

import { mdiAccountMultipleOutline } from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  resolveRolePermissions,
  TENANT_ROLE_LABELS,
  type TenantCustomRole,
  type TenantRoleId,
} from '@aglyn/aglyn'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { checkTenantSeatQuota } from '../../../constants/entitlements'
import settingsNavTabItems from '../../../constants/settings-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import useCurrentTenant from '../../../hooks/use-current-tenant'
import useTenantPermissions from '../../../hooks/use-tenant-permissions'

const PERMISSIONS: Array<{ key: string; label: string }> = [
  { key: 'createHosts', label: 'Create hosts' },
  { key: 'editHosts', label: 'Edit hosts' },
  { key: 'editBilling', label: 'Edit billing' },
  { key: 'publishToCommunity', label: 'Publish to community' },
  { key: 'installPlugins', label: 'Install add-ons' },
  { key: 'manageMembers', label: 'Manage members' },
]

const ROLE_IDS: TenantRoleId[] = ['admin', 'editor', 'viewer']

/**
 * Tenant team manager (AGL-108): the account owner adds manager seats by
 * email with granular permissions. Reads/writes go through
 * /api/tenant/members (tenant-doc rules are staff-only, and seats are
 * quota-enforced per AGL-112). Permission flags are recorded now; console
 * surfaces adopt them incrementally.
 */
const ManageTeam: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  const { permissions, isOwner } = useTenantPermissions()
  const canManage = isOwner || permissions.manageMembers
  const [members, setMembers] = useState<any[]>([])
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<string>('editor')
  // Custom roles (AGL-133): owner-defined permission sets.
  const [customRoles, setCustomRoles] = useState<any[]>([])
  const [roleEditor, setRoleEditor] = useState<{
    id: string | null
    name: string
    permissions: Record<string, boolean>
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const seatQuota = checkTenantSeatQuota(tenant, 'managers', members.length + 1)

  const request = useCallback(
    async (method: string, body?: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/tenant/members', {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Team operation failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [user, enqueueSnackbar],
  )

  const rolesRequest = useCallback(
    async (method: string, body?: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/tenant/roles', {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Role operation failed', {
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
    if (!user) return
    const [payload, rolesPayload] = await Promise.all([
      request('GET'),
      rolesRequest('GET'),
    ])
    if (payload?.members) setMembers(payload.members)
    if (rolesPayload?.roles) setCustomRoles(rolesPayload.roles)
  }, [user, request, rolesRequest])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleAdd = useCallback(async () => {
    const value = email.trim().toLowerCase()
    if (!value) return
    setBusy(true)
    const payload = await request('POST', { email: value, role: newRole })
    setBusy(false)
    if (!payload) return
    enqueueSnackbar(
      payload.status === 'invited'
        ? `Invited ${value} — access starts when they sign up`
        : `Added ${value}`,
      { variant: 'success', persist: false },
    )
    setEmail('')
    void refresh()
  }, [email, newRole, request, enqueueSnackbar, refresh])

  const handleRoleChange = useCallback(
    (member: any) => async (event: { target: { value: string } }) => {
      const role = event.target.value
      // A role change resets overrides — the new role's defaults apply.
      setMembers((prev) =>
        prev.map((item) =>
          item.$id === member.$id
            ? { ...item, role, permissions: {} }
            : item,
        ),
      )
      const payload = await request('PATCH', {
        memberId: member.$id,
        role,
        permissions: {},
      })
      if (!payload) void refresh()
    },
    [request, refresh],
  )

  const customRoleMap: Record<string, TenantCustomRole | undefined> =
    Object.fromEntries(customRoles.map((role) => [role.$id, role]))

  const handleTogglePermission = useCallback(
    (member: any, key: string) => async () => {
      const effective = resolveRolePermissions(
        member.role,
        member.permissions,
        customRoleMap,
      ) as any
      const permissions = {
        ...(member.permissions ?? {}),
        [key]: !effective[key],
      }
      // Optimistic flip; refresh reconciles with the server state.
      setMembers((prev) =>
        prev.map((item) =>
          item.$id === member.$id ? { ...item, permissions } : item,
        ),
      )
      const payload = await request('PATCH', {
        memberId: member.$id,
        permissions,
      })
      if (!payload) void refresh()
    },
    [request, refresh, customRoleMap],
  )

  const handleRemove = useCallback(
    (member: any) => async () => {
      const confirmed = await confirm({
        title: 'Remove this team member?',
        description: `"${member.email}" loses access to your account.`,
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const payload = await request('DELETE', { memberId: member.$id })
      if (!payload) return
      enqueueSnackbar('Team member removed', {
        variant: 'success',
        persist: false,
      })
      void refresh()
    },
    [confirm, request, enqueueSnackbar, refresh],
  )

  return (
    <>
      <NextPageTitle screen={'Team'} />
      <DashboardLayout
        navTabItems={settingsNavTabItems()}
        activeTab={buildRoute(Route.MANAGE_TEAM)}
        breadcrumbItems={[
          {
            children: 'Team',
            href: buildRoute(Route.MANAGE_TEAM),
          },
        ]}
        header={{
          children: 'Team',
          icon: { path: mdiAccountMultipleOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'Team Members'}
            contentGutterX
            contentGutterY
            contentBordered="all"
          >
            <Stack spacing={1.5}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'flex-start' }}
              >
                <TextField
                  size="small"
                  label="Email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  sx={{ flexGrow: 1, maxWidth: 360 }}
                />
                <TextField
                  select
                  size="small"
                  label="Role"
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value)}
                  sx={{ minWidth: 110 }}
                >
                  {ROLE_IDS.map((role) => (
                    <MenuItem key={role} value={role}>
                      {TENANT_ROLE_LABELS[role]}
                    </MenuItem>
                  ))}
                  {customRoles.map((role) => (
                    <MenuItem key={role.$id} value={role.$id}>
                      {role.name}
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
                  {'Add team member'}
                </Button>
              </Stack>
              {Number.isFinite(seatQuota.limit) ? (
                <Typography variant="caption" color="text.secondary">
                  {`${members.length + 1} of ${seatQuota.limit} team seats ` +
                    'used (including you)' +
                    (seatQuota.upgradeRequired
                      ? ' — upgrade for more'
                      : seatQuota.addonPriceUsd != null
                        ? ` — extra seats $${seatQuota.addonPriceUsd}/mo (Billing)`
                        : '')}
                </Typography>
              ) : null}
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Member'}</TableCell>
                    <TableCell>{'Permissions'}</TableCell>
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
                        <span>{user?.email ?? 'You'}</span>
                        <Chip label="Owner" color="secondary" size="small" />
                      </Stack>
                    </TableCell>
                    <TableCell>{'Everything'}</TableCell>
                    <TableCell align="right">{'--'}</TableCell>
                  </TableRow>
                  {members.map((member) => (
                    <TableRow key={member.$id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <span>{member.email}</span>
                          {member.status === 'invited' ? (
                            <Chip
                              label="Invited"
                              size="small"
                              variant="outlined"
                            />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <TextField
                            select
                            size="small"
                            variant="standard"
                            value={
                              (member.role as string) in TENANT_ROLE_LABELS ||
                              member.role in customRoleMap
                                ? member.role
                                : 'viewer'
                            }
                            onChange={handleRoleChange(member)}
                            disabled={!canManage}
                            sx={{ maxWidth: 120 }}
                          >
                            {ROLE_IDS.map((role) => (
                              <MenuItem key={role} value={role}>
                                {TENANT_ROLE_LABELS[role]}
                              </MenuItem>
                            ))}
                            {customRoles.map((role) => (
                              <MenuItem key={role.$id} value={role.$id}>
                                {role.name}
                              </MenuItem>
                            ))}
                          </TextField>
                          <Stack
                            direction="row"
                            sx={{ flexWrap: 'wrap', columnGap: 1 }}
                          >
                            {PERMISSIONS.map(({ key, label }) => {
                              const effective = resolveRolePermissions(
                                member.role,
                                member.permissions,
                                customRoleMap,
                              ) as any
                              return (
                                <FormControlLabel
                                  key={key}
                                  control={
                                    <Checkbox
                                      size="small"
                                      checked={Boolean(effective[key])}
                                      disabled={!canManage}
                                      onChange={handleTogglePermission(
                                        member,
                                        key,
                                      )}
                                    />
                                  }
                                  label={
                                    <Typography variant="caption">
                                      {label}
                                    </Typography>
                                  }
                                />
                              )
                            })}
                          </Stack>
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          color="error"
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
                {'Roles set the default permissions; ticking a box applies ' +
                  'a per-member override on top (changing the role resets ' +
                  'overrides). Host-level access is managed per host on ' +
                  'its dashboard.'}
              </Typography>
            </Stack>
          </CardDisplay>

          <Divider sx={{ my: 3 }} />

          <CardDisplay
            header={'Custom roles'}
            contentGutterX
            contentGutterY
            contentBordered="all"
          >
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {'Define named permission sets beyond Admin/Editor/Viewer ' +
                  'and assign them like any role. Deleting a role drops ' +
                  'its members to Viewer until reassigned.'}
              </Typography>
              {customRoles.map((role) => (
                <Stack
                  key={role.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {role.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {PERMISSIONS.filter(
                        ({ key }) => role.permissions?.[key],
                      )
                        .map(({ label }) => label)
                        .join(', ') || 'No permissions'}
                    </Typography>
                  </Stack>
                  <Button
                    size="small"
                    disabled={!canManage}
                    onClick={() =>
                      setRoleEditor({
                        id: role.$id,
                        name: role.name ?? '',
                        permissions: { ...(role.permissions ?? {}) },
                      })
                    }
                  >
                    {'Edit'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={!canManage}
                    onClick={async () => {
                      const confirmed = await confirm({
                        title: 'Delete this role?',
                        description:
                          `Members with "${role.name}" drop to Viewer ` +
                          'until reassigned.',
                        confirmationText: 'Delete',
                        confirmationButtonProps: { color: 'error' },
                      })
                        .then(() => true)
                        .catch(() => false)
                      if (!confirmed) return
                      const payload = await rolesRequest('DELETE', {
                        roleId: role.$id,
                      })
                      if (payload) void refresh()
                    }}
                  >
                    {'Delete'}
                  </Button>
                </Stack>
              ))}
              <Button
                size="small"
                color="secondary"
                disabled={!canManage}
                sx={{ alignSelf: 'flex-start' }}
                onClick={() =>
                  setRoleEditor({ id: null, name: '', permissions: {} })
                }
              >
                {'Add custom role'}
              </Button>
            </Stack>
          </CardDisplay>

          <Dialog
            open={Boolean(roleEditor)}
            onClose={() => setRoleEditor(null)}
            maxWidth="xs"
            fullWidth
          >
            <DialogTitle>
              {roleEditor?.id ? 'Edit role' : 'Add custom role'}
            </DialogTitle>
            <DialogContent
              sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}
            >
              <TextField
                label="Role name"
                value={roleEditor?.name ?? ''}
                onChange={(event) =>
                  setRoleEditor((previous) =>
                    previous
                      ? { ...previous, name: event.target.value }
                      : previous,
                  )
                }
                size="small"
                autoFocus
                sx={{ mt: 1 }}
              />
              {PERMISSIONS.map(({ key, label }) => (
                <FormControlLabel
                  key={key}
                  control={
                    <Checkbox
                      size="small"
                      checked={Boolean(roleEditor?.permissions?.[key])}
                      onChange={() =>
                        setRoleEditor((previous) =>
                          previous
                            ? {
                                ...previous,
                                permissions: {
                                  ...previous.permissions,
                                  [key]: !previous.permissions[key],
                                },
                              }
                            : previous,
                        )
                      }
                    />
                  }
                  label={label}
                />
              ))}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRoleEditor(null)}>{'Cancel'}</Button>
              <Button
                variant="contained"
                color="secondary"
                disabled={!roleEditor?.name.trim()}
                onClick={async () => {
                  if (!roleEditor) return
                  const payload = await rolesRequest('POST', {
                    ...(roleEditor.id ? { roleId: roleEditor.id } : {}),
                    name: roleEditor.name.trim(),
                    permissions: roleEditor.permissions,
                  })
                  if (!payload) return
                  setRoleEditor(null)
                  enqueueSnackbar('Role saved', {
                    variant: 'success',
                    persist: false,
                  })
                  void refresh()
                }}
              >
                {'Save role'}
              </Button>
            </DialogActions>
          </Dialog>
        </Container>
      </DashboardLayout>
    </>
  )
}
ManageTeam.displayName = 'Page:ManageTeam'
ManageTeam.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Team',
    },
  },
]

export default ManageTeam
