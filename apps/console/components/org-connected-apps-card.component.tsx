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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import useOrgPermissions from '../hooks/use-org-permissions'
import { useOrgScope } from '../hooks/use-org-scope'

/** A connected app as `/api/orgs/connected-apps` lists it. */
interface ConnectedApp {
  grantId: string
  appName: string
  returnsTo: string
  connectedBy: string | null
  connectedAt: string | null
  lastUsedAt: string | null
  access: 'view' | 'change'
}

const ACCESS_LABELS: Record<ConnectedApp['access'], string> = {
  view: 'View only',
  change: 'View and make changes',
}

const formatDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString() : '—')

/**
 * Connected apps (AGL-4225): the apps people connected to this workspace by
 * signing in — any MCP client, named as it names itself — with who
 * connected each, when, when it was
 * last used and what it may do, and a Disconnect that ends it at once.
 *
 * Beside the API keys card and behind the same permission, "Manage API
 * keys". Unlike that card it does not wait on the plan: a workspace that has
 * dropped API access still sees, and can end, the connections it made.
 * A connection's hourly credentials are never listed — only the connection.
 */
export function OrgConnectedAppsCard() {
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const orgId = currentOrg?.$id
  const orgPermissions = useOrgPermissions()
  const canManage = orgPermissions.loaded && orgPermissions.can('org.apiKeys')

  const [apps, setApps] = useState<ConnectedApp[]>([])
  const [listState, setListState] = useState<'pending' | 'error' | 'loaded'>('pending')

  const request = useCallback(
    async (method: 'GET' | 'POST', body?: Record<string, unknown>) => {
      if (!orgId) return null
      const response = await authorizedFetch(
        user,
        method === 'GET' ? `/api/orgs/connected-apps?orgId=${orgId}` : '/api/orgs/connected-apps',
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify({ ...body, orgId }) } : {}),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Connected apps request failed', { variant: 'warning', persist: false })
        return null
      }
      return payload
    },
    [orgId, user, enqueueSnackbar],
  )

  const refresh = useCallback(async () => {
    let payload: Awaited<ReturnType<typeof request>>
    try {
      payload = await request('GET')
    } catch {
      payload = null
    }
    if (!payload?.apps) {
      setListState('error')
      return
    }
    setApps(payload.apps)
    setListState('loaded')
  }, [request])

  useEffect(() => {
    if (orgId && user && canManage) void refresh()
  }, [orgId, user, canManage, refresh])

  const handleDisconnect = async (app: ConnectedApp) => {
    try {
      await confirm({
        title: `Disconnect ${app.appName}?`,
        description: `${app.appName} will lose access to this workspace immediately. Whoever connected it can connect it again later.`,
        confirmationText: 'Disconnect',
        confirmationButtonProps: { color: 'error' },
      })
    } catch {
      return
    }
    const result = await request('POST', { action: 'disconnect', grantId: app.grantId })
    if (result?.disconnected) {
      enqueueSnackbar(`${app.appName} disconnected`, { variant: 'success', persist: false })
    }
    await refresh()
  }

  if (!currentOrg || !canManage) return null

  return (
    <CardDisplay
      header={'Connected apps'}
      help={docsHelp('billing', {
        anchor: '#connected-apps',
        title: 'Connected apps',
        excerpt:
          'Apps connected to this workspace by signing in rather than with an API key. ' +
          'Each acts with the access chosen when it was connected; Disconnect ends it at once.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Apps that people connected to this workspace by signing in instead of with an API key. ' +
            'Each one acts with the access chosen when it was connected, and is listed under the name it gave itself.'}
        </Typography>
        {listState === 'error' ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void refresh()}>
                {'Retry'}
              </Button>
            }
          >
            {'We couldn’t load the connected apps. This does not mean there are none — any that exist are still connected.'}
          </Alert>
        ) : listState === 'pending' ? (
          <Typography variant="body2" color="text.secondary">
            {'Checking connected apps…'}
          </Typography>
        ) : apps.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No apps connected.'}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {apps.map((app) => (
              <Stack
                key={app.grantId}
                direction="row"
                spacing={2}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Stack sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {app.appName}
                    <Chip label={ACCESS_LABELS[app.access]} size="small" variant="outlined" sx={{ ml: 1 }} />
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                    {[
                      app.connectedBy ? `Connected by ${app.connectedBy}` : 'Connected',
                      `on ${formatDate(app.connectedAt)}`,
                      `· Last used ${formatDate(app.lastUsedAt)}`,
                    ].join(' ')}
                  </Typography>
                </Stack>
                <Button size="small" color="error" onClick={() => void handleDisconnect(app)}>
                  {'Disconnect'}
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </CardDisplay>
  )
}
OrgConnectedAppsCard.displayName = 'OrgConnectedAppsCard'

export default OrgConnectedAppsCard
