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

import { canManageOrg } from '@aglyn/aglyn'
import { mdiAccountOutline } from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Avatar,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../components/layouts/main.layout'
import OrgActivityCard from '../../../../../components/org-activity-card.component'
import { useOrgHosts } from '../../../../../hooks/use-org-hosts'
import useOrgNavTabItems from '../../../../../hooks/use-org-nav-tabs'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'

/**
 * Team member detail (AGL-364): org admins/owners inspect and edit a
 * member — role, job title, deactivation — with that member's activity
 * log on the same page.
 */
const TeamMemberDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ uid: string }>()
  const uid = params?.uid as string
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const orgNavTabs = useOrgNavTabItems()
  const { currentOrg } = useOrgScope()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const canManage = canManageOrg(currentOrg?.role)

  const firestore = useFirestore()
  const { hosts } = useOrgHosts(firestore, user?.uid, currentOrg?.$id ?? null)
  const [member, setMember] = useState<any | null>(null)
  const [loadingMember, setLoadingMember] = useState(true)
  const [role, setRole] = useState('viewer')
  const [title, setTitle] = useState('')
  // Per-host access (AGL-388): restrict a member to specific sites.
  const [allHosts, setAllHosts] = useState(true)
  const [hostAccess, setHostAccess] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const loadMember = useCallback(async () => {
    if (!currentOrg?.$id || !uid) return
    setLoadingMember(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(
        `/api/orgs/members?orgId=${encodeURIComponent(currentOrg.$id)}`,
        { headers: { Authorization: `Bearer ${idToken}` } },
      )
      const payload = await response.json().catch(() => ({}))
      const found = (payload.members ?? []).find(
        (item: any) => item.$id === uid,
      )
      setMember(found ?? null)
      if (found) {
        setRole(found.role ?? 'viewer')
        setTitle(found.title ?? '')
        setAllHosts(found.allHosts !== false)
        setHostAccess({ ...(found.hostAccess ?? {}) })
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoadingMember(false)
    }
  }, [currentOrg?.$id, uid, user])
  useEffect(() => {
    void loadMember()
  }, [loadMember])

  const request = useCallback(
    async (body: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId: currentOrg?.$id, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Request failed')
      return payload
    },
    [user, currentOrg?.$id],
  )

  const handleSave = useCallback(async () => {
    if (!member || busy) return
    setBusy(true)
    try {
      // Admin/owner roles span every site; editor/viewer honor the
      // per-host restriction (AGL-388).
      const roleSpansAll = role === 'admin' || role === 'owner'
      await request({
        action: 'upsert',
        uid: member.$id,
        role,
        allHosts: roleSpansAll ? true : allHosts,
        hostAccess: roleSpansAll || allHosts ? {} : hostAccess,
        title: title.trim() || null,
      })
      enqueueSnackbar('Member updated', { variant: 'success', persist: false })
      void loadMember()
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Updating the member failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [
    member,
    busy,
    role,
    title,
    allHosts,
    hostAccess,
    request,
    loadMember,
    enqueueSnackbar,
  ])

  const handleRemove = useCallback(async () => {
    if (!member) return
    const accepted = await confirm({
      title: 'Remove this member?',
      description: `${member.email ?? member.$id} loses access to every site in the organization.`,
      confirmationText: 'Remove member',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await request({ action: 'remove', uid: member.$id })
      enqueueSnackbar('Member removed', { variant: 'success', persist: false })
      void router.push(buildRoute(Route.MANAGE_TEAM, { orgSlug }))
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Removing the member failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [member, confirm, request, router, enqueueSnackbar])

  const displayName = member?.displayName || member?.email || uid
  const isOwnerRow = member?.role === 'owner'

  return (
    <>
      <NextPageTitle screen={'Team member'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
        activeTab={buildRoute(Route.MANAGE_TEAM, { orgSlug })}
        breadcrumbItems={[
          { children: 'Team', href: buildRoute(Route.MANAGE_TEAM, { orgSlug }) },
          {
            children: displayName,
            href: buildRoute(Route.MANAGE_TEAM_MEMBER, { orgSlug,  uid }),
          },
        ]}
        header={{
          children: displayName,
          icon: { path: mdiAccountOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <Stack spacing={3}>
            {!loadingMember && !member ? (
              <Alert severity="warning">
                {'This person is not a member of the organization.'}
              </Alert>
            ) : (
              <CardDisplay
                header={'Member'}
                help={docsHelp('inviteTeammates', {
                  anchor: '#how-team-members-act',
                  excerpt:
                    "Set this member's role and job title, and restrict " +
                    'editors and viewers to specific sites.',
                })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={2} sx={{ maxWidth: 480 }}>
                  <Stack
                    direction="row"
                    spacing={2}
                    sx={{ alignItems: 'center' }}
                  >
                    <Avatar sx={{ width: 48, height: 48 }}>
                      {String(displayName).slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Stack sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" noWrap>
                        {displayName}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {member?.email ?? ''}
                        {member?.joinedAt?.seconds
                          ? ` · joined ${new Date(
                              member.joinedAt.seconds * 1000,
                            ).toLocaleDateString()}`
                          : ''}
                      </Typography>
                    </Stack>
                    {isOwnerRow ? (
                      <Chip size="small" color="secondary" label="Owner" />
                    ) : null}
                  </Stack>
                  {canManage && !isOwnerRow ? (
                    <>
                      <TextField
                        select
                        label="Role"
                        value={role}
                        onChange={(event) => setRole(event.target.value)}
                        size="small"
                      >
                        <MenuItem value="admin">{'Admin'}</MenuItem>
                        <MenuItem value="editor">{'Editor'}</MenuItem>
                        <MenuItem value="viewer">{'Viewer'}</MenuItem>
                      </TextField>
                      <TextField
                        label="Job title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        size="small"
                        placeholder="e.g. Marketing lead"
                      />
                      {/* Per-host access (AGL-388): admins/owners span all
                          sites; editor/viewer can be restricted so they
                          only see and work on the sites granted here. */}
                      {role === 'admin' ? (
                        <Alert severity="info">
                          {'Admins have access to every site in the ' +
                            'organization.'}
                        </Alert>
                      ) : (
                        <Stack spacing={0.5}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={allHosts}
                                onChange={(event) =>
                                  setAllHosts(event.target.checked)
                                }
                              />
                            }
                            label="Access to all sites"
                          />
                          {!allHosts ? (
                            <Stack spacing={0.5} sx={{ pl: 1 }}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {'Grant access to specific sites — the ' +
                                  'member only sees these.'}
                              </Typography>
                              {(hosts ?? []).map((host: any) => {
                                const current = hostAccess[host.$id]
                                return (
                                  <Stack
                                    key={host.$id}
                                    direction="row"
                                    spacing={1}
                                    sx={{ alignItems: 'center' }}
                                  >
                                    <Typography
                                      variant="body2"
                                      sx={{ flex: 1, minWidth: 0 }}
                                      noWrap
                                    >
                                      {host.displayName ?? host.$id}
                                    </Typography>
                                    <TextField
                                      select
                                      size="small"
                                      value={current ?? ''}
                                      onChange={(event) =>
                                        setHostAccess((prev) => {
                                          const next = { ...prev }
                                          if (event.target.value) {
                                            next[host.$id] = event.target.value
                                          } else {
                                            delete next[host.$id]
                                          }
                                          return next
                                        })
                                      }
                                      sx={{ minWidth: 130 }}
                                    >
                                      <MenuItem value="">{'No access'}</MenuItem>
                                      <MenuItem value="editor">
                                        {'Editor'}
                                      </MenuItem>
                                      <MenuItem value="viewer">
                                        {'Viewer'}
                                      </MenuItem>
                                    </TextField>
                                  </Stack>
                                )
                              })}
                              {(hosts ?? []).length === 0 ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {'No sites yet.'}
                                </Typography>
                              ) : null}
                            </Stack>
                          ) : null}
                        </Stack>
                      )}
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="contained"
                          disabled={busy}
                          onClick={() => void handleSave()}
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          color="error"
                          disabled={busy}
                          onClick={() => void handleRemove()}
                        >
                          {'Remove from organization'}
                        </Button>
                      </Stack>
                    </>
                  ) : !canManage ? (
                    <Alert severity="info">
                      {'Editing members requires the admin role.'}
                    </Alert>
                  ) : (
                    <Alert severity="info">
                      {'Ownership changes happen under Settings → ' +
                        'Transfer ownership.'}
                    </Alert>
                  )}
                </Stack>
              </CardDisplay>
            )}
            {currentOrg?.$id ? (
              // Changes made TO this member (role/access edits), AGL-389.
              <OrgActivityCard
                orgId={currentOrg.$id}
                targetId={uid}
                header={'Changes to this member'}
                max={30}
              />
            ) : null}
            {currentOrg?.$id ? (
              <OrgActivityCard
                orgId={currentOrg.$id}
                actorId={uid}
                header={'Activity by this member'}
                max={30}
              />
            ) : null}
          </Stack>
        </Container>
      </DashboardLayout>
    </>
  )
}
TeamMemberDetail.displayName = 'Page:TeamMemberDetail'

export default TeamMemberDetail
