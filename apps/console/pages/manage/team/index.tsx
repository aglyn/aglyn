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
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
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
import { useUser } from 'reactfire'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { checkTenantSeatQuota } from '../../../constants/entitlements'
import settingsNavTabItems from '../../../constants/settings-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import useCurrentTenant from '../../../hooks/use-current-tenant'

const PERMISSIONS: Array<{ key: string; label: string }> = [
  { key: 'createHosts', label: 'Create hosts' },
  { key: 'editBilling', label: 'Edit billing' },
  { key: 'publishToCommunity', label: 'Publish to community' },
  { key: 'installPlugins', label: 'Install plugins' },
  { key: 'manageMembers', label: 'Manage members' },
]

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
  const [members, setMembers] = useState<any[]>([])
  const [email, setEmail] = useState('')
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

  const refresh = useCallback(async () => {
    if (!user) return
    const payload = await request('GET')
    if (payload?.members) setMembers(payload.members)
  }, [user, request])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleAdd = useCallback(async () => {
    const value = email.trim().toLowerCase()
    if (!value) return
    setBusy(true)
    const payload = await request('POST', {
      email: value,
      permissions: { createHosts: true },
    })
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
  }, [email, request, enqueueSnackbar, refresh])

  const handleTogglePermission = useCallback(
    (member: any, key: string) => async () => {
      const permissions = {
        ...(member.permissions ?? {}),
        [key]: !member.permissions?.[key],
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
    [request, refresh],
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
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  disabled={busy || !email.trim()}
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
                        <Stack
                          direction="row"
                          sx={{ flexWrap: 'wrap', columnGap: 1 }}
                        >
                          {PERMISSIONS.map(({ key, label }) => (
                            <FormControlLabel
                              key={key}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={Boolean(member.permissions?.[key])}
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
                          ))}
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
                {'Permissions are recorded per member and enforced across ' +
                  'the console as each surface adopts them; host-level ' +
                  'access is managed per host on its dashboard.'}
              </Typography>
            </Stack>
          </CardDisplay>
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
