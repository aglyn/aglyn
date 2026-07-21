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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Link,
  Stack,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { signInWithCustomToken } from 'firebase/auth'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../components/layouts/main.layout'
import adminNavTabItems from '../../../../../constants/admin-nav-tabs'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'

interface UserDetail {
  user: {
    uid: string
    email: string | null
    displayName: string | null
    disabled: boolean
    staff: boolean
    staffRole: string | null
    providers: string[]
    createdAt: string | null
    lastSignInAt: string | null
  }
  memberships: Array<{
    orgId: string
    orgName: string | null
    slug: string | null
    role: string | null
    roleId: string | null
    allHosts: boolean
    hostAccess: Record<string, string>
    joinedAt: string | null
  }>
  audit: Array<{
    id: string
    actorUid: string | null
    action: string | null
    target: string | null
    at: string | null
  }>
}

/**
 * Staff user detail (AGL-244): what is this account — identity + auth
 * state, staff role, org memberships with per-site access, and its
 * recent audit trail — plus impersonation (AGL-246).
 */
const AdminUserDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ uid: string }>()
  const uid = params?.uid
  const { data: user } = useUser()
  const auth = useAuth()
  const { enqueueSnackbar } = useSnackbar()
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid || !user) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/users/detail?uid=${encodeURIComponent(uid)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!active) return
        if (!response.ok) {
          setError(payload?.error ?? 'Lookup failed')
          return
        }
        setDetail(payload)
      } catch {
        if (active) setError('Lookup failed')
      }
    })()
    return () => {
      active = false
    }
  }, [uid, user])

  // Identity editing (AGL-361): names, photo, email through the audited
  // manage endpoint.
  const [edit, setEdit] = useState({
    displayName: '',
    email: '',
    photoUrl: '',
  })
  const [editBusy, setEditBusy] = useState(false)
  useEffect(() => {
    if (!detail) return
    setEdit({
      displayName: detail.user.displayName ?? '',
      email: detail.user.email ?? '',
      photoUrl: (detail.user as any).photoUrl ?? '',
    })
  }, [detail])
  const handleIdentitySave = useCallback(async () => {
    if (!uid || editBusy) return
    setEditBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/users/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ action: 'updateProfile', uid, ...edit }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Update failed', {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Identity updated', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Update failed', { variant: 'error' })
    } finally {
      setEditBusy(false)
    }
  }, [uid, edit, editBusy, user, enqueueSnackbar])

  const handleImpersonate = useCallback(async () => {
    if (!uid) return
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ uid }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Impersonation failed', {
          variant: 'warning',
          persist: false,
        })
      }
      // Replaces THIS browser session with the target account; the
      // impersonation banner (claims.impersonatedBy) offers the exit.
      // Use the named-app auth instance (useAuth) — bare getAuth() resolves
      // the '[DEFAULT]' app, which this app never registers.
      await signInWithCustomToken(auth, payload.token)
      window.location.assign('/')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Impersonation failed', { variant: 'error' })
    }
  }, [uid, user, auth, enqueueSnackbar])

  return (
    <>
      <NextPageTitle screen={'User – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_USERS)}
        breadcrumbItems={[
          { children: 'Users', href: buildRoute(Route.ADMIN_USERS) },
          {
            children: detail?.user.email ?? uid ?? '',
            href: '#',
          },
        ]}
        header={{
          children: detail?.user.email ?? 'User',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {error ? (
            <Alert severity="warning">{error}</Alert>
          ) : !detail ? (
            <Typography variant="body2" color="text.secondary">
              {'Loading…'}
            </Typography>
          ) : (
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header="Identity"
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          "The account's auth state and staff role, with audited identity edits. Impersonation replaces your session with this account.",
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        <Typography variant="body2">
                          {detail.user.displayName ?? '—'}
                        </Typography>
                        <Typography variant="body2">
                          {detail.user.email ?? 'no email'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {`uid ${detail.user.uid}`}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          {detail.user.disabled ? (
                            <Chip size="small" color="error" label="Disabled" />
                          ) : (
                            <Chip size="small" color="success" label="Active" />
                          )}
                          {detail.user.staff ? (
                            <Chip
                              size="small"
                              color="secondary"
                              label={`Staff: ${detail.user.staffRole ?? 'super'}`}
                            />
                          ) : (
                            <Chip size="small" label="Customer account" />
                          )}
                        </Stack>
                        {/* Assignment summary (AGL-378): staff role +
                            org roles at a glance. */}
                        <Typography variant="caption" color="text.secondary">
                          {[
                            detail.user.staff
                              ? `Staff (${detail.user.staffRole ?? 'super'})`
                              : 'Not staff',
                            detail.memberships.length
                              ? detail.memberships
                                  .map(
                                    (m) =>
                                      `${m.role ?? 'member'} in ${
                                        m.orgName ?? m.orgId
                                      }`,
                                  )
                                  .join(' · ')
                              : 'no organizations',
                          ].join(' · ')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {`Providers: ${detail.user.providers.join(', ') || '—'}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {`Created ${detail.user.createdAt ?? '—'} · last sign-in ${
                            detail.user.lastSignInAt ?? '—'
                          }`}
                        </Typography>
                        {!detail.user.staff ? (
                          <Button
                            size="small"
                            color="warning"
                            variant="outlined"
                            sx={{ alignSelf: 'flex-start' }}
                            onClick={() => void handleImpersonate()}
                          >
                            {'Impersonate (replaces your session)'}
                          </Button>
                        ) : null}
                        {/* Identity editing (AGL-361). */}
                        <Stack spacing={1} sx={{ pt: 1 }}>
                          <TextField
                            size="small"
                            label="Display name"
                            value={edit.displayName}
                            onChange={(event) =>
                              setEdit((prev) => ({
                                ...prev,
                                displayName: event.target.value,
                              }))
                            }
                          />
                          <TextField
                            size="small"
                            label="Email"
                            helperText="Changing the email marks it unverified"
                            value={edit.email}
                            onChange={(event) =>
                              setEdit((prev) => ({
                                ...prev,
                                email: event.target.value,
                              }))
                            }
                          />
                          <TextField
                            size="small"
                            label="Photo URL"
                            placeholder="https://…"
                            value={edit.photoUrl}
                            onChange={(event) =>
                              setEdit((prev) => ({
                                ...prev,
                                photoUrl: event.target.value,
                              }))
                            }
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={editBusy}
                            sx={{ alignSelf: 'flex-start' }}
                            onClick={() => void handleIdentitySave()}
                          >
                            {editBusy ? 'Saving…' : 'Save identity'}
                          </Button>
                        </Stack>
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header="Organizations"
                      help={docsHelp('architectureMultiTenancy', {
                        anchor: '#membership-lifecycle',
                        excerpt:
                          'Every organization this account belongs to, with its role and per-site access.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {detail.memberships.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'Not a member of any organization.'}
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{'Organization'}</TableCell>
                              <TableCell>{'Role'}</TableCell>
                              <TableCell>{'Sites'}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {detail.memberships.map((membership) => (
                              <TableRow key={membership.orgId}>
                                <TableCell>
                                  <Link
                                    href={buildRoute(Route.ADMIN_ORG_DETAIL, {
                                      orgId: membership.orgId,
                                    })}
                                    color="secondary"
                                    underline="hover"
                                  >
                                    {membership.orgName ?? membership.orgId}
                                  </Link>
                                </TableCell>
                                <TableCell>
                                  {membership.role ?? '—'}
                                  {membership.roleId ? ' (custom)' : ''}
                                </TableCell>
                                <TableCell>
                                  {/* Per-host access roles (AGL-378):
                                      show which sites and at what role,
                                      not just a count. */}
                                  {membership.allHosts ? (
                                    <Chip size="small" label="All sites" />
                                  ) : Object.keys(membership.hostAccess)
                                      .length === 0 ? (
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      {'—'}
                                    </Typography>
                                  ) : (
                                    <Stack
                                      direction="row"
                                      spacing={0.5}
                                      sx={{ flexWrap: 'wrap', gap: 0.5 }}
                                    >
                                      {Object.entries(
                                        membership.hostAccess,
                                      ).map(([hostId, role]) => (
                                        <Chip
                                          key={hostId}
                                          size="small"
                                          variant="outlined"
                                          label={`${hostId}: ${role}`}
                                        />
                                      ))}
                                    </Stack>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12 },
                  children: (
                    <CardDisplay
                      header="Recent audit trail"
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          'Audited staff actions performed by or on this account — the full record lives on the Audit log page.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {detail.audit.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'No audited actions involve this account.'}
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{'Action'}</TableCell>
                              <TableCell>{'Target'}</TableCell>
                              <TableCell>{'Actor'}</TableCell>
                              <TableCell>{'When'}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {detail.audit.map((entry) => (
                              <TableRow key={entry.id}>
                                <TableCell>{entry.action ?? '—'}</TableCell>
                                <TableCell>{entry.target ?? '—'}</TableCell>
                                <TableCell>
                                  {entry.actorUid === detail.user.uid
                                    ? 'this account'
                                    : (entry.actorUid ?? '—')}
                                </TableCell>
                                <TableCell>
                                  {entry.at
                                    ? new Date(entry.at).toLocaleString()
                                    : '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardDisplay>
                  ),
                },
              ]}
            />
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
AdminUserDetail.displayName = 'Page:AdminUserDetail'

export default AdminUserDetail
