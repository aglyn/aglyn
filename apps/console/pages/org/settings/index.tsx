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
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import orgNavTabItems from '../../../constants/org-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgWorkspace } from '../../../hooks/use-org-workspace'

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Org settings without host context (AGL-236): rename (the only
 * client-writable org-doc key — everything else is Admin-SDK-only) and
 * workspace info. Slug changes and deletion stay deliberate future flows.
 */
const OrgSettings: NextPageWithLayout = () => {
  const { currentOrg, loading } = useOrgWorkspace()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const canManage = canManageOrg(currentOrg?.role)

  useEffect(() => {
    setName(currentOrg?.orgName ?? '')
  }, [currentOrg?.orgName])

  const handleRename = async () => {
    if (!currentOrg || !name.trim() || busy) return
    setBusy(true)
    try {
      // API-routed so the reverse-index orgName (switcher, breadcrumbs)
      // fans out with the rename.
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId: currentOrg.$id,
          action: 'rename',
          name: name.trim(),
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? 'Renaming failed')
      }
      enqueueSnackbar('Organization renamed', { variant: 'success' })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Renaming failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <NextPageTitle screen={'Settings – Organization'} />
      <DashboardLayout
        navTabItems={orgNavTabItems()}
        activeTab={buildRoute(Route.ORG_SETTINGS)}
        breadcrumbItems={[
          {
            children: currentOrg?.orgName ?? 'Organization',
            href: buildRoute(Route.ORG_MEMBERS),
          },
          { children: 'Settings', href: buildRoute(Route.ORG_SETTINGS) },
        ]}
        header={{
          children: 'Organization Settings',
          icon: { path: ICON_VARIANT_APP_SETTINGS },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {!loading && !currentOrg ? (
            <Alert severity="info">
              {'Create your first site to start an organization, or accept ' +
                'a pending invite from your dashboard.'}
            </Alert>
          ) : (
            <CardDisplay header={'General'} contentGutterX contentGutterY>
              <Stack spacing={2} sx={{ maxWidth: 480 }}>
                <TextField
                  label="Organization name"
                  value={name}
                  disabled={!canManage}
                  onChange={(event) => setName(event.target.value)}
                />
                <TextField
                  label="Workspace URL"
                  value={
                    currentOrg?.slug
                      ? `${currentOrg.slug}.${WORKSPACE_DOMAIN}`
                      : '—'
                  }
                  disabled
                  helperText={
                    'Workspace URLs are permanent for now — contact support ' +
                    'to change one.'
                  }
                />
                <Typography variant="body2" color="text.secondary">
                  {`Your role: ${currentOrg?.role ?? '—'}. Plan, billing and ` +
                    'suspension are managed under Manage → Billing.'}
                </Typography>
                {canManage ? (
                  <Stack direction="row">
                    <Button
                      variant="contained"
                      disabled={
                        busy ||
                        !name.trim() ||
                        name.trim() === (currentOrg?.orgName ?? '')
                      }
                      onClick={() => void handleRename()}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </Button>
                  </Stack>
                ) : (
                  <Alert severity="info">
                    {'Renaming the organization requires the admin role.'}
                  </Alert>
                )}
              </Stack>
            </CardDisplay>
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgSettings.displayName = 'Page:OrgSettings'
OrgSettings.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Settings – Organization' } },
]

export default OrgSettings
